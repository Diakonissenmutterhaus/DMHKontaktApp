//! Explicit, resumable Outlook Classic setup. Graph authenticates this app only;
//! Outlook must prove its own online connection before profile activation.
use crate::{hidden_command, m365, open_db};
use chrono::Utc;
use rusqlite::OptionalExtension;
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    io::{Read, Seek, SeekFrom},
    path::{Path, PathBuf},
    process::Stdio,
    time::Duration,
};
use tauri::{AppHandle, Emitter, Manager};
use tokio::io::AsyncWriteExt;

static SETUP_GATE: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());
struct BackgroundVisibilityGuard {
    process_id: u32,
    started_at: String,
    task: tokio::task::JoinHandle<()>,
}
static BACKGROUND_VISIBILITY_GUARD: std::sync::Mutex<Option<BackgroundVisibilityGuard>> =
    std::sync::Mutex::new(None);

fn stop_background_watcher() {
    if let Ok(mut current) = BACKGROUND_VISIBILITY_GUARD.lock() {
        if let Some(watcher) = current.take() {
            watcher.task.abort();
        }
    }
}

fn keep_setup_in_background(state: &SetupState) -> Result<(), String> {
    if state.phase == "complete" {
        stop_background_watcher();
        return Ok(());
    }
    let (Some(process_id), Some(started_at)) = (
        state.launched_process_id,
        state.launched_started_at.as_ref(),
    ) else {
        return Ok(());
    };
    let mut current = BACKGROUND_VISIBILITY_GUARD
        .lock()
        .map_err(|_| "Outlook-Hintergrundbetrieb konnte nicht vorbereitet werden.")?;
    if current.as_ref().is_some_and(|guard| {
        guard.process_id == process_id
            && &guard.started_at == started_at
            && !guard.task.is_finished()
    }) {
        return Ok(());
    }
    if let Some(previous) = current.take() {
        previous.task.abort();
    }
    let input = serde_json::json!({"operation":"watch-setup-process", "processId":process_id, "startedAt":started_at, "profile":state.exchange_profile, "ownerProcessId":std::process::id()});
    let task = tokio::spawn(async move {
        // Cancellation drops the hidden helper with kill_on_drop enabled.
        // A watcher failure never replaces the actual setup/connection result.
        let _ = powershell::<serde_json::Value>(input).await;
    });
    *current = Some(BackgroundVisibilityGuard {
        process_id,
        started_at: started_at.clone(),
        task,
    });
    Ok(())
}

#[tauri::command]
pub fn stop_outlook_setup_background() {
    stop_background_watcher();
}
const SCRIPT: &str = include_str!("outlook_exchange_profile.ps1");
const BOOTSTRAP: &str = include_str!("outlook_exchange_bootstrap.ps1");
// m365_ is excluded from portable exports/restores: Outlook profiles belong to
// this Windows account and cannot travel with the contact/calendar backup.
const STATE_PREFIX: &str = "m365_outlook_exchange_setup_v1_";
const HELPER_TIMEOUT: &str = "OUTLOOK_HELPER_TIMEOUT";

fn setup_progress(app: &AppHandle, email: &str, value: u8, label: &str) {
    let _ = app.emit(
        "dmh:outlook-setup-progress",
        serde_json::json!({"email":email,"value":value,"label":label}),
    );
}

