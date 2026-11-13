//! Self-updates may never turn a standard user's click into a UAC prompt.
//! Machine installations stay owned by the endpoint deployment agent.
use serde::Serialize;
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{ipc::Channel, Manager, ResourceId, Webview};
use tauri_plugin_updater::Update;

static INSTALL_RUNNING: AtomicBool = AtomicBool::new(false);

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct UpdatePolicy {
    can_self_update: bool,
    reason: &'static str,
}

fn policy(allowed: bool, reason: &'static str) -> UpdatePolicy {
    UpdatePolicy {
        can_self_update: allowed,
        reason,
    }
}

#[tauri::command]
pub fn get_app_update_policy(app: tauri::AppHandle) -> UpdatePolicy {
    #[cfg(windows)]
    {
        windows_policy::inspect(&app).unwrap_or_else(|_| policy(false, "installation_check_failed"))
    }
    #[cfg(not(windows))]
    {
        let _ = app;
        policy(false, "unsupported_installation")
    }
}

#[derive(Clone, Serialize)]
#[serde(tag = "event", content = "data")]
pub enum UpdateEvent {
    #[serde(rename_all = "camelCase")]
    Started {
        content_length: Option<u64>,
    },
    #[serde(rename_all = "camelCase")]
    Progress {
        chunk_length: usize,
    },
    Installing,
}

struct InstallLock;
impl InstallLock {
    fn acquire() -> Result<Self, String> {
        INSTALL_RUNNING
            .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
            .map(|_| Self)
            .map_err(|_| "update_already_running".to_string())
    }
}
impl Drop for InstallLock {
    fn drop(&mut self) {
        INSTALL_RUNNING.store(false, Ordering::SeqCst);
    }
}

fn require_self_update(app: &tauri::AppHandle) -> Result<(), String> {
    let result = get_app_update_policy(app.clone());
    if result.can_self_update {
        Ok(())
    } else {
        Err(format!("update_managed: {}", result.reason))
    }
}

#[tauri::command]
pub async fn install_app_update(
    webview: Webview,
    rid: ResourceId,
    on_event: Channel<UpdateEvent>,
) -> Result<(), String> {
    let _lock = InstallLock::acquire()?;
    require_self_update(webview.app_handle())?;
    // Use only the signed update returned by the configured Tauri updater.
    // The frontend cannot pass an arbitrary executable, URL or installer args.
    let update = webview
        .resources_table()
        .get::<Update>(rid)
        .map_err(|e| e.to_string())?;
    let mut started = false;
    let bytes = update
        .download(
            |chunk_length, content_length| {
                if !started {
                    started = true;
                    let _ = on_event.send(UpdateEvent::Started { content_length });
                }
                let _ = on_event.send(UpdateEvent::Progress { chunk_length });
            },
            || {},
        )
        .await
        .map_err(|e| e.to_string())?;
    // Recheck after the download in case the endpoint agent changed the install.
    require_self_update(webview.app_handle())?;
    on_event
        .send(UpdateEvent::Installing)
        .map_err(|e| e.to_string())?;
    // Let the webview paint the handoff before Windows closes this process.
    tokio::time::sleep(std::time::Duration::from_millis(150)).await;
    update.install(&bytes).map_err(|e| e.to_string())?;
    // On Windows the updater exits and NSIS /S /R restarts the app. Returning
    // here is not proof of a completed installation; never announce success.
    Err("update_installer_did_not_take_over".into())
}

#[cfg(windows)]
mod windows_policy {
    use super::*;
    use std::{
        fs,
        path::{Path, PathBuf},
    };
    use windows::{
        core::{PCWSTR, PWSTR},
        Win32::{
            Foundation::{
                ERROR_FILE_NOT_FOUND, ERROR_NO_MORE_ITEMS, ERROR_PATH_NOT_FOUND, ERROR_SUCCESS,
            },
            System::Registry::*,
        },
    };

