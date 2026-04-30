use std::net::SocketAddr;
use std::path::PathBuf;

/// Base CLI arguments shared across all Philharmonic bin targets.
#[derive(Clone, Debug, clap::Args)]
pub struct BaseArgs {
    /// Path to the primary TOML config file.
    #[arg(long, short = 'c')]
    pub config: Option<PathBuf>,

    /// Path to the drop-in config directory.
    #[arg(long)]
    pub config_dir: Option<PathBuf>,

    /// Socket address to bind to (overrides config file).
    #[arg(long, short = 'b')]
    pub bind: Option<SocketAddr>,
}

/// Top-level subcommands shared across bins.
#[derive(Clone, Debug, clap::Subcommand)]
pub enum BaseCommand {
    /// Start the server (default if no subcommand given).
    Serve(BaseArgs),
    /// Print version information and exit.
    Version,
    /// Install the binary, systemd unit, and config directory.
    ///
    /// Requires root privileges.
    Install(InstallArgs),
}

#[derive(Clone, Debug, clap::Args)]
pub struct InstallArgs {
    /// Override the binary install path (default: /usr/local/bin).
    #[arg(long, default_value = "/usr/local/bin")]
    pub bin_dir: PathBuf,

    /// Override the systemd unit directory (default: /usr/local/lib/systemd/system).
    #[arg(long, default_value = "/usr/local/lib/systemd/system")]
    pub unit_dir: PathBuf,

    /// Override the config directory (default: /etc/philharmonic).
    #[arg(long, default_value = "/etc/philharmonic")]
    pub config_dir: PathBuf,

    /// Don't run systemctl enable.
    #[arg(long)]
    pub no_enable: bool,
}

/// Resolve config file paths from CLI args or defaults.
pub fn resolve_config_paths(name: &str, args: &BaseArgs) -> (PathBuf, PathBuf) {
    let primary = args
        .config
        .clone()
        .unwrap_or_else(|| PathBuf::from(format!("/etc/philharmonic/{name}.toml")));
    let drop_in_dir = args
        .config_dir
        .clone()
        .unwrap_or_else(|| PathBuf::from(format!("/etc/philharmonic/{name}.toml.d")));
    (primary, drop_in_dir)
}

#[cfg(test)]
mod tests {
    use std::net::{Ipv4Addr, SocketAddr, SocketAddrV4};
    use std::path::PathBuf;

    use clap::Parser;

    use super::{BaseArgs, BaseCommand, resolve_config_paths};

    #[derive(Debug, Parser)]
    struct TestCli {
        #[command(subcommand)]
        command: BaseCommand,
    }

    #[test]
    fn parse_serve_args() {
        let cli = TestCli::parse_from([
            "test",
            "serve",
            "-c",
            "/tmp/foo.toml",
            "-b",
            "127.0.0.1:8080",
        ]);

        let BaseCommand::Serve(args) = cli.command else {
            panic!("expected serve command");
        };
        assert_eq!(args.config, Some(PathBuf::from("/tmp/foo.toml")));
        assert_eq!(
            args.bind,
            Some(SocketAddr::V4(SocketAddrV4::new(
                Ipv4Addr::new(127, 0, 0, 1),
                8080
            )))
        );
    }

    #[test]
    fn parse_version() {
        let cli = TestCli::parse_from(["test", "version"]);

        assert!(matches!(cli.command, BaseCommand::Version));
    }

    #[test]
    fn parse_install_defaults() {
        let cli = TestCli::parse_from(["test", "install"]);

        let BaseCommand::Install(args) = cli.command else {
            panic!("expected install command");
        };
        assert_eq!(args.bin_dir, PathBuf::from("/usr/local/bin"));
        assert_eq!(
            args.unit_dir,
            PathBuf::from("/usr/local/lib/systemd/system")
        );
        assert_eq!(args.config_dir, PathBuf::from("/etc/philharmonic"));
        assert!(!args.no_enable);
    }

    #[test]
    fn resolve_defaults() {
        let args = BaseArgs {
            config: None,
            config_dir: None,
            bind: None,
        };

        let (primary, drop_in_dir) = resolve_config_paths("mechanics", &args);

        assert_eq!(primary, PathBuf::from("/etc/philharmonic/mechanics.toml"));
        assert_eq!(
            drop_in_dir,
            PathBuf::from("/etc/philharmonic/mechanics.toml.d")
        );
    }

    #[test]
    fn resolve_overrides() {
        let args = BaseArgs {
            config: Some(PathBuf::from("/tmp/config.toml")),
            config_dir: Some(PathBuf::from("/tmp/config.toml.d")),
            bind: None,
        };

        let (primary, drop_in_dir) = resolve_config_paths("mechanics", &args);

        assert_eq!(primary, PathBuf::from("/tmp/config.toml"));
        assert_eq!(drop_in_dir, PathBuf::from("/tmp/config.toml.d"));
    }
}
