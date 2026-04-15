# Philharmonic — Workflow Orchestration

This document covers `philharmonic-workflow`, the crate that
defines workflow templates and instances as entity kinds, drives
the lifecycle state machine, and bridges between the storage
substrate and the execution substrate.

The workflow layer is where the two substrates meet. Storage on
one side (via the substrate traits, generic over backend);
execution on the other (via an HTTP-shaped executor trait, generic
over transport). The workflow crate is the only layer that depends
on both, and the only layer that gives meaning to the data the
substrate stores.

## What a workflow is

A workflow is a JavaScript program with persistent state. The
program — the script — runs in steps. Each step takes the current
state plus a step-specific input, computes new state plus an
output, and the system records both. Across multiple steps, the
state evolves; the workflow's history is the sequence of states it
passed through.

Three nouns capture this:

- A **template** is the reusable definition: a script and a
  configuration. Templates are authored once and instantiated many
  times.
- An **instance** is a single running execution of a template.
  It carries the evolving state and tracks where it is in its
  lifecycle.
- A **step record** is the immutable artifact of one step's
  execution. It captures the input, the output (or error), and the
  outcome.

The orchestrator's job is to coordinate these: create instances
from templates, drive instances through their step sequence,
record what happens, and surface results to callers.

## The three entity kinds

Each noun is an entity kind in the storage substrate, with slot
declarations that capture what each one needs to persist.

### `WorkflowTemplate`

The reusable definition. Two content slots: the script and the
config. One scalar for soft-deletion semantics.

- **`script`** (content slot) — the JavaScript module source as a
  content blob. Stored once per unique script across all templates;
  templates sharing a script dedupe naturally.
- **`config`** (content slot) — the host-side configuration as
  canonical JSON. Owned by `mechanics-core`'s schema; the workflow
  crate treats it as an opaque pass-through.
- **`is_retired`** (scalar, indexed) — boolean. False for active
  templates, true for retired ones. Active-template queries filter
  on this.

No entity-reference slots. Templates don't reference other
entities; they're standalone definitions.

### `WorkflowInstance`

A running (or completed) execution of a template. The instance's
revision log is its lifecycle history: each revision is a state
transition.

- **`context`** (content slot) — the current workflow context as
  canonical JSON. Updated on every successful step.
- **`args`** (content slot) — the per-instance arguments supplied
  at creation time. Set on revision 0 and unchanged thereafter.
- **`template`** (entity slot, pinned) — reference to the template
  this instance was created from, pinned to the template revision
  that was current at instance creation. Pinning is critical:
  template updates after instance creation must not change the
  behavior of running instances.
- **`status`** (scalar, indexed) — i64 enum encoding the
  lifecycle status. See the status enum section below.

Each revision of an instance represents a state transition. The
attribute values change as the workflow progresses, but the
substrate's append-only discipline preserves every prior state.

### `StepRecord`

The execution record for one step. Created once per step, never
revised.

- **`input`** (content slot) — the step's input, as canonical JSON.
- **`output`** (content slot) — the step's output on success.
  Absent on failure (the slot exists in the declaration; a given
  revision may or may not have a value).
- **`error`** (content slot) — the error string on failure,
  wrapped in a small JSON envelope. Absent on success.
- **`instance`** (entity slot, pinned) — reference to the
  instance this step belongs to, pinned to the instance revision
  current when the step started.
- **`step_seq`** (scalar, indexed) — i64 step number within the
  instance, starting at 0.
- **`outcome`** (scalar, indexed) — i64 enum: 0 for success, 1
  for failure.

Step records are independent entities, not revisions on the
instance. The reasoning is in the next section.

## Why step records are separate entities

A step does two things: it transitions the instance's state, and
it produces an execution artifact. These are different concerns
with different access patterns.

The instance's revision log is *state history*: what does this
workflow look like now, and how did it get here? Consumers reading
an instance care about the latest context, the current status, and
maybe a summary of past states. They generally don't care about
step-level execution details — inputs, outputs, timing.

Step records are *execution history*: what happened when each step
ran? Consumers querying step records care about inputs and outputs
across many instances ("all failed steps in the last hour"),
correlation with external events, and detailed diagnostic
information.

Putting both in the instance's revision log would conflate them.
Every "what's the current state of this instance" read would carry
along step-level data; every "all failed steps this hour" query
would have to scan instance revisions. Separating them lets each
read pattern be efficient.

The cost is one extra entity per step (more rows, more storage).
The benefit is queries that match access patterns and a clean
mental model.

## The status enum

`InstanceStatus` is encoded as i64. The variants:

