# Philharmonic — Overview

Philharmonic is a workflow orchestration system built as a family of Rust
crates. This document is the system map: what the subsystems are, what
crates implement them, and how they fit together. Subsequent documents
in this directory go deeper into individual concerns.

## What the system does

A Philharmonic deployment runs JavaScript-based workflows. A workflow is
defined by a script and a configuration; an instance of a workflow is a
running execution that threads state across multiple step invocations.
Each step takes the current context plus a step-specific input, runs JS
in a sandboxed runtime, and returns updated context plus an output. The
system persists every state transition and every step's input/output as
an append-only history.

The intended deployment shape: a small number of orchestrator processes
talking to a clustered MySQL-family database for persistence, and a
horizontally-scaled fleet of stateless JavaScript worker nodes for
execution. The orchestrator does not embed the JS engine; it reaches
the workers over HTTP. This separation lets the storage and compute
sides scale independently.

## The two pillars

The system has two foundational subsystems, deliberately decoupled.

### Storage substrate

Append-only, content-addressed, entity-centric storage. Three concerns:

- **Content store.** Bytes keyed by SHA-256 hash. Write once, read by hash.
- **Identity store.** Pairs of UUIDs — a UUIDv7 internal ID for time-ordered
  storage, a UUIDv4 public ID for opaque external references.
- **Entity store.** Entities (typed by a kind UUID) with append-only
  revision logs. Each revision carries content-hash attributes,
  entity-reference attributes, and small typed scalar attributes.

Everything in the system that needs persistence — workflow templates,
instances, step records, future policy and connector entities — is
modeled as entity kinds layered on this substrate.

### Execution substrate

JavaScript jobs in stateless Boa runtimes, exposed as an HTTP service.
Each job takes a script (an ECMAScript module), a JSON argument, and a
host-side configuration; runs the script's default export; returns the
result as JSON or an error string. The service is horizontally
scalable: any worker can run any job, and no state persists across
jobs.

The orchestrator does not embed the executor. It calls the executor's
HTTP service like any other network dependency, with whatever
load-balancing or routing the deployment provides in front of the
worker fleet.

## The crates

Each subsystem is published as one or more crates on crates.io. Crates
are versioned independently and depend on each other through their
public APIs.

### Cornerstone

- **`philharmonic-types`** — vocabulary that multiple crates need: SHA-256
  hashes, phantom-typed UUID identities, content-addressed JSON,
  millisecond timestamps, the `Entity` trait and its associated slot
  declarations. No runtime, no I/O. Acts as the workspace's version
  anchor: types like `Uuid` and `JsonValue` are re-exported from here
  so that downstream crates share one canonical definition.

### Storage

- **`philharmonic-store`** — substrate trait definitions: `ContentStore`,
  `IdentityStore`, `EntityStore`, plus typed extension traits and an
  umbrella convenience trait. No SQL, no async runtime, no database
  driver dependencies. Crates that want to be backend-agnostic depend
  only on this.
- **`philharmonic-store-sqlx-mysql`** — the canonical implementation,
  backing the substrate onto MySQL-family databases (MySQL 8, MariaDB,
  Aurora MySQL, TiDB) via `sqlx`. Uses LCD-compatible SQL only; no
  vendor-specific features.

Future backend implementations (in-memory for testing, alternative SQL
flavors) would be sibling crates implementing the same trait surface.

### Execution

- **`mechanics-core`** — the JavaScript execution library. Wraps Boa
  runtimes in a worker pool, accepts jobs as `(module_source, arg,
  config)`, returns JSON results or stringified errors. Stateless per
  job; no cross-job mutable state.
- **`mechanics`** — the HTTP service exposing `mechanics-core` over the
  network. Worker nodes run this binary.

The orchestrator never depends on `mechanics-core` directly. It talks
to one or more `mechanics` instances over HTTP.

### Orchestration

- **`philharmonic-workflow`** *(planned)* — the orchestration layer.
  Defines workflow templates, instances, and step records as entity
  kinds. Implements the lifecycle state machine. Bridges the storage
  substrate (via the trait crate, generic over backend) and the
  execution substrate (via an `HTTP`-shaped trait, with the actual
  HTTP client provided at the application boundary).

### Future layers

Crates that exist as defensive name claims but have no current
implementation:

- **`philharmonic-policy`** — tenants, principals, permissions,
  authorization decisions. Defines the policy entity kinds and the
  evaluation logic.
- **`philharmonic-api`** — public HTTP API for external consumers.
  Translates between API requests and workflow operations.
- **`philharmonic-connector`** — connector routing and lifecycle
  management. Decides which connector services receive which requests
  for which tenants.
- **`philharmonic-realm`** — realm definitions: networking scope,
  source IP routing, and the boundary that connector services live
  inside.

These will be designed and built when the use cases for them
materialize. They do not exist yet beyond name reservation.