pub(crate) fn is_setup_state_key(key: &str) -> bool {
    key.starts_with(STATE_PREFIX)
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SetupStatus {
    stage: &'static str,
    email: String,
    previous_profile: Option<String>,
    exchange_profile: String,
    imap_profile: Option<String>,
    message: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SetupState {
    #[serde(default)]
    reused_profile: bool,
    account_id: String,
    email: String,
    previous_profile: Option<String>,
    exchange_profile: String,
    imap_profile: Option<String>,
    phase: String,
    #[serde(default)]
    windows_sso: bool,
    #[serde(default)]
    warning: Option<String>,
    #[serde(default)]
    launched_process_id: Option<u32>,
    #[serde(default)]
    launched_started_at: Option<String>,
    #[serde(default)]
    confirmed_excel_email: Option<String>,
    #[serde(default)]
    automatic_close: bool,
}

#[derive(Deserialize)]
struct Inventory {
    executable: String,
    running: bool,
    #[serde(default, rename = "windowsPrimarySmtp")]
    windows_primary_smtp: String,
    #[serde(default, rename = "profileNames")]
    profile_names: Vec<String>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Profile {
    name: String,
    is_default: bool,
}

#[derive(Deserialize)]
struct ProfileList {
    profiles: Vec<Profile>,
}

#[derive(Deserialize)]
struct ImapAccount {
    email: String,
}

#[derive(Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Probe {
    active_profile: String,
    accounts: Vec<ExchangeAccount>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ExchangeAccount {
    email: String,
    account_type: i32,
    connection_mode: i32,
    store_type: i32,
}

#[derive(Deserialize)]
struct Activation {
    ok: bool,
    renamed: bool,
    warning: Option<String>,
}

fn state_key(account_id: &str) -> String {
    format!("{STATE_PREFIX}{:x}", Sha256::digest(account_id.as_bytes()))
}

fn lock_file(path: &Path) -> Result<std::fs::File, String> {
    let file = std::fs::File::options()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .open(path)
        .map_err(|_| {
            "Die Outlook-Einrichtung konnte nicht gesperrt werden. Bitte die EDV informieren."
        })?;
    file.try_lock().map_err(|_| "Die Outlook-Einrichtung läuft bereits in einer anderen App-Version. Bitte dort abschließen und erneut versuchen.")?;
    // Closing the last handle releases the OS lock even after a process crash.
    Ok(file)
}

fn process_lock(app: &AppHandle) -> Result<std::fs::File, String> {
    // Deliberately common to production/Admin Test, but local to this Windows
    // user. The process-local async gate alone cannot serialize both channels.
    let directory = app
        .path()
        .local_data_dir()
        .map_err(|_| "Der lokale Windows-Datenordner ist nicht verfügbar.")?
        .join("DMH Backup");
    std::fs::create_dir_all(&directory)
        .map_err(|_| "Die Outlook-Einrichtung konnte nicht vorbereitet werden.")?;
    lock_file(&directory.join("outlook-profile-setup.lock"))
}

fn read_state(app: &AppHandle, id: &str, email: &str) -> Result<Option<SetupState>, String> {
    let raw: Option<String> = open_db(app)?
        .query_row(
            "SELECT value FROM app_settings WHERE key = ?1",
            [state_key(id)],
            |row| row.get(0),
        )
        .optional()
        .map_err(|_| "Outlook-Einrichtung konnte nicht gelesen werden.".to_string())?;
    raw.map(|value| {
        let state: SetupState = serde_json::from_str(&value).map_err(|_| {
            "Gespeicherte Outlook-Einrichtung ist ungültig. Bitte die EDV informieren.".to_string()
        })?;
        validate_state(&state, id, email)?;
        Ok(state)
    })
    .transpose()
}

fn managed_name(name: &str, base: &str) -> bool {
    name == base
        || name
            .strip_prefix(&format!("{base} "))
            .is_some_and(|suffix| {
                suffix
                    .parse::<u32>()
                    .is_ok_and(|number| (2..=999).contains(&number))
            })
}

fn validate_state(state: &SetupState, id: &str, email: &str) -> Result<(), String> {
    if state.account_id != id
        || !state.email.eq_ignore_ascii_case(email)
        || !(managed_name(&state.exchange_profile, "Profile Exchange")
            || (state.reused_profile
                && !state.exchange_profile.is_empty()
                && state.exchange_profile.chars().count() <= 64
                && !state
                    .exchange_profile
                    .chars()
                    .any(|c| c.is_control() || matches!(c, '"' | '\\' | '/'))))
        || state
            .imap_profile
            .as_ref()
            .is_some_and(|name| !managed_name(name, "Profile IMAP"))
        || state.previous_profile.as_ref().is_some_and(|name| {
            name.is_empty() || name.chars().count() > 64 || name.chars().any(char::is_control)
        })
        || state
            .previous_profile
            .as_ref()
            .is_some_and(|name| name.eq_ignore_ascii_case(&state.exchange_profile))
        || !matches!(
            state.phase.as_str(),
            "reserved" | "created" | "verified" | "activating" | "complete"
        )
    {
        return Err("Die Outlook-Einrichtung gehört nicht zur verbundenen Microsoft-365-Adresse. Bitte die EDV informieren.".into());
    }
    Ok(())
}

fn save_state(app: &AppHandle, state: &SetupState) -> Result<(), String> {
    let json = serde_json::to_string(state)
        .map_err(|_| "Outlook-Einrichtung konnte nicht gespeichert werden.".to_string())?;
    open_db(app)?.execute(
        "INSERT INTO app_settings (key,value,updated_at) VALUES (?1,?2,?3) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at",
        rusqlite::params![state_key(&state.account_id), json, Utc::now().to_rfc3339()]
    ).map_err(|_| "Outlook-Einrichtung konnte nicht gespeichert werden.".to_string())?;
    Ok(())
}

fn status(state: &SetupState, stage: &'static str, message: impl Into<String>) -> SetupStatus {
    SetupStatus {
        stage,
        email: state.email.clone(),
        previous_profile: state.previous_profile.clone(),
        exchange_profile: state.exchange_profile.clone(),
        imap_profile: state.imap_profile.clone(),
        message: message.into(),
    }
}

fn initial(email: String, stage: &'static str, message: &str) -> SetupStatus {
    SetupStatus {
        stage,
        email,
        previous_profile: None,
        exchange_profile: "Profile Exchange".into(),
        imap_profile: None,
        message: message.into(),
    }
}

fn completion_message(state: &SetupState) -> String {
    let mut message = format!(
        "„{}“ ist als Outlook-Standardprofil eingerichtet.",
        state.exchange_profile
    );
    if let Some(name) = state
        .imap_profile
        .as_ref()
        .or(state.previous_profile.as_ref())
    {
        message.push_str(&format!(
            " Das bisherige Profil bleibt als „{name}“ erhalten."
        ));
    } else {
        message.push_str(" Vorhandene Profile bleiben erhalten.");
    }
    if let Some(warning) = &state.warning {
        message.push(' ');
        message.push_str(warning);
    }
    message
}

async fn output_json<T: DeserializeOwned>(
    mut command: tokio::process::Command,
    input: Option<serde_json::Value>,
    seconds: u64,
) -> Result<T, String> {
    command
        .stdin(if input.is_some() {
            Stdio::piped()
        } else {
            Stdio::null()
        })
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .kill_on_drop(true);
    let program = Path::new(command.as_std().get_program())
        .file_name()
        .unwrap_or_default()
        .to_string_lossy()
        .into_owned();
    let mut child = command.spawn().map_err(|error| {
        let code = error
            .raw_os_error()
            .map(|code| format!(" (Windows-Code {code})"))
            .unwrap_or_default();
        format!("Outlook-Hilfsprogramm konnte nicht gestartet werden: {program}{code}. {error}")
    })?;
    if let Some(input) = input {
        let mut pipe = child
            .stdin
            .take()
            .ok_or("Outlook-Einrichtung konnte nicht vorbereitet werden.")?;
        pipe.write_all(
            serde_json::to_string(&input)
                .map_err(|_| "Outlook-Anfrage ist ungültig.")?
                .as_bytes(),
        )
        .await
        .map_err(|_| "Outlook-Einrichtung konnte nicht vorbereitet werden.")?;
        drop(pipe);
    }
    let output = tokio::time::timeout(Duration::from_secs(seconds), child.wait_with_output())
        .await
        .map_err(|_| format!("{HELPER_TIMEOUT}: {program}; Zeitlimit {seconds}s"))?
        .map_err(|_| "Outlook-Antwort konnte nicht gelesen werden.".to_string())?;
    if output.stdout.len() > 256 * 1024 {
        return Err("Outlook-Antwort ist ungültig.".into());
    }
    if !output.status.success() {
        let error = serde_json::from_slice::<serde_json::Value>(&output.stdout)
            .ok()
            .and_then(|value| {
                value
                    .get("error")
                    .and_then(|error| error.as_str())
                    .map(str::to_owned)
            });
        return Err(error.unwrap_or_else(|| {
            "Outlook-Einrichtung konnte nicht ausgeführt werden. Bitte die EDV informieren.".into()
        }));
    }
    serde_json::from_slice(&output.stdout).map_err(|_| "Outlook-Antwort ist ungültig.".into())
}

async fn powershell<T: DeserializeOwned>(input: serde_json::Value) -> Result<T, String> {
    powershell_script(SCRIPT, input).await
}

async fn powershell_script<T: DeserializeOwned>(
    script: &str,
    input: serde_json::Value,
) -> Result<T, String> {
    let timeout_seconds =
        if input.get("operation").and_then(|value| value.as_str()) == Some("watch-setup-process") {
            245
        } else {
            25
        };
    let mut command = tokio::process::Command::from(hidden_command("powershell.exe"));
    command.args([
        "-NoProfile",
        "-NonInteractive",
        "-STA",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        BOOTSTRAP,
    ]);
    // The Outlook script exceeds Windows' command-line limit. Keep only this
    // short bootstrap in argv and send the script and JSON over the stdin pipe.
    let envelope = serde_json::json!({
        "script": script,
        "request": serde_json::to_string(&input).map_err(|_| "Outlook-Anfrage ist ungültig.")?
    });
    output_json(command, Some(envelope), timeout_seconds).await
}

async fn inventory() -> Result<Inventory, String> {
    powershell(serde_json::json!({"operation":"inventory"})).await
}

fn helper_name(executable: &Path) -> Result<&'static str, String> {
    let mut file = std::fs::File::open(executable)
        .map_err(|_| "Outlook Classic konnte nicht geprüft werden.")?;
    let mut dos = [0u8; 64];
    file.read_exact(&mut dos)
        .map_err(|_| "Outlook Classic konnte nicht geprüft werden.")?;
    if &dos[..2] != b"MZ" {
        return Err("Outlook Classic ist nicht verfügbar.".into());
    }
    let offset = u32::from_le_bytes(dos[60..64].try_into().unwrap());
    file.seek(SeekFrom::Start(offset as u64))
        .map_err(|_| "Outlook Classic konnte nicht geprüft werden.")?;
    let mut header = [0u8; 6];
    file.read_exact(&mut header)
        .map_err(|_| "Outlook Classic konnte nicht geprüft werden.")?;
    if &header[..4] != b"PE\0\0" {
        return Err("Outlook Classic ist nicht verfügbar.".into());
    }
    match u16::from_le_bytes([header[4], header[5]]) {
        0x014c => Ok("outlook-profile-reader-x86.exe"),
        0x8664 => Ok("outlook-profile-reader-x64.exe"),
        _ => Err(
            "Diese Outlook-Architektur wird für die Profileinrichtung nicht unterstützt.".into(),
        ),
    }
}

fn helper_path(app: &AppHandle, executable: &str) -> Result<PathBuf, String> {
    let name = helper_name(Path::new(executable))?;
    let mut candidates = Vec::new();
    if let Ok(resources) = app.path().resource_dir() {
        candidates.push(resources.join("resources").join(name));
        candidates.push(resources.join(name));
    }
    #[cfg(debug_assertions)]
    candidates.push(
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("resources")
            .join(name),
    );
    candidates
        .into_iter()
        .find(|path| path.is_file())
        .ok_or_else(|| {
            "Outlook-Hilfsprogramm fehlt. Bitte DMH Backup aktualisieren oder neu installieren."
                .into()
        })
}

async fn helper<T: DeserializeOwned>(path: &Path, args: &[&str]) -> Result<T, String> {
    let mut command = tokio::process::Command::from(hidden_command(&path.to_string_lossy()));
    command.args(args);
    output_json(command, None, 60).await
}

fn unique_name(base: &str, profiles: &[Profile]) -> Result<String, String> {
    for number in 1..=999 {
        let name = if number == 1 {
            base.into()
        } else {
            format!("{base} {number}")
        };
        if !profiles
            .iter()
            .any(|profile| profile.name.eq_ignore_ascii_case(&name))
        {
            return Ok(name);
        }
    }
    Err("Es sind zu viele Outlook-Profile vorhanden. Bitte die EDV informieren.".into())
}

fn all_profile_names(profiles: &[Profile], registry_names: &[String]) -> Vec<Profile> {
    let mut names = profiles.to_vec();
    for name in registry_names {
        if !names
            .iter()
            .any(|profile| profile.name.eq_ignore_ascii_case(name))
        {
            names.push(Profile {
                name: name.clone(),
                is_default: false,
            });
        }
    }
    names
}

fn reserve_unused_profile_name(state: &mut SetupState, profiles: &[Profile]) -> Result<(), String> {
    // 'reserved' is not proof that CreateProfile succeeded. Never open an
    // existing profile under a merely reserved name, including after a crash.
    if state.phase == "reserved"
        && profiles
            .iter()
            .any(|profile| profile.name.eq_ignore_ascii_case(&state.exchange_profile))
    {
        state.exchange_profile = unique_name("Profile Exchange", profiles)?;
    }
    Ok(())
}

fn enable_windows_sso(state: &mut SetupState, profiles: &[Profile]) -> Result<(), String> {
    if state.reused_profile
        || state.windows_sso
        || !matches!(state.phase.as_str(), "reserved" | "created")
    {
        return Ok(());
    }
    if profiles
        .iter()
        .any(|profile| profile.name.eq_ignore_ascii_case(&state.exchange_profile))
    {
        // Preserve even an incomplete old profile; never repurpose or delete it.
        state.exchange_profile = unique_name("Profile Exchange", profiles)?;
        state.warning =
            Some("Das bisherige unvollstaendige Exchange-Profil bleibt erhalten.".into());
    }
    state.windows_sso = true;
    state.phase = "reserved".into();
    Ok(())
}

fn select_previous(matches: &[String]) -> Result<Option<String>, String> {
    match matches {
        [] => Ok(None),
        [one] => Ok(Some(one.clone())),
        _ => Err("Mehrere IMAP-Profile verwenden diese E-Mail-Adresse. Bitte die EDV das richtige Profil auswählen lassen; es wurde kein Profil geändert.".into())
    }
}

fn proves_connection(probe: &Probe, state: &SetupState) -> bool {
    probe
        .active_profile
        .eq_ignore_ascii_case(&state.exchange_profile)
        && probe.accounts.iter().any(|account| {
            account.email.eq_ignore_ascii_case(&state.email)
                && account.account_type == 0
                && account.store_type == 0
                && matches!(account.connection_mode, 500 | 600 | 700 | 800)
        })
}

async fn probe() -> Result<Probe, String> {
    pending_probe(powershell(serde_json::json!({"operation":"probe"})).await)
}

fn pending_probe(result: Result<Probe, String>) -> Result<Probe, String> {
    match result {
        // Outlook's COM server can be busy while initializing. Absence of a
        // response is neither an authentication failure nor proof of success.
        // The caller keeps polling within the bounded setup deadline.
        Err(error) if error.starts_with(&format!("{HELPER_TIMEOUT}:")) => Ok(Probe::default()),
        other => other,
    }
}

async fn configured_exchange_default(
    email: &str,
    profiles: &[Profile],
) -> Result<Option<SetupStatus>, String> {
    let catalog: serde_json::Value =
        powershell(serde_json::json!({"operation":"profile-catalog"})).await?;
    let Some(name) = catalog
        .get("defaultProfile")
        .and_then(|value| value.as_str())
    else {
        return Ok(None);
    };
    if !startup_is_verified(profiles, &catalog, name) {
        return Ok(None);
    }
    let matches_account = catalog
        .get("profiles")
        .and_then(|value| value.as_array())
        .is_some_and(|entries| {
            entries.iter().any(|entry| {
                entry
                    .get("name")
                    .and_then(|value| value.as_str())
                    .is_some_and(|entry_name| entry_name.eq_ignore_ascii_case(name))
                    && entry
                        .get("accounts")
                        .and_then(|value| value.as_array())
                        .is_some_and(|accounts| {
                            accounts.iter().any(|account| {
                                account
                                    .get("email")
                                    .and_then(|value| value.as_str())
                                    .is_some_and(|address| address.eq_ignore_ascii_case(email))
                                    && account.get("accountType").and_then(|value| value.as_str())
                                        == Some("Exchange")
                            })
                        })
            })
        });
    if !matches_account {
        return Ok(None);
    }
    Ok(Some(SetupStatus {
        // Registry metadata is a reuse candidate, not proof of online access.
        stage: "ready",
        email: email.into(),
        previous_profile: None,
        exchange_profile: name.into(),
        imap_profile: None,
        message: format!("Exchange-Profil „{name}“ ist vorhanden und kann überprüft werden."),
    }))
}

fn reusable_exchange_profile(
    catalog: &serde_json::Value,
    profiles: &[Profile],
    email: &str,
) -> Result<Option<String>, String> {
    let mut candidates = Vec::new();
    for profile in profiles {
        let matches = catalog
            .get("profiles")
            .and_then(|v| v.as_array())
            .is_some_and(|entries| {
                entries.iter().any(|entry| {
                    entry
                        .get("name")
                        .and_then(|v| v.as_str())
                        .is_some_and(|name| name.eq_ignore_ascii_case(&profile.name))
                        && entry
                            .get("accounts")
                            .and_then(|v| v.as_array())
                            .is_some_and(|accounts| {
                                accounts.iter().any(|account| {
                                    account.get("accountType").and_then(|v| v.as_str())
                                        == Some("Exchange")
                                        && account
                                            .get("email")
                                            .and_then(|v| v.as_str())
                                            .is_some_and(|address| {
                                                address.eq_ignore_ascii_case(email)
                                            })
                                })
                            })
                })
            });
        if matches {
            if profile.is_default {
                return Ok(Some(profile.name.clone()));
            }
            candidates.push(profile.name.clone());
        }
    }
    match candidates.as_slice() {
        [] => Ok(None),
        [name] => Ok(Some(name.clone())),
        _ => Err("Mehrere passende Exchange-Profile gefunden. Bitte die EDV das Standardprofil auswählen lassen; es wurde kein Profil geändert.".into()),
    }
}

async fn current_status(app: &AppHandle, id: &str, email: &str) -> Result<SetupStatus, String> {
    let Some(state) = read_state(app, id, email)? else {
        let installed = inventory().await?;
        if !installed.executable.is_empty() {
            let path = helper_path(app, &installed.executable)?;
            let profiles: ProfileList = helper(&path, &["exchange-list"]).await?;
            if let Some(existing) = configured_exchange_default(email, &profiles.profiles).await? {
                return Ok(existing);
            }
        }
        return Ok(initial(
            email.into(),
            "ready",
            "Outlook Classic kann mit einem eigenen Exchange-Profil eingerichtet werden.",
        ));
    };
    if matches!(state.phase.as_str(), "complete" | "activating" | "verified") {
        let installed = inventory().await?;
        if installed.executable.is_empty() {
            return Ok(status(
                &state,
                "unavailable",
                "Outlook Classic ist nicht installiert.",
            ));
        }
        let path = helper_path(app, &installed.executable)?;
        let profiles: ProfileList = helper(&path, &["exchange-list"]).await?;
        if !profiles
            .profiles
            .iter()
            .any(|profile| profile.name.eq_ignore_ascii_case(&state.exchange_profile))
        {
            if let Some(existing) = configured_exchange_default(email, &profiles.profiles).await? {
                return Ok(existing);
            }
            return Ok(status(&state, "ready", "Das bisherige Exchange-Profil ist in Outlook nicht mehr verfügbar. Bitte die Einrichtung erneut starten; vorhandene Daten bleiben erhalten."));
        }
        if state.phase == "complete"
            && profiles.profiles.iter().any(|profile| {
                profile.name.eq_ignore_ascii_case(&state.exchange_profile) && profile.is_default
            })
        {
            let startup: serde_json::Value =
                powershell(serde_json::json!({"operation":"profile-catalog"})).await?;
            if startup_is_verified(&profiles.profiles, &startup, &state.exchange_profile) {
                return Ok(status(&state, "complete", completion_message(&state)));
            }
        }
        if state.phase == "complete" {
            return Ok(status(&state, "connected", "Das Exchange-Profil ist eingerichtet. Die automatische Standardöffnung muss noch gespeichert werden."));
        }
        if !installed.running {
            return Ok(status(
                &state,
                "connected",
                "Exchange wurde bestätigt. Das Standardprofil wird jetzt dauerhaft gespeichert.",
            ));
        }
        return Ok(status(&state, "awaiting_close", "Exchange ist verbunden. Bitte Outlook vollständig schließen, damit das Standardprofil dauerhaft gespeichert werden kann."));
    }
    if proves_connection(&probe().await?, &state) {
        return Ok(status(&state, "connected", "Outlook ist mit der richtigen Exchange-Mailbox verbunden. Die Profile werden jetzt abgeschlossen."));
    }
    let message = if state.windows_sso {
        "Outlook verwendet das passende Windows-Konto fuer die automatische Einrichtung. Falls Microsoft eine Bestaetigung oder MFA verlangt, diese bitte abschliessen. Der bisherige Standard bleibt bis zur Verbindungspruefung erhalten."
    } else {
        "Bitte im geöffneten Outlook die Anmeldung abschließen. Microsoft kann eine Bestätigung oder MFA verlangen. Der bisherige Standard bleibt bis zur Prüfung erhalten."
    };
    Ok(status(&state, "awaiting_login", message))
}

fn startup_is_verified(profiles: &[Profile], startup: &serde_json::Value, target: &str) -> bool {
    profiles
        .iter()
        .any(|profile| profile.is_default && profile.name.eq_ignore_ascii_case(target))
        && startup
            .get("defaultProfile")
            .and_then(|value| value.as_str())
            .is_some_and(|name| name.eq_ignore_ascii_case(target))
        && startup
            .get("promptForProfile")
            .and_then(|value| value.as_bool())
            == Some(false)
}

#[tauri::command]
pub async fn get_outlook_account_configuration(
    app: AppHandle,
) -> Result<serde_json::Value, String> {
    let (_, email) = m365::outlook_profile_identity(&app)?;
    powershell(serde_json::json!({"operation":"account-configuration", "email":email})).await
}

#[tauri::command]
pub async fn get_outlook_profile_catalog() -> Result<serde_json::Value, String> {
    powershell(serde_json::json!({"operation":"profile-catalog"})).await
}

#[tauri::command]
pub async fn set_outlook_default_profile(
    app: AppHandle,
    profile: String,
) -> Result<serde_json::Value, String> {
    if m365::get_m365_read_only_test_mode() {
        return Err(
            "Im schreibgeschuetzten Testmodus wird das Standardprofil nicht geaendert.".into(),
        );
    }
    let _guard = SETUP_GATE
        .try_lock()
        .map_err(|_| "Eine Outlook-Profileinstellung wird bereits bearbeitet.")?;
    let _process_guard = process_lock(&app)?;
    let installed = inventory().await?;
    if !installed.profile_names.iter().any(|name| name == &profile) {
        return Err(
            "Das gewaehlte Outlook-Profil ist nicht mehr vorhanden. Bitte aktualisieren.".into(),
        );
    }
    let path = helper_path(&app, &installed.executable)?;
    let result: Activation = helper(&path, &["profile-set-default", &profile]).await?;
    if !result.ok {
        return Err("Das Standardprofil konnte nicht gespeichert werden.".into());
    }
    let startup: serde_json::Value =
        powershell(serde_json::json!({"operation":"automatic-startup", "profile":profile})).await?;
    if startup.get("ok").and_then(|value| value.as_bool()) != Some(true) {
        return Err("Die automatische Outlook-Öffnung konnte nicht gespeichert werden.".into());
    }
    Ok(serde_json::json!({"defaultProfile":profile}))
}

#[tauri::command]
pub async fn open_outlook_default_profile() -> Result<serde_json::Value, String> {
    let _guard = SETUP_GATE
        .try_lock()
        .map_err(|_| "Die Outlook-Einrichtung laeuft bereits.")?;
    powershell(serde_json::json!({"operation":"open-default-profile"})).await
}

#[tauri::command]
pub async fn create_outlook_profile(
    app: AppHandle,
    profile: String,
) -> Result<serde_json::Value, String> {
    if m365::get_m365_read_only_test_mode() {
        return Err("Im schreibgeschuetzten Testmodus werden keine Profile erstellt.".into());
    }
    let _guard = SETUP_GATE
        .try_lock()
        .map_err(|_| "Eine Outlook-Profileinstellung wird bereits bearbeitet.")?;
    let _process_guard = process_lock(&app)?;
    let installed = inventory().await?;
    let path = helper_path(&app, &installed.executable)?;
    let result: serde_json::Value = helper(&path, &["profile-create", &profile]).await?;
    if result.get("ok").and_then(|value| value.as_bool()) != Some(true) {
        return Err("Das Outlook-Profil konnte nicht erstellt werden.".into());
    }
    Ok(serde_json::json!({"profile":profile}))
}

#[tauri::command]
pub async fn remove_outlook_profile(
    app: AppHandle,
    profile: String,
    replacement: Option<String>,
    confirmation: String,
) -> Result<serde_json::Value, String> {
    if m365::get_m365_read_only_test_mode() {
        return Err("Im schreibgeschuetzten Testmodus werden keine Profile entfernt.".into());
    }
    if confirmation != profile {
        return Err("Die Profilentfernung wurde nicht bestaetigt.".into());
    }
    let _guard = SETUP_GATE
        .try_lock()
        .map_err(|_| "Eine Outlook-Profileinstellung wird bereits bearbeitet.")?;
    let _process_guard = process_lock(&app)?;
    let installed = inventory().await?;
    if installed.running {
        return Err(
            "Bitte Outlook vor dem Entfernen eines Profils vollstaendig schliessen.".into(),
        );
    }
    let path = helper_path(&app, &installed.executable)?;
    let result: serde_json::Value = helper(
        &path,
        &[
            "profile-remove",
            &profile,
            replacement.as_deref().unwrap_or(""),
        ],
    )
    .await?;
    if result.get("ok").and_then(|value| value.as_bool()) != Some(true) {
        return Err("Das Outlook-Profil konnte nicht entfernt werden.".into());
    }
    let profiles: ProfileList = helper(&path, &["exchange-list"]).await?;
    let default_profile = profiles
        .profiles
        .iter()
        .find(|entry| entry.is_default)
        .map(|entry| entry.name.as_str())
        .unwrap_or("");
    Ok(serde_json::json!({"defaultProfile":default_profile}))
}

#[tauri::command]
pub async fn open_outlook_profile(profile: String) -> Result<serde_json::Value, String> {
    let _guard = SETUP_GATE
        .try_lock()
        .map_err(|_| "Die Outlook-Einrichtung laeuft bereits.")?;
    powershell(serde_json::json!({"operation":"open-selected-profile", "profile":profile})).await
}

#[tauri::command]
pub async fn get_outlook_exchange_setup_status(
    app: AppHandle,
    background: Option<bool>,
) -> Result<SetupStatus, String> {
    if !cfg!(windows) {
        return Ok(initial(
            String::new(),
            "unavailable",
            "Die Profileinrichtung benötigt Outlook Classic unter Windows.",
        ));
    }
    let _guard = SETUP_GATE
        .try_lock()
        .map_err(|_| "Die Outlook-Einrichtung läuft bereits.")?;
    let _process_guard = process_lock(&app)?;
    let (id, email) = m365::outlook_profile_identity(&app)?;
    if background == Some(true) {
        if let Some(state) =
            read_state(&app, &id, &email)?.filter(|state| state.phase != "complete")
        {
            keep_setup_in_background(&state)?;
            // The independent watcher manages visibility. A blocked COM call
            // there must not prevent the connection probe from running.
        }
    }
    current_status(&app, &id, &email).await
}

#[tauri::command]
pub async fn get_outlook_office_account_check(app: AppHandle) -> Result<serde_json::Value, String> {
    let (_, email) = m365::outlook_profile_identity(&app)?;
    let mut office: serde_json::Value =
        powershell(serde_json::json!({"operation":"office-accounts"})).await?;
    office["dmhEmail"] = serde_json::json!(email);
    office["dmhEmails"] = serde_json::json!(m365::excel_account_aliases(&app)?);
    Ok(office)
}

fn automatic_office_email(
    office: &serde_json::Value,
    aliases: &[String],
) -> Result<String, String> {
    let unknown = format!(
        "OFFICE_ACCOUNT_NOT_DETECTED: {}",
        serde_json::json!({
            "readSucceeded": office.get("readSucceeded"),
            "accountCount": office.get("accounts").and_then(|value| value.as_array()).map(|items| items.len()).unwrap_or(0),
            "sources": office.get("sources"),
        })
    );
    if office.get("readSucceeded").and_then(|v| v.as_bool()) != Some(true) {
        return Err(unknown.clone());
    }
    let accounts = office
        .get("accounts")
        .and_then(|v| v.as_array())
        .filter(|a| !a.is_empty())
        .ok_or_else(|| unknown.clone())?;
    let matches = |email: &str| {
        !email.is_empty()
            && aliases
                .iter()
                .any(|alias| alias.eq_ignore_ascii_case(email))
    };
    if accounts
        .iter()
        .any(|a| !matches(a.get("email").and_then(|v| v.as_str()).unwrap_or("")))
    {
        return Err("Die Office-Konten stimmen nicht eindeutig mit dem DMH-Konto überein. In DMH und Excel muss dasselbe Geschäftskonto angemeldet sein. Bitte die Konten prüfen und erneut versuchen.".into());
    }
    let suggested = office
        .get("suggestedEmail")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    if !suggested.is_empty() && !matches(suggested) {
        return Err("Das bevorzugte Office-Konto unterscheidet sich vom DMH-Konto. Bitte in DMH und Excel dasselbe Geschäftskonto verbinden.".into());
    }
    Ok(if suggested.is_empty() {
        accounts[0]["email"]
            .as_str()
            .ok_or_else(|| unknown.clone())?
    } else {
        suggested
    }
    .to_owned())
}

#[tauri::command]
pub async fn prepare_outlook_exchange_profile(
    app: AppHandle,
    excel_email: String,
    excel_account_confirmed: bool,
    close_existing_outlook: bool,
    automatic_account_check: Option<bool>,
) -> Result<SetupStatus, String> {
    if m365::get_m365_read_only_test_mode() {
        return Err(
            "Im schreibgeschützten Testmodus werden keine Outlook-Profile eingerichtet.".into(),
        );
    }
    if !cfg!(windows) {
        return Ok(initial(
            String::new(),
            "unavailable",
            "Die Profileinrichtung benötigt Outlook Classic unter Windows.",
        ));
    }
    let _guard = SETUP_GATE
        .try_lock()
        .map_err(|_| "Die Outlook-Einrichtung läuft bereits.")?;
    let _process_guard = process_lock(&app)?;
    if automatic_account_check == Some(true) {
        let office: serde_json::Value =
            powershell(serde_json::json!({"operation":"office-accounts"})).await?;
        let aliases = m365::excel_account_aliases(&app)?;
        let detected = automatic_office_email(&office, &aliases)?;
        if !detected.eq_ignore_ascii_case(&excel_email) {
            return Err(
                "Das Office-Konto wurde inzwischen geändert. Bitte erneut versuchen.".into(),
            );
        }
        m365::confirm_excel_account(&app, &excel_email, true)?;
    } else {
        m365::confirm_excel_account(&app, &excel_email, excel_account_confirmed)?;
    }
    setup_progress(&app, &excel_email, 0, "Microsoft-Konto wird geprüft …");
    m365::test_m365_connection(app.clone()).await?;
    let (id, email) = m365::outlook_profile_identity(&app)?;
    let mut installed = inventory().await?;
    if installed.executable.is_empty() {
        return Ok(initial(email, "unavailable", "Bitte Outlook Classic installieren. Das neue Outlook unterstützt diese Profileinrichtung nicht."));
    }
    let path = helper_path(&app, &installed.executable)?;
    let mut saved = read_state(&app, &id, &email)?;
    if let Some(state) = saved.as_mut() {
        state.automatic_close = close_existing_outlook;
        state.confirmed_excel_email = Some(excel_email.clone());
        save_state(&app, state)?;
    }
    let profiles: ProfileList = helper(&path, &["exchange-list"]).await?;
    m365::check_exchange_mailbox_access(&app).await?;
    if saved.is_none() {
        let catalog = powershell(serde_json::json!({"operation":"profile-catalog"})).await?;
        if let Some(name) = reusable_exchange_profile(&catalog, &profiles.profiles, &email)? {
            saved = Some(SetupState {
                reused_profile: true,
                account_id: id.clone(),
                email: email.clone(),
                previous_profile: None,
                exchange_profile: name,
                imap_profile: None,
                phase: "created".into(),
                windows_sso: false,
                warning: None,
                launched_process_id: None,
                launched_started_at: None,
                confirmed_excel_email: Some(excel_email.clone()),
                automatic_close: close_existing_outlook,
            });
            save_state(&app, saved.as_ref().unwrap())?;
        }
    }
    if installed.running && close_existing_outlook {
        // A resumed Exchange login must finish before its Outlook is closed.
        if let Some(state) = saved.as_ref() {
            let connection = probe().await?;
            if connection
                .active_profile
                .eq_ignore_ascii_case(&state.exchange_profile)
            {
                return current_status(&app, &id, &email).await;
            }
        }
        setup_progress(&app, &email, 1, "Outlook wird geschlossen …");
        let closed: serde_json::Value =
            powershell(serde_json::json!({"operation":"close-for-migration","authorized":true}))
                .await?;
        installed = inventory().await?;
        if installed.running {
            let message = if closed.get("reason").and_then(|value| value.as_str())
                == Some("user_work")
            {
                "Outlook enthält ein geöffnetes Element oder einen Entwurf. Bitte speichern und schließen; anschließend die Einrichtung fortsetzen."
            } else {
                "Outlook konnte noch nicht regulär geschlossen werden. Bitte offene Outlook-Dialoge prüfen und die Einrichtung fortsetzen."
            };
            return Ok(initial(email, "outlook_open", message));
        }
    }
    setup_progress(&app, &email, 2, "Outlook-Profile werden geprüft …");
    if saved.as_ref().is_some_and(|state| {
        state.phase != "reserved"
            && !profiles
                .profiles
                .iter()
                .any(|profile| profile.name.eq_ignore_ascii_case(&state.exchange_profile))
    }) {
        if installed.running {
            return Ok(initial(email, "outlook_open", "Bitte Outlook vollständig schließen. Das nicht mehr verfügbare Exchange-Profil wird anschließend neu eingerichtet."));
        }
        // Discard only stale setup bookkeeping, never delete a profile or data.
        saved = None;
    }
    if let Some(state) = saved.as_mut() {
        state.confirmed_excel_email = Some(excel_email.clone());
        save_state(&app, state)?;
        let connection = probe().await?;
        if matches!(state.phase.as_str(), "complete" | "verified" | "activating")
            || proves_connection(&connection, state)
        {
            return current_status(&app, &id, &email).await;
        }
        if connection
            .active_profile
            .eq_ignore_ascii_case(&state.exchange_profile)
        {
            return Ok(status(state, "awaiting_login", "Das neue Exchange-Profil ist bereits geöffnet. Bitte dort die Microsoft-Anmeldung abschließen; die Verbindung wird weiter geprüft."));
        }
        if installed.running {
            return Ok(status(state, "outlook_open", "Bitte die Anmeldung im neuen Exchange-Profil abschließen. Falls ein anderes Profil geöffnet ist: Arbeit speichern, Outlook schließen und erneut versuchen."));
        }
    } else if installed.running {
        return Ok(initial(email, "outlook_open", "Bitte Ihre Arbeit in Outlook speichern und Outlook vollständig schließen. Danach hier erneut versuchen."));
    }
    let naming_profiles = all_profile_names(&profiles.profiles, &installed.profile_names);
    let windows_sso = installed.windows_primary_smtp.eq_ignore_ascii_case(&email);
    let mut state = if let Some(state) = saved {
        state
    } else {
        let mut matches = Vec::new();
        for profile in &profiles.profiles {
            let accounts: Vec<ImapAccount> = helper(&path, &["scan", &profile.name]).await?;
            if accounts
                .iter()
                .any(|account| account.email.eq_ignore_ascii_case(&email))
            {
                matches.push(profile.name.clone());
            }
        }
        let previous = select_previous(&matches)?;
        let imap = if let Some(name) = previous.as_ref() {
            Some(if managed_name(name, "Profile IMAP") {
                name.clone()
            } else {
                unique_name("Profile IMAP", &naming_profiles)?
            })
        } else {
            None
        };
        let state = SetupState {
            reused_profile: false,
            account_id: id.clone(),
            email: email.clone(),
            previous_profile: previous,
            exchange_profile: unique_name("Profile Exchange", &naming_profiles)?,
            imap_profile: imap,
            phase: "reserved".into(),
            windows_sso,
            warning: None,
            launched_process_id: None,
            launched_started_at: None,
            confirmed_excel_email: Some(excel_email.clone()),
            automatic_close: close_existing_outlook,
        };
        save_state(&app, &state)?;
        state
    };
    state.confirmed_excel_email = Some(excel_email);
    save_state(&app, &state)?;
    if state.windows_sso && !windows_sso {
        return Err("Das Windows-Konto fuer die automatische Outlook-Anmeldung konnte nicht bestaetigt werden. Bitte die Verbindung zum Firmennetz pruefen und erneut versuchen.".into());
    }
    if windows_sso && !state.windows_sso && matches!(state.phase.as_str(), "reserved" | "created") {
        // Upgrade only an unfinished legacy setup. Keep its profile untouched;
        // Outlook will provision a fresh, uniquely named profile via Windows SSO.
        enable_windows_sso(&mut state, &naming_profiles)?;
        save_state(&app, &state)?;
    }
    // Recheck after discovery; never force-close an Outlook opened meanwhile.
    let latest_inventory = inventory().await?;
    if latest_inventory.running {
        return Ok(status(
            &state,
            "outlook_open",
            "Bitte Outlook vollständig schließen und erneut versuchen.",
        ));
    }
    let naming_profiles = all_profile_names(&naming_profiles, &latest_inventory.profile_names);
    reserve_unused_profile_name(&mut state, &naming_profiles)?;
    save_state(&app, &state)?;
    if !naming_profiles
        .iter()
        .any(|profile| profile.name.eq_ignore_ascii_case(&state.exchange_profile))
    {
        if state.reused_profile {
            return Err("Das ausgewählte Exchange-Profil ist nicht mehr vorhanden. Bitte die EDV informieren.".into());
        }
        setup_progress(&app, &email, 3, "Exchange-Profil wird vorbereitet …");
        let command = if state.windows_sso {
            "exchange-create-windows-sso"
        } else {
            "exchange-create"
        };
        let result: serde_json::Value =
            helper(&path, &[command, &state.exchange_profile, &email]).await?;
        if result.get("ok").and_then(|value| value.as_bool()) != Some(true) {
            return Err("Das Exchange-Profil konnte nicht erstellt werden.".into());
        }
        state.phase = "created".into();
        save_state(&app, &state)?;
    } else if state.phase == "reserved" {
        // Crash during creation cannot prove a complete profile. Do not mutate
        // that profile or create duplicates; let Outlook complete/verify it.
        state.warning = Some(
            "Die Einrichtung wurde unterbrochen. Bitte das vorbereitete Profil in Outlook prüfen."
                .into(),
        );
        save_state(&app, &state)?;
    }
    if m365::outlook_profile_identity(&app)? != (id.clone(), email.clone()) {
        return Err("Das Microsoft-365-Konto wurde während der Einrichtung geändert. Bitte erneut versuchen.".into());
    }
    setup_progress(
        &app,
        &email,
        4,
        "Outlook wird im Hintergrund eingerichtet …",
    );
    let launched: serde_json::Value =
        powershell(serde_json::json!({"operation":"launch","profile":state.exchange_profile,"email":email,"windowsSso":state.windows_sso}))
            .await?;
    if launched.get("launched").and_then(|value| value.as_bool()) != Some(true) {
        return Ok(status(
            &state,
            "outlook_open",
            "Outlook wurde inzwischen geöffnet. Bitte Outlook schließen und erneut versuchen.",
        ));
    }
    state.launched_process_id = launched
        .get("processId")
        .and_then(|value| value.as_u64())
        .and_then(|value| u32::try_from(value).ok());
    state.launched_started_at = launched
        .get("startedAt")
        .and_then(|value| value.as_str())
        .map(str::to_owned);
    save_state(&app, &state)?;
    keep_setup_in_background(&state)?;
    let message = if state.windows_sso {
        "Outlook wurde mit der automatischen Windows-Kontoeinrichtung gestartet. Die E-Mail-Adresse wird aus Ihrem passenden Domaenenkonto uebernommen. Microsoft kann weiterhin eine Bestaetigung oder MFA verlangen."
    } else {
        "Das Exchange-Profil wurde vorbereitet und Outlook geöffnet. Bitte gegebenenfalls die Microsoft-Anmeldung bestätigen. Die Verbindung wird anschließend geprüft."
    };
    Ok(status(&state, "awaiting_login", message))
}

#[tauri::command]
pub async fn complete_outlook_exchange_profile(app: AppHandle) -> Result<SetupStatus, String> {
    if m365::get_m365_read_only_test_mode() {
        return Err(
            "Im schreibgeschützten Testmodus werden keine Outlook-Profile geändert.".into(),
        );
    }
    let _guard = SETUP_GATE
        .try_lock()
        .map_err(|_| "Die Outlook-Einrichtung läuft bereits.")?;
    let _process_guard = process_lock(&app)?;
    m365::test_m365_connection(app.clone()).await?;
    let (id, email) = m365::outlook_profile_identity(&app)?;
    let mut state =
        read_state(&app, &id, &email)?.ok_or("Bitte die Outlook-Einrichtung zuerst starten.")?;
    keep_setup_in_background(&state)?;
    m365::confirm_excel_account(
        &app,
        state.confirmed_excel_email.as_deref().unwrap_or(""),
        state.confirmed_excel_email.is_some(),
    )?;
    let previously_verified =
        matches!(state.phase.as_str(), "verified" | "activating" | "complete");
    if !previously_verified && !proves_connection(&probe().await?, &state) {
        return Ok(status(&state, "awaiting_login", "Die Verbindung zur richtigen Exchange-Mailbox ist noch nicht bestätigt. Bitte die Anmeldung in Outlook abschließen; der bisherige Standard bleibt erhalten."));
    }
    setup_progress(
        &app,
        &email,
        5,
        "Verbindung bestätigt. Standardprofil wird eingerichtet …",
    );
    let mut installed = inventory().await?;
    if installed.running {
        if !previously_verified {
            state.phase = "verified".into();
            save_state(&app, &state)?;
        }
        let mut closed: serde_json::Value = powershell(serde_json::json!({"operation":"close-setup-process", "processId":state.launched_process_id, "startedAt":state.launched_started_at, "profile":state.exchange_profile})).await?;
        if state.automatic_close
            && closed.get("reason").and_then(|value| value.as_str()) == Some("not_owned")
        {
            closed = powershell(serde_json::json!({"operation":"close-for-migration","authorized":true,"profile":state.exchange_profile})).await?;
        }
        if closed.get("closed").and_then(|value| value.as_bool()) != Some(true) {
            let needs_user = matches!(
                closed.get("reason").and_then(|value| value.as_str()),
                Some("not_owned" | "user_work")
            );
            return Ok(status(
                &state,
                if needs_user {
                    "outlook_open"
                } else {
                    "awaiting_close"
                },
                if needs_user {
                    "Bitte Ihre Arbeit in Outlook speichern und Outlook schließen, um die Einrichtung abzuschließen."
                } else {
                    "Wird eingerichtet. Bitte warten und die Anwendung nicht schließen."
                },
            ));
        }
        installed = inventory().await?;
        if installed.running {
            return Ok(status(
                &state,
                "awaiting_close",
                "Wird eingerichtet. Bitte warten und die Anwendung nicht schließen.",
            ));
        }
    }
    let path = helper_path(&app, &installed.executable)?;
    let profiles: ProfileList = helper(&path, &["exchange-list"]).await?;
    let original_exists = state.previous_profile.as_ref().is_some_and(|old| {
        profiles
            .profiles
            .iter()
            .any(|profile| profile.name.eq_ignore_ascii_case(old))
    });
    let already_renamed = matches!(state.phase.as_str(), "activating" | "complete")
        && !original_exists
        && state.imap_profile.as_ref().is_some_and(|name| {
            profiles
                .profiles
                .iter()
                .any(|profile| profile.name.eq_ignore_ascii_case(name))
        });
    if state.previous_profile.is_some() && !original_exists && !already_renamed {
        return Err("Das ursprüngliche IMAP-Profil wurde inzwischen verändert. Bitte die EDV informieren; die Profile werden nicht automatisch umbenannt.".into());
    }
    // Persist before mutation so interruption can be resumed without creating
    // duplicates or re-renaming a profile already processed by MAPI.
    state.phase = "activating".into();
    save_state(&app, &state)?;
    if m365::outlook_profile_identity(&app)? != (id, email) {
        return Err(
            "Das verbundene Microsoft-365-Konto wurde geändert. Bitte erneut versuchen.".into(),
        );
    }
    let result: Activation = helper(
        &path,
        &[
            "exchange-activate",
            &state.exchange_profile,
            if already_renamed {
                ""
            } else {
                state.previous_profile.as_deref().unwrap_or("")
            },
            if already_renamed {
                ""
            } else {
                state.imap_profile.as_deref().unwrap_or("")
            },
        ],
    )
    .await?;
    if !result.ok {
        return Err("Das Exchange-Profil konnte nicht als Standard bestätigt werden.".into());
    }
    let startup: serde_json::Value = powershell(
        serde_json::json!({"operation":"automatic-startup", "profile":state.exchange_profile}),
    )
    .await?;
    let verified: ProfileList = helper(&path, &["exchange-list"]).await?;
    // Read persisted settings again through a fresh helper after Outlook exit.
    // Do not rely solely on the write command's own response.
    let persisted: serde_json::Value =
        powershell(serde_json::json!({"operation":"profile-catalog"})).await?;
    if startup.get("ok").and_then(|value| value.as_bool()) != Some(true)
        || !startup_is_verified(&verified.profiles, &startup, &state.exchange_profile)
        || !startup_is_verified(&verified.profiles, &persisted, &state.exchange_profile)
        || inventory().await?.running
    {
        return Err(
            "Outlook hat das Exchange-Profil nicht als dauerhaften Standard bestätigt.".into(),
        );
    }
    state.warning = result.warning;
    if !result.renamed && !already_renamed {
        state.imap_profile = state
            .previous_profile
            .clone()
            .filter(|name| managed_name(name, "Profile IMAP"));
    }
    state.phase = "complete".into();
    save_state(&app, &state)?;
    stop_background_watcher();
    Ok(status(&state, "complete", completion_message(&state)))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reuse_requires_matching_exchange_account_and_unambiguous_profile() {
        let catalog = serde_json::json!({"profiles":[
            {"name":"Büro", "accounts":[{"email":"ANNA@example.test","accountType":"Exchange"}]},
            {"name":"Second", "accounts":[{"email":"anna@example.test","accountType":"Exchange"}]},
            {"name":"IMAP", "accounts":[{"email":"anna@example.test","accountType":"IMAP"}]}
        ]});
        let mut profiles = vec![
            Profile {
                name: "Büro".into(),
                is_default: false,
            },
            Profile {
                name: "IMAP".into(),
                is_default: true,
            },
        ];
        assert_eq!(
            reusable_exchange_profile(&catalog, &profiles, "anna@example.test").unwrap(),
            Some("Büro".into())
        );
        assert!(
            reusable_exchange_profile(&catalog, &profiles, "other@example.test")
                .unwrap()
                .is_none()
        );
        profiles.push(Profile {
            name: "Second".into(),
            is_default: false,
        });
        assert!(reusable_exchange_profile(&catalog, &profiles, "anna@example.test").is_err());
        profiles[0].is_default = true;
        assert_eq!(
            reusable_exchange_profile(&catalog, &profiles, "anna@example.test").unwrap(),
            Some("Büro".into())
        );
        let mut reused = state();
        reused.reused_profile = true;
        reused.exchange_profile = "Büro".into();
        assert!(validate_state(&reused, "one", "anna@example.test").is_ok());
        enable_windows_sso(&mut reused, &profiles).unwrap();
        assert_eq!(reused.exchange_profile, "Büro");
        assert!(!reused.windows_sso);
    }

    #[test]
    fn busy_com_probe_is_pending_not_failure_or_success() {
        let probe = pending_probe(Err(format!(
            "{HELPER_TIMEOUT}: powershell.exe; Zeitlimit 25s"
        )))
        .unwrap();
        assert!(probe.active_profile.is_empty());
        assert!(probe.accounts.is_empty());
        assert!(pending_probe(Err("real helper failure".into())).is_err());
    }

    #[cfg(windows)]
    #[test]
    fn powershell_pipe_handles_large_real_script_and_keeps_request_as_data() {
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        // Run only the harmless transport-check branch: no Outlook launch,
        // profile changes, registry writes or authentication.
        let script = format!("{SCRIPT}\n#{}", "x".repeat(70_000));
        let echo = "Grüße · configuração · '; throw 'must remain data'; #";
        let result: serde_json::Value = runtime
            .block_on(powershell_script(
                &script,
                serde_json::json!({"operation":"transport-check", "echo":echo}),
            ))
            .unwrap();
        assert_eq!(result["ok"], true);
        assert_eq!(result["echo"], echo);
    }

    #[test]
    fn automatic_office_account_requires_unambiguous_matching_metadata() {
        let aliases = vec![
            "anna@example.test".to_owned(),
            "anna@tenant.test".to_owned(),
        ];
        let matching = serde_json::json!({"readSucceeded":true,"accounts":[{"email":"ANNA@example.test"}],"suggestedEmail":"anna@example.test"});
        assert_eq!(
            automatic_office_email(&matching, &aliases).unwrap(),
            "anna@example.test"
        );
        for invalid in [
            serde_json::json!({"readSucceeded":false,"accounts":[{"email":"anna@example.test"}]}),
            serde_json::json!({"readSucceeded":true,"accounts":[]}),
            serde_json::json!({"readSucceeded":true,"accounts":[{"email":"admin@example.test"}]}),
            serde_json::json!({"readSucceeded":true,"accounts":[{"email":"anna@example.test"},{"email":"admin@example.test"}]}),
            serde_json::json!({"readSucceeded":true,"accounts":[{"email":"anna@example.test"}],"suggestedEmail":"admin@example.test"}),
        ] {
            assert!(automatic_office_email(&invalid, &aliases).is_err());
        }
        let aliases_only = serde_json::json!({"readSucceeded":true,"accounts":[{"email":"anna@example.test"},{"email":"anna@tenant.test"}]});
        assert_eq!(
            automatic_office_email(&aliases_only, &aliases).unwrap(),
            "anna@example.test"
        );
    }

    #[test]
    fn missing_office_metadata_is_not_reported_as_excel_signed_out() {
        let office = serde_json::json!({
            "readSucceeded": true, "accounts": [],
            "sources": [{"version":"16.0", "view":"Registry32", "state":"missing", "identityCount":0}]
        });
        let error = automatic_office_email(&office, &["anna@example.test".into()]).unwrap_err();
        let detail: serde_json::Value =
            serde_json::from_str(error.strip_prefix("OFFICE_ACCOUNT_NOT_DETECTED: ").unwrap())
                .unwrap();
        assert_eq!(detail["accountCount"], 0);
        assert_eq!(detail["sources"], office["sources"]);
        assert!(!error.contains("anmelden"));
    }

    #[cfg(windows)]
    #[test]
    fn office_identity_reader_covers_local_users_and_registry_views() {
        let script = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../scripts/test-office-account-detection.ps1");
        // Executes the real reader against synthetic keys only. No Office
        // launch, authentication, registry writes or user-account changes.
        let output = hidden_command("powershell.exe")
            .args([
                "-NoProfile",
                "-NonInteractive",
                "-ExecutionPolicy",
                "Bypass",
                "-File",
            ])
            .arg(script)
            .output()
            .expect("Office identity regression checks could not start");
        assert!(
            output.status.success(),
            "{}\n{}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        );
    }

    #[test]
    fn completion_requires_native_default_and_automatic_startup() {
        let profiles = vec![Profile {
            name: "Profile Exchange".into(),
            is_default: true,
        }];
        let startup =
            serde_json::json!({"defaultProfile":"Profile Exchange", "promptForProfile":false});
        assert!(startup_is_verified(&profiles, &startup, "Profile Exchange"));
        assert!(!startup_is_verified(&[], &startup, "Profile Exchange"));
        assert!(!startup_is_verified(
            &profiles,
            &serde_json::json!({"defaultProfile":"Profile Exchange", "promptForProfile":true}),
            "Profile Exchange"
        ));
        assert!(!startup_is_verified(
            &profiles,
            &serde_json::json!({"defaultProfile":"Profile IMAP", "promptForProfile":false}),
            "Profile Exchange"
        ));
        assert!(!startup_is_verified(
            &[Profile {
                name: "Profile Exchange".into(),
                is_default: false
            }],
            &startup,
            "Profile Exchange"
        ));
    }

    fn state() -> SetupState {
        SetupState {
            reused_profile: false,
            account_id: "one".into(),
            email: "anna@example.test".into(),
            previous_profile: Some("Outlook".into()),
            exchange_profile: "Profile Exchange".into(),
            imap_profile: Some("Profile IMAP".into()),
            phase: "created".into(),
            windows_sso: false,
            warning: None,
            launched_process_id: None,
            launched_started_at: None,
            confirmed_excel_email: Some("anna@example.test".into()),
            automatic_close: false,
        }
    }
    fn connection() -> Probe {
        Probe {
            active_profile: "Profile Exchange".into(),
            accounts: vec![ExchangeAccount {
                email: "anna@example.test".into(),
                account_type: 0,
                connection_mode: 700,
                store_type: 0,
            }],
        }
    }
    #[test]
    fn windows_sso_upgrade_preserves_old_profiles_and_resumes_reserved_name() {
        let mut state = state();
        let profiles = vec![Profile {
            name: "Profile Exchange".into(),
            is_default: false,
        }];
        enable_windows_sso(&mut state, &profiles).unwrap();
        assert!(state.windows_sso);
        assert_eq!(state.exchange_profile, "Profile Exchange 2");
        assert_eq!(state.previous_profile.as_deref(), Some("Outlook"));
        assert_eq!(state.phase, "reserved");
        enable_windows_sso(&mut state, &profiles).unwrap();
        assert_eq!(state.exchange_profile, "Profile Exchange 2");

        let mut state = self::state();
        state.phase = "complete".into();
        enable_windows_sso(&mut state, &profiles).unwrap();
        assert!(!state.windows_sso);
        assert_eq!(state.exchange_profile, "Profile Exchange");
    }
    #[test]
    fn registry_only_profiles_reserve_names_without_becoming_defaults() {
        let table = vec![Profile {
            name: "Outlook".into(),
            is_default: true,
        }];
        let names = all_profile_names(
            &table,
            &[
                "outlook".into(),
                "Profile Exchange".into(),
                "Profile Exchange 2".into(),
                "Profile IMAP".into(),
            ],
        );
        assert_eq!(names.len(), 4);
        assert_eq!(names.iter().filter(|profile| profile.is_default).count(), 1);
        assert_eq!(
            unique_name("Profile Exchange", &names).unwrap(),
            "Profile Exchange 3"
        );
        assert_eq!(
            unique_name("Profile IMAP", &names).unwrap(),
            "Profile IMAP 2"
        );

        let mut reserved = state();
        reserved.phase = "reserved".into();
        reserve_unused_profile_name(&mut reserved, &names).unwrap();
        assert_eq!(reserved.exchange_profile, "Profile Exchange 3");
        reserve_unused_profile_name(&mut reserved, &names).unwrap();
        assert_eq!(reserved.exchange_profile, "Profile Exchange 3");

        let mut created = state();
        reserve_unused_profile_name(&mut created, &names).unwrap();
        assert_eq!(created.exchange_profile, "Profile Exchange");
    }
    #[test]
    fn activation_requires_online_correct_account_profile_and_primary_exchange_store() {
        let state = state();
        assert!(proves_connection(&connection(), &state));
        for mode in [0, 100, 200, 300, 400] {
            let mut probe = connection();
            probe.accounts[0].connection_mode = mode;
            assert!(!proves_connection(&probe, &state));
        }
        let mut probe = connection();
        probe.active_profile = "Old profile".into();
        assert!(!proves_connection(&probe, &state));
        let mut probe = connection();
        probe.accounts[0].email = "another@example.test".into();
        assert!(!proves_connection(&probe, &state));
        for store in [1, 2, 3, 4] {
            let mut probe = connection();
            probe.accounts[0].store_type = store;
            assert!(!proves_connection(&probe, &state));
        }
        let mut probe = connection();
        probe.accounts[0].account_type = 1;
        assert!(!proves_connection(&probe, &state));
        assert!(!proves_connection(&Probe::default(), &state));
    }
    #[test]
    fn refuses_ambiguous_imap_profiles_and_preserves_occupied_names() {
        assert!(select_previous(&["One".into(), "Two".into()]).is_err());
        assert_eq!(select_previous(&[]).unwrap(), None);
        assert_eq!(
            select_previous(&["Outlook".into()]).unwrap(),
            Some("Outlook".into())
        );
        let profiles = vec![
            Profile {
                name: "profile exchange".into(),
                is_default: true,
            },
            Profile {
                name: "Profile Exchange 2".into(),
                is_default: false,
            },
        ];
        assert_eq!(
            unique_name("Profile Exchange", &profiles).unwrap(),
            "Profile Exchange 3"
        );
    }
    #[test]
    fn saved_setup_is_bound_to_account_email_and_reserved_profile_names() {
        let mut state = state();
        assert!(validate_state(&state, "one", "ANNA@example.test").is_ok());
        assert!(validate_state(&state, "two", "anna@example.test").is_err());
        assert!(validate_state(&state, "one", "other@example.test").is_err());
        state.exchange_profile = "Outlook".into();
        assert!(validate_state(&state, "one", "anna@example.test").is_err());
        assert_ne!(state_key("one"), state_key("two"));
        assert!(!crate::is_backup_safe_setting_key(&state_key("one")));
        assert!(is_setup_state_key(&state_key("one")));
    }

    #[test]
    fn setup_lock_rejects_other_handles_and_recovers_when_owner_exits() {
        let path =
            std::env::temp_dir().join(format!("dmh-outlook-lock-{}.tmp", uuid::Uuid::new_v4()));
        let first = lock_file(&path).unwrap();
        assert!(lock_file(&path).is_err());
        drop(first);
        drop(lock_file(&path).unwrap());
        std::fs::remove_file(path).unwrap();
    }
}