    const UNINSTALL: &str = r"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall";
    struct Key(HKEY);
    impl Drop for Key {
        fn drop(&mut self) {
            unsafe {
                let _ = RegCloseKey(self.0);
            }
        }
    }
    fn wide(value: &str) -> Vec<u16> {
        value.encode_utf16().chain(Some(0)).collect()
    }
    fn open(root: HKEY, path: &str, view: REG_SAM_FLAGS) -> Result<Option<Key>, String> {
        let path = wide(path);
        let mut key = HKEY::default();
        let result =
            unsafe { RegOpenKeyExW(root, PCWSTR(path.as_ptr()), None, KEY_READ | view, &mut key) };
        if result == ERROR_FILE_NOT_FOUND || result == ERROR_PATH_NOT_FOUND {
            return Ok(None);
        }
        result.ok().map_err(|e| e.to_string())?;
        Ok(Some(Key(key)))
    }
    fn read(key: &Key, name: &str) -> Result<Option<String>, String> {
        let name = wide(name);
        let mut buffer = vec![0u16; 32768];
        let mut bytes = (buffer.len() * 2) as u32;
        let result = unsafe {
            RegGetValueW(
                key.0,
                PCWSTR::null(),
                PCWSTR(name.as_ptr()),
                RRF_RT_REG_SZ,
                None,
                Some(buffer.as_mut_ptr().cast()),
                Some(&mut bytes),
            )
        };
        if result == ERROR_FILE_NOT_FOUND {
            return Ok(None);
        }
        result.ok().map_err(|e| e.to_string())?;
        let length = buffer.iter().position(|c| *c == 0).unwrap_or(buffer.len());
        String::from_utf16(&buffer[..length])
            .map(Some)
            .map_err(|e| e.to_string())
    }

    fn has_machine_install(product: &str) -> Result<bool, String> {
        // NSIS can discover and uninstall an old WiX/MSI package. Check both
        // registry views even when a per-user NSIS copy also exists.
        for view in [KEY_WOW64_64KEY, KEY_WOW64_32KEY] {
            let Some(parent) = open(HKEY_LOCAL_MACHINE, UNINSTALL, view)? else {
                continue;
            };
            for index in 0.. {
                let mut name = [0u16; 256];
                let mut length = name.len() as u32;
                let result = unsafe {
                    RegEnumKeyExW(
                        parent.0,
                        index,
                        Some(PWSTR(name.as_mut_ptr())),
                        &mut length,
                        None,
                        None,
                        None,
                        None,
                    )
                };
                if result == ERROR_NO_MORE_ITEMS {
                    break;
                }
                if result != ERROR_SUCCESS {
                    return Err(format!("registry_enumeration: {}", result.0));
                }
                let name =
                    String::from_utf16(&name[..length as usize]).map_err(|e| e.to_string())?;
                if let Some(key) = open(HKEY_LOCAL_MACHINE, &format!(r"{UNINSTALL}\{name}"), view)?
                {
                    if read(&key, "DisplayName")?.as_deref() == Some(product) {
                        return Ok(true);
                    }
                }
            }
        }
        Ok(false)
    }