### Meta-crate

- **`philharmonic`** — name placeholder on crates.io. Currently empty.
  May eventually become a convenience re-export crate that pulls in
  the common subset of the system; the decision is deferred until
  there's a clear convenience worth providing.

## How the pieces connect

A workflow runs roughly like this:

1. A caller creates an instance of a template through the orchestration
   layer. The orchestrator mints an identity, creates a
   `WorkflowInstance` entity in the storage substrate, and writes the
   initial revision (status: pending, context: null, args: caller-supplied).
2. The caller (or a scheduler, or some external trigger) invokes
   `execute_step` on the orchestrator with the instance ID and a
   step-specific input.
3. The orchestrator reads the instance's latest revision (for current
   context), reads the template (for script and config), and assembles
   a job request: the script source, the combined `{context, args,
   input}` argument, the config blob.
4. The orchestrator sends the job to a `mechanics` worker over HTTP.
5. The worker runs the script in an isolated Boa realm and returns the
   result (a JSON value with `context` and `output` fields) or an
   error string.
6. The orchestrator validates the result shape, content-addresses the
   new context and the output, appends a new revision to the instance
   (status: running, new context), and creates a `StepRecord` entity
   capturing the input, output, and outcome.
7. The cycle repeats until the instance reaches a terminal status
   (completed, failed, or cancelled).

The storage substrate doesn't know about workflows. The execution
substrate doesn't know about persistence. The orchestration layer is
where the two meet, and it's the only layer that depends on both.

## Design philosophy

A few commitments shape decisions across the entire system. They are
covered in detail in `01-principles.md` but summarized here.

**Append-only.** Storage operations add data; they never modify or
delete. Soft-delete is expressed as a new revision with a deletion
scalar, not as removal. This collapses concurrency concerns and
gives every entity a complete audit trail by default.

**Content-addressed.** Anything that can be deduplicated and named by
content is stored as bytes keyed by SHA-256 hash. JSON content is
canonicalized (RFC 8785, JCS) before hashing so that semantically-equal
JSON produces equal hashes regardless of key order or whitespace.

**Backend-agnostic interfaces.** The storage substrate is defined as
traits, not as a concrete implementation. Multiple backends can
coexist; consumers choose at construction time. The same principle
applies to the executor — the orchestrator depends on an
`HTTP`-shaped trait, not on a specific HTTP client.

**Vocabulary collapses misuse paths.** Types in the cornerstone are
deliberately narrow. There is no `ScalarType::Str` because strings
should live in content blobs (for opaque text), in `i64` enum
encodings (for status fields), or in entity references (for
relationships) — never as ad-hoc scalar columns. The substrate
refuses to bless patterns that lead to bad designs.

**LCD MySQL.** The SQL implementation uses only features common to
MySQL 8, MariaDB, Aurora MySQL, and TiDB. No JSON columns, no
vendor-specific operators, no declared foreign keys. This makes
deployment portable across the MySQL-compatible ecosystem.

**Statelessness in execution.** JavaScript workers maintain no state
across jobs. Each job runs in an isolated realm; no cross-job caches,
no mutable globals, no worker affinity required for correctness.
Caching, if needed, lives outside the worker process.

## What this system is not

A few things worth being explicit about.

**Not a general-purpose database.** The substrate is shaped specifically
for entity-centric, append-only, revision-logged data. It would be the
wrong tool for relational analytics, full-text search, or
high-throughput key-value workloads.

**Not a JavaScript runtime in the orchestrator.** The orchestrator
process does not execute JS. It coordinates persistence and dispatches
jobs to the executor service. Embedding a JS engine in the orchestrator
would tie scaling of state management to scaling of compute, which the
two-pillar separation deliberately avoids.

**Not a message queue or event bus.** Workflows are step-driven by
explicit calls (from API requests, schedulers, etc.). The system does
not provide messaging primitives. If a deployment needs queuing
between external triggers and workflow execution, that's an
infrastructure concern handled outside Philharmonic.

**Not a deployment framework.** Crate consumers assemble their own
binaries and choose their own deployment topology. Philharmonic
provides the libraries; how to package, configure, monitor, and run
the resulting services is the deployer's responsibility.

## Reading order for the rest of these docs

- `01-principles.md` — design commitments shared across all subsystems.
- `02-00-components.md` — concrete inventory of components and crates.
- `02-01-cornerstone.md` — the cornerstone vocabulary crate.
- `02-02-storage.md` — storage substrate design.
- `02-03-execution.md` — execution substrate and JS contract.
- `02-04-connectors.md` — connector layer and capability tokens.
- `02-05-workflow.md` — orchestration layer design.
- `03-boundaries.md` — what each layer doesn't know about.
- `04-deferred.md` — explicitly out-of-scope features and why.
- `05-conventions.md` — workspace-wide practices.
