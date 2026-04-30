use std::fs::{self, OpenOptions};
use std::io::{self, Write};
use std::path::Path;
use std::process::Command;

use super::cli::InstallArgs;

pub struct InstallPlan {
    pub service_name: String,
    pub binary_name: String,
    pub description: String,
    pub config_file_name: String,
    pub default_config_content: String,
    pub args: InstallArgs,
}

pub fn execute_install(plan: &InstallPlan) -> Result<(), String> {
    ensure_root()?;

    let bin_path = plan.args.bin_dir.join(&plan.binary_name);
    let service_file_name = format!("{}.service", plan.service_name);
    let unit_path = plan.args.unit_dir.join(&service_file_name);
    let config_path = plan.args.config_dir.join(&plan.config_file_name);
    let drop_in_dir = plan
        .args
        .config_dir
        .join(format!("{}.d", plan.config_file_name));

    fs::create_dir_all(&plan.args.bin_dir).map_err(|error| {
        format!(
            "failed to create binary directory {}: {error}",
            plan.args.bin_dir.display()
        )
    })?;
    copy_current_binary(&bin_path)?;

    fs::create_dir_all(&plan.args.unit_dir).map_err(|error| {
        format!(
            "failed to create systemd unit directory {}: {error}",
            plan.args.unit_dir.display()
        )
    })?;
    write_unit_file(plan, &bin_path, &config_path, &unit_path)?;

    fs::create_dir_all(&plan.args.config_dir).map_err(|error| {
        format!(
            "failed to create config directory {}: {error}",
            plan.args.config_dir.display()
        )
    })?;
    fs::create_dir_all(&drop_in_dir).map_err(|error| {
        format!(
            "failed to create config drop-in directory {}: {error}",
            drop_in_dir.display()
        )
    })?;
    write_default_config(&config_path, &plan.default_config_content)?;

    if !plan.args.no_enable {
        enable_service(&service_file_name)?;
    }

    print_setup_instructions(plan, &bin_path, &unit_path, &config_path, &drop_in_dir);
    Ok(())
}

fn ensure_root() -> Result<(), String> {
    let output = Command::new("id").arg("-u").output().map_err(|error| {
        if error.kind() == io::ErrorKind::NotFound {
            "failed to check root privileges: id command not found".to_string()
        } else {
            format!("failed to check root privileges with id -u: {error}")
        }
    })?;
    if !output.status.success() {
        return Err(format!(
            "failed to check root privileges: id -u exited with status {}",
            output.status
        ));
    }

    let stdout = String::from_utf8(output.stdout)
        .map_err(|error| format!("failed to parse id -u output as UTF-8: {error}"))?;
    if stdout.trim() != "0" {
        return Err("install requires root privileges; rerun as root or via sudo".to_string());
    }
    Ok(())
}

fn copy_current_binary(bin_path: &Path) -> Result<(), String> {
    let current_exe = std::env::current_exe()
        .map_err(|error| format!("failed to locate current binary: {error}"))?;
    fs::copy(&current_exe, bin_path).map_err(|error| {
        format!(
            "failed to copy binary from {} to {}: {error}",
            current_exe.display(),
            bin_path.display()
        )
    })?;
    set_executable_permissions(bin_path)
}

#[cfg(unix)]
fn set_executable_permissions(bin_path: &Path) -> Result<(), String> {
    use std::os::unix::fs::PermissionsExt;

    let permissions = fs::Permissions::from_mode(0o755);
    fs::set_permissions(bin_path, permissions).map_err(|error| {
        format!(
            "failed to set executable permissions on {}: {error}",
            bin_path.display()
        )
    })
}

#[cfg(not(unix))]
fn set_executable_permissions(_bin_path: &Path) -> Result<(), String> {
    Ok(())
}

fn write_unit_file(
    plan: &InstallPlan,
    bin_path: &Path,
    config_path: &Path,
    unit_path: &Path,
) -> Result<(), String> {
    let unit = systemd_unit_content(plan, bin_path, config_path);
    fs::write(unit_path, unit).map_err(|error| {
        format!(
            "failed to write systemd unit {}: {error}",
            unit_path.display()
        )
    })
}

