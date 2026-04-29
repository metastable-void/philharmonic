use std::collections::HashSet;
use std::path::Path;
use std::process;
use std::sync::Arc;

use axum::Router;
use axum::body::Body;
use axum::extract::State;
use axum::http::{Request, Response, Uri};
use axum::routing::any;
use clap::Parser;
use philharmonic::connector_common::RealmId;
use philharmonic::connector_router::{
    DispatchConfig, HyperForwarder, RouterState, dispatch_request,
};
use philharmonic::connector_service::{
    MintingKeyEntry, MintingKeyRegistry, RealmPrivateKeyEntry, RealmPrivateKeyRegistry,
    VerifyingKey,
};
use philharmonic::server::cli::{BaseArgs, BaseCommand, resolve_config_paths};
use philharmonic::server::config::{ConfigError, load_config};
use philharmonic::server::reload::ReloadHandle;
use tokio::net::TcpListener;
use tokio::sync::RwLock;
use x25519_dalek::StaticSecret;
use zeroize::Zeroizing;

mod config;
use config::ConnectorConfig;

const ED25519_VERIFYING_KEY_BYTES: usize = 32;
const MLKEM_SECRET_KEY_BYTES: usize = 2400;
const X25519_SECRET_KEY_BYTES: usize = 32;
const COMBINED_REALM_PRIVATE_KEY_BYTES: usize = MLKEM_SECRET_KEY_BYTES + X25519_SECRET_KEY_BYTES;

#[derive(Parser)]
#[command(
    name = "philharmonic-connector",
    version,
    about = "Philharmonic connector router and per-realm service wrapper"
)]
struct Cli {
    #[command(subcommand)]
    command: Option<BaseCommand>,
}

#[derive(Clone)]
struct ReloadableRouterState {
    inner: Arc<RwLock<RouterState>>,
}

#[derive(Clone, Copy)]
struct RuntimeCounts {
    minting_keys: usize,
    realm_keys: usize,
    dispatch_realms: usize,
    dispatch_upstreams: usize,
}

struct Runtime {
    router_state: RouterState,
    counts: RuntimeCounts,
}

#[tokio::main]
async fn main() {
    if let Err(error) = run(Cli::parse()).await {
        eprintln!("philharmonic-connector: {error}");
        process::exit(1);
    }
}

async fn run(cli: Cli) -> Result<(), String> {
    match cli.command.unwrap_or_else(default_command) {
        BaseCommand::Version => {
            println!("{}", env!("CARGO_PKG_VERSION"));
            Ok(())
        }
        BaseCommand::Serve(args) => serve(args).await,
    }
}

fn default_command() -> BaseCommand {
    BaseCommand::Serve(BaseArgs {
        config: None,
        config_dir: None,
        bind: None,
    })
}

async fn serve(args: BaseArgs) -> Result<(), String> {
    let (primary, drop_in) = resolve_config_paths("connector", &args);
    let mut config = load_connector_config(&primary, &drop_in, &args)?;
    if let Some(bind) = args.bind {
        config.bind = bind;
    }

    let runtime = build_runtime(&config)?;
    let reloadable_state = ReloadableRouterState {
        inner: Arc::new(RwLock::new(runtime.router_state)),
    };
    let app = reloadable_router(reloadable_state.clone());

    let bind = config.bind;
    let protocol = start_server(app, &config).await?;
    let mut counts = runtime.counts;
    eprintln!("philharmonic-connector listening on {bind} ({protocol})");
    log_loaded_counts(counts);

    let reload_handle = ReloadHandle::new()
        .map_err(|error| format!("failed to install SIGHUP reload handler: {error}"))?;

    loop {
        reload_handle.notified().await;
        match load_connector_config(&primary, &drop_in, &args) {
            Ok(mut reloaded) => {
                if let Some(bind) = args.bind {
                    reloaded.bind = bind;
                }
                match build_runtime(&reloaded) {
                    Ok(runtime) => {
                        log_tls_reload_note(&reloaded);
                        *reloadable_state.inner.write().await = runtime.router_state;
                        log_reload(counts, runtime.counts);
                        counts = runtime.counts;
                    }
                    Err(error) => {
                        eprintln!("philharmonic-connector reload failed: {error}");
                    }
                }
            }
            Err(error) => {
                eprintln!("philharmonic-connector reload failed: {error}");
            }
        }
    }
}