    fn canonical(value: impl AsRef<Path>) -> Result<PathBuf, String> {
        fs::canonicalize(value).map_err(|e| e.to_string())
    }
    fn owned_location(install: &Path, local: &Path, registered: &Path) -> bool {
        // Paths have already been canonicalized, so junctions outside the
        // user's directory and sibling prefixes do not pass this check.
        install != local && install.starts_with(local) && install == registered
    }
    fn write_probe(folder: &Path) -> Result<(), String> {
        let path = folder.join(format!(".dmh-update-{}.tmp", uuid::Uuid::new_v4()));
        let file = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&path)
            .map_err(|e| e.to_string())?;
        drop(file);
        fs::remove_file(path).map_err(|e| e.to_string())
    }

    pub(super) fn inspect(app: &tauri::AppHandle) -> Result<UpdatePolicy, String> {
        use tauri::utils::{config::BundleType, platform::bundle_type};
        match bundle_type() {
            Some(BundleType::Nsis) => {}
            Some(BundleType::Msi) => return Ok(policy(false, "managed_msi")),
            _ => return Ok(policy(false, "unknown_bundle")),
        }
        let product = app
            .config()
            .product_name
            .as_deref()
            .ok_or("missing_product_name")?;
        if has_machine_install(product)? {
            return Ok(policy(false, "machine_installation"));
        }
        let exe = canonical(std::env::current_exe().map_err(|e| e.to_string())?)?;
        let install = exe.parent().ok_or("missing_install_directory")?;
        let local = canonical(app.path().local_data_dir().map_err(|e| e.to_string())?)?;
        let Some(key) = open(
            HKEY_CURRENT_USER,
            &format!(r"{UNINSTALL}\{product}"),
            KEY_WOW64_64KEY,
        )?
        else {
            return Ok(policy(false, "missing_user_installation"));
        };
        let location = read(&key, "InstallLocation")?.ok_or("missing_install_location")?;
        let registered = canonical(location.trim_matches('"'))?;
        if !owned_location(install, &local, &registered) {
            return Ok(policy(false, "protected_installation"));
        }
        if write_probe(install).is_err() {
            return Ok(policy(false, "installation_not_writable"));
        }
        Ok(policy(true, "per_user_nsis"))
    }

    #[cfg(test)]
    mod tests {
        use super::*;
        #[test]
        fn requires_registered_user_directory() {
            let local = Path::new(r"C:\Users\test\AppData\Local");
            let install = local.join("DMH Backup");
            assert!(owned_location(&install, local, &install));
            assert!(!owned_location(local, local, local));
            assert!(!owned_location(&install, local, &local.join("Other")));
            for blocked in [
                r"C:\Program Files\DMH Backup",
                r"C:\Users\other\AppData\Local\DMH Backup",
                r"C:\Users\test\AppData\Local-other\DMH Backup",
            ] {
                assert!(!owned_location(
                    Path::new(blocked),
                    local,
                    Path::new(blocked)
                ));
            }
        }
        #[test]
        fn write_probe_cleans_up_and_does_not_create_missing_directories() {
            let dir =
                std::env::temp_dir().join(format!("dmh-update-test-{}", uuid::Uuid::new_v4()));
            assert!(write_probe(&dir).is_err());
            assert!(!dir.exists());
            fs::create_dir(&dir).unwrap();
            write_probe(&dir).unwrap();
            assert_eq!(fs::read_dir(&dir).unwrap().count(), 0);
            fs::remove_dir(dir).unwrap();
        }
        #[test]
        fn registry_missing_key_is_not_treated_as_a_user_installation() {
            assert!(open(
                HKEY_CURRENT_USER,
                &format!(r"Software\DMH-update-test-{}", uuid::Uuid::new_v4()),
                KEY_WOW64_64KEY
            )
            .unwrap()
            .is_none());
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn concurrent_installations_are_rejected_and_lock_releases_on_failure() {
        let lock = InstallLock::acquire().unwrap();
        assert!(InstallLock::acquire().is_err());
        drop(lock);
        assert!(InstallLock::acquire().is_ok());
    }
    #[test]
    fn installer_is_per_user_silent_and_direct_installs_are_not_exposed() {
        let config: serde_json::Value =
            serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
        assert_eq!(
            config["bundle"]["windows"]["nsis"]["installMode"],
            "currentUser"
        );
        assert_eq!(
            config["plugins"]["updater"]["windows"]["installMode"],
            "quiet"
        );
        let capability: serde_json::Value =
            serde_json::from_str(include_str!("../capabilities/default.json")).unwrap();
        let updater_permissions: Vec<_> = capability["permissions"]
            .as_array()
            .unwrap()
            .iter()
            .filter_map(|v| v.as_str())
            .filter(|v| v.starts_with("updater:"))
            .collect();
        assert_eq!(updater_permissions, ["updater:allow-check"]);
    }
}
