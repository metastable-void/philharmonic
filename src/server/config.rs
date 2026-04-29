use std::error::Error;
use std::ffi::OsString;
use std::fmt;
use std::path::{Path, PathBuf};

/// Errors returned while loading a Philharmonic TOML config file.
#[derive(Debug)]
pub enum ConfigError {
    Io(std::io::Error),
    Parse {
        path: PathBuf,
        source: toml::de::Error,
    },
    Merge(String),
}

impl fmt::Display for ConfigError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Io(error) => write!(f, "failed to read config file: {error}"),
            Self::Parse { path, source } => {
                write!(
                    f,
                    "failed to parse TOML config at {}: {source}",
                    path.display()
                )
            }
            Self::Merge(message) => write!(f, "failed to merge TOML config: {message}"),
        }
    }
}

impl Error for ConfigError {
    fn source(&self) -> Option<&(dyn Error + 'static)> {
        match self {
            Self::Io(error) => Some(error),
            Self::Parse { source, .. } => Some(source),
            Self::Merge(_) => None,
        }
    }
}

impl From<std::io::Error> for ConfigError {
    fn from(error: std::io::Error) -> Self {
        Self::Io(error)
    }
}

/// Load a TOML config file, then merge any `.toml` files found in
/// the drop-in directory (lexicographic order). Later files override
/// earlier ones at the top-level key level.
pub fn load_config<T: serde::de::DeserializeOwned>(
    primary: &Path,
    drop_in_dir: &Path,
) -> Result<T, ConfigError> {
    let mut merged = read_table(primary)?;

    for path in drop_in_paths(drop_in_dir)? {
        let overlay = read_table(&path)?;
        for (key, value) in overlay {
            merged.insert(key, value);
        }
    }

    T::deserialize(toml::Value::Table(merged)).map_err(|source| ConfigError::Parse {
        path: primary.to_path_buf(),
        source,
    })
}

fn read_table(path: &Path) -> Result<toml::Table, ConfigError> {
    let content = std::fs::read_to_string(path)?;
    toml::from_str(&content).map_err(|source| ConfigError::Parse {
        path: path.to_path_buf(),
        source,
    })
}

fn drop_in_paths(drop_in_dir: &Path) -> Result<Vec<PathBuf>, ConfigError> {
    let entries = match std::fs::read_dir(drop_in_dir) {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(error) => return Err(ConfigError::Io(error)),
    };

    let mut paths = Vec::<(OsString, PathBuf)>::new();
    for entry in entries {
        let entry = entry?;
        let path = entry.path();
        if path
            .extension()
            .is_some_and(|extension| extension == "toml")
        {
            paths.push((entry.file_name(), path));
        }
    }
    paths.sort_by(|(left, _), (right, _)| left.cmp(right));

    Ok(paths.into_iter().map(|(_, path)| path).collect())
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    use super::{ConfigError, load_config};

    #[derive(Debug, PartialEq, serde::Deserialize)]
    struct TestConfig {
        name: String,
        port: u16,
    }

    fn test_dir(name: &str) -> PathBuf {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let path = std::env::temp_dir().join(format!(
            "philharmonic-config-{name}-{}-{unique}",
            std::process::id()
        ));
        fs::create_dir_all(&path).unwrap();
        path
    }

    #[test]
    fn load_single_file() {
        let dir = test_dir("single");
        let primary = dir.join("config.toml");
        let drop_in = dir.join("config.toml.d");
        fs::write(&primary, "name = \"worker\"\nport = 3000\n").unwrap();

        let config: TestConfig = load_config(&primary, &drop_in).unwrap();

        assert_eq!(
            config,
            TestConfig {
                name: "worker".to_string(),
                port: 3000
            }
        );
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn load_with_drop_in_override() {
        let dir = test_dir("overlay");
        let primary = dir.join("config.toml");
        let drop_in = dir.join("config.toml.d");
        fs::create_dir_all(&drop_in).unwrap();
        fs::write(&primary, "name = \"worker\"\nport = 3000\n").unwrap();
        fs::write(drop_in.join("20-port.toml"), "port = 4000\n").unwrap();

        let config: TestConfig = load_config(&primary, &drop_in).unwrap();

        assert_eq!(
            config,
            TestConfig {
                name: "worker".to_string(),
                port: 4000
            }
        );
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn drop_in_dir_missing() {
        let dir = test_dir("missing-drop-in");
        let primary = dir.join("config.toml");
        let drop_in = dir.join("missing");
        fs::write(&primary, "name = \"worker\"\nport = 3000\n").unwrap();

        let config: TestConfig = load_config(&primary, &drop_in).unwrap();

        assert_eq!(config.port, 3000);
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn primary_missing() {
        let dir = test_dir("missing-primary");
        let primary = dir.join("missing.toml");
        let drop_in = dir.join("config.toml.d");

        let error = load_config::<TestConfig>(&primary, &drop_in).unwrap_err();

        assert!(matches!(error, ConfigError::Io(_)));
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn invalid_toml() {
        let dir = test_dir("invalid");
        let primary = dir.join("config.toml");
        let drop_in = dir.join("config.toml.d");
        fs::write(&primary, "name = [\n").unwrap();

        let error = load_config::<TestConfig>(&primary, &drop_in).unwrap_err();

        assert!(matches!(error, ConfigError::Parse { .. }));
        fs::remove_dir_all(dir).unwrap();
    }
}
