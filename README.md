# philharmonic

Meta-crate for the Philharmonic workflow orchestration system.
Re-exports every library crate in the family and provides three
binary targets for deployment.

## What this crate provides

### Library re-exports

Every published Philharmonic library crate is re-exported at the
top level so consumers can depend on `philharmonic` alone:

- `philharmonic::types` — cornerstone vocabulary
- `philharmonic::store` — storage substrate traits
- `philharmonic::store_sqlx_mysql` — MySQL storage backend
- `philharmonic::mechanics` / `mechanics_core` / `mechanics_config` — JS execution
- `philharmonic::policy` — tenants, principals, roles, tokens
- `philharmonic::workflow` — orchestration engine
- `philharmonic::connector_common` / `connector_client` / `connector_router` / `connector_service` — connector layer
- `philharmonic::connector_impl_api` — Implementation trait
- `philharmonic::api` — HTTP API library
- Connector implementations (feature-gated, see below)

### Binary targets

Three runnable servers, each with Clap CLI, TOML config file
loading, SIGHUP-based config reload, and optional TLS:

- **`mechanics-worker`** — JavaScript execution HTTP service.
- **`philharmonic-connector`** — per-realm connector service
  (token verification, payload decryption, Implementation
  dispatch).
- **`philharmonic-api`** — public API server with embedded
  WebUI and connector router.

All three support the `install` subcommand for systemd
deployment and compile for `x86_64-unknown-linux-musl`
(static linking).

### Feature flags

Connector implementations are feature-gated. All shipped
implementations are default-on:

- `connector-http-forward` (default)
- `connector-llm-openai-compat` (default)
- `connector-sql-postgres` (default)
- `connector-sql-mysql` (default)
- `connector-embed` (default)
- `connector-vector-search` (default)
- `connector-llm-anthropic` (off, unshipped)
- `connector-llm-gemini` (off, unshipped)
- `connector-email-smtp` (off, unshipped)
- `https` — TLS support for bin targets (rustls)

Use `default-features = false` to pick individually.

## License

Dual-licensed under `Apache-2.0 OR MPL-2.0`; either license
is sufficient.

## Contributing

This crate is developed as a submodule of the Philharmonic
workspace at
[metastable-void/philharmonic-workspace](https://github.com/metastable-void/philharmonic-workspace).
See
[`CONTRIBUTING.md`](https://github.com/metastable-void/philharmonic-workspace/blob/main/CONTRIBUTING.md)
for conventions.