- **`0` Pending** — the instance has been created but no step has
  run yet. Revision 0 always has this status.
- **`1` Running** — at least one step has executed; the instance
  is not in a terminal state.
- **`2` Completed** — the instance finished successfully. Terminal.
- **`3` Failed** — a step error transitioned the instance to
  failure. Terminal.
- **`4` Cancelled** — a caller cancelled the instance. Terminal.

The values are stable wire-format integers. They never change once
written; new statuses get new integers. The mapping is documented
in `philharmonic-workflow`'s code so callers can encode and decode
consistently.

`StepOutcome` is similarly encoded:

- **`0` Success** — the step ran and returned a valid result.
- **`1` Failure** — the step errored or returned malformed output.

## Status transitions

The state machine is deliberately small. Five statuses, with
allowed transitions:

```
Pending → Running   (first step starts)
Running → Running   (subsequent steps succeed)
Running → Completed (script signals completion)
Running → Failed    (step errors, including malformed output)
Pending → Cancelled (cancel before any step runs)
Running → Cancelled (cancel during execution)
```

Terminal states (Completed, Failed, Cancelled) have no outgoing
transitions. Once an instance is terminal, no further revisions
are appended. The substrate doesn't enforce this — it would
happily let you append to a terminated instance — but the workflow
engine refuses, returning a `WorkflowError::InstanceTerminal`.

The "script signals completion" transition deserves explanation. A
multi-step workflow needs some way for the script to say "I'm
done." The simplest convention: the script's return value includes
a `done: true` field at the top level of `output`, or sets a
specific field in `context` that the engine inspects. The exact
signal is a workflow-layer convention, not enforced by the script
or the executor.

For the first version, instances don't auto-transition to
Completed. They stay in Running indefinitely until a caller
explicitly marks them complete via an engine method, or until a
step error takes them to Failed. Auto-completion based on
script-level signaling can be added later if a use case demands it;
the substrate already supports it (just append a revision with
status: Completed).

## Pinning vs latest references

The substrate's `EntitySlot` declarations specify either
`SlotPinning::Pinned` (reference includes a specific revision
sequence) or `SlotPinning::Latest` (reference tracks the target's
latest revision at read time). The workflow layer uses both
deliberately.

**Instance → template is pinned.** When an instance is created,
the orchestrator records the template's current revision sequence
in the entity reference. Subsequent template updates don't affect
the running instance — it still uses the script and config from the
template revision it was created against.

This is critical for correctness. If template references tracked
latest, deploying a template update would change the behavior of
every running instance using that template, mid-execution. That's
almost never what anyone wants. Pinning makes template updates
safe: existing instances keep using the old version, new instances
get the new version.

**Step record → instance is pinned.** When a step starts, the
orchestrator records the instance's current revision sequence in
the entity reference. The step record says "I ran against this
specific snapshot of the instance." This makes step records
self-contained: reading a step record tells you exactly what state
the script saw, even if the instance has had many revisions since.

