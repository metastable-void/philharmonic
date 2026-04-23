# philharmonic

Philharmonic is a workflow orchestration system built as a family of
Rust crates. This `philharmonic` crate is a placeholder — it reserves
the name on crates.io and gives readers a starting point for finding
the actual components. It does not re-export anything and has no
runtime dependencies.

## Current component crates

- [`philharmonic-types`](https://crates.io/crates/philharmonic-types) —
  cornerstone vocabulary: content-addressed JSON, phantom-typed UUID
  identities, SHA-256 hashes, entity-kind declarations.
- [`philharmonic-store`](https://crates.io/crates/philharmonic-store) —
  storage substrate traits: content store, identity store, entity store.
  Backend-agnostic.
- `philharmonic-store-sqlx-mysql` — canonical storage implementation
  against MySQL-family databases (in development).

More crates will appear as the system is built out. See the repository
for the current state.

## Why is this crate empty?

A workflow orchestration system is not one thing; it's several
subsystems with distinct concerns (vocabulary, storage, JS execution,
policy, API, connector routing). Publishing them as separate crates
lets consumers depend only on what they need, keeps compile times
reasonable, and lets each subsystem evolve at its own pace.

The `philharmonic` name on crates.io will eventually become a
convenience re-export crate that pulls in the common subset of the
system. For now, it's reserved.

## License

**This crate is dual-licensed under `Apache-2.0 OR MPL-2.0`**;
either license is sufficient; choose whichever fits your project.

**Rationale**: We generally want our reusable Rust crates to be
under a license permissive enough to be friendly for the Rust
community as a whole, while maintaining GPL-2.0 compatibility via
the MPL-2.0 arm. This is FSF-safer for everyone than `MIT OR Apache-2.0`,
still being permissive. **This is the standard licensing** for our reusable
Rust crate projects. Someone's `GPL-2.0-or-later` project should not be
forced to drop the `GPL-2.0` option because of our crates,
while `Apache-2.0` is the non-copyleft (permissive) license recommended
by the FSF, which we base our decisions on.

## Contributing

This crate is developed as a submodule of the Philharmonic
workspace. Workspace-wide development conventions — git workflow,
script wrappers, Rust code rules, versioning, terminology — live
in the workspace meta-repo at
[metastable-void/philharmonic-workspace](https://github.com/metastable-void/philharmonic-workspace),
authoritatively in its
[`CONTRIBUTING.md`](https://github.com/metastable-void/philharmonic-workspace/blob/main/CONTRIBUTING.md).
