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
use tauri::{AppHandle, Manager};
use tokio::io::AsyncWriteExt;

static SETUP_GATE: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());
const SCRIPT: &str = include_str!("outlook_exchange_profile.ps1");
// m365_ is excluded from portable exports/restores: Outlook profiles belong to
// this Windows account and cannot travel with the contact/calendar backup.
const STATE_PREFIX: &str = "m365_outlook_exchange_setup_v1_";

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
    account_id: String,
    email: String,
    previous_profile: Option<String>,
    exchange_profile: String,
    imap_profile: Option<String>,
    phase: String,
    #[serde(default)]
    warning: Option<String>,
}

#[derive(Deserialize)]
struct Inventory {
    executable: String,
    running: bool,
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
        || !managed_name(&state.exchange_profile, "Profile Exchange")
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
            "reserved" | "created" | "activating" | "complete"
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
    let mut child = command
        .spawn()
        .map_err(|_| "Outlook-Hilfsprogramm konnte nicht gestartet werden.".to_string())?;
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
        .map_err(|_| {
            "Outlook antwortet noch nicht. Bitte offene Anmeldefenster prüfen und erneut versuchen."
                .to_string()
        })?
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
    let mut command = tokio::process::Command::from(hidden_command("powershell.exe"));
    command.args([
        "-NoProfile",
        "-NonInteractive",
        "-STA",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        SCRIPT,
    ]);
    output_json(command, Some(input), 25).await
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
    powershell(serde_json::json!({"operation":"probe"})).await
}

async fn current_status(app: &AppHandle, id: &str, email: &str) -> Result<SetupStatus, String> {
    let Some(state) = read_state(app, id, email)? else {
        return Ok(initial(
            email.into(),
            "ready",
            "Outlook Classic kann mit einem eigenen Exchange-Profil eingerichtet werden.",
        ));
    };
    if state.phase == "complete" {
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
        if profiles.profiles.iter().any(|profile| {
            profile.name.eq_ignore_ascii_case(&state.exchange_profile) && profile.is_default
        }) {
            return Ok(status(&state, "complete", completion_message(&state)));
        }
        return Err("Das eingerichtete Exchange-Profil ist nicht mehr als Standard vorhanden. Bitte die EDV informieren.".into());
    }
    if proves_connection(&probe().await?, &state) {
        return Ok(status(&state, "connected", "Outlook ist mit der richtigen Exchange-Mailbox verbunden. Die Profile werden jetzt abgeschlossen."));
    }
    Ok(status(&state, "awaiting_login", "Bitte im geöffneten Outlook die Anmeldung abschließen. Microsoft kann eine Bestätigung oder MFA verlangen. Der bisherige Standard bleibt bis zur Prüfung erhalten."))
}

#[tauri::command]
pub async fn get_outlook_exchange_setup_status(app: AppHandle) -> Result<SetupStatus, String> {
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
    current_status(&app, &id, &email).await
}

#[tauri::command]
pub async fn prepare_outlook_exchange_profile(app: AppHandle) -> Result<SetupStatus, String> {
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
    m365::test_m365_connection(app.clone()).await?;
    let (id, email) = m365::outlook_profile_identity(&app)?;
    let installed = inventory().await?;
    if installed.executable.is_empty() {
        return Ok(initial(email, "unavailable", "Bitte Outlook Classic installieren. Das neue Outlook unterstützt diese Profileinrichtung nicht."));
    }
    let path = helper_path(&app, &installed.executable)?;
    let saved = read_state(&app, &id, &email)?;
    if let Some(state) = saved.as_ref() {
        let connection = probe().await?;
        if state.phase == "complete" || proves_connection(&connection, state) {
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
    let profiles: ProfileList = helper(&path, &["exchange-list"]).await?;
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
                unique_name("Profile IMAP", &profiles.profiles)?
            })
        } else {
            None
        };
        let state = SetupState {
            account_id: id.clone(),
            email: email.clone(),
            previous_profile: previous,
            exchange_profile: unique_name("Profile Exchange", &profiles.profiles)?,
            imap_profile: imap,
            phase: "reserved".into(),
            warning: None,
        };
        save_state(&app, &state)?;
        state
    };
    // Recheck after discovery; never force-close an Outlook opened meanwhile.
    if inventory().await?.running {
        return Ok(status(
            &state,
            "outlook_open",
            "Bitte Outlook vollständig schließen und erneut versuchen.",
        ));
    }
    if !profiles
        .profiles
        .iter()
        .any(|profile| profile.name.eq_ignore_ascii_case(&state.exchange_profile))
    {
        let result: serde_json::Value =
            helper(&path, &["exchange-create", &state.exchange_profile, &email]).await?;
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
    if m365::outlook_profile_identity(&app)? != (id, email) {
        return Err("Das Microsoft-365-Konto wurde während der Einrichtung geändert. Bitte erneut versuchen.".into());
    }
    let launched: serde_json::Value =
        powershell(serde_json::json!({"operation":"launch","profile":state.exchange_profile}))
            .await?;
    if launched.get("launched").and_then(|value| value.as_bool()) != Some(true) {
        return Ok(status(
            &state,
            "outlook_open",
            "Outlook wurde inzwischen geöffnet. Bitte Outlook schließen und erneut versuchen.",
        ));
    }
    Ok(status(&state, "awaiting_login", "Das Exchange-Profil wurde vorbereitet und Outlook geöffnet. Bitte gegebenenfalls die Microsoft-Anmeldung bestätigen. Die Verbindung wird anschließend geprüft."))
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
    if state.phase == "complete" {
        return current_status(&app, &id, &email).await;
    }
    if !proves_connection(&probe().await?, &state) {
        return Ok(status(&state, "awaiting_login", "Die Verbindung zur richtigen Exchange-Mailbox ist noch nicht bestätigt. Bitte die Anmeldung in Outlook abschließen; der bisherige Standard bleibt erhalten."));
    }
    let installed = inventory().await?;
    let path = helper_path(&app, &installed.executable)?;
    let profiles: ProfileList = helper(&path, &["exchange-list"]).await?;
    let original_exists = state.previous_profile.as_ref().is_some_and(|old| {
        profiles
            .profiles
            .iter()
            .any(|profile| profile.name.eq_ignore_ascii_case(old))
    });
    let already_renamed = state.phase == "activating"
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
    state.warning = result.warning;
    if !result.renamed && !already_renamed {
        state.imap_profile = state
            .previous_profile
            .clone()
            .filter(|name| managed_name(name, "Profile IMAP"));
    }
    state.phase = "complete".into();
    save_state(&app, &state)?;
    Ok(status(&state, "complete", completion_message(&state)))
}

#[cfg(test)]
mod tests {
    use super::*;
    fn state() -> SetupState {
        SetupState {
            account_id: "one".into(),
            email: "anna@example.test".into(),
            previous_profile: Some("Outlook".into()),
            exchange_profile: "Profile Exchange".into(),
            imap_profile: Some("Profile IMAP".into()),
            phase: "created".into(),
            warning: None,
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