fn load_connector_config(
    primary: &Path,
    drop_in: &Path,
    args: &BaseArgs,
) -> Result<ConnectorConfig, String> {
    match load_config::<ConnectorConfig>(primary, drop_in) {
        Ok(config) => Ok(config),
        Err(ConfigError::Io(error))
            if error.kind() == std::io::ErrorKind::NotFound && args.config.is_none() =>
        {
            eprintln!(
                "philharmonic-connector config {} not found; using built-in defaults",
                primary.display()
            );
            Ok(ConnectorConfig::default())
        }
        Err(error) => Err(error.to_string()),
    }
}

fn build_runtime(config: &ConnectorConfig) -> Result<Runtime, String> {
    let minting_registry = build_minting_key_registry(&config.minting_keys)?;
    let realm_registry = build_realm_private_key_registry(&config.realm_keys)?;
    let (dispatch_config, dispatch_upstreams) = build_dispatch_config(config)?;

    let router_state = RouterState::new(dispatch_config, Arc::new(HyperForwarder::new()));
    let counts = RuntimeCounts {
        minting_keys: count_unique_minting_keys(&minting_registry, &config.minting_keys),
        realm_keys: count_unique_realm_keys(&realm_registry, &config.realm_keys),
        dispatch_realms: config.dispatch.len(),
        dispatch_upstreams,
    };

    Ok(Runtime {
        router_state,
        counts,
    })
}

fn build_minting_key_registry(
    entries: &[config::MintingKeyConfig],
) -> Result<MintingKeyRegistry, String> {
    let mut registry = MintingKeyRegistry::new();
    for entry in entries {
        let key_bytes = read_fixed_key_file::<ED25519_VERIFYING_KEY_BYTES>(
            &entry.public_key_path,
            "Ed25519 verifying key",
        )?;
        let vk = VerifyingKey::from_bytes(&key_bytes).map_err(|error| {
            format!(
                "failed to parse Ed25519 verifying key {}: {error}",
                entry.public_key_path.display()
            )
        })?;
        registry.insert(
            entry.kid.clone(),
            MintingKeyEntry {
                vk,
                not_before: entry.not_before,
                not_after: entry.not_after,
            },
        );
    }
    Ok(registry)
}

fn build_realm_private_key_registry(
    entries: &[config::RealmKeyConfig],
) -> Result<RealmPrivateKeyRegistry, String> {
    let mut registry = RealmPrivateKeyRegistry::new();
    for entry in entries {
        let (kem_sk, x25519_sk) = read_realm_private_key(entry)?;
        registry.insert(
            entry.kid.clone(),
            RealmPrivateKeyEntry {
                kem_sk: Zeroizing::new(kem_sk),
                ecdh_sk: StaticSecret::from(x25519_sk),
                realm: RealmId::new(entry.realm_id.clone()),
                not_before: entry.not_before,
                not_after: entry.not_after,
            },
        );
    }
    Ok(registry)
}

fn read_realm_private_key(
    entry: &config::RealmKeyConfig,
) -> Result<([u8; MLKEM_SECRET_KEY_BYTES], [u8; X25519_SECRET_KEY_BYTES]), String> {
    if let Some(x25519_private_key_path) = &entry.x25519_private_key_path {
        let kem_sk = read_fixed_key_file::<MLKEM_SECRET_KEY_BYTES>(
            &entry.private_key_path,
            "ML-KEM-768 secret key",
        )?;
        let x25519_sk = read_fixed_key_file::<X25519_SECRET_KEY_BYTES>(
            x25519_private_key_path,
            "X25519 static secret key",
        )?;
        return Ok((kem_sk, x25519_sk));
    }

    let combined = read_key_file(&entry.private_key_path, COMBINED_REALM_PRIVATE_KEY_BYTES)?;
    let (kem_slice, x25519_slice) = combined.split_at(MLKEM_SECRET_KEY_BYTES);
    let kem_sk = <[u8; MLKEM_SECRET_KEY_BYTES]>::try_from(kem_slice).map_err(|_| {
        format!(
            "failed to split combined realm private key {}",
            entry.private_key_path.display()
        )
    })?;
    let x25519_sk = <[u8; X25519_SECRET_KEY_BYTES]>::try_from(x25519_slice).map_err(|_| {
        format!(
            "failed to split combined realm private key {}",
            entry.private_key_path.display()
        )
    })?;
    Ok((kem_sk, x25519_sk))
}

