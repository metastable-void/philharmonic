// Re-exports of the Philharmonic crate family.
//
// Each library crate is re-exported at the top level so consumers
// can depend on `philharmonic` alone. Connector implementations
// are feature-gated; use `default-features = false` to pick
// individually.

// Core vocabulary
pub use philharmonic_types as types;

// Storage substrate
pub use philharmonic_store as store;
pub use philharmonic_store_sqlx_mysql as store_sqlx_mysql;

// Execution substrate
pub use mechanics;
pub use mechanics_config;
pub use mechanics_core;

// Policy and workflow
pub use philharmonic_policy as policy;
pub use philharmonic_workflow as workflow;

// Connector layer — always-on
pub use philharmonic_connector_client as connector_client;
pub use philharmonic_connector_common as connector_common;
pub use philharmonic_connector_impl_api as connector_impl_api;
pub use philharmonic_connector_router as connector_router;
pub use philharmonic_connector_service as connector_service;

// Connector implementations — feature-gated (shipped)
#[cfg(feature = "connector-http-forward")]
pub use philharmonic_connector_impl_http_forward as connector_impl_http_forward;

#[cfg(feature = "connector-llm-openai-compat")]
pub use philharmonic_connector_impl_llm_openai_compat as connector_impl_llm_openai_compat;

#[cfg(feature = "connector-sql-postgres")]
pub use philharmonic_connector_impl_sql_postgres as connector_impl_sql_postgres;

#[cfg(feature = "connector-sql-mysql")]
pub use philharmonic_connector_impl_sql_mysql as connector_impl_sql_mysql;

#[cfg(feature = "connector-embed")]
pub use philharmonic_connector_impl_embed as connector_impl_embed;

#[cfg(feature = "connector-vector-search")]
pub use philharmonic_connector_impl_vector_search as connector_impl_vector_search;

// Connector implementations — feature-gated (unshipped, off by default)
#[cfg(feature = "connector-llm-anthropic")]
pub use philharmonic_connector_impl_llm_anthropic as connector_impl_llm_anthropic;

#[cfg(feature = "connector-llm-gemini")]
pub use philharmonic_connector_impl_llm_gemini as connector_impl_llm_gemini;

#[cfg(feature = "connector-email-smtp")]
pub use philharmonic_connector_impl_email_smtp as connector_impl_email_smtp;

// API
pub use philharmonic_api as api;

pub mod server;

#[cfg(feature = "webui")]
pub mod webui;