**Latest references are not currently used.** The workflow layer
doesn't yet have a use case that needs latest-tracking. If one
emerges (a "links to" relationship that should always reflect the
target's current state), the substrate already supports it; the
workflow layer just adds the slot.

## The execution model

The workflow layer's main API is "create an instance, then execute
steps against it, then read results." The engine is the API; it
holds references to the storage substrate and the executor and
coordinates them.

```
pub struct WorkflowEngine<S, E> {
    store: S,
    executor: E,
}

impl<S, E> WorkflowEngine<S, E>
where
    S: ContentStore + IdentityStore + EntityStore,
    E: StepExecutor,
{
    pub fn new(store: S, executor: E) -> Self { ... }

    pub async fn create_instance(
        &self,
        template_id: EntityId<WorkflowTemplate>,
        args: CanonicalJson,
    ) -> Result<EntityId<WorkflowInstance>, WorkflowError>;

    pub async fn execute_step(
        &self,
        instance_id: EntityId<WorkflowInstance>,
        input: CanonicalJson,
    ) -> Result<StepResult, WorkflowError>;

    pub async fn cancel(
        &self,
        instance_id: EntityId<WorkflowInstance>,
    ) -> Result<(), WorkflowError>;
}
```

The engine is generic over both axes. `S: ContentStore +
IdentityStore + EntityStore` covers the substrate dependencies;
`E: StepExecutor` covers the executor dependency. Both are trait
bounds, not concrete types — the engine doesn't know whether
storage is MySQL or in-memory, doesn't know whether the executor
is HTTP or in-process.

`create_instance` mints an identity, creates the entity with kind
`WorkflowInstance::KIND`, content-addresses the args blob, and
appends revision 0 with status: Pending and the args content
reference. Returns the new instance's typed ID.

`execute_step` is the substantial method. Its sequence:

1. Read the instance's latest revision. Verify the status is
   non-terminal (else return `InstanceTerminal`). Compute the next
   revision sequence as `latest_seq + 1`.
2. Read the template referenced by the instance (using the pinned
   revision). Extract the script and config content hashes.
3. Fetch the script bytes and config bytes from the content store.
   Parse the config as JSON (the executor expects it as a JSON
   value).
4. Read the latest context blob from the content store using the
   instance's `context` content reference. Parse as JSON.
5. Read the args blob from the content store using the instance's
   `args` content reference. Parse as JSON.
6. Assemble the executor's argument: `{context, args, input}`.
7. Submit the job to the executor: `executor.execute(script, &arg,
   &config).await`.
8. Process the result (next section).
9. Create the step record entity and append the new instance
   revision, in that order. Both writes happen against the
   substrate; failures are translated to `WorkflowError`.

The "in that order" matters. The step record references the
instance's *current* (pre-step) revision, so it's created against
that revision sequence. The new instance revision is appended
afterward, transitioning the state. If the step record creation
fails, the instance is unchanged (which is correct — the step
didn't logically happen). If the step record succeeds but the
instance revision append fails (e.g., concurrent step), the step
record is orphaned (an acceptable outcome — orphaned step records
are queryable for diagnosis, just not associated with a successful
state transition). The caller can retry; the substrate's
optimistic concurrency on revision sequences makes the retry safe.

`cancel` appends a revision with status: Cancelled. No step is run;
no executor call is made. Returns success if the instance is
non-terminal, returns `InstanceTerminal` if it's already in a
terminal state.

## Result processing

The executor returns one of three outcomes, and the workflow
engine handles each:

**Transport failure.** The executor couldn't be reached or didn't
respond (network timeout, connection refused, HTTP 5xx). The step
outcome is unknown — the script may or may not have run. The
engine doesn't record anything. Returns
`WorkflowError::ExecutorUnreachable` to the caller, who can retry.

**Script error.** The executor returned an error string (script
threw an exception, returned a rejected promise, etc.). The engine
content-addresses an error envelope (`{"error": <stringified>}`
wrapped in `CanonicalJson`), creates a step record with the input,
the error blob, `step_seq`, and `outcome: Failure`. Then it
appends an instance revision with the same context as before
(unchanged — the script didn't successfully update it) and status:
Failed. The instance is now terminal.

**Script success with malformed result.** The executor returned a
JSON value that doesn't have the `{context, output}` shape. The
engine treats this the same as a script error: it constructs an
error message ("malformed step result: missing 'context' field"),
content-addresses an error envelope around it, and proceeds as in
the script-error case. The step is failed, the instance becomes
Failed, and the caller can investigate why the script returned the
wrong shape.

**Script success with valid result.** The engine extracts `context`
and `output` from the result. Content-addresses both. Creates a
step record with the input, the output, `step_seq`, and `outcome:
Success`. Appends an instance revision with the new context and
status: Running.

The four outcomes are exhaustive. Every executor result lands in
exactly one of these branches, and each branch produces a
well-defined substrate state.

## The `StepExecutor` trait

The workflow engine reaches the executor through a trait, not a
concrete HTTP client. This keeps the workflow crate transport-agnostic
and testable without a running executor.

```
#[async_trait]
pub trait StepExecutor: Send + Sync {
    async fn execute(
        &self,
        script: &str,
        arg: &JsonValue,
        config: &JsonValue,
    ) -> Result<JsonValue, StepExecutionError>;
}

pub enum StepExecutionError {
    Transport(String),
    ScriptError(String),
}
```

The trait takes the script as a string (the engine reads the bytes
from the content store and passes them through), the arg as a
JSON value (the assembled `{context, args, input}` object), and
the config as a JSON value (the parsed config blob). It returns
either a JSON value (the script's return) or a `StepExecutionError`.

The two error variants distinguish transport failures (recoverable
by retry, no record created) from script errors (recorded as a
failed step). The engine's result-processing logic depends on this
distinction; mixing them would force the engine to guess.

The trait lives in the workflow crate. Implementations live
elsewhere: an `HttpStepExecutor` in a future
`philharmonic-workflow-http` crate (or in the application binary),
a `MockStepExecutor` for tests in test code.

The script is passed as a string rather than as a content hash.
The reasoning: scripts are small (typically a few KB), the
network cost is negligible compared to execution cost, and keeping
the executor stateless (no content-store access) matches the
execution substrate's design. If a future deployment wants
script caching at the executor side, the executor can hash the
incoming script and cache parsed forms; the wire format doesn't
need to change.

## Single-step orchestration

The engine executes one step per `execute_step` call. The caller
decides when to call it again. There is no "run to completion"
loop, no automatic step chaining, no scheduler embedded in the
workflow crate.

This shape matches the system's intended deployment: workflow
steps are triggered by external events (API requests, scheduler
ticks, queue messages), and each event produces one step. The
trigger source decides when to advance the instance.

For workflows that need to run multiple steps without external
prompting (a pipeline that advances autonomously), the natural
implementation is a loop in the caller's code:

```
loop {
    let result = engine.execute_step(instance_id, input).await?;
    if instance_terminal_after(result) { break; }
    input = compute_next_input(result);
}
```

Embedding this loop in the engine would require the engine to
decide when to stop, which couples the engine to workflow-specific
completion semantics. Keeping it in the caller's code keeps the
engine narrow.

A future scheduler crate could provide auto-stepping for workflows
that signal "advance me" via some convention (e.g., a `next_input`
field in the step output). That belongs above the workflow crate,
not inside it.

## What the workflow crate doesn't do

**Retry policy.** A step that fails could be retried with the
same input, or with backoff, or after some condition is met. The
workflow crate doesn't decide. The caller of `execute_step`
decides whether and when to retry. Retry policy is a deployment
or domain concern, not a workflow-engine concern.

**Tenant scoping.** Instances are not scoped to tenants in the
current design. When a `philharmonic-policy` crate exists with a
`Tenant` entity, instance entities can gain a tenant entity-slot
reference, and the engine can grow tenant-aware methods. Until
then, instances live in a flat namespace.

**Authorization.** Whether a caller is allowed to create an
instance or execute a step is a policy concern, not a workflow
concern. The engine assumes the caller has been authorized by
something upstream.

**Scheduling.** Triggering steps on a schedule, on external
events, or in response to other instances' completion — none of
this is the workflow crate's job. A scheduler crate (or external
infrastructure like cron or a queue consumer) calls
`execute_step` at the right times; the workflow crate just
processes the calls.

**Multi-instance coordination.** "Wait for these other instances
to complete before continuing" is a coordination primitive the
workflow crate doesn't provide. Scripts can implement it via
their host functions if needed (querying instance status from
within a script via a connector); the engine itself doesn't
coordinate across instances.

These exclusions follow the layering principle: the workflow
crate handles workflow-internal concerns (state, lifecycle, step
execution), and everything that requires context outside a single
workflow lives in higher layers.

## Construction

The engine's two type parameters mean construction sites combine a
storage backend and an executor:

```
let pool = MySqlPool::connect(&database_url).await?;
philharmonic_store_sqlx_mysql::migrate(&pool).await?;
let store = SqlStore::from_pool(pool);

let executor = HttpStepExecutor::new("https://mechanics.internal");

let engine = WorkflowEngine::new(store, executor);
```

The application binary is where the concrete types come together.
The workflow crate doesn't know which backend or which executor;
both are plug-ins.

For tests:

```
let store = MemStore::new();
let executor = MockStepExecutor::with_responses(vec![...]);
let engine = WorkflowEngine::new(store, executor);
```

Same engine, different plug-ins. The engine's logic is exercised
identically; only the surrounding infrastructure changes. This is
what the trait-based design buys: testability without dependence
on running services.

## What the workflow crate adds to the substrate

The substrate stores entities, revisions, content blobs. It
doesn't know what they mean. The workflow crate is what gives
them meaning:

- `WorkflowTemplate`, `WorkflowInstance`, `StepRecord` as named
  entity kinds with specific slot conventions.
- The `context` / `args` / `input` JSON convention for what gets
  passed to scripts.
- The `{context, output}` convention for what scripts return.
- The status enum encoding lifecycle states.
- The state-transition logic that turns script results into
  substrate revisions.
- The pinning convention (instance → template, step → instance)
  that keeps references stable.
- The error-handling logic that decides which substrate writes
  happen for which executor outcomes.

These are workflow concepts. They don't belong in the substrate
(which would couple the substrate to one consumer's domain) and
they don't belong in the executor (which would couple the
executor to one orchestrator's contract). They belong here, in
the layer that is by definition workflow-specific.

The substrate is general-purpose persistence; the executor is
general-purpose JS execution; the workflow crate is what turns
them into a workflow orchestrator. Other consumers of the substrate
or the executor would have their own equivalent layers, with
their own conventions.