fn build_dispatch_config(config: &ConnectorConfig) -> Result<(DispatchConfig, usize), String> {
    let mut dispatch = DispatchConfig::new(config.domain_suffix.clone())
        .map_err(|error| format!("invalid dispatch domain suffix: {error}"))?;
    let mut upstream_count = 0usize;

    for (realm, upstream_config) in &config.dispatch {
        let upstreams = upstream_config
            .values()
            .iter()
            .map(|value| {
                value.parse::<Uri>().map_err(|error| {
                    format!("invalid upstream URI for dispatch realm '{realm}': {error}")
                })
            })
            .collect::<Result<Vec<_>, _>>()?;
        upstream_count = upstream_count
            .checked_add(upstreams.len())
            .ok_or_else(|| "dispatch upstream count overflowed usize".to_string())?;
        dispatch
            .insert_realm(realm.clone(), upstreams)
            .map_err(|error| format!("invalid dispatch entry for realm '{realm}': {error}"))?;
    }

    Ok((dispatch, upstream_count))
}

fn reloadable_router(state: ReloadableRouterState) -> Router {
    // RouterState is immutable in the router crate; delegating to its handler
    // lets this bin apply SIGHUP dispatch-table reloads without rebinding.
    Router::new()
        .fallback(any(reloadable_dispatch_request))
        .with_state(state)
}

async fn reloadable_dispatch_request(
    State(state): State<ReloadableRouterState>,
    request: Request<Body>,
) -> Response<Body> {
    let router_state = state.inner.read().await.clone();
    dispatch_request(State(router_state), request).await
}

async fn start_server(app: Router, config: &ConnectorConfig) -> Result<&'static str, String> {
    #[cfg(feature = "https")]
    if let Some(tls) = &config.tls {
        start_tls_server(app, config.bind, tls).await?;
        return Ok("https");
    }

    let listener = TcpListener::bind(config.bind)
        .await
        .map_err(|error| format!("failed to bind connector HTTP listener: {error}"))?;
    tokio::spawn(async move {
        if let Err(error) = axum::serve(listener, app).await {
            eprintln!("philharmonic-connector HTTP server stopped: {error}");
        }
    });
    Ok("http")
}

#[cfg(feature = "https")]
async fn start_tls_server(
    app: Router,
    bind: std::net::SocketAddr,
    tls: &config::TlsFileConfig,
) -> Result<(), String> {
    use hyper_util::rt::{TokioExecutor, TokioIo};
    use hyper_util::server::conn::auto::Builder;
    use hyper_util::service::TowerToHyperService;
    use tokio_rustls::TlsAcceptor;

    let tls_config = read_tls_server_config(tls)?;
    let acceptor = TlsAcceptor::from(Arc::new(tls_config));
    let listener = TcpListener::bind(bind)
        .await
        .map_err(|error| format!("failed to bind connector HTTPS listener: {error}"))?;

    tokio::spawn(async move {
        loop {
            let (stream, _) = match listener.accept().await {
                Ok(accepted) => accepted,
                Err(error) => {
                    eprintln!("philharmonic-connector HTTPS accept failed: {error}");
                    continue;
                }
            };
            let acceptor = acceptor.clone();
            let app = app.clone();
            tokio::spawn(async move {
                let tls_stream = match acceptor.accept(stream).await {
                    Ok(stream) => stream,
                    Err(error) => {
                        eprintln!("philharmonic-connector TLS handshake failed: {error}");
                        return;
                    }
                };
                let service = TowerToHyperService::new(app);
                let builder = Builder::new(TokioExecutor::new());
                if let Err(error) = builder
                    .serve_connection_with_upgrades(TokioIo::new(tls_stream), service)
                    .await
                {
                    eprintln!("philharmonic-connector HTTPS connection failed: {error}");
                }
            });
        }
    });

    Ok(())
}