fn systemd_unit_content(plan: &InstallPlan, bin_path: &Path, config_path: &Path) -> String {
    format!(
        "[Unit]\n\
Description={description}\n\
After=network-online.target\n\
Wants=network-online.target\n\
\n\
[Service]\n\
Type=simple\n\
ExecStart={bin_path} serve -c {config_path}\n\
ExecReload=/bin/kill -HUP $MAINPID\n\
Restart=on-failure\n\
RestartSec=5\n\
LimitNOFILE=65536\n\
\n\
[Install]\n\
WantedBy=multi-user.target\n",
        description = plan.description,
        bin_path = bin_path.display(),
        config_path = config_path.display()
    )
}

fn write_default_config(config_path: &Path, content: &str) -> Result<(), String> {
    match OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(config_path)
    {
        Ok(mut file) => file.write_all(content.as_bytes()).map_err(|error| {
            format!(
                "failed to write default config {}: {error}",
                config_path.display()
            )
        }),
        Err(error) if error.kind() == io::ErrorKind::AlreadyExists => Ok(()),
        Err(error) => Err(format!(
            "failed to create default config {}: {error}",
            config_path.display()
        )),
    }
}

fn enable_service(service_file_name: &str) -> Result<(), String> {
    let status = Command::new("systemctl")
        .arg("enable")
        .arg(service_file_name)
        .status()
        .map_err(|error| {
            if error.kind() == io::ErrorKind::NotFound {
                "failed to enable service: systemctl command not found".to_string()
            } else {
                format!("failed to run systemctl enable {service_file_name}: {error}")
            }
        })?;
    if !status.success() {
        return Err(format!(
            "systemctl enable {service_file_name} failed with status {status}"
        ));
    }
    Ok(())
}

fn print_setup_instructions(
    plan: &InstallPlan,
    bin_path: &Path,
    unit_path: &Path,
    config_path: &Path,
    drop_in_dir: &Path,
) {
    println!("Installed {}.", plan.service_name);
    println!("Binary: {}", bin_path.display());
    println!("Systemd unit: {}", unit_path.display());
    println!("Config file: {}", config_path.display());
    println!("Config drop-in directory: {}", drop_in_dir.display());
    if plan.args.no_enable {
        println!(
            "Service not enabled. Run: systemctl enable {}.service",
            plan.service_name
        );
    }
    println!(
        "Start service: systemctl start {}.service",
        plan.service_name
    );
    println!(
        "Reload after config changes: systemctl reload {}.service",
        plan.service_name
    );
}

#[cfg(test)]
mod tests {
    use std::path::{Path, PathBuf};

    use super::{InstallPlan, systemd_unit_content};
    use crate::server::cli::InstallArgs;

    #[test]
    fn unit_content_uses_plan_paths() {
        let plan = InstallPlan {
            service_name: "mechanics-worker".to_string(),
            binary_name: "mechanics-worker".to_string(),
            description: "Philharmonic mechanics JS executor".to_string(),
            config_file_name: "mechanics.toml".to_string(),
            default_config_content: String::new(),
            args: InstallArgs {
                bin_dir: PathBuf::from("/usr/local/bin"),
                unit_dir: PathBuf::from("/usr/local/lib/systemd/system"),
                config_dir: PathBuf::from("/etc/philharmonic"),
                no_enable: false,
            },
        };

        let unit = systemd_unit_content(
            &plan,
            Path::new("/usr/local/bin/mechanics-worker"),
            Path::new("/etc/philharmonic/mechanics.toml"),
        );

        assert!(unit.contains("Description=Philharmonic mechanics JS executor\n"));
        assert!(unit.contains(
            "ExecStart=/usr/local/bin/mechanics-worker serve -c /etc/philharmonic/mechanics.toml\n"
        ));
    }
}