#[cfg(feature = "https")]
fn read_tls_server_config(
    tls: &config::TlsFileConfig,
) -> Result<tokio_rustls::rustls::ServerConfig, String> {
    use std::io;

    let cert_bytes = std::fs::read(&tls.cert_path).map_err(|error| {
        format!(
            "failed to read TLS certificate file {}: {error}",
            tls.cert_path.display()
        )
    })?;
    let key_bytes = std::fs::read(&tls.key_path).map_err(|error| {
        format!(
            "failed to read TLS private key file {}: {error}",
            tls.key_path.display()
        )
    })?;

    let cert_chain = rustls_pemfile::certs(&mut io::BufReader::new(cert_bytes.as_slice()))
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("failed to parse TLS certificate chain: {error}"))?;
    if cert_chain.is_empty() {
        return Err("failed to parse TLS certificate chain: no certificates found".to_string());
    }

    let private_key = rustls_pemfile::private_key(&mut io::BufReader::new(key_bytes.as_slice()))
        .map_err(|error| format!("failed to parse TLS private key: {error}"))?
        .ok_or_else(|| "failed to parse TLS private key: no private key found".to_string())?;

    let mut config = tokio_rustls::rustls::ServerConfig::builder()
        .with_no_client_auth()
        .with_single_cert(cert_chain, private_key)
        .map_err(|error| format!("failed to build TLS server config: {error}"))?;
    config.alpn_protocols = vec![b"h2".to_vec(), b"http/1.1".to_vec()];
    Ok(config)
}

fn read_fixed_key_file<const N: usize>(path: &Path, label: &str) -> Result<[u8; N], String> {
    let bytes = read_key_file(path, N)?;
    <[u8; N]>::try_from(bytes.as_slice()).map_err(|_| {
        format!(
            "{label} file {} did not contain exactly {N} decoded bytes",
            path.display()
        )
    })
}

fn read_key_file(path: &Path, expected_len: usize) -> Result<Vec<u8>, String> {
    let bytes = std::fs::read(path)
        .map_err(|error| format!("failed to read key file {}: {error}", path.display()))?;
    if bytes.len() == expected_len {
        return Ok(bytes);
    }

    let hex_len = expected_len
        .checked_mul(2)
        .ok_or_else(|| "expected key length overflowed usize".to_string())?;
    let Ok(text) = std::str::from_utf8(&bytes) else {
        return Err(format!(
            "key file {} has {} bytes; expected {expected_len} raw bytes",
            path.display(),
            bytes.len()
        ));
    };
    let compact = text
        .chars()
        .filter(|character| !character.is_whitespace())
        .collect::<String>();
    if compact.len() == hex_len
        && compact
            .chars()
            .all(|character| character.is_ascii_hexdigit())
    {
        return hex::decode(&compact).map_err(|error| {
            format!(
                "failed to decode hex key file {} as {expected_len} bytes: {error}",
                path.display()
            )
        });
    }

    Err(format!(
        "key file {} has {} raw bytes and {} hex characters; expected {expected_len} raw bytes or {hex_len} hex characters",
        path.display(),
        bytes.len(),
        compact.len()
    ))
}

fn count_unique_minting_keys(
    registry: &MintingKeyRegistry,
    entries: &[config::MintingKeyConfig],
) -> usize {
    entries
        .iter()
        .map(|entry| entry.kid.as_str())
        .filter(|kid| registry.lookup(kid).is_some())
        .collect::<HashSet<_>>()
        .len()
}

fn count_unique_realm_keys(
    registry: &RealmPrivateKeyRegistry,
    entries: &[config::RealmKeyConfig],
) -> usize {
    entries
        .iter()
        .map(|entry| entry.kid.as_str())
        .filter(|kid| registry.lookup(kid).is_some())
        .collect::<HashSet<_>>()
        .len()
}

fn log_loaded_counts(counts: RuntimeCounts) {
    eprintln!(
        "loaded {} minting key(s), {} realm key(s), {} dispatch realm(s), {} upstream(s)",
        counts.minting_keys, counts.realm_keys, counts.dispatch_realms, counts.dispatch_upstreams
    );
}

fn log_reload(old: RuntimeCounts, new: RuntimeCounts) {
    eprintln!(
        "philharmonic-connector reloaded config; minting keys {} -> {}, realm keys {} -> {}, dispatch realms {} -> {}, upstreams {} -> {}",
        old.minting_keys,
        new.minting_keys,
        old.realm_keys,
        new.realm_keys,
        old.dispatch_realms,
        new.dispatch_realms,
        old.dispatch_upstreams,
        new.dispatch_upstreams
    );
}

#[cfg(feature = "https")]
fn log_tls_reload_note(config: &ConnectorConfig) {
    if let Some(tls) = &config.tls {
        match read_tls_server_config(tls) {
            Ok(_) => eprintln!(
                "philharmonic-connector re-read TLS certificate/key; restart required to apply TLS changes"
            ),
            Err(error) => eprintln!("philharmonic-connector TLS reload check failed: {error}"),
        }
    }
}

#[cfg(not(feature = "https"))]
fn log_tls_reload_note(_config: &ConnectorConfig) {}
