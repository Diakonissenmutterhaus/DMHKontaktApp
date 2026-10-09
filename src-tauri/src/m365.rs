use crate::{hidden_command, open_db, AppState};
use base64::{
    engine::general_purpose::{STANDARD as BASE64_STANDARD, URL_SAFE_NO_PAD},
    Engine as _,
};
use chrono::{Datelike, Duration as ChronoDuration, Utc};
use futures_util::{stream, StreamExt};
use rand::{Rng, RngCore};
use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet};
use std::io::{ErrorKind, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Manager, State};
use tauri_plugin_opener::OpenerExt;
use zeroize::Zeroize;

const TOKEN_SETTING_KEY: &str = "m365_token_bundle_v1";
const PROFILE_SETTING_KEY: &str = "m365_connection_profile_v1";
const CALENDAR_COLOR_CATEGORY_MIGRATION_KEY_PREFIX: &str = "m365_calendar_color_categories_v2";
const DPAPI_ENTROPY: &[u8] = b"de.dmh.agendakontakte.m365.v1";
const GRAPH_PROFILE_URL: &str =
    "https://graph.microsoft.com/v1.0/me?$select=id,displayName,mail,userPrincipalName";
const LOGIN_SCOPES: &str = "openid profile offline_access User.Read Contacts.ReadWrite Contacts.ReadWrite.Shared Calendars.ReadWrite Calendars.ReadWrite.Shared Calendars.Read.Shared MailboxSettings.ReadWrite Files.ReadWrite.All Sites.Read.All";
const INTERACTIVE_LOGIN_TIMEOUT: Duration = Duration::from_secs(5 * 60);
const GRAPH_MAX_ATTEMPTS: usize = 5;
const GRAPH_REQUEST_TIMEOUT: Duration = Duration::from_secs(60);
const GRAPH_MAX_PAGES: usize = 100_000;
// Large enough to drain a 200k-event first import in roughly 40 bounded
// transactions, while keeping each WebView/SQLite hand-off manageable.
const CALENDAR_DELTA_BATCH_SIZE: usize = 5_000;
const CALENDAR_DELTA_PAGES_PER_SYNC: usize = 4;
const CALENDAR_TITLE_REPAIR_BATCH_SIZE: usize = 120;
const CALENDAR_TITLE_REPAIR_CONCURRENCY: usize = 6;
// Opt-in diagnostic mode for a local development run. It is intentionally
// enforced in Rust as well as the WebView so no UI path can write to Graph.
fn m365_read_only_test_mode() -> bool {
    std::env::var("DMH_M365_READ_ONLY_TEST").as_deref() == Ok("1")
}

#[tauri::command]
pub fn get_m365_read_only_test_mode() -> bool {
    m365_read_only_test_mode()
}
// v1.0 calendarView/delta needs a bounded date range. A 200-year calendarView
// expands recurring series and can fail before it ever reaches a delta token.
fn calendar_delta_window(year: i32) -> (String, String) {
    (
        format!("{:04}-01-01T00:00:00Z", year - 1),
        format!("{:04}-01-01T00:00:00Z", year + 3),
    )
}

fn calendar_delta_quarters(year: i32, month: u32) -> Vec<(String, String)> {
    let mut windows = Vec::new();
    for window_year in (year - 1)..(year + 3) {
        for window_month in [1, 4, 7, 10] {
            let (end_year, end_month) = if window_month == 10 {
                (window_year + 1, 1)
            } else {
                (window_year, window_month + 3)
            };
            windows.push((
                format!("{window_year:04}-{window_month:02}-01T00:00:00Z"),
                format!("{end_year:04}-{end_month:02}-01T00:00:00Z"),
            ));
        }
    }
    let current = 4 + ((month - 1) / 3) as usize;
    let current_window = windows.remove(current);
    windows.insert(0, current_window);
    windows
}

#[derive(Default)]
pub struct Microsoft365Runtime {
    pending_device_flow: Mutex<Option<PendingDeviceFlow>>,
    pending_interactive_state: Mutex<Option<String>>,
    access_token: Mutex<Option<CachedAccessToken>>,
    refresh_gate: tokio::sync::Mutex<()>,
    calendar_sync_gate: tokio::sync::Mutex<()>,
    contact_sync_gate: tokio::sync::Mutex<()>,
}

struct CachedAccessToken {
    value: String,
    expires_at: Instant,
}

impl Drop for CachedAccessToken {
    fn drop(&mut self) {
        self.value.zeroize();
    }
}

#[derive(Debug, Clone)]
struct PendingDeviceFlow {
    device_code: String,
    expires_at: String,
    interval_seconds: u64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Microsoft365Account {
    id: String,
    display_name: String,
    email: String,
    user_principal_name: String,
    connected_at: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Microsoft365ConnectionStatus {
    configured: bool,
    connected: bool,
    account: Option<Microsoft365Account>,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Microsoft365CalendarCategory {
    name: String,
    color: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Microsoft365CalendarCategoryRepairPreview {
    linked_events: usize,
    category_names: Vec<String>,
    categories_to_repair: usize,
    pending_operations: usize,
    pending_deletions: usize,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Microsoft365CalendarCategoryRepairResult {
    scanned: usize,
    updated: usize,
    errors: usize,
    error_messages: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Microsoft365DeviceCode {
    user_code: String,
    verification_uri: String,
    expires_at: String,
    interval_seconds: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Microsoft365PollResult {
    state: String,
    account: Option<Microsoft365Account>,
    interval_seconds: u64,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Microsoft365SyncSource {
    pub id: String,
    pub name: String,
    pub kind: String,
    pub editable: bool,
    pub shared: bool,
    pub resource_path: String,
    pub mailbox: Option<String>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Microsoft365SharedMailbox {
    pub address: String,
    pub display_name: String,
    pub available: bool,
    pub contact_folder_count: usize,
    pub calendar_count: usize,
    pub error: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Microsoft365SyncSources {
    pub contacts: Vec<Microsoft365SyncSource>,
    pub calendars: Vec<Microsoft365SyncSource>,
    pub shared_mailboxes: Vec<Microsoft365SharedMailbox>,
    pub shared_access_available: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Microsoft365SyncPreviewRequest {
    pub direction: String,
    pub base: String,
    pub contacts: bool,
    #[serde(default)]
    pub contact_groups: bool,
    pub calendars: bool,
    pub shared_calendars: bool,
    pub shared_mailboxes: bool,
    #[serde(default)]
    pub shared_mailbox_addresses: Vec<String>,
    #[serde(default)]
    pub selected_contact_source_ids: Vec<String>,
    #[serde(default)]
    pub selected_calendar_source_ids: Vec<String>,
    #[serde(default)]
    pub source_directions: HashMap<String, String>,
    pub backup: crate::BackupData,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Microsoft365SyncChange {
    pub id: String,
    pub kind: String,
    pub action: String,
    pub source_id: String,
    pub source_name: String,
    pub title: String,
    pub detail: String,
    pub local_summary: Option<String>,
    pub remote_summary: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Microsoft365SyncPreview {
    pub local_contacts: usize,
    pub remote_contacts: usize,
    pub local_events: usize,
    pub remote_events: usize,
    pub create_in_m365: usize,
    pub import_to_app: usize,
    pub conflicts: usize,
    pub shared_sources_skipped: usize,
    pub changes: Vec<Microsoft365SyncChange>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Microsoft365SyncApplyRequest {
    pub direction: String,
    pub base: String,
    pub contacts: bool,
    #[serde(default)]
    pub contact_groups: bool,
    pub calendars: bool,
    pub shared_calendars: bool,
    pub shared_mailboxes: bool,
    #[serde(default)]
    pub shared_mailbox_addresses: Vec<String>,
    #[serde(default)]
    pub selected_contact_source_ids: Vec<String>,
    #[serde(default)]
    pub selected_calendar_source_ids: Vec<String>,
    #[serde(default)]
    pub source_directions: HashMap<String, String>,
    #[serde(default)]
    pub decisions: HashMap<String, String>,
    #[serde(default)]
    pub backup: Option<crate::BackupData>,
    #[serde(default)]
    pub allow_partial_sources: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Microsoft365SyncResult {
    pub started_at: String,
    pub finished_at: String,
    pub created: usize,
    pub updated: usize,
    pub deleted: usize,
    pub ignored: usize,
    pub conflicts: usize,
    pub errors: usize,
    pub error_messages: Vec<String>,
    pub calendar_upserts: Vec<crate::CalendarEvent>,
    pub calendar_deletes: Vec<String>,
    pub calendar_categories: Vec<Microsoft365CalendarCategory>,
    pub calendar_category_rules: Vec<category_management::CategoryOperation>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CalendarOutboxSyncRequest {
    pub direction: String,
    #[serde(default)]
    pub selected_calendar_source_ids: Vec<String>,
    #[serde(default)]
    pub source_directions: HashMap<String, String>,
    #[serde(default)]
    pub shared_calendars: bool,
    #[serde(default)]
    pub shared_mailbox_addresses: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CalendarOutboxSyncResult {
    pub processed: usize,
    pub created: usize,
    pub updated: usize,
    pub deleted: usize,
    pub pending: usize,
    pub errors: usize,
    pub error_messages: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContactOutboxSyncRequest {
    pub direction: String,
    #[serde(default)]
    pub contact_groups: bool,
    #[serde(default)]
    pub selected_contact_source_ids: Vec<String>,
    #[serde(default)]
    pub source_directions: HashMap<String, String>,
    #[serde(default)]
    pub shared_mailboxes: bool,
    #[serde(default)]
    pub shared_mailbox_addresses: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ContactOutboxSyncResult {
    pub processed: usize,
    pub created: usize,
    pub updated: usize,
    pub deleted: usize,
    pub pending: usize,
    pub errors: usize,
    pub error_messages: Vec<String>,
}

#[derive(Debug, Deserialize)]
struct DeviceCodeResponse {
    device_code: String,
    user_code: String,
    verification_uri: String,
    expires_in: i64,
    #[serde(default = "default_poll_interval")]
    interval: u64,
}

#[derive(Debug, Deserialize)]
struct OAuthTokenResponse {
    access_token: String,
    refresh_token: Option<String>,
    #[serde(default)]
    scope: String,
    #[serde(default = "default_token_lifetime")]
    expires_in: i64,
}

#[derive(Debug, Deserialize)]
struct OAuthErrorResponse {
    #[serde(default)]
    error: String,
    #[serde(default)]
    error_description: String,
}

#[derive(Debug)]
struct OAuthAuthorizationCallback {
    code: String,
    state: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GraphProfile {
    id: String,
    #[serde(default)]
    display_name: String,
    #[serde(default)]
    mail: String,
    #[serde(default)]
    user_principal_name: String,
}

#[derive(Debug, Serialize, Deserialize)]
struct StoredTokenBundle {
    refresh_token: String,
    scope: String,
}

fn default_poll_interval() -> u64 {
    5
}

fn default_token_lifetime() -> i64 {
    3600
}

pub(crate) fn http_client() -> &'static reqwest::Client {
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .connect_timeout(Duration::from_secs(10))
            .build()
            .unwrap_or_else(|_| reqwest::Client::new())
    })
}

fn client_id() -> Option<&'static str> {
    option_env!("M365_CLIENT_ID")
        .map(str::trim)
        .filter(|value| is_identifier(value))
}

fn tenant_id() -> &'static str {
    option_env!("M365_TENANT_ID")
        .map(str::trim)
        .filter(|value| is_tenant(value))
        .unwrap_or("organizations")
}

fn is_identifier(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 128
        && value
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || character == '-')
}

fn is_tenant(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 255
        && value
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || matches!(character, '-' | '.'))
}

fn oauth_url(endpoint: &str) -> String {
    format!(
        "https://login.microsoftonline.com/{}/oauth2/v2.0/{endpoint}",
        tenant_id()
    )
}

fn encode_form_component(value: &str) -> String {
    let mut encoded = String::new();
    for byte in value.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                encoded.push(byte as char)
            }
            b' ' => encoded.push('+'),
            _ => encoded.push_str(&format!("%{byte:02X}")),
        }
    }
    encoded
}

fn form_body(fields: &[(&str, &str)]) -> String {
    fields
        .iter()
        .map(|(key, value)| {
            format!(
                "{}={}",
                encode_form_component(key),
                encode_form_component(value)
            )
        })
        .collect::<Vec<_>>()
        .join("&")
}

fn secure_url_token(byte_count: usize) -> String {
    let mut bytes = vec![0_u8; byte_count];
    rand::thread_rng().fill_bytes(&mut bytes);
    URL_SAFE_NO_PAD.encode(bytes)
}

fn pkce_challenge(verifier: &str) -> String {
    URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()))
}

fn interactive_authorization_url(
    client_id: &str,
    redirect_uri: &str,
    state: &str,
    challenge: &str,
) -> String {
    format!(
        "{}?{}",
        oauth_url("authorize"),
        form_body(&[
            ("client_id", client_id),
            ("response_type", "code"),
            ("redirect_uri", redirect_uri),
            ("response_mode", "query"),
            ("scope", LOGIN_SCOPES),
            ("state", state),
            ("code_challenge", challenge),
            ("code_challenge_method", "S256"),
            ("prompt", "select_account"),
        ])
    )
}

fn callback_response_page(success: bool) -> String {
    let (color, icon, title, detail) = if success {
        (
            "#08784f",
            "✓",
            "Microsoft-Anmeldung bestätigt",
            "Sie können dieses Fenster schließen und zu DMH Backup zurückkehren.",
        )
    } else {
        (
            "#a1123f",
            "!",
            "Anmeldung nicht abgeschlossen",
            "Schließen Sie dieses Fenster und versuchen Sie es in DMH Backup erneut.",
        )
    };
    format!(
        "<!doctype html><html lang=\"de\"><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><title>{title}</title><body style=\"font-family:Segoe UI,Arial,sans-serif;background:#f6f4f5;color:#171717;display:grid;place-items:center;min-height:100vh;margin:0\"><main style=\"background:white;border:1px solid #dcc6cf;border-radius:16px;padding:36px;max-width:520px;text-align:center;box-shadow:0 12px 32px rgba(0,0,0,.1)\"><div style=\"width:64px;height:64px;border-radius:50%;background:{color};color:white;display:grid;place-items:center;font-size:38px;margin:0 auto 20px\">{icon}</div><h1 style=\"font-size:26px;margin:0 0 12px\">{title}</h1><p style=\"font-size:18px;line-height:1.5;margin:0\">{detail}</p></main></body></html>"
    )
}

fn write_callback_response(stream: &mut TcpStream, success: bool) {
    let body = callback_response_page(success);
    let response = format!(
        "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n{}",
        body.len(),
        body
    );
    let _ = stream.write_all(response.as_bytes());
    let _ = stream.flush();
}

fn parse_authorization_callback(target: &str) -> Result<OAuthAuthorizationCallback, String> {
    let parsed = url::Url::parse(&format!("http://localhost{target}"))
        .map_err(|_| "Microsoft hat eine ungültige Rückmeldung geliefert.".to_string())?;
    let parameters = parsed.query_pairs().into_owned().collect::<HashMap<_, _>>();
    if let Some(error) = parameters.get("error") {
        return Err(if error == "access_denied" {
            "Die Microsoft-Anmeldung wurde abgebrochen.".to_string()
        } else {
            "Microsoft konnte die Anmeldung nicht abschließen.".to_string()
        });
    }
    let code = parameters
        .get("code")
        .filter(|value| !value.is_empty())
        .cloned()
        .ok_or_else(|| "Microsoft hat keinen Anmeldecode zurückgegeben.".to_string())?;
    let state = parameters
        .get("state")
        .filter(|value| !value.is_empty())
        .cloned()
        .ok_or_else(|| "Microsoft hat die Anmeldung nicht eindeutig bestätigt.".to_string())?;
    Ok(OAuthAuthorizationCallback { code, state })
}

fn read_callback_request(stream: &mut TcpStream) -> Result<String, String> {
    stream
        .set_read_timeout(Some(Duration::from_secs(3)))
        .map_err(|_| "Microsoft-Rückmeldung konnte nicht gelesen werden.".to_string())?;
    let mut buffer = [0_u8; 16 * 1024];
    let length = stream
        .read(&mut buffer)
        .map_err(|_| "Microsoft-Rückmeldung konnte nicht gelesen werden.".to_string())?;
    let request = String::from_utf8_lossy(&buffer[..length]);
    let first_line = request
        .lines()
        .next()
        .ok_or_else(|| "Microsoft hat eine leere Rückmeldung geliefert.".to_string())?;
    let mut parts = first_line.split_whitespace();
    if parts.next() != Some("GET") {
        return Err("Microsoft hat eine ungültige Rückmeldung geliefert.".to_string());
    }
    parts
        .next()
        .map(str::to_string)
        .ok_or_else(|| "Microsoft hat eine ungültige Rückmeldung geliefert.".to_string())
}

fn interactive_state_is_current(app: &AppHandle, expected: &str) -> Result<bool, String> {
    let state = app.state::<AppState>();
    let pending = state
        .m365
        .pending_interactive_state
        .lock()
        .map_err(|_| "Microsoft-Anmeldung konnte intern nicht gelesen werden.".to_string())?;
    Ok(pending.as_deref() == Some(expected))
}

fn clear_interactive_state(app: &AppHandle, expected: &str) -> Result<(), String> {
    let state = app.state::<AppState>();
    let mut pending = state
        .m365
        .pending_interactive_state
        .lock()
        .map_err(|_| "Microsoft-Anmeldung konnte intern nicht beendet werden.".to_string())?;
    if pending.as_deref() == Some(expected) {
        *pending = None;
    }
    Ok(())
}

async fn wait_for_authorization_callback(
    app: &AppHandle,
    listener: &TcpListener,
    expected_state: &str,
) -> Result<OAuthAuthorizationCallback, String> {
    let deadline = Instant::now() + INTERACTIVE_LOGIN_TIMEOUT;
    loop {
        if !interactive_state_is_current(app, expected_state)? {
            return Err("Die Microsoft-Anmeldung wurde abgebrochen.".to_string());
        }
        if Instant::now() >= deadline {
            return Err(
                "Die Microsoft-Anmeldung hat zu lange gedauert. Versuchen Sie es erneut."
                    .to_string(),
            );
        }
        match listener.accept() {
            Ok((mut stream, _)) => {
                let callback = read_callback_request(&mut stream)
                    .and_then(|target| parse_authorization_callback(&target));
                let valid = callback
                    .as_ref()
                    .is_ok_and(|callback| callback.state == expected_state);
                write_callback_response(&mut stream, valid);
                let callback = callback?;
                if callback.state != expected_state {
                    return Err("Die Microsoft-Anmeldung konnte aus Sicherheitsgründen nicht bestätigt werden.".to_string());
                }
                return Ok(callback);
            }
            Err(error) if error.kind() == ErrorKind::WouldBlock => {
                tokio::time::sleep(Duration::from_millis(120)).await;
            }
            Err(_) => {
                return Err(
                    "Die automatische Rückkehr von Microsoft konnte nicht empfangen werden."
                        .to_string(),
                )
            }
        }
    }
}

fn oauth_error_message(error: &OAuthErrorResponse) -> String {
    let description = error
        .error_description
        .split("\r\n")
        .next()
        .unwrap_or("")
        .trim();
    match error.error.as_str() {
        "authorization_declined" => "Die Microsoft-Anmeldung wurde abgelehnt.".to_string(),
        "expired_token" => {
            "Der Anmeldecode ist abgelaufen. Starten Sie die Verbindung erneut.".to_string()
        }
        "bad_verification_code" => {
            "Der Microsoft-Anmeldecode ist ungültig oder abgelaufen.".to_string()
        }
        "invalid_client" => {
            "Die Microsoft-Anwendung ist im Entra ID nicht korrekt eingerichtet.".to_string()
        }
        "invalid_grant" => {
            "Die Microsoft-Sitzung ist abgelaufen. Verbinden Sie das Konto erneut.".to_string()
        }
        _ if !description.is_empty() => {
            format!("Microsoft-Anmeldung fehlgeschlagen: {description}")
        }
        _ => "Microsoft-Anmeldung ist fehlgeschlagen.".to_string(),
    }
}

fn microsoft_session_requires_reconnect(error: &str) -> bool {
    error.contains("Microsoft-Sitzung ist abgelaufen")
        || error.contains("Microsoft-365-Konto ist nicht verbunden")
        || error.contains("gespeicherte Microsoft-Anmeldung ist ungültig")
        || error.contains("gespeicherte Microsoft-Anmeldung konnte nicht gelesen werden")
        || error.contains("Microsoft-365-Kontoprofil fehlt")
}

fn get_setting(app: &AppHandle, key: &str) -> Result<Option<String>, String> {
    let conn = open_db(app)?;
    conn.query_row(
        "SELECT value FROM app_settings WHERE key = ?1",
        [key],
        |row| row.get(0),
    )
    .optional()
    .map_err(|error| error.to_string())
}

fn set_setting(app: &AppHandle, key: &str, value: &str) -> Result<(), String> {
    let conn = open_db(app)?;
    conn.execute(
        "INSERT INTO app_settings (key, value, updated_at) VALUES (?1, ?2, ?3)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
        params![key, value, Utc::now().to_rfc3339()],
    )
    .map_err(|error| error.to_string())?;
    Ok(())
}

fn delete_connection_settings(app: &AppHandle) -> Result<(), String> {
    let mut conn = open_db(app)?;
    conn.execute_batch("PRAGMA secure_delete = ON;")
        .map_err(|error| error.to_string())?;
    let tx = conn.transaction().map_err(|error| error.to_string())?;
    tx.execute(
        "DELETE FROM app_settings WHERE key IN (?1, ?2)",
        params![TOKEN_SETTING_KEY, PROFILE_SETTING_KEY],
    )
    .map_err(|error| error.to_string())?;
    tx.execute("DELETE FROM m365_calendar_delta_changes", [])
        .map_err(|error| error.to_string())?;
    tx.execute("DELETE FROM m365_calendar_delta_state", [])
        .map_err(|error| error.to_string())?;
    tx.execute("DELETE FROM m365_calendar_title_repair_attempts", [])
        .map_err(|error| error.to_string())?;
    tx.commit().map_err(|error| error.to_string())
}

fn read_account(app: &AppHandle) -> Result<Option<Microsoft365Account>, String> {
    get_setting(app, PROFILE_SETTING_KEY)?
        .map(|value| {
            serde_json::from_str(&value)
                .map_err(|_| "Das gespeicherte Microsoft-365-Kontoprofil ist ungültig.".to_string())
        })
        .transpose()
}

fn ensure_read_only_test_account(app: &AppHandle) -> Result<(), String> {
    if !m365_read_only_test_mode() {
        return Ok(());
    }
    let expected = std::env::var("DMH_M365_READ_ONLY_ACCOUNT_SHA256").unwrap_or_default();
    let account = read_account(app)?
        .ok_or_else(|| "Der sichere M365-Test hat kein verbundenes Konto.".to_string())?;
    let actual = format!("{:x}", Sha256::digest(account.id.as_bytes()));
    if expected.len() != 64 || !actual.eq_ignore_ascii_case(&expected) {
        return Err(
            "Der sichere M365-Test wurde wegen eines anderen Microsoft-Kontos unterbrochen."
                .to_string(),
        );
    }
    Ok(())
}

fn calendar_color_category_migration_keys(app: &AppHandle) -> Result<(String, String), String> {
    let account =
        read_account(app)?.ok_or_else(|| "Microsoft-365-Konto ist nicht verbunden.".to_string())?;
    let digest = Sha256::digest(account.id.as_bytes());
    let account_key = URL_SAFE_NO_PAD.encode(&digest[..12]);
    let progress_key = format!("{CALENDAR_COLOR_CATEGORY_MIGRATION_KEY_PREFIX}_{account_key}");
    let cursor_key = format!("{progress_key}_cursor");
    Ok((progress_key, cursor_key))
}

fn save_connection(
    app: &AppHandle,
    account: &Microsoft365Account,
    token: &StoredTokenBundle,
) -> Result<(), String> {
    let mut token_json = serde_json::to_vec(token)
        .map_err(|_| "Microsoft-Anmeldung konnte nicht sicher gespeichert werden.".to_string())?;
    let protected = protect_secret(&token_json)?;
    token_json.zeroize();
    let encoded = BASE64_STANDARD.encode(protected);
    let profile_json = serde_json::to_string(account)
        .map_err(|_| "Microsoft-Kontoprofil konnte nicht gespeichert werden.".to_string())?;
    set_setting(app, TOKEN_SETTING_KEY, &encoded)?;
    if let Err(error) = set_setting(app, PROFILE_SETTING_KEY, &profile_json) {
        let _ = delete_connection_settings(app);
        return Err(error);
    }
    Ok(())
}

fn read_token(app: &AppHandle) -> Result<StoredTokenBundle, String> {
    let encoded = get_setting(app, TOKEN_SETTING_KEY)?
        .ok_or_else(|| "Microsoft-365-Konto ist nicht verbunden.".to_string())?;
    let protected = BASE64_STANDARD
        .decode(encoded)
        .map_err(|_| "Die gespeicherte Microsoft-Anmeldung ist ungültig.".to_string())?;
    let mut token_json = unprotect_secret(&protected)?;
    let token = serde_json::from_slice(&token_json).map_err(|_| {
        "Die gespeicherte Microsoft-Anmeldung konnte nicht gelesen werden.".to_string()
    })?;
    token_json.zeroize();
    Ok(token)
}

async fn graph_profile(access_token: &str) -> Result<GraphProfile, String> {
    let response = http_client()
        .get(GRAPH_PROFILE_URL)
        .bearer_auth(access_token)
        .send()
        .await
        .map_err(|_| {
            "Microsoft Graph ist derzeit nicht erreichbar. Internetverbindung prüfen.".to_string()
        })?;
    if !response.status().is_success() {
        return Err(format!(
            "Microsoft Graph hat die Verbindung nicht bestätigt (HTTP {}).",
            response.status().as_u16()
        ));
    }
    response
        .json::<GraphProfile>()
        .await
        .map_err(|_| "Microsoft Graph hat ein ungültiges Kontoprofil geliefert.".to_string())
}

pub(crate) async fn refreshed_access_token(app: &AppHandle) -> Result<String, String> {
    let state = app.state::<AppState>();
    if let Some(token) = cached_access_token(&state)? {
        return Ok(token);
    }
    let _refresh_guard = state.m365.refresh_gate.lock().await;
    if let Some(token) = cached_access_token(&state)? {
        return Ok(token);
    }
    let client_id = client_id().ok_or_else(|| {
        "Die EDV muss zuerst die Microsoft-Anwendungs-ID für diesen Build hinterlegen.".to_string()
    })?;
    let stored = read_token(app)?;
    let token = request_token(&[
        ("grant_type", "refresh_token"),
        ("client_id", client_id),
        ("refresh_token", &stored.refresh_token),
        ("scope", LOGIN_SCOPES),
    ])
    .await
    .map_err(|error| oauth_error_message(&error))?;
    let refresh_token = token.refresh_token.unwrap_or(stored.refresh_token);
    let expires_in = token.expires_in.max(300) as u64;
    let account = read_account(app)?.ok_or_else(|| {
        "Microsoft-365-Kontoprofil fehlt. Verbinden Sie das Konto erneut.".to_string()
    })?;
    save_connection(
        app,
        &account,
        &StoredTokenBundle {
            refresh_token,
            scope: token.scope,
        },
    )?;
    let access_token = token.access_token;
    *state.m365.access_token.lock().map_err(|_| {
        "Microsoft-Anmeldung konnte intern nicht zwischengespeichert werden.".to_string()
    })? = Some(CachedAccessToken {
        value: access_token.clone(),
        expires_at: Instant::now() + Duration::from_secs(expires_in),
    });
    Ok(access_token)
}

fn cached_access_token(state: &State<'_, AppState>) -> Result<Option<String>, String> {
    let mut cache = state
        .m365
        .access_token
        .lock()
        .map_err(|_| "Microsoft-Anmeldung konnte intern nicht gelesen werden.".to_string())?;
    if cache
        .as_ref()
        .is_some_and(|token| token.expires_at > Instant::now() + Duration::from_secs(60))
    {
        return Ok(cache.as_ref().map(|token| token.value.clone()));
    }
    *cache = None;
    Ok(None)
}

fn graph_retry_delay(
    status: reqwest::StatusCode,
    headers: &reqwest::header::HeaderMap,
    attempt: usize,
) -> Option<Duration> {
    if !matches!(status.as_u16(), 429 | 500 | 502 | 503 | 504) {
        return None;
    }
    let retry_after = headers
        .get(reqwest::header::RETRY_AFTER)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.trim().parse::<u64>().ok())
        .map(|seconds| seconds.clamp(1, 120));
    let exponential = (1u64 << attempt.min(6)).min(60);
    let jitter_ms = rand::thread_rng().gen_range(0..=400);
    Some(Duration::from_millis(
        retry_after.unwrap_or(exponential) * 1_000 + jitter_ms,
    ))
}

async fn graph_json_response(access_token: &str, url: &str) -> Result<Value, String> {
    let delta_request = url.contains("/calendarView/delta");
    let mut last_network_error = None;
    for attempt in 0..GRAPH_MAX_ATTEMPTS {
        let response = match http_client()
            .get(url)
            .timeout(if delta_request {
                Duration::from_secs(15)
            } else {
                GRAPH_REQUEST_TIMEOUT
            })
            .bearer_auth(access_token)
            .header(
                "Prefer",
                if delta_request {
                    "outlook.timezone=\"W. Europe Standard Time\", odata.maxpagesize=50"
                } else {
                    "outlook.timezone=\"W. Europe Standard Time\", odata.maxpagesize=250"
                },
            )
            .send()
            .await
        {
            Ok(response) => response,
            Err(error) => {
                last_network_error = Some(error.to_string());
                if delta_request {
                    break;
                }
                if attempt + 1 < GRAPH_MAX_ATTEMPTS {
                    tokio::time::sleep(Duration::from_secs(1u64 << attempt.min(5))).await;
                    continue;
                }
                break;
            }
        };
        let status = response.status();
        if status.is_success() {
            return response
                .json::<Value>()
                .await
                .map_err(|_| "Microsoft Graph hat eine ungültige Antwort geliefert.".to_string());
        }
        if let Some(delay) = graph_retry_delay(status, response.headers(), attempt) {
            if attempt + 1 < GRAPH_MAX_ATTEMPTS && (!delta_request || status.as_u16() == 429) {
                tokio::time::sleep(delay).await;
                continue;
            }
        }
        let detail = response.json::<Value>().await.ok().and_then(|value| {
            let code = value
                .pointer("/error/code")
                .and_then(Value::as_str)
                .unwrap_or("");
            let message = value
                .pointer("/error/message")
                .and_then(Value::as_str)
                .unwrap_or("");
            let safe = format!("{code}: {message}")
                .chars()
                .filter(|character| !character.is_control())
                .take(240)
                .collect::<String>();
            (!safe.trim_matches([':', ' ']).is_empty()).then_some(safe)
        });
        return Err(format!(
            "Microsoft Graph konnte die Daten nicht lesen (HTTP {}){}.",
            status.as_u16(),
            detail.map(|value| format!(", {value}")).unwrap_or_default()
        ));
    }
    Err(format!(
        "Microsoft Graph ist nach mehreren Versuchen nicht erreichbar. Internetverbindung prüfen{}.",
        last_network_error
            .map(|error| format!(" ({})", error.chars().take(160).collect::<String>()))
            .unwrap_or_default()
    ))
}

pub(crate) async fn graph_json(access_token: &str, url: &str) -> Result<Value, String> {
    graph_json_response(access_token, url).await
}

pub(crate) async fn graph_collection(access_token: &str, url: &str) -> Result<Vec<Value>, String> {
    let mut next_url = Some(url.to_string());
    let mut values = Vec::new();
    let mut pages = 0usize;
    while let Some(current_url) = next_url.take() {
        pages += 1;
        if pages > GRAPH_MAX_PAGES {
            return Err("Microsoft Graph lieferte ungewöhnlich viele Seiten. Die Synchronisierung wurde sicher abgebrochen.".to_string());
        }
        let page = graph_json(access_token, &current_url).await?;
        if let Some(items) = page.get("value").and_then(Value::as_array) {
            values.extend(items.iter().cloned());
        }
        next_url = page
            .get("@odata.nextLink")
            .and_then(Value::as_str)
            .map(ToOwned::to_owned);
    }
    Ok(values)
}

#[derive(Debug)]
struct CalendarDeltaBatch {
    values: Vec<Value>,
    removed_ids: HashSet<String>,
}

fn clear_calendar_delta_state(app: &AppHandle, source_id: &str) -> Result<(), String> {
    open_db(app)?
        .execute(
            "DELETE FROM m365_calendar_delta_state WHERE source_id = ?1",
            [source_id],
        )
        .map_err(|error| error.to_string())?;
    // Other periods may already have uncommitted events in the shared queue.
    // Expiring one period's token must not discard any of them.
    Ok(())
}

fn calendar_delta_link(
    app: &AppHandle,
    source_id: &str,
    window_start: &str,
    window_end: &str,
) -> Result<Option<String>, String> {
    open_db(app)?
        .query_row(
            "SELECT delta_link FROM m365_calendar_delta_state
             WHERE source_id = ?1 AND window_start = ?2 AND window_end = ?3",
            params![source_id, window_start, window_end],
            |row| row.get(0),
        )
        .optional()
        .map_err(|error| error.to_string())
}

fn queue_calendar_delta_page(
    app: &AppHandle,
    source_id: &str,
    values: &[Value],
) -> Result<(), String> {
    if values.is_empty() {
        return Ok(());
    }
    let mut conn = open_db(app)?;
    let tx = conn.transaction().map_err(|error| error.to_string())?;
    queue_calendar_delta_values(&tx, source_id, values)?;
    tx.commit().map_err(|error| error.to_string())
}

fn queue_calendar_delta_values(
    conn: &rusqlite::Connection,
    source_id: &str,
    values: &[Value],
) -> Result<(), String> {
    let received_at = Utc::now().to_rfc3339();
    for value in values {
        let remote_id = value_text(value, "id").trim();
        if remote_id.is_empty() {
            continue;
        }
        let removed = value.get("@removed").is_some();
        let payload = if removed {
            None
        } else {
            Some(serde_json::to_string(value).map_err(|error| error.to_string())?)
        };
        conn.execute(
            "INSERT INTO m365_calendar_delta_changes
             (source_id, remote_id, change_kind, payload_json, received_at)
             VALUES (?1, ?2, ?3, ?4, ?5)
             ON CONFLICT(source_id, remote_id) DO UPDATE SET
               change_kind = excluded.change_kind,
               payload_json = excluded.payload_json,
               received_at = excluded.received_at",
            params![
                source_id,
                remote_id,
                if removed { "delete" } else { "upsert" },
                payload,
                received_at
            ],
        )
        .map_err(|error| error.to_string())?;
    }
    Ok(())
}

fn checkpoint_calendar_delta_window_page(
    conn: &mut rusqlite::Connection,
    source_id: &str,
    values: &[Value],
    delta_link: &str,
    cursor_id: &str,
    window_start: &str,
    window_end: &str,
) -> Result<(), String> {
    let tx = conn.transaction().map_err(|error| error.to_string())?;
    queue_calendar_delta_values(&tx, source_id, values)?;
    // A continuation URL and its events are one durable checkpoint. A failed
    // later page or an app restart resumes here without losing pending changes.
    tx.execute(
        "INSERT INTO m365_calendar_delta_state
         (source_id, delta_link, window_start, window_end, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5)
         ON CONFLICT(source_id) DO UPDATE SET
           delta_link = excluded.delta_link,
           window_start = excluded.window_start,
           window_end = excluded.window_end,
           updated_at = excluded.updated_at",
        params![
            cursor_id,
            delta_link,
            window_start,
            window_end,
            Utc::now().to_rfc3339()
        ],
    )
    .map_err(|error| error.to_string())?;
    tx.commit().map_err(|error| error.to_string())
}

#[cfg(test)]
fn checkpoint_calendar_delta_page(
    conn: &mut rusqlite::Connection,
    source_id: &str,
    values: &[Value],
    delta_link: &str,
) -> Result<(), String> {
    let (start, end) = calendar_delta_window(Utc::now().year());
    checkpoint_calendar_delta_window_page(
        conn, source_id, values, delta_link, source_id, &start, &end,
    )
}

fn blank_calendar_title_candidates(
    conn: &rusqlite::Connection,
    source: &Microsoft365SyncSource,
    now: &str,
    limit: usize,
) -> Result<Vec<String>, String> {
    let id_prefix = format!("m365:{}:", source.id);
    let id_upper_bound = format!("{id_prefix}\u{10ffff}");
    let mut statement = conn
        .prepare(
            "WITH blank_events AS (
                SELECT substr(id, length(?1) + 1) AS remote_id,
                       starts_at AS event_start, 1 AS priority
                FROM calendar_events
                WHERE id >= ?1 AND id < ?5
                  AND deleted_at IS NULL
                  AND trim(coalesce(json_extract(event_json, '$.title'), '')) = ''
                UNION ALL
                SELECT remote_id, json_extract(payload_json, '$.start.dateTime'), 0
                FROM m365_calendar_delta_changes
                WHERE source_id = ?2 AND change_kind = 'upsert'
                  AND trim(coalesce(json_extract(payload_json, '$.subject'), '')) = ''
            ), distinct_events AS (
                SELECT remote_id, min(event_start) AS event_start,
                       min(priority) AS priority
                FROM blank_events WHERE remote_id <> '' GROUP BY remote_id
            )
            SELECT events.remote_id FROM distinct_events events
            LEFT JOIN m365_calendar_title_repair_attempts attempts
              ON attempts.source_id = ?2 AND attempts.remote_id = events.remote_id
            WHERE attempts.retry_after IS NULL OR attempts.retry_after <= ?3
            ORDER BY attempts.retry_after IS NOT NULL, events.priority,
                     coalesce(abs(julianday(substr(events.event_start, 1, 10)) - julianday('now')), 999999),
                     events.remote_id
            LIMIT ?4",
        )
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map(
            params![id_prefix, source.id, now, limit as i64, id_upper_bound],
            |row| row.get(0),
        )
        .map_err(|error| error.to_string())?;
    rows.collect::<rusqlite::Result<Vec<String>>>()
        .map_err(|error| error.to_string())
}

fn defer_calendar_title_repairs(
    app: &AppHandle,
    source: &Microsoft365SyncSource,
    retries: &[(String, String)],
) -> Result<(), String> {
    if retries.is_empty() {
        return Ok(());
    }
    let mut conn = open_db(app)?;
    let tx = conn.transaction().map_err(|error| error.to_string())?;
    for (remote_id, retry_after) in retries {
        tx.execute(
            "INSERT INTO m365_calendar_title_repair_attempts (source_id, remote_id, retry_after)
             VALUES (?1, ?2, ?3)
             ON CONFLICT(source_id, remote_id) DO UPDATE SET retry_after = excluded.retry_after",
            params![source.id, remote_id, retry_after],
        )
        .map_err(|error| error.to_string())?;
    }
    tx.commit().map_err(|error| error.to_string())
}

fn normalize_calendar_source_label(
    conn: &rusqlite::Connection,
    source: &Microsoft365SyncSource,
) -> Result<usize, String> {
    if source.shared || !source.resource_path.contains("/me/calendars/") {
        return Ok(0);
    }
    let id_prefix = format!("m365:{}:", source.id);
    let id_upper_bound = format!("{id_prefix}\u{10ffff}");
    let canonical_name = format!("Microsoft 365 · {}", source.name);
    conn.execute(
        "UPDATE calendar_events
         SET event_json = json_set(event_json, '$.source', ?2)
         WHERE id >= ?1 AND id < ?3 AND deleted_at IS NULL
           AND coalesce(json_extract(event_json, '$.source'), '') <> ?2",
        params![id_prefix, canonical_name, id_upper_bound],
    )
    .map_err(|error| error.to_string())
}

async fn repair_blank_calendar_titles(
    app: &AppHandle,
    access_token: &str,
    source: &Microsoft365SyncSource,
) -> Result<(), String> {
    // Delta responses can omit a subject. Fetch the full event by ID and only
    // queue a repair when Graph supplies a real title. A sparse response must
    // never overwrite an existing local title or other appointment fields.
    let now = Utc::now();
    let candidates = {
        let conn = open_db(app)?;
        blank_calendar_title_candidates(
            &conn,
            source,
            &now.to_rfc3339(),
            CALENDAR_TITLE_REPAIR_BATCH_SIZE,
        )?
    };
    if candidates.is_empty() {
        return Ok(());
    }
    let results = stream::iter(candidates.into_iter().map(|remote_id| async move {
        let event_url = format!(
            "{}/events/{}",
            source.resource_path,
            encode_graph_path_segment(&remote_id)
        );
        let response = graph_json(access_token, &event_url).await;
        (remote_id, response)
    }))
    .buffer_unordered(CALENDAR_TITLE_REPAIR_CONCURRENCY)
    .collect::<Vec<_>>()
    .await;
    let mut resolved = Vec::new();
    let mut retries = Vec::new();
    for (remote_id, response) in results {
        match response {
            Ok(event)
                if value_text(&event, "id") == remote_id
                    && !value_text(&event, "subject").trim().is_empty() =>
            {
                resolved.push(event);
            }
            Ok(_) => retries.push((remote_id, (now + ChronoDuration::hours(6)).to_rfc3339())),
            Err(error) => {
                let transient = ["HTTP 429", "HTTP 500", "HTTP 502", "HTTP 503", "HTTP 504"]
                    .iter()
                    .any(|status| error.contains(status));
                let delay = if transient {
                    ChronoDuration::minutes(2)
                } else {
                    ChronoDuration::hours(6)
                };
                retries.push((remote_id, (now + delay).to_rfc3339()));
            }
        }
    }
    let resolved = event_sync::normalize_series(app, access_token, source, resolved).await?;
    queue_calendar_delta_page(app, &source.id, &resolved)?;
    defer_calendar_title_repairs(app, source, &retries)
}

async fn refresh_calendar_delta_queue(
    app: &AppHandle,
    access_token: &str,
    source: &Microsoft365SyncSource,
) -> Result<(), String> {
    let now = Utc::now();
    event_sync::prepare_series_upgrade(app, source)?;
    let windows = calendar_delta_quarters(now.year(), now.month());
    let current =
        refresh_calendar_delta_period(app, access_token, source, &windows[0].0, &windows[0].1)
            .await;
    // Poll the current quarter on every cycle and rotate one historical/future
    // quarter alongside it. A problematic old series cannot freeze this week.
    let rotation_key = format!(
        "m365_calendar_period_rotation_v1:{}:{}",
        source.id,
        now.year()
    );
    let index = get_setting(app, &rotation_key)?
        .and_then(|value| value.parse::<usize>().ok())
        .unwrap_or(0)
        % (windows.len() - 1);
    let (start, end) = &windows[index + 1];
    let history = refresh_calendar_delta_period(app, access_token, source, start, end).await;
    set_setting(
        app,
        &rotation_key,
        &((index + 1) % (windows.len() - 1)).to_string(),
    )?;
    current.and(history)?;
    repair_blank_calendar_titles(app, access_token, source).await
}

async fn refresh_calendar_delta_period(
    app: &AppHandle,
    access_token: &str,
    source: &Microsoft365SyncSource,
    window_start: &str,
    window_end: &str,
) -> Result<(), String> {
    // Keep fetching newer deltas even if an older change is still pending.
    // One conflicting or temporarily unwritable event must not stop every
    // later edit made in Teams from reaching the app.
    let mut reset_attempted = false;
    let mut title_lookups = 0usize;
    loop {
        let cursor_id = format!("{}:period:{window_start}", source.id);
        let saved_link = calendar_delta_link(app, &cursor_id, window_start, window_end)?;
        let mut next_url = Some(saved_link.clone().unwrap_or_else(|| {
            format!(
                "{}/calendarView/delta?startDateTime={}&endDateTime={}",
                source.resource_path, window_start, window_end
            )
        }));
        let mut pages = 0usize;
        let mut restart = false;
        while let Some(url) = next_url.take() {
            pages += 1;
            if pages > GRAPH_MAX_PAGES {
                return Err("Microsoft Graph lieferte ungewöhnlich viele Delta-Seiten. Die Synchronisierung wurde sicher unterbrochen.".to_string());
            }
            let page = match graph_json(access_token, &url).await {
                Ok(page) => page,
                Err(error)
                    if saved_link.is_some()
                        && !reset_attempted
                        && (error.contains("HTTP 400") || error.contains("HTTP 410")) =>
                {
                    clear_calendar_delta_state(app, &cursor_id)?;
                    reset_attempted = true;
                    restart = true;
                    break;
                }
                Err(error) => return Err(error),
            };
            let mut resolved = Vec::new();
            if let Some(values) = page.get("value").and_then(Value::as_array) {
                resolved.reserve(values.len());
                for value in values {
                    if value.get("@removed").is_none() {
                        if value_text(value, "subject").trim().is_empty() && title_lookups < 10 {
                            let remote_id = value_text(value, "id");
                            if !remote_id.is_empty() {
                                title_lookups += 1;
                                let event_url = format!(
                                    "{}/events/{}",
                                    source.resource_path,
                                    encode_graph_path_segment(remote_id)
                                );
                                if let Ok(full_event) = graph_json(access_token, &event_url).await {
                                    if !value_text(&full_event, "subject").trim().is_empty() {
                                        resolved.push(full_event);
                                        continue;
                                    }
                                }
                            }
                        }
                        resolved.push(value.clone());
                        continue;
                    }
                    let remote_id = value_text(value, "id");
                    if remote_id.is_empty() {
                        continue;
                    }
                    // Graph also emits @removed when an appointment moves out
                    // of the calendarView range. Fetch it by ID before treating
                    // the marker as an actual deletion.
                    let event_url = format!(
                        "{}/events/{}",
                        source.resource_path,
                        encode_graph_path_segment(remote_id)
                    );
                    match graph_json(access_token, &event_url).await {
                        Ok(current) => resolved.push(current),
                        Err(error) if error.contains("HTTP 404") || error.contains("HTTP 410") => {
                            resolved.push(value.clone());
                        }
                        Err(error) => return Err(error),
                    }
                }
            }
            next_url = page
                .get("@odata.nextLink")
                .and_then(Value::as_str)
                .map(ToOwned::to_owned);
            let checkpoint = next_url.as_deref().or_else(|| {
                page.get("@odata.deltaLink").and_then(Value::as_str)
            }).ok_or_else(|| {
                "Microsoft Graph hat keinen Delta-Merker geliefert. Es wurden keine Änderungen verworfen."
                    .to_string()
            })?;
            let resolved =
                event_sync::normalize_series(app, access_token, source, resolved).await?;
            checkpoint_calendar_delta_window_page(
                &mut open_db(app)?,
                &source.id,
                &resolved,
                checkpoint,
                &cursor_id,
                window_start,
                window_end,
            )?;
            if next_url.is_some() && pages >= CALENDAR_DELTA_PAGES_PER_SYNC {
                // Release the shared sync gate regularly so app edits can be
                // exported while the first calendar import is still running.
                normalize_calendar_source_label(&open_db(app)?, source)?;
                return Ok(());
            }
        }
        if restart {
            continue;
        }
        normalize_calendar_source_label(&open_db(app)?, source)?;
        return Ok(());
    }
}

fn read_calendar_delta_batch(
    app: &AppHandle,
    source_id: &str,
) -> Result<CalendarDeltaBatch, String> {
    let conn = open_db(app)?;
    let mut statement = conn
        .prepare(
            "SELECT remote_id, change_kind, payload_json
             FROM m365_calendar_delta_changes
             WHERE source_id = ?1
             ORDER BY received_at, remote_id
             LIMIT ?2",
        )
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map(params![source_id, CALENDAR_DELTA_BATCH_SIZE], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, Option<String>>(2)?,
            ))
        })
        .map_err(|error| error.to_string())?;
    let mut values = Vec::new();
    let mut removed_ids = HashSet::new();
    for row in rows {
        let (remote_id, change_kind, payload) = row.map_err(|error| error.to_string())?;
        if change_kind == "delete" {
            removed_ids.insert(remote_id);
        } else if let Some(payload) = payload {
            let value = serde_json::from_str::<Value>(&payload).map_err(|error| {
                format!("Eine vorgemerkte Kalenderänderung ist beschädigt: {error}")
            })?;
            values.push(value);
        }
    }
    Ok(CalendarDeltaBatch {
        values,
        removed_ids,
    })
}

fn encode_graph_path_segment(value: &str) -> String {
    let mut encoded = String::new();
    for byte in value.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                encoded.push(byte as char)
            }
            _ => encoded.push_str(&format!("%{byte:02X}")),
        }
    }
    encoded
}

fn sync_source(
    value: &Value,
    kind: &str,
    shared: bool,
    resource_path: String,
    mailbox: Option<String>,
) -> Option<Microsoft365SyncSource> {
    let id = value.get("id")?.as_str()?.trim();
    if id.is_empty() {
        return None;
    }
    let name = value
        .get("displayName")
        .or_else(|| value.get("name"))
        .and_then(Value::as_str)
        .unwrap_or("Ohne Namen")
        .trim()
        .to_string();
    Some(Microsoft365SyncSource {
        id: id.to_string(),
        name,
        kind: kind.to_string(),
        editable: value
            .get("canEdit")
            .and_then(Value::as_bool)
            .unwrap_or(true),
        shared,
        resource_path,
        mailbox,
    })
}

fn synthetic_sync_source(
    id: String,
    name: String,
    kind: &str,
    resource_path: String,
    mailbox: String,
) -> Microsoft365SyncSource {
    Microsoft365SyncSource {
        id,
        name,
        kind: kind.to_string(),
        editable: true,
        shared: true,
        resource_path,
        mailbox: Some(mailbox),
    }
}

fn append_unique_calendar_sources(
    calendars: &mut Vec<Microsoft365SyncSource>,
    additions: impl IntoIterator<Item = Microsoft365SyncSource>,
) {
    let mut known_ids: HashSet<String> = calendars.iter().map(|source| source.id.clone()).collect();
    for source in additions {
        if known_ids.insert(source.id.clone()) {
            calendars.push(source);
        }
    }
}

#[tauri::command]
pub async fn list_m365_sync_sources(
    app: AppHandle,
    shared_mailbox_addresses: Option<Vec<String>>,
) -> Result<Microsoft365SyncSources, String> {
    list_m365_sync_sources_filtered(app, shared_mailbox_addresses, true, true).await
}

#[tauri::command]
pub async fn list_m365_calendar_sources(
    app: AppHandle,
    shared_mailbox_addresses: Option<Vec<String>>,
) -> Result<Vec<Microsoft365SyncSource>, String> {
    Ok(
        list_m365_sync_sources_filtered(app, shared_mailbox_addresses, false, true)
            .await?
            .calendars,
    )
}

async fn list_m365_sync_sources_filtered(
    app: AppHandle,
    shared_mailbox_addresses: Option<Vec<String>>,
    include_contacts: bool,
    include_calendars: bool,
) -> Result<Microsoft365SyncSources, String> {
    let access_token = refreshed_access_token(&app).await?;
    let contact_folders = if include_contacts {
        graph_collection(
        &access_token,
        "https://graph.microsoft.com/v1.0/me/contactFolders?$select=id,displayName,parentFolderId&$top=100",
    )
    .await?
    } else {
        Vec::new()
    };
    let calendars = if include_calendars {
        graph_collection(
            &access_token,
            "https://graph.microsoft.com/v1.0/me/calendars?$select=id,name,canEdit,owner&$top=100",
        )
        .await?
    } else {
        Vec::new()
    };
    let calendar_groups = if include_calendars {
        graph_collection(
            &access_token,
            "https://graph.microsoft.com/v1.0/me/calendarGroups?$select=id,name&$top=100",
        )
        .await
        .unwrap_or_default()
    } else {
        Vec::new()
    };

    let mut calendar_sources: Vec<Microsoft365SyncSource> = calendars
        .iter()
        .filter_map(|value| {
            let id = value.get("id").and_then(Value::as_str)?;
            sync_source(
                value,
                "calendar",
                false,
                format!("https://graph.microsoft.com/v1.0/me/calendars/{id}"),
                None,
            )
        })
        .collect();
    for group in calendar_groups {
        let Some(group_id) = group.get("id").and_then(Value::as_str) else {
            continue;
        };
        let group_name = group
            .get("name")
            .and_then(Value::as_str)
            .unwrap_or("Freigegeben");
        let url = format!(
            "https://graph.microsoft.com/v1.0/me/calendarGroups/{group_id}/calendars?$select=id,name,canEdit,owner&$top=100"
        );
        if let Ok(shared_calendars) = graph_collection(&access_token, &url).await {
            append_unique_calendar_sources(&mut calendar_sources, shared_calendars.iter().filter_map(|value| {
                let calendar_id = value.get("id").and_then(Value::as_str)?;
                let mut source = sync_source(
                    value,
                    "calendar",
                    true,
                    format!(
                        "https://graph.microsoft.com/v1.0/me/calendarGroups/{group_id}/calendars/{calendar_id}"
                    ),
                    None,
                )?;
                source.name = format!("{group_name} · {}", source.name);
                Some(source)
            }));
        }
    }

    let mut contact_sources: Vec<Microsoft365SyncSource> = contact_folders
        .iter()
        .filter_map(|value| {
            let id = value.get("id").and_then(Value::as_str)?;
            sync_source(
                value,
                "contactFolder",
                false,
                format!("https://graph.microsoft.com/v1.0/me/contactFolders/{id}/contacts"),
                None,
            )
        })
        .collect();
    if include_contacts {
        contact_sources.insert(
            0,
            Microsoft365SyncSource {
                id: "me:default-contacts".to_string(),
                name: "Kontakte".to_string(),
                kind: "contactFolder".to_string(),
                editable: true,
                shared: false,
                resource_path: "https://graph.microsoft.com/v1.0/me/contacts".to_string(),
                mailbox: None,
            },
        );
    }
    let mut shared_mailboxes = Vec::new();

    for address in shared_mailbox_addresses
        .unwrap_or_default()
        .into_iter()
        .map(|address| address.trim().to_lowercase())
        .filter(|address| address.contains('@') && !address.contains(' '))
        .collect::<Vec<_>>()
    {
        let encoded_address = encode_graph_path_segment(&address);
        let mailbox_calendars = if include_calendars {
            graph_collection(
            &access_token,
            &format!(
                "https://graph.microsoft.com/v1.0/users/{encoded_address}/calendars?$select=id,name,canEdit,owner&$top=100"
            ),
        )
        .await
        } else {
            Ok(Vec::new())
        };
        let mailbox_contacts = if include_contacts {
            graph_collection(
            &access_token,
            &format!(
                "https://graph.microsoft.com/v1.0/users/{encoded_address}/contactFolders?$select=id,displayName,parentFolderId&$top=100"
            ),
        )
        .await
        } else {
            Ok(Vec::new())
        };
        let mailbox_default_contacts = if include_contacts {
            graph_collection(
            &access_token,
            &format!(
                "https://graph.microsoft.com/v1.0/users/{encoded_address}/contacts?$select=id&$top=1"
            ),
        )
        .await
        } else {
            Ok(Vec::new())
        };
        let mailbox_access_error = if include_calendars
            && mailbox_calendars.is_err()
            && (!include_contacts
                || (mailbox_contacts.is_err() && mailbox_default_contacts.is_err()))
        {
            let mut message = format!("Kalender: {}", mailbox_calendars.as_ref().err().unwrap());
            if include_contacts {
                message.push_str(&format!(
                    " Kontakte: {}",
                    mailbox_contacts
                        .as_ref()
                        .err()
                        .or_else(|| mailbox_default_contacts.as_ref().err())
                        .unwrap()
                ));
            }
            Some(message)
        } else if !include_calendars
            && include_contacts
            && mailbox_contacts.is_err()
            && mailbox_default_contacts.is_err()
        {
            Some(format!(
                "Kontakte: {}",
                mailbox_contacts.as_ref().err().unwrap()
            ))
        } else {
            None
        };

        if include_contacts && mailbox_default_contacts.is_ok() {
            contact_sources.push(synthetic_sync_source(
                format!("{address}:default-contacts"),
                format!("{address} · Kontakte"),
                "contactFolder",
                format!("https://graph.microsoft.com/v1.0/users/{encoded_address}/contacts"),
                address.clone(),
            ));
        }

        if include_contacts {
            if let Ok(values) = &mailbox_contacts {
                contact_sources.extend(values.iter().filter_map(|value| {
                let id = value.get("id").and_then(Value::as_str)?;
                let mut source = sync_source(
                    value,
                    "contactFolder",
                    true,
                    format!(
                        "https://graph.microsoft.com/v1.0/users/{encoded_address}/contactFolders/{id}/contacts"
                    ),
                    Some(address.clone()),
                )?;
                source.name = format!("{address} · {}", source.name);
                Some(source)
            }));
            }
        }
        if let Ok(values) = &mailbox_calendars {
            calendar_sources.extend(values.iter().filter_map(|value| {
                let id = value.get("id").and_then(Value::as_str)?;
                let mut source = sync_source(
                    value,
                    "calendar",
                    true,
                    format!(
                        "https://graph.microsoft.com/v1.0/users/{encoded_address}/calendars/{id}"
                    ),
                    Some(address.clone()),
                )?;
                source.name = format!("{address} · {}", source.name);
                Some(source)
            }));
        }
        shared_mailboxes.push(Microsoft365SharedMailbox {
            address: address.clone(),
            display_name: address.clone(),
            available: mailbox_access_error.is_none(),
            contact_folder_count: mailbox_contacts.as_ref().map(Vec::len).unwrap_or(0)
                + usize::from(include_contacts && mailbox_default_contacts.is_ok()),
            calendar_count: mailbox_calendars.as_ref().map(Vec::len).unwrap_or(0),
            error: mailbox_access_error,
        });
    }

    let shared_access_available = calendar_sources.iter().any(|source| source.shared)
        || shared_mailboxes.iter().any(|mailbox| mailbox.available);

    Ok(Microsoft365SyncSources {
        contacts: contact_sources,
        calendars: calendar_sources,
        shared_mailboxes,
        shared_access_available,
    })
}

fn value_text<'a>(value: &'a Value, key: &str) -> &'a str {
    value.get(key).and_then(Value::as_str).unwrap_or("")
}

fn first_graph_email(value: &Value) -> &str {
    value
        .get("emailAddresses")
        .and_then(Value::as_array)
        .and_then(|addresses| addresses.first())
        .and_then(|address| address.get("address"))
        .and_then(Value::as_str)
        .unwrap_or("")
}

fn normalized_contact_key(value: &Value) -> String {
    let email = first_graph_email(value).trim().to_lowercase();
    if !email.is_empty() {
        return format!("email:{email}");
    }
    format!(
        "name:{}",
        value_text(value, "displayName").trim().to_lowercase()
    )
}

fn local_contact_key(contact: &crate::Contact) -> String {
    if !contact.email.trim().is_empty() {
        return format!("email:{}", contact.email.trim().to_lowercase());
    }
    let name = if contact.display_name.trim().is_empty() {
        format!("{} {}", contact.first_name, contact.last_name)
    } else {
        contact.display_name.clone()
    };
    format!("name:{}", name.trim().to_lowercase())
}

fn contact_summary(contact: &crate::Contact) -> String {
    [
        contact.display_name.trim(),
        contact.email.trim(),
        contact.phone.trim(),
        contact.city.trim(),
    ]
    .into_iter()
    .filter(|part| !part.is_empty())
    .collect::<Vec<_>>()
    .join(" · ")
}

fn remote_contact_summary(value: &Value) -> String {
    [
        value_text(value, "displayName"),
        first_graph_email(value),
        value
            .get("businessPhones")
            .and_then(Value::as_array)
            .and_then(|phones| phones.first())
            .and_then(Value::as_str)
            .unwrap_or(""),
        value
            .get("businessAddress")
            .and_then(|address| address.get("city"))
            .and_then(Value::as_str)
            .unwrap_or(""),
    ]
    .into_iter()
    .filter(|part| !part.trim().is_empty())
    .collect::<Vec<_>>()
    .join(" · ")
}

fn remote_contact_input(value: &Value, existing: Option<&crate::Contact>) -> crate::ContactInput {
    let address = value.get("businessAddress").unwrap_or(&Value::Null);
    let emails = value.get("emailAddresses").and_then(Value::as_array);
    let email_at = |index: usize| {
        emails
            .and_then(|items| items.get(index))
            .and_then(|item| item.get("address"))
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string()
    };
    let home_phones = value.get("homePhones").and_then(Value::as_array);
    let home_phone_at = |index: usize| {
        home_phones
            .and_then(|items| items.get(index))
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string()
    };
    crate::ContactInput {
        id: existing.and_then(|contact| contact.id),
        first_name: value_text(value, "givenName").to_string(),
        last_name: value_text(value, "surname").to_string(),
        display_name: value_text(value, "displayName").to_string(),
        email: first_graph_email(value).to_string(),
        private_email: email_at(1),
        second_private_email: email_at(2),
        phone: value
            .get("businessPhones")
            .and_then(Value::as_array)
            .and_then(|phones| phones.first())
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string(),
        mobile_phone: value_text(value, "mobilePhone").to_string(),
        private_phone: home_phone_at(0),
        second_private_phone: home_phone_at(1),
        company: value_text(value, "companyName").to_string(),
        street: value_text(address, "street").to_string(),
        postal_code: value_text(address, "postalCode").to_string(),
        city: value_text(address, "city").to_string(),
        country: value_text(address, "countryOrRegion").to_string(),
        short_info: existing
            .map(|contact| contact.short_info.clone())
            .unwrap_or_default(),
        notes: value_text(value, "personalNotes").to_string(),
        group_ids: existing
            .map(|contact| contact.groups.iter().filter_map(|group| group.id).collect())
            .unwrap_or_default(),
    }
}

fn remote_contact_input_for_source(
    value: &Value,
    existing: Option<&crate::Contact>,
    backup: &crate::BackupData,
    source: &Microsoft365SyncSource,
) -> crate::ContactInput {
    let mut input = remote_contact_input(value, existing);
    if let Some(group_id) = source_group_id(backup, source) {
        if !input.group_ids.contains(&group_id) {
            input.group_ids.push(group_id);
        }
    }
    input
}

fn graph_contact_payload(contact: &crate::Contact) -> Value {
    let display_name = if contact.display_name.trim().is_empty() {
        format!("{} {}", contact.first_name, contact.last_name)
            .trim()
            .to_string()
    } else {
        contact.display_name.clone()
    };
    let emails = [
        &contact.email,
        &contact.private_email,
        &contact.second_private_email,
    ]
    .into_iter()
    .filter(|email| !email.trim().is_empty())
    .map(|email| json!({"address": email.trim(), "name": display_name}))
    .collect::<Vec<_>>();
    let phones = if contact.phone.trim().is_empty() {
        Vec::<String>::new()
    } else {
        vec![contact.phone.trim().to_string()]
    };
    json!({
        "givenName": contact.first_name,
        "surname": contact.last_name,
        "displayName": display_name,
        "emailAddresses": emails,
        "businessPhones": phones,
        "mobilePhone": contact.mobile_phone,
        "homePhones": ([&contact.private_phone, &contact.second_private_phone]
            .into_iter().filter(|phone| !phone.trim().is_empty()).map(|phone| phone.trim()).collect::<Vec<_>>()),
        "companyName": contact.company,
        "businessAddress": {
            "street": contact.street,
            "postalCode": contact.postal_code,
            "city": contact.city,
            "countryOrRegion": contact.country
        },
        "personalNotes": contact.notes
    })
}

fn contact_equivalent(local: &crate::Contact, remote: &Value) -> bool {
    let remote_input = remote_contact_input(remote, Some(local));
    local.first_name.trim() == remote_input.first_name.trim()
        && local.last_name.trim() == remote_input.last_name.trim()
        && local.display_name.trim() == remote_input.display_name.trim()
        && local
            .email
            .trim()
            .eq_ignore_ascii_case(remote_input.email.trim())
        && local
            .private_email
            .trim()
            .eq_ignore_ascii_case(remote_input.private_email.trim())
        && local
            .second_private_email
            .trim()
            .eq_ignore_ascii_case(remote_input.second_private_email.trim())
        && local.phone.trim() == remote_input.phone.trim()
        && local.mobile_phone.trim() == remote_input.mobile_phone.trim()
        && local.private_phone.trim() == remote_input.private_phone.trim()
        && local.second_private_phone.trim() == remote_input.second_private_phone.trim()
        && local.company.trim() == remote_input.company.trim()
        && local.street.trim() == remote_input.street.trim()
        && local.postal_code.trim() == remote_input.postal_code.trim()
        && local.city.trim() == remote_input.city.trim()
        && local.country.trim() == remote_input.country.trim()
        && local.notes.trim() == remote_input.notes.trim()
}

fn merge_contact(local: &crate::Contact, remote: &Value) -> crate::Contact {
    let remote_input = remote_contact_input(remote, Some(local));
    let mut merged = local.clone();
    if merged.first_name.trim().is_empty() {
        merged.first_name = remote_input.first_name;
    }
    if merged.last_name.trim().is_empty() {
        merged.last_name = remote_input.last_name;
    }
    if merged.display_name.trim().is_empty() {
        merged.display_name = remote_input.display_name;
    }
    if merged.email.trim().is_empty() {
        merged.email = remote_input.email;
    }
    if merged.private_email.trim().is_empty() {
        merged.private_email = remote_input.private_email;
    }
    if merged.second_private_email.trim().is_empty() {
        merged.second_private_email = remote_input.second_private_email;
    }
    if merged.phone.trim().is_empty() {
        merged.phone = remote_input.phone;
    }
    if merged.mobile_phone.trim().is_empty() {
        merged.mobile_phone = remote_input.mobile_phone;
    }
    if merged.private_phone.trim().is_empty() {
        merged.private_phone = remote_input.private_phone;
    }
    if merged.second_private_phone.trim().is_empty() {
        merged.second_private_phone = remote_input.second_private_phone;
    }
    if merged.company.trim().is_empty() {
        merged.company = remote_input.company;
    }
    if merged.street.trim().is_empty() {
        merged.street = remote_input.street;
    }
    if merged.postal_code.trim().is_empty() {
        merged.postal_code = remote_input.postal_code;
    }
    if merged.city.trim().is_empty() {
        merged.city = remote_input.city;
    }
    if merged.country.trim().is_empty() {
        merged.country = remote_input.country;
    }
    if merged.notes.trim().is_empty() {
        merged.notes = remote_input.notes;
    } else if !remote_input.notes.trim().is_empty()
        && merged.notes.trim() != remote_input.notes.trim()
    {
        merged.notes = format!(
            "{}\n\n--- Microsoft 365 ---\n{}",
            merged.notes.trim(),
            remote_input.notes.trim()
        );
    }
    merged
}

fn local_calendar_events(backup: &crate::BackupData) -> Vec<crate::CalendarEvent> {
    backup
        .browser_storage
        .get("agendakontakte.calendarEvents")
        .and_then(|raw| serde_json::from_str::<Vec<crate::CalendarEvent>>(raw).ok())
        .unwrap_or_default()
}

fn decode_html_entities(value: &str) -> String {
    let chars = value.chars().collect::<Vec<_>>();
    let mut decoded = String::with_capacity(value.len());
    let mut index = 0usize;
    while index < chars.len() {
        if chars[index] != '&' {
            decoded.push(chars[index]);
            index += 1;
            continue;
        }
        let Some(end) = chars[index + 1..]
            .iter()
            .position(|character| *character == ';')
            .map(|offset| index + 1 + offset)
        else {
            decoded.push('&');
            index += 1;
            continue;
        };
        let entity = chars[index + 1..end].iter().collect::<String>();
        let replacement = match entity.as_str() {
            "amp" => Some('&'),
            "lt" => Some('<'),
            "gt" => Some('>'),
            "quot" => Some('"'),
            "apos" | "#39" => Some('\''),
            "nbsp" => Some(' '),
            _ if entity.starts_with("#x") || entity.starts_with("#X") => {
                u32::from_str_radix(&entity[2..], 16)
                    .ok()
                    .and_then(char::from_u32)
            }
            _ if entity.starts_with('#') => {
                entity[1..].parse::<u32>().ok().and_then(char::from_u32)
            }
            _ => None,
        };
        if let Some(character) = replacement {
            decoded.push(character);
            index = end + 1;
        } else {
            decoded.push('&');
            index += 1;
        }
    }
    decoded
}

fn html_to_plain_text(value: &str) -> String {
    let chars = value.chars().collect::<Vec<_>>();
    let mut text = String::with_capacity(value.len());
    let mut index = 0usize;
    let mut suppressed_tag: Option<String> = None;
    while index < chars.len() {
        if chars[index] != '<' {
            if suppressed_tag.is_none() {
                text.push(chars[index]);
            }
            index += 1;
            continue;
        }
        let Some(end) = chars[index + 1..]
            .iter()
            .position(|character| *character == '>')
            .map(|offset| index + 1 + offset)
        else {
            if suppressed_tag.is_none() {
                text.push('<');
            }
            index += 1;
            continue;
        };
        let raw_tag = chars[index + 1..end].iter().collect::<String>();
        let trimmed = raw_tag.trim();
        let closing = trimmed.starts_with('/');
        let tag_name = trimmed
            .trim_start_matches('/')
            .split_ascii_whitespace()
            .next()
            .unwrap_or("")
            .trim_end_matches('/')
            .to_ascii_lowercase();
        if matches!(tag_name.as_str(), "head" | "style" | "script") {
            if closing {
                if suppressed_tag.as_deref() == Some(tag_name.as_str()) {
                    suppressed_tag = None;
                }
            } else if suppressed_tag.is_none() {
                suppressed_tag = Some(tag_name.clone());
            }
        } else if suppressed_tag.is_none()
            && matches!(
                tag_name.as_str(),
                "br" | "p"
                    | "div"
                    | "li"
                    | "tr"
                    | "table"
                    | "ul"
                    | "ol"
                    | "h1"
                    | "h2"
                    | "h3"
                    | "h4"
                    | "h5"
                    | "h6"
            )
        {
            text.push('\n');
        }
        index = end + 1;
    }

    decode_html_entities(&text)
        .lines()
        .map(|line| line.split_whitespace().collect::<Vec<_>>().join(" "))
        .filter(|line| !line.is_empty())
        .collect::<Vec<_>>()
        .join("\n")
}

fn remote_event_description(value: &Value) -> String {
    let Some(body) = value.get("body") else {
        return String::new();
    };
    let content = body.get("content").and_then(Value::as_str).unwrap_or("");
    if body
        .get("contentType")
        .and_then(Value::as_str)
        .is_some_and(|content_type| content_type.eq_ignore_ascii_case("html"))
    {
        html_to_plain_text(event_sync::description_html(value))
    } else {
        content.to_string()
    }
}

fn remote_event_attendees(value: &Value, attendee_type: &str) -> Vec<String> {
    value
        .get("attendees")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter(|attendee| value_text(attendee, "type").eq_ignore_ascii_case(attendee_type))
        .filter_map(|attendee| {
            let email = attendee
                .get("emailAddress")
                .and_then(|address| address.get("address"))
                .and_then(Value::as_str)
                .unwrap_or("")
                .trim();
            let name = attendee
                .get("emailAddress")
                .and_then(|address| address.get("name"))
                .and_then(Value::as_str)
                .unwrap_or("")
                .trim();
            (!email.is_empty() || !name.is_empty())
                .then(|| if email.is_empty() { name } else { email }.to_string())
        })
        .collect()
}

fn deleted_calendar_events(backup: &crate::BackupData) -> Vec<crate::CalendarEvent> {
    backup
        .browser_storage
        .get("agendakontakte.deletedCalendarEvents")
        .and_then(|raw| serde_json::from_str::<Vec<crate::CalendarEvent>>(raw).ok())
        .unwrap_or_default()
}

fn linked_calendar_remote_id<'a>(
    event: &'a crate::CalendarEvent,
    source_id: &str,
) -> Option<&'a str> {
    event.id.strip_prefix(&format!("m365:{source_id}:"))
}

fn normalized_duplicate_value(value: &str) -> String {
    value
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_lowercase()
}

fn calendar_event_duplicate_key(event: &crate::CalendarEvent) -> Option<String> {
    if event.title.trim().is_empty()
        || event.starts_at.trim().is_empty()
        || event.ends_at.trim().is_empty()
    {
        return None;
    }
    Some(format!(
        "{}|{}|{}|{}|{}|{}|{}|{}|{}",
        normalized_duplicate_value(&event.title),
        event.starts_at.trim(),
        event.ends_at.trim(),
        normalized_duplicate_value(&event.location),
        normalized_duplicate_value(&html_to_plain_text(&event.description)),
        normalized_duplicate_value(&event.category),
        serde_json::to_string(&event.recurrence).unwrap_or_default(),
        serde_json::to_string(&event.excluded_dates).unwrap_or_default(),
        event.recurrence_id.as_deref().unwrap_or("")
    ))
}

fn duplicate_calendar_event_ids(
    events: &[crate::CalendarEvent],
    sources: &[Microsoft365SyncSource],
    export_target_id: Option<&str>,
) -> HashSet<String> {
    let mut groups = HashMap::<String, Vec<&crate::CalendarEvent>>::new();
    for event in events {
        if let Some(key) = calendar_event_duplicate_key(event) {
            groups.entry(key).or_default().push(event);
        }
    }

    let mut duplicate_ids = HashSet::new();
    for group in groups.values().filter(|group| group.len() > 1) {
        let keep =
            group
                .iter()
                .min_by_key(|event| match linked_calendar_source_id(event, sources) {
                    Some(source_id) if Some(source_id) == export_target_id => 0u8,
                    Some(_) => 1u8,
                    None => 2u8,
                });
        for event in group {
            if keep.is_some_and(|kept| kept.id == event.id) {
                continue;
            }
            duplicate_ids.insert(event.id.clone());
        }
    }
    duplicate_ids
}

fn should_plan_calendar_duplicate_cleanup(
    request: &Microsoft365SyncPreviewRequest,
    sources: &[Microsoft365SyncSource],
    selected: &HashSet<&str>,
) -> bool {
    // An inbound-only refresh repairs or adds appointments. It must never
    // remove a second appointment merely because its visible fields match.
    sources.iter().any(|source| {
        calendar_source_is_enabled(request, selected, source)
            && source_direction(request, &source.id) != "import"
    })
}

/// The app stores local appointments as `YYYY-MM-DDTHH:MM`, while Microsoft Graph
/// can return the same instant with seconds and fractional seconds.  A first sync
/// must compare the human appointment time, not those transport-format details.
fn normalized_calendar_start(value: &str) -> String {
    let value = value.trim().replace(' ', "T");
    if value.len() >= 16
        && value.as_bytes().get(4) == Some(&b'-')
        && value.as_bytes().get(7) == Some(&b'-')
        && value.as_bytes().get(10) == Some(&b'T')
        && value.as_bytes().get(13) == Some(&b':')
    {
        return value[..16].to_string();
    }
    value
}

fn remote_event_key(value: &Value) -> String {
    let subject = value_text(value, "subject").trim().to_lowercase();
    let start = value
        .get("start")
        .and_then(|start| start.get("dateTime"))
        .and_then(Value::as_str)
        .unwrap_or("")
        .trim();
    format!("{subject}|{}", normalized_calendar_start(start))
}

fn local_event_key(event: &crate::CalendarEvent) -> String {
    format!(
        "{}|{}",
        event.title.trim().to_lowercase(),
        normalized_calendar_start(&event.starts_at)
    )
}

fn outlook_category_color(value: &str) -> &'static str {
    match value.trim().to_ascii_lowercase().as_str() {
        "preset0" | "preset9" | "preset15" | "preset24" => "red",
        "preset1" | "preset2" | "preset3" | "preset16" | "preset17" | "preset18" => "yellow",
        "preset4" | "preset5" | "preset6" | "preset19" | "preset20" | "preset21" => "green",
        "preset7" | "preset22" => "blue",
        "preset8" | "preset23" => "purple",
        "preset10" | "preset11" | "preset12" | "preset13" | "preset14" => "gray",
        _ => "gray",
    }
}

fn outlook_category_has_color(value: &str) -> bool {
    let Some(number) = value
        .trim()
        .to_ascii_lowercase()
        .strip_prefix("preset")
        .and_then(|number| number.parse::<u8>().ok())
    else {
        return false;
    };
    number <= 24 && !(10..=14).contains(&number)
}

fn outlook_category_has_preset(value: &str) -> bool {
    value
        .trim()
        .to_ascii_lowercase()
        .strip_prefix("preset")
        .and_then(|number| number.parse::<u8>().ok())
        .is_some_and(|number| number <= 24)
}

fn dmh_category_for_calendar_color(value: &str) -> (&'static str, &'static str) {
    match value.trim().to_ascii_lowercase().as_str() {
        "red" => ("DMH Farbe: Rot", "preset0"),
        "green" => ("DMH Farbe: Grün", "preset4"),
        "yellow" => ("DMH Farbe: Gelb", "preset3"),
        "purple" => ("DMH Farbe: Lila", "preset8"),
        // A gray local/imported value must never create a gray category in
        // Exchange. Use the default blue category instead.
        "gray" | "grey" => ("DMH Farbe: Blau", "preset7"),
        _ => ("DMH Farbe: Blau", "preset7"),
    }
}

fn calendar_category_preset(name: &str, local_color: &str) -> &'static str {
    // Generated category names describe their colour. An old appointment's
    // cached colour must not turn "DMH Farbe: Blau" into a green category.
    match name.trim().to_lowercase().as_str() {
        "dmh farbe: rot" => "preset0",
        "dmh farbe: grün" => "preset4",
        "dmh farbe: gelb" => "preset3",
        "dmh farbe: lila" => "preset8",
        "dmh farbe: grau" | "dmh farbe: blau" => "preset7",
        _ => dmh_category_for_calendar_color(local_color).1,
    }
}

fn expected_calendar_category_preset(
    name: &str,
    local_color: &str,
    existing: Option<&Value>,
    force_local_color: bool,
) -> String {
    if force_local_color {
        return dmh_category_for_calendar_color(local_color).1.to_string();
    }
    existing
        .map(|category| value_text(category, "color"))
        .filter(|color| outlook_category_has_preset(color))
        .unwrap_or_else(|| calendar_category_preset(name, local_color))
        .to_string()
}

mod calendar_transfer;
pub mod category_management;
mod event_sync;

async fn ensure_calendar_default_blue(
    token: &str,
    source: &Microsoft365SyncSource,
) -> Result<(), String> {
    if !source.editable {
        return Ok(());
    }
    let calendar = graph_json(token, &format!("{}?$select=id,color", source.resource_path)).await?;
    if !value_text(&calendar, "color").eq_ignore_ascii_case("lightBlue") {
        graph_write(
            token,
            reqwest::Method::PATCH,
            &source.resource_path,
            &json!({"color": "lightBlue"}),
        )
        .await?;
        let saved =
            graph_json(token, &format!("{}?$select=id,color", source.resource_path)).await?;
        if !value_text(&saved, "color").eq_ignore_ascii_case("lightBlue") {
            return Err(format!(
                "Exchange hat die blaue Standardfarbe für „{}“ nicht bestätigt.",
                source.name
            ));
        }
    }
    Ok(())
}

fn graph_category_values(category: &str) -> Vec<String> {
    if category.is_empty() {
        Vec::new()
    } else {
        vec![category.to_string()]
    }
}

fn graph_category_for_event(event: &crate::CalendarEvent) -> String {
    let existing = event.category.trim();
    if existing.eq_ignore_ascii_case("DMH Farbe: Grau") {
        return "DMH Farbe: Blau".to_string();
    }
    if !existing.is_empty() {
        return existing.to_string();
    }
    if !matches!(event.color.as_str(), "green" | "red" | "yellow" | "purple") {
        return String::new();
    }
    dmh_category_for_calendar_color(&event.color).0.to_string()
}

fn master_category_for_event(
    event: &crate::CalendarEvent,
    names: &HashMap<String, String>,
) -> String {
    let requested = graph_category_for_event(event);
    names
        .get(&requested.to_lowercase())
        .cloned()
        .unwrap_or(requested)
}

#[derive(Debug, Clone)]
struct CalendarCategoryRepairTarget {
    title: String,
    url: String,
    category: String,
    color: String,
}

fn calendar_category_repair_targets(
    events: &[crate::CalendarEvent],
    sources: &[Microsoft365SyncSource],
) -> Vec<CalendarCategoryRepairTarget> {
    events
        .iter()
        .filter_map(|event| {
            let source = sources.iter().find(|source| {
                source.editable && linked_calendar_remote_id(event, &source.id).is_some()
            })?;
            let remote_id = linked_calendar_remote_id(event, &source.id)?;
            Some(CalendarCategoryRepairTarget {
                title: event.title.clone(),
                url: format!(
                    "{}/events/{}",
                    source.resource_path,
                    encode_graph_path_segment(remote_id)
                ),
                category: graph_category_for_event(event),
                color: event.color.clone(),
            })
        })
        .collect()
}

fn required_calendar_category_colors(
    targets: &[CalendarCategoryRepairTarget],
) -> HashMap<String, (String, &'static str)> {
    let mut required = HashMap::new();
    for target in targets {
        if target.category.is_empty() {
            continue;
        }
        let key = target.category.to_lowercase();
        required.entry(key).or_insert_with(|| {
            (
                target.category.clone(),
                dmh_category_for_calendar_color(&target.color).1,
            )
        });
    }
    required
}

fn category_needs_repair(_name: &str, actual: &str, expected: &str) -> bool {
    !outlook_category_has_preset(actual) || !actual.eq_ignore_ascii_case(expected)
}

fn verified_calendar_category_names(
    categories: Vec<Value>,
    needed: &HashMap<String, (String, String)>,
) -> Result<HashMap<String, String>, String> {
    let by_name = categories
        .into_iter()
        .filter_map(|category| {
            let name = value_text(&category, "displayName").trim().to_lowercase();
            (!name.is_empty()).then_some((name, category))
        })
        .collect::<HashMap<_, _>>();
    for (key, (name, expected)) in needed {
        let actual = by_name
            .get(key)
            .map(|category| value_text(category, "color"))
            .unwrap_or("");
        if category_needs_repair(name, actual, expected) {
            return Err(format!(
                "Die Exchange-Kategorie „{name}“ hat noch keine bestätigte Farbe (erwartet: {expected}, erhalten: {}). Der Termin wird später erneut synchronisiert.",
                if actual.is_empty() { "Kategorie fehlt" } else { actual }
            ));
        }
    }
    Ok(by_name
        .into_iter()
        .filter(|(_, category)| outlook_category_has_preset(value_text(category, "color")))
        .map(|(key, category)| (key, value_text(&category, "displayName").trim().to_string()))
        .collect())
}

fn verify_calendar_event_category(value: &Value, category: &str) -> Result<(), String> {
    if category.is_empty()
        && value
            .get("categories")
            .and_then(Value::as_array)
            .is_some_and(Vec::is_empty)
    {
        return Ok(());
    }
    if value
        .get("categories")
        .and_then(Value::as_array)
        .and_then(|categories| categories.first())
        .and_then(Value::as_str)
        == Some(category)
    {
        Ok(())
    } else {
        Err(format!(
            "Exchange hat die Kategorie „{category}“ am erneut gelesenen Termin nicht bestätigt. Bitte erneut prüfen."
        ))
    }
}

async fn ensure_m365_calendar_categories(
    access_token: &str,
    categories: impl IntoIterator<Item = (String, String, bool)>,
) -> Result<HashMap<String, String>, String> {
    let existing = graph_collection(
        access_token,
        "https://graph.microsoft.com/v1.0/me/outlook/masterCategories?$select=id,displayName,color",
    )
    .await?
    .into_iter()
    .filter_map(|category| {
        let name = value_text(&category, "displayName").trim().to_lowercase();
        (!name.is_empty()).then_some((name, category))
    })
    .collect::<HashMap<_, _>>();
    let mut needed = HashMap::<String, (String, String)>::new();
    for (name, local_color, force_local_color) in categories {
        if name.trim().is_empty() {
            continue;
        }
        // Preserve the chosen Exchange colour. Cached event colours are only
        // a fallback for missing or uncoloured master categories.
        let color = expected_calendar_category_preset(
            &name,
            &local_color,
            existing.get(&name.to_lowercase()),
            force_local_color,
        );
        if force_local_color {
            needed.insert(name.to_lowercase(), (name, color));
        } else {
            needed.entry(name.to_lowercase()).or_insert((name, color));
        }
    }
    // Fill in generated categories without a valid preset. A valid colour
    // chosen in Teams is retained until an explicit app colour edit or repair.
    for (key, category) in &existing {
        if outlook_category_has_preset(value_text(category, "color")) {
            continue;
        }
        let app_color = match key.as_str() {
            "dmh farbe: rot" => Some("preset0"),
            "dmh farbe: grün" => Some("preset4"),
            "dmh farbe: gelb" => Some("preset3"),
            "dmh farbe: lila" => Some("preset8"),
            "dmh farbe: grau" | "dmh farbe: blau" => Some("preset7"),
            _ => None,
        };
        if let Some(color) = app_color {
            needed.entry(key.clone()).or_insert_with(|| {
                (
                    value_text(category, "displayName").trim().to_string(),
                    color.to_string(),
                )
            });
        }
    }
    let mut changed = false;
    for (key, (name, color)) in &needed {
        let write = match existing.get(key) {
            Some(category) if value_text(category, "color").eq_ignore_ascii_case(color) => {
                continue;
            }
            Some(category) => {
                let id = value_text(category, "id").trim();
                if id.is_empty() {
                    return Err(format!("Die Exchange-Kategorie „{name}“ hat keine Kennung und konnte nicht eingefärbt werden."));
                }
                graph_write(
                    access_token,
                    reqwest::Method::PATCH,
                    &format!(
                        "https://graph.microsoft.com/v1.0/me/outlook/masterCategories/{}",
                        encode_graph_path_segment(id)
                    ),
                    &json!({ "color": color }),
                )
                .await
            }
            None => {
                graph_write(
                    access_token,
                    reqwest::Method::POST,
                    "https://graph.microsoft.com/v1.0/me/outlook/masterCategories",
                    &json!({ "displayName": name, "color": color }),
                )
                .await
            }
        };
        write.map_err(|error| format!(
            "Die Exchange-Kategorie „{name}“ konnte nicht mit einer Farbe gespeichert werden: {error}. Bitte verbinden Sie Microsoft 365 erneut, falls die Kategorie-Berechtigung fehlt."
        ))?;
        changed = true;
    }
    let verified_categories = if changed {
        graph_collection(
            access_token,
            "https://graph.microsoft.com/v1.0/me/outlook/masterCategories?$select=displayName,color",
        )
        .await?
    } else {
        existing.into_values().collect()
    };
    verified_calendar_category_names(verified_categories, &needed)
}

async fn m365_master_categories(
    access_token: &str,
) -> Result<Vec<Microsoft365CalendarCategory>, String> {
    let categories = graph_collection(
        access_token,
        "https://graph.microsoft.com/v1.0/me/outlook/masterCategories?$select=displayName,color",
    )
    .await?;
    Ok(categories
        .into_iter()
        .filter_map(|category| {
            let name = value_text(&category, "displayName").trim();
            if name.is_empty() {
                return None;
            }
            Some(Microsoft365CalendarCategory {
                name: name.to_string(),
                color: outlook_category_color(value_text(&category, "color")).to_string(),
            })
        })
        .collect())
}

fn m365_master_category_from_value(value: &Value) -> Option<Microsoft365CalendarCategory> {
    let name = value_text(value, "displayName").trim();
    (!name.is_empty()).then(|| Microsoft365CalendarCategory {
        name: name.to_string(),
        color: outlook_category_color(value_text(value, "color")).to_string(),
    })
}

fn refresh_calendar_category_colors_in_db(
    conn: &rusqlite::Connection,
    categories: &[Microsoft365CalendarCategory],
    source_ids: Option<&[String]>,
) -> Result<Vec<crate::CalendarEvent>, String> {
    if source_ids.is_some_and(|ids| ids.is_empty()) {
        return Ok(Vec::new());
    }
    let colors: HashMap<_, _> = categories
        .iter()
        .map(|category| (category.name.trim().to_lowercase(), category.color.as_str()))
        .collect();
    let tx = conn
        .unchecked_transaction()
        .map_err(|error| error.to_string())?;
    crate::set_audit_source(&tx, "m365")?;
    let mut changed = Vec::new();
    for mut event in crate::read_calendar_events(&tx, false)? {
        if source_ids.is_some_and(|ids| {
            !ids.iter()
                .any(|source| linked_calendar_remote_id(&event, source).is_some())
        }) {
            continue;
        }
        let color = if event.category.trim().is_empty() {
            Some(&"blue")
        } else {
            colors.get(&event.category.trim().to_lowercase())
        };
        let Some(color) = color else {
            continue;
        };
        if event.color == *color {
            continue;
        }
        event.color = (*color).to_string();
        // Colour metadata must not advance the content timestamp or enqueue
        // an outgoing write that would undo the change just read from Teams.
        tx.execute("UPDATE calendar_events SET event_json = json_set(event_json, '$.color', ?1) WHERE id = ?2", params![color, event.id])
            .map_err(|error| error.to_string())?;
        changed.push(event);
    }
    crate::set_audit_source(&tx, "user")?;
    tx.commit().map_err(|error| error.to_string())?;
    Ok(changed)
}

fn apply_m365_category_color(value: &mut Value, colors: &HashMap<String, String>) {
    if value.get("categories").is_none() {
        return;
    }
    let category = value
        .get("categories")
        .and_then(Value::as_array)
        .and_then(|categories| categories.first())
        .and_then(Value::as_str)
        .unwrap_or("")
        .trim()
        .to_lowercase();
    let color = if category.is_empty() {
        "blue"
    } else {
        colors.get(&category).map(String::as_str).unwrap_or("gray")
    };
    if let Some(object) = value.as_object_mut() {
        object.insert(
            "_dmhCategoryColor".to_string(),
            Value::String(color.to_string()),
        );
    }
}

fn remote_event_to_local(
    value: &Value,
    source: &Microsoft365SyncSource,
    existing: Option<&crate::CalendarEvent>,
) -> crate::CalendarEvent {
    let remote_id = value_text(value, "id");
    let category = if value.get("categories").is_some() {
        value
            .get("categories")
            .and_then(Value::as_array)
            .and_then(|categories| categories.first())
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string()
    } else {
        existing
            .map(|event| event.category.clone())
            .unwrap_or_default()
    };
    let imported_color = value_text(value, "_dmhCategoryColor");
    crate::CalendarEvent {
        calendar_source_id: Some(source.id.clone()),
        id: existing
            .filter(|event| linked_calendar_remote_id(event, &source.id).is_some())
            .map(|event| event.id.clone())
            .unwrap_or_else(|| format!("m365:{}:{remote_id}", source.id)),
        updated_at: value
            .get("lastModifiedDateTime")
            .and_then(Value::as_str)
            .map(ToOwned::to_owned)
            .or_else(|| existing.map(|event| event.updated_at.clone()))
            .unwrap_or_default(),
        title: if value_text(value, "subject").trim().is_empty() {
            existing
                .map(|event| event.title.clone())
                .unwrap_or_default()
        } else {
            value_text(value, "subject").to_string()
        },
        starts_at: value
            .get("start")
            .and_then(|part| part.get("dateTime"))
            .and_then(Value::as_str)
            .map(ToOwned::to_owned)
            .or_else(|| existing.map(|event| event.starts_at.clone()))
            .unwrap_or_default(),
        ends_at: value
            .get("end")
            .and_then(|part| part.get("dateTime"))
            .and_then(Value::as_str)
            .map(ToOwned::to_owned)
            .or_else(|| existing.map(|event| event.ends_at.clone()))
            .unwrap_or_default(),
        is_all_day: value
            .get("isAllDay")
            .and_then(Value::as_bool)
            .or_else(|| existing.map(|event| event.is_all_day))
            .unwrap_or(false),
        location: if value.get("location").is_some() {
            value
                .get("location")
                .and_then(|location| location.get("displayName"))
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string()
        } else {
            existing
                .map(|event| event.location.clone())
                .unwrap_or_default()
        },
        description: if value.get("body").is_some() || value.get("bodyPreview").is_some() {
            remote_event_description(value)
        } else {
            existing
                .map(|event| event.description.clone())
                .unwrap_or_default()
        },
        color: if imported_color.is_empty() {
            existing
                .map(|event| event.color.clone())
                .unwrap_or_else(|| "blue".to_string())
        } else {
            imported_color.to_string()
        },
        category,
        source: format!("Microsoft 365 · {}", source.name),
        recurrence: if matches!(value_text(value, "type"), "occurrence" | "exception") {
            None
        } else if value.get("recurrence").is_some() {
            event_sync::recurrence_from_graph(&value["recurrence"])
        } else {
            existing.and_then(|event| event.recurrence.clone())
        },
        excluded_dates: value
            .get("_dmhExcludedDates")
            .and_then(Value::as_array)
            .map(|dates| {
                dates
                    .iter()
                    .filter_map(Value::as_str)
                    .map(str::to_string)
                    .collect()
            })
            .unwrap_or_else(|| {
                existing
                    .map(|event| event.excluded_dates.clone())
                    .unwrap_or_default()
            }),
        deleted_at: None,
        recurrence_master_id: value
            .get("seriesMasterId")
            .and_then(Value::as_str)
            .map(|id| format!("m365:{}:{id}", source.id))
            .or_else(|| existing.and_then(|event| event.recurrence_master_id.clone())),
        recurrence_id: event_sync::original_occurrence_date(value)
            .or_else(|| existing.and_then(|event| event.recurrence_id.clone())),
        meeting: crate::CalendarMeetingOptions {
            required_attendees: if value.get("attendees").is_some() {
                remote_event_attendees(value, "required")
            } else {
                existing
                    .map(|event| event.meeting.required_attendees.clone())
                    .unwrap_or_default()
            },
            optional_attendees: if value.get("attendees").is_some() {
                remote_event_attendees(value, "optional")
            } else {
                existing
                    .map(|event| event.meeting.optional_attendees.clone())
                    .unwrap_or_default()
            },
            show_as: {
                let show_as = value_text(value, "showAs");
                if show_as.is_empty() {
                    existing
                        .map(|event| event.meeting.show_as.clone())
                        .unwrap_or_else(|| "busy".to_string())
                } else {
                    show_as.to_string()
                }
            },
            reminder_minutes: if value.get("isReminderOn").and_then(Value::as_bool) == Some(false) {
                None
            } else if value.get("reminderMinutesBeforeStart").is_none()
                && value.get("isReminderOn").is_none()
            {
                existing.and_then(|event| event.meeting.reminder_minutes)
            } else {
                value
                    .get("reminderMinutesBeforeStart")
                    .and_then(Value::as_i64)
            },
            is_private: if value.get("sensitivity").is_some() {
                value_text(value, "sensitivity").eq_ignore_ascii_case("private")
            } else {
                existing.is_some_and(|event| event.meeting.is_private)
            },
            is_online_meeting: value
                .get("isOnlineMeeting")
                .and_then(Value::as_bool)
                .unwrap_or(false)
                || value
                    .get("onlineMeeting")
                    .and_then(|meeting| meeting.get("joinUrl"))
                    .and_then(Value::as_str)
                    .is_some()
                || (value.get("isOnlineMeeting").is_none()
                    && value.get("onlineMeeting").is_none()
                    && value.get("onlineMeetingUrl").is_none()
                    && existing.is_some_and(|event| event.meeting.is_online_meeting)),
            online_meeting_url: value
                .get("onlineMeeting")
                .and_then(|meeting| meeting.get("joinUrl"))
                .and_then(Value::as_str)
                .or_else(|| value.get("onlineMeetingUrl").and_then(Value::as_str))
                .map(ToOwned::to_owned)
                .or_else(|| {
                    (value.get("onlineMeeting").is_none()
                        && value.get("onlineMeetingUrl").is_none())
                    .then(|| existing.map(|event| event.meeting.online_meeting_url.clone()))
                    .flatten()
                })
                .unwrap_or_default(),
        },
    }
}

fn event_summary(event: &crate::CalendarEvent) -> String {
    [
        event.title.trim(),
        event.starts_at.trim(),
        event.location.trim(),
    ]
    .into_iter()
    .filter(|part| !part.is_empty())
    .collect::<Vec<_>>()
    .join(" · ")
}

fn remote_event_summary(value: &Value) -> String {
    let start = value
        .get("start")
        .and_then(|part| part.get("dateTime"))
        .and_then(Value::as_str)
        .unwrap_or("");
    let location = value
        .get("location")
        .and_then(|part| part.get("displayName"))
        .and_then(Value::as_str)
        .unwrap_or("");
    [value_text(value, "subject"), start, location]
        .into_iter()
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join(" · ")
}

fn event_equivalent(
    local: &crate::CalendarEvent,
    remote: &Value,
    source: &Microsoft365SyncSource,
) -> bool {
    let remote_local = remote_event_to_local(remote, source, Some(local));
    local.title.trim() == remote_local.title.trim()
        && normalized_calendar_start(&local.starts_at)
            == normalized_calendar_start(&remote_local.starts_at)
        && normalized_calendar_start(&local.ends_at)
            == normalized_calendar_start(&remote_local.ends_at)
        && local.is_all_day == remote_local.is_all_day
        && local.location.trim() == remote_local.location.trim()
        && local.description.trim() == remote_local.description.trim()
        && local.category.trim() == remote_local.category.trim()
        && local.color.trim() == remote_local.color.trim()
        && local.meeting.required_attendees == remote_local.meeting.required_attendees
        && local.meeting.optional_attendees == remote_local.meeting.optional_attendees
        && local.meeting.show_as == remote_local.meeting.show_as
        && local.meeting.reminder_minutes == remote_local.meeting.reminder_minutes
        && local.meeting.is_private == remote_local.meeting.is_private
        && local.meeting.is_online_meeting == remote_local.meeting.is_online_meeting
        && event_sync::recurrence_to_graph(local) == event_sync::recurrence_to_graph(&remote_local)
        && local.excluded_dates == remote_local.excluded_dates
        && local.recurrence_master_id == remote_local.recurrence_master_id
}

fn merge_event(
    local: &crate::CalendarEvent,
    remote: &Value,
    source: &Microsoft365SyncSource,
) -> crate::CalendarEvent {
    let remote_local = remote_event_to_local(remote, source, Some(local));
    let mut merged = local.clone();
    if merged.title.trim().is_empty() {
        merged.title = remote_local.title;
    }
    if merged.starts_at.trim().is_empty() {
        merged.starts_at = remote_local.starts_at;
    }
    if merged.ends_at.trim().is_empty() {
        merged.ends_at = remote_local.ends_at;
    }
    merged.is_all_day = remote_local.is_all_day;
    if merged.location.trim().is_empty() {
        merged.location = remote_local.location;
    }
    if merged.category.trim().is_empty() {
        merged.category = remote_local.category;
    }
    if !value_text(remote, "_dmhCategoryColor").is_empty() {
        merged.color = remote_local.color;
    }
    if merged.description.trim().is_empty() {
        merged.description = remote_local.description;
    } else if !remote_local.description.trim().is_empty()
        && merged.description.trim() != remote_local.description.trim()
    {
        merged.description = format!(
            "{}\n\n--- Microsoft 365 ---\n{}",
            merged.description.trim(),
            remote_local.description.trim()
        );
    }
    merged.meeting = remote_local.meeting;
    if merged.recurrence.is_none() {
        merged.recurrence = remote_local.recurrence;
    }
    merged.excluded_dates.extend(remote_local.excluded_dates);
    merged.excluded_dates.sort();
    merged.excluded_dates.dedup();
    if merged.recurrence_master_id.is_none() {
        merged.recurrence_master_id = remote_local.recurrence_master_id;
    }
    if merged.recurrence_id.is_none() {
        merged.recurrence_id = remote_local.recurrence_id;
    }
    merged
}

fn normalized_event_for_graph(event: &crate::CalendarEvent) -> crate::CalendarEvent {
    let mut normalized = event.clone();
    let start = normalized.starts_at.trim().to_string();
    let end = normalized.ends_at.trim().to_string();
    if !start.is_empty() && !end.is_empty() && end < start {
        // Microsoft Graph rejects an end before the start. Preserve the
        // original duration and metadata by placing the two values in order.
        normalized.starts_at = end;
        normalized.ends_at = start;
    }
    normalized
}

fn graph_event_payload(event: &crate::CalendarEvent) -> Value {
    let event = normalized_event_for_graph(event);
    let categories = graph_category_values(&graph_category_for_event(&event));
    let attendees = event
        .meeting
        .required_attendees
        .iter()
        .map(|address| {
            json!({
                "emailAddress": {"address": address, "name": address}, "type": "required"
            })
        })
        .chain(event.meeting.optional_attendees.iter().map(|address| {
            json!({
                "emailAddress": {"address": address, "name": address}, "type": "optional"
            })
        }))
        .collect::<Vec<_>>();
    let mut payload = json!({
        "subject": event.title,
        "start": {"dateTime": event.starts_at, "timeZone": "W. Europe Standard Time"},
        "end": {"dateTime": event.ends_at, "timeZone": "W. Europe Standard Time"},
        "isAllDay": event.is_all_day,
        "location": {"displayName": event.location},
        "body": {"contentType": "text", "content": html_to_plain_text(&event.description)},
        "categories": categories,
        "recurrence": event_sync::recurrence_to_graph(&event),
        "attendees": attendees,
        "showAs": event.meeting.show_as,
        "isReminderOn": event.meeting.reminder_minutes.is_some(),
        "reminderMinutesBeforeStart": event.meeting.reminder_minutes.unwrap_or(15),
        "sensitivity": if event.meeting.is_private { "private" } else { "normal" }
    });
    payload["transactionId"] = json!(event.id);
    if event.meeting.is_online_meeting {
        payload["isOnlineMeeting"] = Value::Bool(true);
        payload["onlineMeetingProvider"] = Value::String("teamsForBusiness".to_string());
    }
    payload
}

fn graph_event_payload_for_master(
    event: &crate::CalendarEvent,
    names: &HashMap<String, String>,
) -> Value {
    let mut payload = graph_event_payload(event);
    payload["categories"] = json!(graph_category_values(&master_category_for_event(
        event, names
    )));
    payload
}

fn operation_id(kind: &str, source_id: &str, local_id: &str, remote_id: &str) -> String {
    format!("{kind}|{source_id}|{local_id}|{remote_id}")
}

fn source_direction(request: &Microsoft365SyncPreviewRequest, source_id: &str) -> String {
    request
        .source_directions
        .get(source_id)
        .cloned()
        .unwrap_or_else(|| request.direction.clone())
}

fn should_defer_inbound_contact(
    direction: &str,
    has_export_target: bool,
    has_pending_local_write: bool,
) -> bool {
    direction == "import" && has_export_target && has_pending_local_write
}

fn calendar_source_is_enabled(
    request: &Microsoft365SyncPreviewRequest,
    selected: &HashSet<&str>,
    source: &Microsoft365SyncSource,
) -> bool {
    selected.contains(source.id.as_str())
        && (!source.shared
            || if source.mailbox.is_some() {
                request.shared_mailboxes
            } else {
                request.shared_calendars
            })
}

fn calendar_export_target_id<'a>(
    request: &Microsoft365SyncPreviewRequest,
    sources: &'a [Microsoft365SyncSource],
    selected: &HashSet<&str>,
) -> Option<&'a str> {
    request.selected_calendar_source_ids.iter().find_map(|id| {
        sources
            .iter()
            .find(|source| {
                source.id.as_str() == id.as_str()
                    && source.editable
                    && calendar_source_is_enabled(request, selected, source)
                    && source_direction(request, &source.id) != "import"
            })
            .map(|source| source.id.as_str())
    })
}

fn linked_calendar_source_id<'a>(
    event: &crate::CalendarEvent,
    sources: &'a [Microsoft365SyncSource],
) -> Option<&'a str> {
    sources
        .iter()
        .find(|source| linked_calendar_remote_id(event, &source.id).is_some())
        .map(|source| source.id.as_str())
}

fn local_event_belongs_to_calendar_source(
    event: &crate::CalendarEvent,
    source: &Microsoft365SyncSource,
    sources: &[Microsoft365SyncSource],
    export_target_id: Option<&str>,
) -> bool {
    match linked_calendar_source_id(event, sources) {
        Some(linked)
            if event
                .calendar_source_id
                .as_deref()
                .is_some_and(|target| target != linked) =>
        {
            false
        }
        _ if event.calendar_source_id.is_some() => {
            event.calendar_source_id.as_deref() == Some(source.id.as_str())
        }
        Some(linked_source_id) => linked_source_id == source.id,
        None => export_target_id == Some(source.id.as_str()),
    }
}

fn source_group_id(backup: &crate::BackupData, source: &Microsoft365SyncSource) -> Option<i64> {
    if source.shared || source.id == "me:default-contacts" {
        return None;
    }
    backup
        .groups
        .iter()
        .find(|group| {
            group.deleted_at.is_none() && group.name.trim().eq_ignore_ascii_case(source.name.trim())
        })
        .and_then(|group| group.id)
}

fn contact_source_selected(
    request: &Microsoft365SyncPreviewRequest,
    selected: &HashSet<&str>,
    source: &Microsoft365SyncSource,
) -> bool {
    selected.contains(source.id.as_str())
        || (request.contact_groups && source_group_id(&request.backup, source).is_some())
}

fn local_contacts_for_source(
    contacts: &[crate::Contact],
    request: &Microsoft365SyncPreviewRequest,
    source: &Microsoft365SyncSource,
) -> Vec<crate::Contact> {
    if !request.contact_groups || source.shared {
        return contacts.to_vec();
    }
    if source.id == "me:default-contacts" {
        return contacts
            .iter()
            .filter(|contact| contact.groups.is_empty())
            .cloned()
            .collect();
    }
    let Some(group_id) = source_group_id(&request.backup, source) else {
        return Vec::new();
    };
    contacts
        .iter()
        .filter(|contact| {
            contact
                .groups
                .iter()
                .any(|group| group.id == Some(group_id))
        })
        .cloned()
        .collect()
}

fn load_contact_links(
    app: &AppHandle,
    source_id: &str,
) -> Result<(HashMap<i64, String>, HashMap<String, i64>), String> {
    let conn = open_db(app)?;
    let mut statement = conn
        .prepare("SELECT local_contact_id, remote_id FROM m365_contact_links WHERE source_id = ?")
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map(params![source_id], |row| {
            Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?))
        })
        .map_err(|error| error.to_string())?;
    let mut by_local = HashMap::new();
    let mut by_remote = HashMap::new();
    for row in rows {
        let (local_id, remote_id) = row.map_err(|error| error.to_string())?;
        by_remote.insert(remote_id.clone(), local_id);
        by_local.insert(local_id, remote_id);
    }
    Ok((by_local, by_remote))
}

fn save_contact_link(
    app: &AppHandle,
    local_contact_id: i64,
    source_id: &str,
    remote_id: &str,
) -> Result<(), String> {
    let conn = open_db(app)?;
    conn.execute(
        "INSERT INTO m365_contact_links (local_contact_id, source_id, remote_id, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(local_contact_id, source_id) DO UPDATE SET
           remote_id = excluded.remote_id, updated_at = excluded.updated_at",
        params![
            local_contact_id,
            source_id,
            remote_id,
            Utc::now().to_rfc3339()
        ],
    )
    .map_err(|error| error.to_string())?;
    Ok(())
}

fn delete_contact_link(
    app: &AppHandle,
    local_contact_id: i64,
    source_id: &str,
) -> Result<(), String> {
    let conn = open_db(app)?;
    conn.execute(
        "DELETE FROM m365_contact_links WHERE local_contact_id = ? AND source_id = ?",
        params![local_contact_id, source_id],
    )
    .map_err(|error| error.to_string())?;
    Ok(())
}

fn remove_contact_from_group(
    app: &AppHandle,
    local_contact_id: i64,
    group_id: i64,
) -> Result<(), String> {
    let conn = open_db(app)?;
    conn.execute(
        "DELETE FROM contact_groups WHERE contact_id = ? AND group_id = ?",
        params![local_contact_id, group_id],
    )
    .map_err(|error| error.to_string())?;
    Ok(())
}

fn local_changed_after_remote(local_updated_at: &str, remote: &Value) -> bool {
    let remote_updated_at = value_text(remote, "lastModifiedDateTime");
    match (
        chrono::DateTime::parse_from_rfc3339(local_updated_at),
        chrono::DateTime::parse_from_rfc3339(remote_updated_at),
    ) {
        (Ok(local), Ok(remote)) => local > remote,
        _ => !local_updated_at.trim().is_empty() && local_updated_at > remote_updated_at,
    }
}

async fn ensure_contact_group_folders(
    access_token: &str,
    backup: &crate::BackupData,
) -> Result<(), String> {
    let folders = graph_collection(
        access_token,
        "https://graph.microsoft.com/v1.0/me/contactFolders?$select=id,displayName&$top=100",
    )
    .await?;
    let existing: HashSet<String> = folders
        .iter()
        .map(|folder| value_text(folder, "displayName").trim().to_lowercase())
        .collect();
    for group in backup
        .groups
        .iter()
        .filter(|group| group.deleted_at.is_none())
    {
        let name = group.name.trim();
        if name.is_empty() || existing.contains(&name.to_lowercase()) {
            continue;
        }
        graph_write(
            access_token,
            reqwest::Method::POST,
            "https://graph.microsoft.com/v1.0/me/contactFolders",
            &json!({ "displayName": name }),
        )
        .await?;
    }
    Ok(())
}

#[derive(Clone)]
enum PlannedPayload {
    Contact {
        local: Option<crate::Contact>,
        remote: Option<Value>,
    },
    Calendar {
        local: Option<crate::CalendarEvent>,
        remote: Option<Value>,
    },
}

#[derive(Clone)]
struct PlannedOperation {
    change: Microsoft365SyncChange,
    source: Microsoft365SyncSource,
    payload: PlannedPayload,
}

struct Microsoft365SyncPlan {
    preview: Microsoft365SyncPreview,
    operations: Vec<PlannedOperation>,
    delta_operation_acks: HashMap<String, (String, String)>,
    delta_noop_acks: Vec<(String, String)>,
    source_errors: Vec<String>,
    calendar_categories: Vec<Microsoft365CalendarCategory>,
    category_import_source_ids: Vec<String>,
}

const MAX_CONTACT_OPERATIONS_PER_SYNC: usize = 250;
const MAX_CALENDAR_OPERATIONS_PER_SYNC: usize = CALENDAR_DELTA_BATCH_SIZE;

fn operation_limit(operation: &PlannedOperation) -> usize {
    match operation.change.kind.as_str() {
        "Kalender" => MAX_CALENDAR_OPERATIONS_PER_SYNC,
        _ => MAX_CONTACT_OPERATIONS_PER_SYNC,
    }
}

fn operation_priority(operation: &PlannedOperation) -> u8 {
    match operation.change.action.as_str() {
        // Writes from the app must not wait behind a large first import. This
        // makes a newly created appointment reach Exchange on the next run.
        "createRemote" | "updateRemote" | "deleteRemote" => 3,
        "createLocal" | "updateLocal" | "deleteLocal" => 2,
        "link" => 1,
        _ => 0,
    }
}

fn push_operation(operations: &mut Vec<PlannedOperation>, operation: PlannedOperation) {
    let kind = operation.change.kind.as_str();
    let limit = operation_limit(&operation);
    let matching_count = operations
        .iter()
        .filter(|candidate| candidate.change.kind == kind)
        .count();
    if matching_count < limit {
        operations.push(operation);
        return;
    }

    // Keep the batch bounded for large mailboxes, but allow a real write to
    // replace a harmless link/conflict that was planned earlier in the pass.
    let new_priority = operation_priority(&operation);
    let replacement = operations
        .iter()
        .enumerate()
        .filter(|(_, candidate)| candidate.change.kind == kind)
        .min_by_key(|(_, candidate)| operation_priority(candidate));
    if let Some((index, candidate)) = replacement {
        if new_priority > operation_priority(candidate) {
            operations[index] = operation;
        }
    }
}

fn prioritize_operations(operations: &mut [PlannedOperation]) {
    // A calendar change is normally the interaction the user has just made.
    // Execute it before any long contact-import backlog so it reaches Exchange
    // within the same automatic cycle.
    operations.sort_by(|left, right| {
        operation_priority(right)
            .cmp(&operation_priority(left))
            .then_with(|| {
                let left_is_calendar = usize::from(left.change.kind == "Kalender");
                let right_is_calendar = usize::from(right.change.kind == "Kalender");
                right_is_calendar.cmp(&left_is_calendar)
            })
    });
}

async fn build_m365_sync_plan(
    app: &AppHandle,
    access_token: &str,
    request: &Microsoft365SyncPreviewRequest,
    allow_partial_sources: bool,
) -> Result<Microsoft365SyncPlan, String> {
    if request.calendars {
        category_management::ensure_no_pending_operation(app)?;
        calendar_transfer::ensure_no_pending_transfer(app)?;
    }
    let sources = list_m365_sync_sources_filtered(
        app.clone(),
        Some(request.shared_mailbox_addresses.clone()),
        request.contacts,
        request.calendars,
    )
    .await?;
    let selected_contacts: HashSet<&str> = request
        .selected_contact_source_ids
        .iter()
        .map(String::as_str)
        .collect();
    let selected_calendars: HashSet<&str> = request
        .selected_calendar_source_ids
        .iter()
        .map(String::as_str)
        .collect();
    let mut source_errors = Vec::new();
    if request.calendars {
        let missing = request
            .selected_calendar_source_ids
            .iter()
            .filter(|id| !sources.calendars.iter().any(|source| &source.id == *id))
            .count();
        if missing > 0 {
            let message = format!(
                "{missing} ausgewählte Microsoft-365-Kalender sind momentan nicht erreichbar. Kalenderauswahl oder Exchange-Verbindung prüfen."
            );
            if !allow_partial_sources {
                return Err(message);
            }
            source_errors.push(message);
        }
    }
    let has_contact_export_target = request.contacts
        && sources.contacts.iter().any(|source| {
            contact_source_selected(request, &selected_contacts, source)
                && source.editable
                && (!source.shared || request.shared_mailboxes)
                && source_direction(request, &source.id) != "import"
        });
    let local_contacts: Vec<crate::Contact> = request
        .backup
        .contacts
        .iter()
        .filter(|contact| contact.deleted_at.is_none())
        .cloned()
        .collect();
    let pending_contact_ids = crate::pending_contact_sync_ids(app)?;
    let local_contacts_by_key: HashMap<String, &crate::Contact> = local_contacts
        .iter()
        .map(|contact| (local_contact_key(contact), contact))
        .collect();
    let mut local_events = crate::read_calendar_events(&crate::open_db(app)?, false)?;
    // A first import can contain tens of thousands of historical entries. A
    // newly saved appointment has to be considered before that backlog.
    local_events.sort_by(|left, right| {
        right
            .updated_at
            .cmp(&left.updated_at)
            .then_with(|| right.starts_at.cmp(&left.starts_at))
    });
    let mut deleted_local_events = crate::read_calendar_events(&crate::open_db(app)?, true)?;
    deleted_local_events.sort_by(|left, right| right.updated_at.cmp(&left.updated_at));
    let mut operations = Vec::new();
    let mut pending_delta_ids = HashMap::<String, HashSet<String>>::new();
    let mut delta_noop_acks = Vec::<(String, String)>::new();
    let mut remote_contacts = 0usize;
    let mut remote_events = 0usize;
    let calendar_export_target_id =
        calendar_export_target_id(request, &sources.calendars, &selected_calendars);
    let duplicate_calendar_event_ids =
        if should_plan_calendar_duplicate_cleanup(request, &sources.calendars, &selected_calendars)
        {
            duplicate_calendar_event_ids(
                &local_events,
                &sources.calendars,
                calendar_export_target_id,
            )
        } else {
            HashSet::new()
        };
    let pending_calendar_content_ids = if request.calendars {
        crate::pending_calendar_content_sync_ids(app)?
    } else {
        HashSet::new()
    };
    let calendar_categories = if request.calendars {
        let categories = m365_master_categories(access_token).await?;
        category_management::reconcile_recreated_categories(app, &categories)?;
        categories
    } else {
        Vec::new()
    };
    let master_category_colors = calendar_categories
        .iter()
        .map(|category| (category.name.to_lowercase(), category.color.clone()))
        .collect();
    let category_import_source_ids = sources
        .calendars
        .iter()
        .filter(|source| {
            calendar_source_is_enabled(request, &selected_calendars, source)
                && source_direction(request, &source.id) != "export"
        })
        .map(|source| source.id.clone())
        .collect();

    if request.contacts {
        for source in sources.contacts.iter().filter(|source| {
            contact_source_selected(request, &selected_contacts, source)
                && (!source.shared || request.shared_mailboxes)
        }) {
            let direction = source_direction(request, &source.id);
            let url = format!("{}?$select=id,givenName,surname,displayName,emailAddresses,businessPhones,mobilePhone,homePhones,companyName,businessAddress,personalNotes,lastModifiedDateTime&$top=100", source.resource_path);
            let values = graph_collection(access_token, &url).await?;
            remote_contacts += values.len();
            let remote_by_key: HashMap<String, &Value> = values
                .iter()
                .map(|value| (normalized_contact_key(value), value))
                .collect();
            let remote_by_id: HashMap<String, &Value> = values
                .iter()
                .map(|value| (value_text(value, "id").to_string(), value))
                .collect();
            let source_contacts = local_contacts_for_source(&local_contacts, request, source);
            let source_contact_ids: HashSet<i64> = source_contacts
                .iter()
                .filter_map(|contact| contact.id)
                .collect();
            let local_keys: HashSet<String> =
                source_contacts.iter().map(local_contact_key).collect();
            let (links_by_local, links_by_remote) = load_contact_links(app, &source.id)?;
            let mut matched_remote_ids = HashSet::new();

            for local in &source_contacts {
                let local_id = local.id.unwrap_or_default();
                // A failed or not-yet-confirmed local write owns this contact
                // until the durable outbox succeeds.  An inbound pass must not
                // overwrite it and silently discard the pending change.
                if should_defer_inbound_contact(
                    &direction,
                    has_contact_export_target,
                    pending_contact_ids.contains(&local_id),
                ) {
                    continue;
                }
                let linked_remote_id = links_by_local.get(&local_id);
                let linked_remote = links_by_local
                    .get(&local_id)
                    .and_then(|remote_id| remote_by_id.get(remote_id).copied());
                let remote =
                    linked_remote.or_else(|| remote_by_key.get(&local_contact_key(local)).copied());
                if let Some(remote) = remote {
                    let remote_id = value_text(remote, "id");
                    matched_remote_ids.insert(remote_id.to_string());
                    let equivalent = contact_equivalent(local, remote);
                    let is_linked =
                        linked_remote_id.is_some_and(|linked_id| linked_id == remote_id);
                    if equivalent && is_linked {
                        continue;
                    }
                    // During the first synchronization an equal contact must only be
                    // linked. Writing either copy here was the source of duplicate
                    // contacts after a previous manual import.
                    let action = if equivalent {
                        "link"
                    } else if !is_linked {
                        // A matching identity with different data is ambiguous until a
                        // user/EDV decision is made. Preserve both copies unchanged.
                        "conflict"
                    } else {
                        match direction.as_str() {
                            "export" => "updateRemote",
                            "import" => "updateLocal",
                            _ if local_changed_after_remote(&local.updated_at, remote) => {
                                "updateRemote"
                            }
                            _ => "updateLocal",
                        }
                    };
                    push_operation(
                        &mut operations,
                        PlannedOperation {
                            change: Microsoft365SyncChange {
                                id: operation_id(
                                    "contact",
                                    &source.id,
                                    &local_id.to_string(),
                                    remote_id,
                                ),
                                kind: "Kontakt".to_string(),
                                action: action.to_string(),
                                source_id: source.id.clone(),
                                source_name: source.name.clone(),
                                title: local.display_name.clone(),
                                detail: if equivalent {
                                    "Kontakt wird dauerhaft mit Microsoft 365 verknüpft."
                                        .to_string()
                                } else if action == "conflict" {
                                    "Gleiche Kontaktkennung, aber unterschiedliche Angaben. Beide Kopien bleiben unverändert."
                                        .to_string()
                                } else {
                                    "Neueste Änderung wird übernommen.".to_string()
                                },
                                local_summary: Some(contact_summary(local)),
                                remote_summary: Some(remote_contact_summary(remote)),
                            },
                            source: source.clone(),
                            payload: PlannedPayload::Contact {
                                local: Some(local.clone()),
                                remote: Some(remote.clone()),
                            },
                        },
                    );
                } else if links_by_local.contains_key(&local_id) && direction != "export" {
                    push_operation(
                        &mut operations,
                        PlannedOperation {
                            change: Microsoft365SyncChange {
                                id: operation_id(
                                    "contact",
                                    &source.id,
                                    &local_id.to_string(),
                                    "deleted",
                                ),
                                kind: "Kontakt".to_string(),
                                action: "deleteLocal".to_string(),
                                source_id: source.id.clone(),
                                source_name: source.name.clone(),
                                title: local.display_name.clone(),
                                detail: "In Microsoft 365 gelöscht → App-Papierkorb".to_string(),
                                local_summary: Some(contact_summary(local)),
                                remote_summary: None,
                            },
                            source: source.clone(),
                            payload: PlannedPayload::Contact {
                                local: Some(local.clone()),
                                remote: None,
                            },
                        },
                    );
                } else if direction != "import" {
                    push_operation(
                        &mut operations,
                        PlannedOperation {
                            change: Microsoft365SyncChange {
                                id: operation_id(
                                    "contact",
                                    &source.id,
                                    &local_id.to_string(),
                                    "new",
                                ),
                                kind: "Kontakt".to_string(),
                                action: "createRemote".to_string(),
                                source_id: source.id.clone(),
                                source_name: source.name.clone(),
                                title: local.display_name.clone(),
                                detail: format!("App → M365: {}", source.name),
                                local_summary: Some(contact_summary(local)),
                                remote_summary: None,
                            },
                            source: source.clone(),
                            payload: PlannedPayload::Contact {
                                local: Some(local.clone()),
                                remote: None,
                            },
                        },
                    );
                }
            }

            if direction != "import" {
                for local in local_contacts.iter().filter(|contact| {
                    contact.id.is_some_and(|id| {
                        links_by_local.contains_key(&id) && !source_contact_ids.contains(&id)
                    })
                }) {
                    let local_id = local.id.unwrap_or_default();
                    let Some(remote_id) = links_by_local.get(&local_id) else {
                        continue;
                    };
                    let Some(remote) = remote_by_id.get(remote_id).copied() else {
                        continue;
                    };
                    push_operation(
                        &mut operations,
                        PlannedOperation {
                            change: Microsoft365SyncChange {
                                id: operation_id(
                                    "contact",
                                    &source.id,
                                    &local_id.to_string(),
                                    remote_id,
                                ),
                                kind: "Kontakt".to_string(),
                                action: "deleteRemote".to_string(),
                                source_id: source.id.clone(),
                                source_name: source.name.clone(),
                                title: local.display_name.clone(),
                                detail: "Kontakt wurde aus diesem App-Ordner verschoben."
                                    .to_string(),
                                local_summary: Some(contact_summary(local)),
                                remote_summary: Some(remote_contact_summary(remote)),
                            },
                            source: source.clone(),
                            payload: PlannedPayload::Contact {
                                local: Some(local.clone()),
                                remote: Some(remote.clone()),
                            },
                        },
                    );
                }
            }

            for deleted in request
                .backup
                .contacts
                .iter()
                .filter(|contact| contact.deleted_at.is_some())
            {
                let Some(local_id) = deleted.id else {
                    continue;
                };
                let Some(remote_id) = links_by_local.get(&local_id) else {
                    continue;
                };
                let Some(remote) = remote_by_id.get(remote_id).copied() else {
                    continue;
                };
                if direction == "import" {
                    continue;
                }
                push_operation(
                    &mut operations,
                    PlannedOperation {
                        change: Microsoft365SyncChange {
                            id: operation_id(
                                "contact",
                                &source.id,
                                &local_id.to_string(),
                                remote_id,
                            ),
                            kind: "Kontakt".to_string(),
                            action: "deleteRemote".to_string(),
                            source_id: source.id.clone(),
                            source_name: source.name.clone(),
                            title: deleted.display_name.clone(),
                            detail: "App-Papierkorb → in Microsoft 365 löschen".to_string(),
                            local_summary: Some(contact_summary(deleted)),
                            remote_summary: Some(remote_contact_summary(remote)),
                        },
                        source: source.clone(),
                        payload: PlannedPayload::Contact {
                            local: Some(deleted.clone()),
                            remote: Some(remote.clone()),
                        },
                    },
                );
            }

            if direction != "export" {
                for remote in &values {
                    let remote_id = value_text(remote, "id");
                    if matched_remote_ids.contains(remote_id)
                        || links_by_remote.contains_key(remote_id)
                        || local_keys.contains(&normalized_contact_key(remote))
                    {
                        continue;
                    }
                    if let Some(local) = local_contacts_by_key.get(&normalized_contact_key(remote))
                    {
                        if request.contact_groups && direction != "import" {
                            push_operation(
                                &mut operations,
                                PlannedOperation {
                                    change: Microsoft365SyncChange {
                                        id: operation_id(
                                            "contact",
                                            &source.id,
                                            &local.id.unwrap_or_default().to_string(),
                                            remote_id,
                                        ),
                                        kind: "Kontakt".to_string(),
                                        action: "deleteRemote".to_string(),
                                        source_id: source.id.clone(),
                                        source_name: source.name.clone(),
                                        title: local.display_name.clone(),
                                        detail: "Kontakt gehört im App zu einem anderen Ordner."
                                            .to_string(),
                                        local_summary: Some(contact_summary(local)),
                                        remote_summary: Some(remote_contact_summary(remote)),
                                    },
                                    source: source.clone(),
                                    payload: PlannedPayload::Contact {
                                        local: Some((*local).clone()),
                                        remote: Some(remote.clone()),
                                    },
                                },
                            );
                        }
                        continue;
                    }
                    push_operation(
                        &mut operations,
                        PlannedOperation {
                            change: Microsoft365SyncChange {
                                id: operation_id("contact", &source.id, "new", remote_id),
                                kind: "Kontakt".to_string(),
                                action: "createLocal".to_string(),
                                source_id: source.id.clone(),
                                source_name: source.name.clone(),
                                title: value_text(remote, "displayName").to_string(),
                                detail: format!("M365 → App: {}", source.name),
                                local_summary: None,
                                remote_summary: Some(remote_contact_summary(remote)),
                            },
                            source: source.clone(),
                            payload: PlannedPayload::Contact {
                                local: None,
                                remote: Some(remote.clone()),
                            },
                        },
                    );
                }
            }
        }
    }

    if request.calendars {
        let local_cleanup_source = calendar_export_target_id
            .and_then(|target_id| {
                sources
                    .calendars
                    .iter()
                    .find(|source| source.id == target_id)
            })
            .or_else(|| {
                sources
                    .calendars
                    .iter()
                    .find(|source| calendar_source_is_enabled(request, &selected_calendars, source))
            });
        if let Some(cleanup_source) = local_cleanup_source {
            for local in local_events.iter().filter(|event| {
                duplicate_calendar_event_ids.contains(&event.id)
                    && linked_calendar_source_id(event, &sources.calendars).is_none()
            }) {
                push_operation(
                    &mut operations,
                    PlannedOperation {
                        change: Microsoft365SyncChange {
                            id: operation_id(
                                "calendar",
                                &cleanup_source.id,
                                &local.id,
                                "duplicate",
                            ),
                            kind: "Kalender".to_string(),
                            action: "deleteLocal".to_string(),
                            source_id: cleanup_source.id.clone(),
                            source_name: cleanup_source.name.clone(),
                            title: local.title.clone(),
                            detail: "Überzählige lokale Terminkopie entfernen; eine Kopie bleibt erhalten."
                                .to_string(),
                            local_summary: Some(event_summary(local)),
                            remote_summary: None,
                        },
                        source: cleanup_source.clone(),
                        payload: PlannedPayload::Calendar {
                            local: Some(local.clone()),
                            remote: None,
                        },
                    },
                );
            }
        }

        for source in sources
            .calendars
            .iter()
            .filter(|source| calendar_source_is_enabled(request, &selected_calendars, source))
        {
            let direction = source_direction(request, &source.id);
            let use_delta = direction == "import";
            let (mut values, removed_ids) = if use_delta {
                if let Err(error) = refresh_calendar_delta_queue(app, access_token, source).await {
                    if !allow_partial_sources {
                        return Err(error);
                    }
                    source_errors.push(format!("{}: {error}", source.name));
                    // Successfully checkpointed pages remain usable even when
                    // a later request fails. Never discard that import batch.
                }
                let batch = read_calendar_delta_batch(app, &source.id)?;
                let mut ids = batch.removed_ids.clone();
                ids.extend(
                    batch
                        .values
                        .iter()
                        .map(|value| value_text(value, "id").to_string())
                        .filter(|id| !id.is_empty()),
                );
                pending_delta_ids.insert(source.id.clone(), ids);
                (batch.values, batch.removed_ids)
            } else {
                let url = format!("{}/events?$select=id,subject,start,end,isAllDay,lastModifiedDateTime,location,body,categories,attendees,showAs,isReminderOn,reminderMinutesBeforeStart,sensitivity,isOnlineMeeting,onlineMeeting,onlineMeetingUrl,recurrence,type,seriesMasterId,originalStart,occurrenceId&$top=100", source.resource_path);
                let normalized = event_sync::normalize_series(
                    app,
                    access_token,
                    source,
                    graph_collection(access_token, &url).await?,
                )
                .await?;
                let removed = normalized
                    .iter()
                    .filter(|value| value.get("@removed").is_some())
                    .map(|value| value_text(value, "id").to_string())
                    .collect();
                (
                    normalized
                        .into_iter()
                        .filter(|value| value.get("@removed").is_none())
                        .collect(),
                    removed,
                )
            };
            category_management::apply_category_rules(app, &mut values)?;
            for value in &mut values {
                apply_m365_category_color(value, &master_category_colors);
            }
            remote_events += values.len() + removed_ids.len();
            let remote_by_key: HashMap<String, &Value> = values
                .iter()
                .map(|value| (remote_event_key(value), value))
                .collect();
            let remote_by_id: HashMap<String, &Value> = values
                .iter()
                .map(|value| (value_text(value, "id").to_string(), value))
                .collect();
            let local_keys: HashSet<String> = local_events.iter().map(local_event_key).collect();
            let mut matched_remote_ids = HashSet::new();
            let mut deferred_remote_ids = HashSet::new();

            for local in local_events.iter().filter(|event| {
                !use_delta
                    && duplicate_calendar_event_ids.contains(&event.id)
                    && linked_calendar_remote_id(event, &source.id).is_some()
            }) {
                let remote = linked_calendar_remote_id(local, &source.id)
                    .and_then(|remote_id| remote_by_id.get(remote_id).copied());
                let (action, remote_summary) = if let Some(remote) = remote {
                    if !source.editable {
                        continue;
                    }
                    ("deleteRemote", Some(remote_event_summary(remote)))
                } else {
                    ("deleteLocal", None)
                };
                push_operation(
                    &mut operations,
                    PlannedOperation {
                        change: Microsoft365SyncChange {
                            id: operation_id(
                                "calendar",
                                &source.id,
                                &local.id,
                                "duplicate",
                            ),
                            kind: "Kalender".to_string(),
                            action: action.to_string(),
                            source_id: source.id.clone(),
                            source_name: source.name.clone(),
                            title: local.title.clone(),
                            detail: "Überzählige Terminkopie in App und Exchange entfernen; eine Kopie bleibt erhalten."
                                .to_string(),
                            local_summary: Some(event_summary(local)),
                            remote_summary,
                        },
                        source: source.clone(),
                        payload: PlannedPayload::Calendar {
                            local: Some(local.clone()),
                            remote: remote.cloned(),
                        },
                    },
                );
            }

            for local in &local_events {
                if duplicate_calendar_event_ids.contains(&local.id) {
                    continue;
                }
                if !local_event_belongs_to_calendar_source(
                    local,
                    source,
                    &sources.calendars,
                    calendar_export_target_id,
                ) {
                    if pending_calendar_content_ids.contains(&local.id) {
                        if let Some(remote_id) = linked_calendar_remote_id(local, &source.id) {
                            deferred_remote_ids.insert(remote_id.to_string());
                        }
                    }
                    continue;
                }
                if use_delta && pending_calendar_content_ids.contains(&local.id) {
                    if let Some(remote_id) = linked_calendar_remote_id(local, &source.id) {
                        deferred_remote_ids.insert(remote_id.to_string());
                    }
                    continue;
                }
                let linked_id = linked_calendar_remote_id(local, &source.id);
                if use_delta
                    && !linked_id
                        .is_some_and(|id| remote_by_id.contains_key(id) || removed_ids.contains(id))
                    && !remote_by_key.contains_key(&local_event_key(local))
                {
                    continue;
                }
                let remote = linked_id
                    .and_then(|remote_id| remote_by_id.get(remote_id).copied())
                    .or_else(|| remote_by_key.get(&local_event_key(local)).copied());
                if let Some(remote) = remote {
                    let remote_id = value_text(remote, "id");
                    matched_remote_ids.insert(remote_id.to_string());
                    let equivalent = event_equivalent(local, remote, source);
                    if equivalent && linked_id.is_some() {
                        if use_delta {
                            delta_noop_acks.push((source.id.clone(), remote_id.to_string()));
                        }
                        continue;
                    }
                    // Equal appointments are linked without rewriting Exchange or the
                    // local record. This makes a prior Outlook/Teams import safe.
                    let action = if equivalent {
                        "link"
                    } else if linked_id.is_none() {
                        "conflict"
                    } else {
                        match direction.as_str() {
                            "export" => "updateRemote",
                            "import" => "updateLocal",
                            _ if local_changed_after_remote(&local.updated_at, remote) => {
                                "updateRemote"
                            }
                            _ => "updateLocal",
                        }
                    };
                    if action == "conflict" && use_delta {
                        // Preserve both records, but do not replay this same
                        // ambiguity forever. The manual full-sync preview can
                        // still show and resolve it explicitly.
                        delta_noop_acks.push((source.id.clone(), remote_id.to_string()));
                    }
                    push_operation(
                        &mut operations,
                        PlannedOperation {
                            change: Microsoft365SyncChange {
                                id: operation_id(
                                    "calendar",
                                    &source.id,
                                    &local.id,
                                    value_text(remote, "id"),
                                ),
                                kind: "Kalender".to_string(),
                                action: action.to_string(),
                                source_id: source.id.clone(),
                                source_name: source.name.clone(),
                                title: local.title.clone(),
                                detail: if equivalent {
                                    "Termin wird dauerhaft mit Microsoft 365 verknüpft.".to_string()
                                } else if action == "conflict" {
                                    "Gleicher Titel und Zeitpunkt, aber unterschiedliche Angaben. Beide Termine bleiben unverändert."
                                        .to_string()
                                } else {
                                    "Neueste Änderung wird übernommen.".to_string()
                                },
                                local_summary: Some(event_summary(local)),
                                remote_summary: Some(remote_event_summary(remote)),
                            },
                            source: source.clone(),
                            payload: PlannedPayload::Calendar {
                                local: Some(local.clone()),
                                remote: Some(remote.clone()),
                            },
                        },
                    );
                } else if linked_id.is_some()
                    && direction != "export"
                    && (!use_delta || linked_id.is_some_and(|id| removed_ids.contains(id)))
                {
                    push_operation(
                        &mut operations,
                        PlannedOperation {
                            change: Microsoft365SyncChange {
                                id: operation_id("calendar", &source.id, &local.id, "deleted"),
                                kind: "Kalender".to_string(),
                                action: "deleteLocal".to_string(),
                                source_id: source.id.clone(),
                                source_name: source.name.clone(),
                                title: local.title.clone(),
                                detail: "In Microsoft 365 gelöscht → App-Papierkorb".to_string(),
                                local_summary: Some(event_summary(local)),
                                remote_summary: None,
                            },
                            source: source.clone(),
                            payload: PlannedPayload::Calendar {
                                local: Some(local.clone()),
                                remote: None,
                            },
                        },
                    );
                } else if direction != "import" {
                    push_operation(
                        &mut operations,
                        PlannedOperation {
                            change: Microsoft365SyncChange {
                                id: operation_id("calendar", &source.id, &local.id, "new"),
                                kind: "Kalender".to_string(),
                                action: "createRemote".to_string(),
                                source_id: source.id.clone(),
                                source_name: source.name.clone(),
                                title: local.title.clone(),
                                detail: format!("App → M365: {}", source.name),
                                local_summary: Some(event_summary(local)),
                                remote_summary: None,
                            },
                            source: source.clone(),
                            payload: PlannedPayload::Calendar {
                                local: Some(local.clone()),
                                remote: None,
                            },
                        },
                    );
                }
            }

            for deleted in deleted_local_events.iter().cloned().filter(|_| !use_delta) {
                let Some(remote_id) = linked_calendar_remote_id(&deleted, &source.id) else {
                    continue;
                };
                let Some(remote) = remote_by_id.get(remote_id).copied() else {
                    continue;
                };
                if direction == "import" {
                    continue;
                }
                push_operation(
                    &mut operations,
                    PlannedOperation {
                        change: Microsoft365SyncChange {
                            id: operation_id("calendar", &source.id, &deleted.id, remote_id),
                            kind: "Kalender".to_string(),
                            action: "deleteRemote".to_string(),
                            source_id: source.id.clone(),
                            source_name: source.name.clone(),
                            title: deleted.title.clone(),
                            detail: "App-Papierkorb → in Microsoft 365 löschen".to_string(),
                            local_summary: Some(event_summary(&deleted)),
                            remote_summary: Some(remote_event_summary(remote)),
                        },
                        source: source.clone(),
                        payload: PlannedPayload::Calendar {
                            local: Some(deleted),
                            remote: Some(remote.clone()),
                        },
                    },
                );
            }
            if direction != "export" {
                for remote in &values {
                    if matched_remote_ids.contains(value_text(remote, "id"))
                        || deferred_remote_ids.contains(value_text(remote, "id"))
                        || local_keys.contains(&remote_event_key(remote))
                    {
                        continue;
                    }
                    push_operation(
                        &mut operations,
                        PlannedOperation {
                            change: Microsoft365SyncChange {
                                id: operation_id(
                                    "calendar",
                                    &source.id,
                                    "new",
                                    value_text(remote, "id"),
                                ),
                                kind: "Kalender".to_string(),
                                action: "createLocal".to_string(),
                                source_id: source.id.clone(),
                                source_name: source.name.clone(),
                                title: value_text(remote, "subject").to_string(),
                                detail: format!("M365 → App: {}", source.name),
                                local_summary: None,
                                remote_summary: Some(remote_event_summary(remote)),
                            },
                            source: source.clone(),
                            payload: PlannedPayload::Calendar {
                                local: None,
                                remote: Some(remote.clone()),
                            },
                        },
                    );
                }
            }
            if use_delta {
                for remote_id in &removed_ids {
                    let has_local_match = local_events.iter().any(|event| {
                        linked_calendar_remote_id(event, &source.id) == Some(remote_id.as_str())
                    });
                    if !has_local_match {
                        delta_noop_acks.push((source.id.clone(), remote_id.clone()));
                    }
                }
            }
        }
    }

    prioritize_operations(&mut operations);
    let mut delta_operation_acks = HashMap::new();
    for operation in &operations {
        let Some(pending_ids) = pending_delta_ids.get(&operation.source.id) else {
            continue;
        };
        let remote_id = match &operation.payload {
            PlannedPayload::Calendar {
                remote: Some(remote),
                ..
            } => Some(value_text(remote, "id")),
            PlannedPayload::Calendar {
                local: Some(local),
                remote: None,
            } => linked_calendar_remote_id(local, &operation.source.id),
            _ => None,
        };
        if let Some(remote_id) = remote_id.filter(|id| pending_ids.contains(*id)) {
            delta_operation_acks.insert(
                operation.change.id.clone(),
                (operation.source.id.clone(), remote_id.to_string()),
            );
        }
    }
    delta_noop_acks.retain(|(source_id, remote_id)| {
        pending_delta_ids
            .get(source_id)
            .is_some_and(|ids| ids.contains(remote_id))
    });
    delta_noop_acks.sort();
    delta_noop_acks.dedup();

    let create_in_m365 = operations
        .iter()
        .filter(|operation| {
            matches!(
                operation.change.action.as_str(),
                "createRemote" | "updateRemote" | "deleteRemote"
            )
        })
        .count();
    let import_to_app = operations
        .iter()
        .filter(|operation| {
            matches!(
                operation.change.action.as_str(),
                "createLocal" | "updateLocal" | "deleteLocal"
            )
        })
        .count();
    let conflicts = operations
        .iter()
        .filter(|operation| operation.change.action == "conflict")
        .count();
    Ok(Microsoft365SyncPlan {
        preview: Microsoft365SyncPreview {
            local_contacts: local_contacts.len(),
            remote_contacts,
            local_events: local_events.len(),
            remote_events,
            create_in_m365,
            import_to_app,
            conflicts,
            shared_sources_skipped: sources
                .calendars
                .iter()
                .filter(|source| source.shared && !selected_calendars.contains(source.id.as_str()))
                .count(),
            changes: operations
                .iter()
                .map(|operation| operation.change.clone())
                .collect(),
        },
        operations,
        delta_operation_acks,
        delta_noop_acks,
        source_errors,
        calendar_categories,
        category_import_source_ids,
    })
}

async fn graph_write(
    access_token: &str,
    method: reqwest::Method,
    url: &str,
    body: &Value,
) -> Result<Value, String> {
    if m365_read_only_test_mode() {
        return Err(
            "Der sichere M365-Testmodus sperrt jede Änderung an Microsoft 365.".to_string(),
        );
    }
    let mut last_network_error = None;
    let idempotent = method != reqwest::Method::POST;
    for attempt in 0..GRAPH_MAX_ATTEMPTS {
        let response = match http_client()
            .request(method.clone(), url)
            .timeout(GRAPH_REQUEST_TIMEOUT)
            .bearer_auth(access_token)
            .header("Prefer", "outlook.timezone=\"W. Europe Standard Time\"")
            .json(body)
            .send()
            .await
        {
            Ok(response) => response,
            Err(error) => {
                last_network_error = Some(error.to_string());
                if idempotent && attempt + 1 < GRAPH_MAX_ATTEMPTS {
                    tokio::time::sleep(Duration::from_secs(1u64 << attempt.min(5))).await;
                    continue;
                }
                break;
            }
        };
        let status = response.status();
        if method == reqwest::Method::DELETE && status == reqwest::StatusCode::NOT_FOUND {
            // A deletion already made in Teams is an idempotent success for
            // the local outbox, not a permanent retry failure.
            return Ok(Value::Null);
        }
        if status.is_success() {
            if status.as_u16() == 204 {
                return Ok(Value::Null);
            }
            return response
                .json::<Value>()
                .await
                .map_err(|_| "Microsoft Graph hat eine ungültige Antwort geliefert.".to_string());
        }
        if let Some(delay) = graph_retry_delay(status, response.headers(), attempt) {
            if (idempotent || status.as_u16() == 429) && attempt + 1 < GRAPH_MAX_ATTEMPTS {
                tokio::time::sleep(delay).await;
                continue;
            }
        }
        let detail = response.json::<Value>().await.ok().and_then(|value| {
            let code = value
                .pointer("/error/code")
                .and_then(Value::as_str)
                .unwrap_or("");
            let message = value
                .pointer("/error/message")
                .and_then(Value::as_str)
                .unwrap_or("");
            let safe = format!("{code}: {message}")
                .chars()
                .filter(|character| !character.is_control())
                .take(240)
                .collect::<String>();
            (!safe.trim_matches([':', ' ']).is_empty()).then_some(safe)
        });
        return Err(format!(
            "Microsoft Graph hat die Änderung abgelehnt (HTTP {}){}.",
            status.as_u16(),
            detail.map(|value| format!(", {value}")).unwrap_or_default()
        ));
    }
    Err(format!(
        "Microsoft Graph ist nach mehreren Versuchen nicht erreichbar{}.",
        last_network_error
            .map(|error| format!(" ({})", error.chars().take(160).collect::<String>()))
            .unwrap_or_default()
    ))
}

const CONTACT_OUTBOX_BATCH_SIZE: usize = 250;
const CALENDAR_OUTBOX_BATCH_SIZE: usize = 24;

fn contact_outbox_source_direction(request: &ContactOutboxSyncRequest, source_id: &str) -> String {
    request
        .source_directions
        .get(source_id)
        .cloned()
        .unwrap_or_else(|| request.direction.clone())
}

fn contact_outbox_source_is_available(
    request: &ContactOutboxSyncRequest,
    source: &Microsoft365SyncSource,
    active_group_names: &HashSet<String>,
) -> bool {
    (request
        .selected_contact_source_ids
        .iter()
        .any(|id| id == &source.id)
        || (request.contact_groups
            && active_group_names.contains(&source.name.trim().to_lowercase())))
        && source.editable
        && (!source.shared || request.shared_mailboxes)
        && contact_outbox_source_direction(request, &source.id) != "import"
}

fn contact_belongs_to_outbox_source(
    contact: &crate::Contact,
    request: &ContactOutboxSyncRequest,
    source: &Microsoft365SyncSource,
) -> bool {
    if !request.contact_groups || source.shared {
        return true;
    }
    if source.id == "me:default-contacts" {
        return contact.groups.is_empty();
    }
    contact.groups.iter().any(|group| {
        group.deleted_at.is_none() && group.name.trim().eq_ignore_ascii_case(source.name.trim())
    })
}

fn contact_identity_matches(local: &crate::Contact, remote: &Value) -> bool {
    let local_emails = [
        &local.email,
        &local.private_email,
        &local.second_private_email,
    ]
    .into_iter()
    .map(|email| email.trim().to_lowercase())
    .filter(|email| !email.is_empty())
    .collect::<Vec<_>>();
    let remote_emails = remote
        .get("emailAddresses")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|entry| entry.get("address").and_then(Value::as_str))
        .map(|email| email.trim().to_lowercase())
        .filter(|email| !email.is_empty())
        .collect::<Vec<_>>();
    if !local_emails.is_empty() && !remote_emails.is_empty() {
        return local_emails
            .iter()
            .any(|email| remote_emails.contains(email));
    }
    let local_name = if local.display_name.trim().is_empty() {
        format!("{} {}", local.first_name, local.last_name)
    } else {
        local.display_name.clone()
    };
    let remote_name = value_text(remote, "displayName");
    if local_name.trim().is_empty() || !local_name.trim().eq_ignore_ascii_case(remote_name.trim()) {
        return false;
    }
    let mut remote_phones = remote
        .get("businessPhones")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .map(crate::normalize_phone_for_match)
        .filter(|phone| !phone.is_empty())
        .collect::<Vec<_>>();
    let remote_mobile = crate::normalize_phone_for_match(value_text(remote, "mobilePhone"));
    if !remote_mobile.is_empty() && !remote_phones.contains(&remote_mobile) {
        remote_phones.push(remote_mobile);
    }
    for phone in remote
        .get("homePhones")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
    {
        let normalized = crate::normalize_phone_for_match(phone.as_str().unwrap_or(""));
        if !normalized.is_empty() && !remote_phones.contains(&normalized) {
            remote_phones.push(normalized);
        }
    }
    let local_phones = [
        &local.phone,
        &local.mobile_phone,
        &local.private_phone,
        &local.second_private_phone,
    ]
    .into_iter()
    .map(|phone| crate::normalize_phone_for_match(phone))
    .filter(|phone| !phone.is_empty())
    .collect::<Vec<_>>();
    local_phones.is_empty()
        || remote_phones.is_empty()
        || local_phones
            .iter()
            .any(|phone| remote_phones.contains(phone))
}

#[tauri::command]
pub async fn flush_m365_contact_outbox(
    app: AppHandle,
    request: ContactOutboxSyncRequest,
) -> Result<ContactOutboxSyncResult, String> {
    if m365_read_only_test_mode() {
        return Err("Der sichere M365-Testmodus sperrt ausgehende Änderungen.".to_string());
    }
    let state = app.state::<crate::AppState>();
    let _sync_guard = state.m365.contact_sync_gate.lock().await;
    let access_token = refreshed_access_token(&app).await?;
    let backup = crate::get_sync_backup_data(app.clone())?;
    if request.contact_groups {
        ensure_contact_group_folders(&access_token, &backup).await?;
    }
    let active_group_names = backup
        .groups
        .iter()
        .filter(|group| group.deleted_at.is_none())
        .map(|group| group.name.trim().to_lowercase())
        .collect::<HashSet<_>>();
    let sources = list_m365_sync_sources_filtered(
        app.clone(),
        Some(request.shared_mailbox_addresses.clone()),
        true,
        false,
    )
    .await?;
    let export_sources = sources
        .contacts
        .iter()
        .filter(|source| contact_outbox_source_is_available(&request, source, &active_group_names))
        .cloned()
        .collect::<Vec<_>>();

    if !export_sources.is_empty() && crate::contact_sync_outbox_count(&app)? == 0 {
        crate::enqueue_contacts_for_exchange(&app, CONTACT_OUTBOX_BATCH_SIZE)?;
    }
    let entries = crate::read_contact_sync_outbox(&app, CONTACT_OUTBOX_BATCH_SIZE)?;
    let mut result = ContactOutboxSyncResult {
        processed: 0,
        created: 0,
        updated: 0,
        deleted: 0,
        pending: entries.len(),
        errors: 0,
        error_messages: Vec::new(),
    };

    if export_sources.is_empty() {
        result.pending = crate::contact_sync_outbox_count(&app)?;
        return Ok(result);
    }

    let mut remote_contacts = HashMap::<String, Vec<Value>>::new();
    let mut links = HashMap::<String, HashMap<i64, String>>::new();
    for source in &export_sources {
        let url = format!(
            "{}?$select=id,givenName,surname,displayName,emailAddresses,businessPhones,mobilePhone,homePhones,companyName,businessAddress,personalNotes,lastModifiedDateTime&$top=100",
            source.resource_path
        );
        remote_contacts.insert(
            source.id.clone(),
            graph_collection(&access_token, &url).await?,
        );
        links.insert(source.id.clone(), load_contact_links(&app, &source.id)?.0);
    }

    for entry in entries {
        let contact = entry.contact;
        let contact_id = contact
            .id
            .ok_or_else(|| "Ausstehender Kontakt hat keine lokale ID.".to_string())?;
        let mut error_message = None;
        let mut merged_local: Option<crate::Contact> = None;

        for source in &export_sources {
            let linked_remote_id = links
                .get(&source.id)
                .and_then(|source_links| source_links.get(&contact_id))
                .cloned();
            let should_exist = entry.action != "delete"
                && contact.deleted_at.is_none()
                && contact_belongs_to_outbox_source(&contact, &request, source);

            let operation = if let Some(remote_id) = linked_remote_id {
                let url = format!(
                    "{}/{}",
                    source.resource_path,
                    encode_graph_path_segment(&remote_id)
                );
                if should_exist {
                    graph_write(
                        &access_token,
                        reqwest::Method::PATCH,
                        &url,
                        &graph_contact_payload(&contact),
                    )
                    .await
                    .map(|_| {
                        let _ = save_contact_link(&app, contact_id, &source.id, &remote_id);
                        result.updated += 1;
                    })
                } else {
                    graph_write(&access_token, reqwest::Method::DELETE, &url, &Value::Null)
                        .await
                        .and_then(|_| delete_contact_link(&app, contact_id, &source.id))
                        .map(|_| result.deleted += 1)
                }
            } else if should_exist {
                let matching_remote = remote_contacts
                    .get(&source.id)
                    .and_then(|values| {
                        values
                            .iter()
                            .find(|remote| contact_identity_matches(&contact, remote))
                    })
                    .cloned();
                if let Some(remote) = matching_remote {
                    let remote_id = value_text(&remote, "id").to_string();
                    let merged = merge_contact(&contact, &remote);
                    let write = if contact_equivalent(&merged, &remote) {
                        Ok(Value::Null)
                    } else {
                        let url = format!(
                            "{}/{}",
                            source.resource_path,
                            encode_graph_path_segment(&remote_id)
                        );
                        graph_write(
                            &access_token,
                            reqwest::Method::PATCH,
                            &url,
                            &graph_contact_payload(&merged),
                        )
                        .await
                    };
                    write.and_then(|_| {
                        save_contact_link(&app, contact_id, &source.id, &remote_id)?;
                        if !contact_equivalent(&contact, &remote) {
                            result.updated += 1;
                            merged_local = Some(merged);
                        }
                        Ok(())
                    })
                } else {
                    match graph_write(
                        &access_token,
                        reqwest::Method::POST,
                        &source.resource_path,
                        &graph_contact_payload(&contact),
                    )
                    .await
                    {
                        Ok(remote) => {
                            let remote_id = value_text(&remote, "id");
                            if remote_id.is_empty() {
                                Err("Microsoft 365 hat keine Kontakt-ID zurückgegeben.".to_string())
                            } else {
                                save_contact_link(&app, contact_id, &source.id, remote_id)?;
                                links
                                    .entry(source.id.clone())
                                    .or_default()
                                    .insert(contact_id, remote_id.to_string());
                                remote_contacts
                                    .entry(source.id.clone())
                                    .or_default()
                                    .push(remote);
                                result.created += 1;
                                Ok(())
                            }
                        }
                        Err(error) => Err(error),
                    }
                }
            } else {
                Ok(())
            };

            if let Err(error) = operation {
                error_message = Some(error);
                break;
            }
        }

        if let Some(error) = error_message {
            crate::record_contact_sync_outbox_error(&app, contact_id, &error)?;
            result.errors += 1;
            result
                .error_messages
                .push(format!("{}: {error}", contact.display_name));
        } else {
            if let Some(merged) = merged_local {
                crate::save_contact_from_m365(app.clone(), contact_input_from_contact(&merged))?;
            } else {
                crate::complete_contact_sync_outbox_entry(&app, contact_id)?;
            }
            result.processed += 1;
        }
    }

    result.pending = crate::contact_sync_outbox_count(&app)?;
    Ok(result)
}

fn outbox_source_direction(request: &CalendarOutboxSyncRequest, source_id: &str) -> String {
    request
        .source_directions
        .get(source_id)
        .cloned()
        .unwrap_or_else(|| request.direction.clone())
}

fn outbox_source_is_available(
    request: &CalendarOutboxSyncRequest,
    source: &Microsoft365SyncSource,
) -> bool {
    request
        .selected_calendar_source_ids
        .iter()
        .any(|id| id == &source.id)
        && source.editable
        && (!source.shared || request.shared_calendars)
}

fn calendar_outbox_lookup_window(starts_at: &str) -> Result<(String, String), String> {
    let date = starts_at
        .get(..10)
        .and_then(|value| chrono::NaiveDate::parse_from_str(value, "%Y-%m-%d").ok())
        .ok_or_else(|| "Der Kalendertermin hat kein gültiges Startdatum.".to_string())?;
    let start = date
        .checked_sub_signed(ChronoDuration::days(1))
        .ok_or_else(|| "Das Startdatum liegt außerhalb des unterstützten Bereichs.".to_string())?;
    let end = date
        .checked_add_signed(ChronoDuration::days(2))
        .ok_or_else(|| "Das Startdatum liegt außerhalb des unterstützten Bereichs.".to_string())?;
    // calendarView query bounds use UTC even when Prefer requests local times.
    // Cover the local day and its UTC offsets, then match the exact local start.
    Ok((format!("{start}T00:00:00Z"), format!("{end}T00:00:00Z")))
}

async fn find_matching_exchange_event_for_outbox(
    access_token: &str,
    source: &Microsoft365SyncSource,
    event: &crate::CalendarEvent,
) -> Result<Option<Value>, String> {
    let event = normalized_event_for_graph(event);
    let (start, end) = calendar_outbox_lookup_window(&event.starts_at)?;
    let start = encode_graph_path_segment(&start);
    let end = encode_graph_path_segment(&end);
    let fields = "id,subject,start,end,isAllDay,lastModifiedDateTime,location,body,categories,attendees,showAs,isReminderOn,reminderMinutesBeforeStart,sensitivity,isOnlineMeeting,onlineMeeting,onlineMeetingUrl,recurrence,type,seriesMasterId";
    let url = if event.recurrence.is_some() {
        format!("{}/events?$select={fields}&$top=100", source.resource_path)
    } else {
        format!(
            "{}/calendarView?startDateTime={start}&endDateTime={end}&$select={fields}&$top=50",
            source.resource_path
        )
    };
    let values = graph_collection(access_token, &url).await?;
    Ok(values.into_iter().find(|remote| {
        remote_event_key(remote) == local_event_key(&event)
            && event_sync::recurrence_to_graph(&remote_event_to_local(remote, source, None))
                == event_sync::recurrence_to_graph(&event)
            && (!matches!(value_text(remote, "type"), "occurrence" | "exception")
                || event.recurrence_master_id.is_some())
    }))
}

#[tauri::command]
pub async fn flush_m365_calendar_outbox(
    app: AppHandle,
    request: CalendarOutboxSyncRequest,
) -> Result<CalendarOutboxSyncResult, String> {
    if m365_read_only_test_mode() {
        return Err("Der sichere M365-Testmodus sperrt ausgehende Änderungen.".to_string());
    }
    // The runtime is owned by the application's shared state.  Looking it up
    // as a separately managed Tauri state panics at runtime because it is not
    // registered independently.  Keep the guard on the actual AppState so a
    // calendar write cannot overlap a manual sync.
    let state = app.state::<crate::AppState>();
    let _sync_guard = state.m365.calendar_sync_gate.lock().await;
    category_management::ensure_no_pending_operation(&app)?;
    let access_token = refreshed_access_token(&app).await?;
    let sources = list_m365_sync_sources_filtered(
        app.clone(),
        Some(request.shared_mailbox_addresses.clone()),
        false,
        true,
    )
    .await?;
    let has_export_target = sources.calendars.iter().any(|source| {
        outbox_source_is_available(&request, source)
            && outbox_source_direction(&request, &source.id) != "import"
    });
    for source in sources.calendars.iter().filter(|source| {
        outbox_source_is_available(&request, source)
            && outbox_source_direction(&request, &source.id) != "import"
    }) {
        ensure_calendar_default_blue(&access_token, source).await?;
    }
    // Upgrade existing appointments through the normal outbox in bounded,
    // cursor-based batches. An existing remote event receives only a category
    // PATCH, so this migration does not overwrite its other meeting fields.
    let (migration_key, cursor_key) = calendar_color_category_migration_keys(&app)?;
    let color_category_migration_complete =
        get_setting(&app, &migration_key)?.as_deref() == Some("complete");
    let outbox_count = crate::calendar_sync_outbox_count(&app)?;
    if has_export_target && !color_category_migration_complete && outbox_count == 0 {
        let cursor = get_setting(&app, &cursor_key)?.unwrap_or_default();
        if let Some(last_id) = crate::enqueue_active_calendar_events_for_exchange(
            &app,
            CALENDAR_OUTBOX_BATCH_SIZE,
            &cursor,
        )? {
            set_setting(&app, &cursor_key, &last_id)?;
        } else {
            set_setting(&app, &migration_key, "complete")?;
        }
    } else if has_export_target && crate::calendar_sync_outbox_count(&app)? == 0 {
        // Existing upgrade path: appointments created before the outbox existed
        // are fed through the same safe, duplicate-aware queue in small batches.
        crate::enqueue_unlinked_calendar_events_for_exchange(&app, CALENDAR_OUTBOX_BATCH_SIZE)?;
    }
    let entries = crate::read_calendar_sync_outbox(&app, CALENDAR_OUTBOX_BATCH_SIZE)?;
    let master_category_names = if has_export_target {
        ensure_m365_calendar_categories(
            &access_token,
            entries
                .iter()
                .filter(|entry| entry.action != "delete")
                .map(|entry| {
                    (
                        graph_category_for_event(&entry.event),
                        entry.event.color.clone(),
                        entry.event.category.trim().is_empty(),
                    )
                }),
        )
        .await?
    } else {
        HashMap::new()
    };
    let mut result = CalendarOutboxSyncResult {
        processed: 0,
        created: 0,
        updated: 0,
        deleted: 0,
        pending: entries.len(),
        errors: 0,
        error_messages: Vec::new(),
    };

    for entry in entries {
        let event = entry.event;
        let linked_source = sources.calendars.iter().find_map(|source| {
            linked_calendar_remote_id(&event, &source.id)
                .map(|remote_id| (source, remote_id.to_string()))
        });
        let requested_target = event.calendar_source_id.as_deref();
        let transfer_requested = linked_source
            .as_ref()
            .is_some_and(|(source, _)| requested_target.is_some_and(|target| target != source.id));
        let outcome = if entry.action == "delete" {
            calendar_transfer::discard_pending_transfer(&app, &access_token, &event.id).await?;
            match linked_source {
                Some((source, remote_id))
                    if outbox_source_direction(&request, &source.id) != "import" =>
                {
                    let url = format!(
                        "{}/events/{}",
                        source.resource_path,
                        encode_graph_path_segment(&remote_id)
                    );
                    graph_write(&access_token, reqwest::Method::DELETE, &url, &Value::Null)
                        .await
                        .map(|_| "deleted")
                }
                // A local-only event has no remote copy that could be deleted.
                Some(_) | None => Ok("ignored"),
            }
        } else if transfer_requested {
            let (origin, remote_id) = linked_source.as_ref().unwrap();
            if !outbox_source_is_available(&request, origin)
                || outbox_source_direction(&request, &origin.id) == "import"
            {
                Err("Der Quellkalender erlaubt keine ausgehenden Änderungen.".to_string())
            } else {
                let target_id = requested_target.unwrap();
                let target = sources.calendars.iter().find(|source| {
                    source.id == target_id
                        && outbox_source_is_available(&request, source)
                        && outbox_source_direction(&request, &source.id) != "import"
                });
                if target.is_none() && !target_id.starts_with("local:") {
                    Err("Der gewählte Zielkalender ist nicht beschreibbar oder nicht zur Synchronisierung ausgewählt.".to_string())
                } else {
                    calendar_transfer::transfer_event(
                        &app,
                        &access_token,
                        origin,
                        remote_id,
                        target,
                        &event,
                        &master_category_names,
                    )
                    .await
                    .map(|_| "created")
                }
            }
        } else if requested_target.is_some_and(|target| target.starts_with("local:"))
            && linked_source.is_none()
        {
            Ok("ignored")
        } else {
            calendar_transfer::discard_pending_transfer(&app, &access_token, &event.id).await?;
            match linked_source {
                Some((source, remote_id))
                    if outbox_source_direction(&request, &source.id) != "import" =>
                {
                    let url = format!(
                        "{}/events/{}",
                        source.resource_path,
                        encode_graph_path_segment(&remote_id)
                    );
                    event_sync::patch_event(
                        &access_token,
                        &url,
                        &event,
                        &master_category_names,
                        entry.action == "category",
                    )
                    .await
                    .map(|_| "updated")
                }
                Some(_) => Ok("ignored"),
                None => {
                    let target = sources.calendars.iter().find(|source| {
                        outbox_source_is_available(&request, source)
                            && outbox_source_direction(&request, &source.id) != "import"
                            && requested_target.map_or(true, |target| target == source.id)
                    });
                    if let Some(target) = target {
                        match find_matching_exchange_event_for_outbox(&access_token, target, &event)
                            .await
                        {
                            Ok(Some(remote)) => {
                                let remote_id = value_text(&remote, "id");
                                let url = format!(
                                    "{}/events/{}",
                                    target.resource_path,
                                    encode_graph_path_segment(remote_id)
                                );
                                match event_sync::patch_event(
                                    &access_token,
                                    &url,
                                    &event,
                                    &master_category_names,
                                    entry.action == "category",
                                )
                                .await
                                {
                                    Ok(_) => {
                                        let mut linked = event.clone();
                                        linked.id = format!("m365:{}:{remote_id}", target.id);
                                        linked.source = target.name.clone();
                                        crate::link_calendar_event_after_exchange_create(
                                            &app, &event.id, &linked,
                                        )?;
                                        Ok("updated")
                                    }
                                    Err(error) => Err(error),
                                }
                            }
                            Ok(None) => {
                                let url = format!("{}/events", target.resource_path);
                                match event_sync::create_event(
                                    &access_token,
                                    &url,
                                    &event,
                                    &master_category_names,
                                )
                                .await
                                {
                                    Ok(remote) if value_text(&remote, "id").is_empty() => {
                                        Err("Microsoft 365 hat keine Termin-ID zurückgegeben."
                                            .to_string())
                                    }
                                    Ok(remote) => {
                                        let linked =
                                            remote_event_to_local(&remote, target, Some(&event));
                                        crate::link_calendar_event_after_exchange_create(
                                            &app, &event.id, &linked,
                                        )?;
                                        Ok("created")
                                    }
                                    Err(error) => Err(error),
                                }
                            }
                            Err(error) => Err(error),
                        }
                    } else {
                        Err("Kein beschreibbarer Exchange-Kalender ist ausgewählt.".to_string())
                    }
                }
            }
        };
        match outcome {
            Ok("created") => {
                result.processed += 1;
                result.created += 1;
            }
            Ok("deleted") => {
                crate::complete_calendar_sync_outbox_entry(&app, &event.id)?;
                result.processed += 1;
                result.deleted += 1;
            }
            Ok("updated") => {
                crate::complete_calendar_sync_outbox_entry(&app, &event.id)?;
                result.processed += 1;
                result.updated += 1;
            }
            Ok("ignored") => {
                crate::complete_calendar_sync_outbox_entry(&app, &event.id)?;
                result.processed += 1;
            }
            Ok(_) => unreachable!(),
            Err(error) => {
                let _ = crate::record_calendar_sync_outbox_error(&app, &event.id, &error);
                result.errors += 1;
                if result.error_messages.len() < 5 {
                    result
                        .error_messages
                        .push(format!("{}: {error}", event.title));
                }
            }
        }
    }
    result.pending = crate::calendar_sync_outbox_count(&app)?;
    Ok(result)
}

fn contact_input_from_contact(contact: &crate::Contact) -> crate::ContactInput {
    crate::ContactInput {
        id: contact.id,
        first_name: contact.first_name.clone(),
        last_name: contact.last_name.clone(),
        display_name: contact.display_name.clone(),
        email: contact.email.clone(),
        private_email: contact.private_email.clone(),
        second_private_email: contact.second_private_email.clone(),
        phone: contact.phone.clone(),
        mobile_phone: contact.mobile_phone.clone(),
        private_phone: contact.private_phone.clone(),
        second_private_phone: contact.second_private_phone.clone(),
        company: contact.company.clone(),
        street: contact.street.clone(),
        postal_code: contact.postal_code.clone(),
        city: contact.city.clone(),
        country: contact.country.clone(),
        short_info: contact.short_info.clone(),
        notes: contact.notes.clone(),
        group_ids: contact.groups.iter().filter_map(|group| group.id).collect(),
    }
}

#[tauri::command]
pub async fn preview_m365_sync(
    app: AppHandle,
    request: Microsoft365SyncPreviewRequest,
) -> Result<Microsoft365SyncPreview, String> {
    let access_token = refreshed_access_token(&app).await?;
    Ok(build_m365_sync_plan(&app, &access_token, &request, false)
        .await?
        .preview)
}

#[tauri::command]
pub async fn apply_m365_sync(
    app: AppHandle,
    request: Microsoft365SyncApplyRequest,
) -> Result<Microsoft365SyncResult, String> {
    ensure_read_only_test_account(&app)?;
    if m365_read_only_test_mode()
        && (!request.calendars
            || request.contacts
            || request.selected_calendar_source_ids.is_empty()
            || request
                .selected_calendar_source_ids
                .iter()
                .any(|id| request.source_directions.get(id).map(String::as_str) != Some("import")))
    {
        return Err(
            "Der sichere M365-Testmodus erlaubt nur den Kalenderimport ohne ausgehende Änderungen."
                .to_string(),
        );
    }
    // A manual sync can overlap the automatic change/poll sync. Building the
    // second plan only after the first write is visible lets the remote-key
    // matching relink the event instead of creating it a second time.
    let state = app.state::<crate::AppState>();
    // Calendar-only cycles must remain independent of a slow contact import.
    // Mixed manual syncs acquire both in a fixed order to avoid overlap.
    let _contact_guard = if request.contacts {
        Some(state.m365.contact_sync_gate.lock().await)
    } else {
        None
    };
    let _calendar_guard = if request.calendars {
        Some(state.m365.calendar_sync_gate.lock().await)
    } else {
        None
    };
    let started_at = Utc::now().to_rfc3339();
    let access_token = refreshed_access_token(&app).await?;
    let backup = request
        .backup
        .unwrap_or(crate::load_sync_backup_data(app.clone())?);
    if request.contacts && request.contact_groups {
        ensure_contact_group_folders(&access_token, &backup).await?;
    }
    let preview_request = Microsoft365SyncPreviewRequest {
        direction: request.direction,
        base: request.base,
        contacts: request.contacts,
        contact_groups: request.contact_groups,
        calendars: request.calendars,
        shared_calendars: request.shared_calendars,
        shared_mailboxes: request.shared_mailboxes,
        shared_mailbox_addresses: request.shared_mailbox_addresses,
        selected_contact_source_ids: request.selected_contact_source_ids,
        selected_calendar_source_ids: request.selected_calendar_source_ids,
        source_directions: request.source_directions,
        backup,
    };
    let plan = build_m365_sync_plan(
        &app,
        &access_token,
        &preview_request,
        request.allow_partial_sources,
    )
    .await?;
    let needs_calendar_write_categories = request.calendars
        && (request
            .decisions
            .values()
            .any(|decision| matches!(decision.as_str(), "keepApp" | "merge"))
            || plan.operations.iter().any(|operation| {
                operation.change.kind == "Kalender"
                    && matches!(
                        operation.change.action.as_str(),
                        "createRemote" | "updateRemote" | "keepApp" | "merge"
                    )
            }));
    let master_category_names = if needs_calendar_write_categories {
        let mut calendars = HashSet::new();
        for operation in &plan.operations {
            if operation.change.kind == "Kalender"
                && operation.source.editable
                && calendars.insert(operation.source.id.clone())
                && source_direction(&preview_request, &operation.source.id) != "import"
            {
                ensure_calendar_default_blue(&access_token, &operation.source).await?;
            }
        }
        let categories = plan.operations.iter().flat_map(|operation| {
            let mut names = Vec::with_capacity(2);
            if let PlannedPayload::Calendar { local, remote } = &operation.payload {
                if let Some(event) = local {
                    names.push((
                        graph_category_for_event(event),
                        event.color.clone(),
                        event.category.trim().is_empty(),
                    ));
                }
                if let Some(event) = remote {
                    let name = event
                        .get("categories")
                        .and_then(Value::as_array)
                        .and_then(|categories| categories.first())
                        .and_then(Value::as_str)
                        .unwrap_or("")
                        .trim();
                    let color = value_text(event, "_dmhCategoryColor");
                    names.push((
                        if name.is_empty() {
                            dmh_category_for_calendar_color(color).0.to_string()
                        } else {
                            name.to_string()
                        },
                        color.to_string(),
                        false,
                    ));
                }
            }
            names
        });
        ensure_m365_calendar_categories(&access_token, categories).await?
    } else {
        HashMap::new()
    };
    let conflicts = plan.preview.conflicts;
    let mut delta_acks_to_commit = plan.delta_noop_acks;
    let delta_operation_acks = plan.delta_operation_acks;
    let category_import_source_ids = plan.category_import_source_ids;
    let mut result = Microsoft365SyncResult {
        started_at,
        finished_at: String::new(),
        created: 0,
        updated: 0,
        deleted: 0,
        ignored: 0,
        conflicts,
        errors: plan.source_errors.len(),
        error_messages: plan.source_errors,
        calendar_upserts: Vec::new(),
        calendar_deletes: Vec::new(),
        calendar_categories: plan.calendar_categories,
        calendar_category_rules: category_management::get_calendar_category_rules(app.clone())?,
    };

    for operation in plan.operations {
        let delta_ack = delta_operation_acks.get(&operation.change.id).cloned();
        let conflict_was_decided = operation.change.action != "conflict"
            || request.decisions.contains_key(&operation.change.id);
        let requested_action = if operation.change.action == "conflict" {
            request
                .decisions
                .get(&operation.change.id)
                .map(String::as_str)
                .unwrap_or("ignore")
        } else {
            operation.change.action.as_str()
        };
        let execution = match (&operation.payload, requested_action) {
            (_, "ignore") => {
                result.ignored += 1;
                Ok(())
            }
            (
                PlannedPayload::Contact {
                    local: Some(local),
                    remote: None,
                },
                "createRemote",
            ) => {
                match graph_write(
                    &access_token,
                    reqwest::Method::POST,
                    &operation.source.resource_path,
                    &graph_contact_payload(local),
                )
                .await
                {
                    Ok(remote) => {
                        let local_id = local
                            .id
                            .ok_or_else(|| "Lokaler Kontakt hat keine ID.".to_string())?;
                        let remote_id = value_text(&remote, "id");
                        if remote_id.is_empty() {
                            Err("Microsoft 365 hat keine Kontakt-ID zurückgegeben.".to_string())
                        } else {
                            save_contact_link(&app, local_id, &operation.source.id, remote_id)?;
                            result.created += 1;
                            Ok(())
                        }
                    }
                    Err(error) => Err(error),
                }
            }
            (
                PlannedPayload::Contact {
                    local: None,
                    remote: Some(remote),
                },
                "createLocal",
            ) => {
                let input = remote_contact_input_for_source(
                    remote,
                    None,
                    &preview_request.backup,
                    &operation.source,
                );
                crate::save_contact_from_m365(app.clone(), input).and_then(|local_id| {
                    save_contact_link(
                        &app,
                        local_id,
                        &operation.source.id,
                        value_text(remote, "id"),
                    )?;
                    result.created += 1;
                    Ok(())
                })
            }
            (
                PlannedPayload::Contact {
                    local: Some(local),
                    remote: Some(remote),
                },
                "link",
            ) => {
                let local_id = local
                    .id
                    .ok_or_else(|| "Lokaler Kontakt hat keine ID.".to_string())?;
                save_contact_link(
                    &app,
                    local_id,
                    &operation.source.id,
                    value_text(remote, "id"),
                )?;
                result.ignored += 1;
                Ok(())
            }
            (
                PlannedPayload::Contact {
                    local: Some(local),
                    remote: Some(remote),
                },
                "updateRemote" | "keepApp",
            ) => {
                let url = format!(
                    "{}/{}",
                    operation.source.resource_path,
                    encode_graph_path_segment(value_text(remote, "id"))
                );
                graph_write(
                    &access_token,
                    reqwest::Method::PATCH,
                    &url,
                    &graph_contact_payload(local),
                )
                .await
                .map(|_| {
                    if let Some(local_id) = local.id {
                        let _ = save_contact_link(
                            &app,
                            local_id,
                            &operation.source.id,
                            value_text(remote, "id"),
                        );
                    }
                    result.updated += 1;
                })
            }
            (
                PlannedPayload::Contact {
                    local: Some(local),
                    remote: Some(remote),
                },
                "updateLocal" | "keepM365",
            ) => crate::save_contact_from_m365(
                app.clone(),
                remote_contact_input_for_source(
                    remote,
                    Some(local),
                    &preview_request.backup,
                    &operation.source,
                ),
            )
            .and_then(|local_id| {
                save_contact_link(
                    &app,
                    local_id,
                    &operation.source.id,
                    value_text(remote, "id"),
                )?;
                result.updated += 1;
                Ok(())
            }),
            (
                PlannedPayload::Contact {
                    local: Some(local),
                    remote: Some(remote),
                },
                "merge",
            ) => {
                let merged = merge_contact(local, remote);
                let url = format!(
                    "{}/{}",
                    operation.source.resource_path,
                    encode_graph_path_segment(value_text(remote, "id"))
                );
                match graph_write(
                    &access_token,
                    reqwest::Method::PATCH,
                    &url,
                    &graph_contact_payload(&merged),
                )
                .await
                {
                    Ok(_) => crate::save_contact_from_m365(
                        app.clone(),
                        contact_input_from_contact(&merged),
                    )
                    .map(|_| {
                        result.updated += 2;
                    }),
                    Err(error) => Err(error),
                }
            }
            (
                PlannedPayload::Contact {
                    local: Some(local),
                    remote: Some(remote),
                },
                "deleteRemote",
            ) => {
                let url = format!(
                    "{}/{}",
                    operation.source.resource_path,
                    encode_graph_path_segment(value_text(remote, "id"))
                );
                graph_write(&access_token, reqwest::Method::DELETE, &url, &Value::Null)
                    .await
                    .and_then(|_| {
                        if let Some(local_id) = local.id {
                            delete_contact_link(&app, local_id, &operation.source.id)?;
                        }
                        result.deleted += 1;
                        Ok(())
                    })
            }
            (
                PlannedPayload::Contact {
                    local: Some(local),
                    remote: None,
                },
                "deleteLocal",
            ) => {
                let local_id = local
                    .id
                    .ok_or_else(|| "Lokaler Kontakt hat keine ID.".to_string())?;
                if let Some(group_id) = source_group_id(&preview_request.backup, &operation.source)
                {
                    remove_contact_from_group(&app, local_id, group_id)?;
                } else {
                    crate::delete_contact_from_m365(app.clone(), local_id)?;
                }
                delete_contact_link(&app, local_id, &operation.source.id)?;
                result.deleted += 1;
                Ok(())
            }
            (
                PlannedPayload::Calendar {
                    local: Some(local),
                    remote: None,
                },
                "createRemote",
            ) => {
                let url = format!("{}/events", operation.source.resource_path);
                match event_sync::create_event(&access_token, &url, local, &master_category_names)
                    .await
                {
                    Ok(remote) => {
                        if value_text(&remote, "id").is_empty() {
                            Err("Microsoft 365 hat keine Termin-ID zurückgegeben.".to_string())
                        } else {
                            let linked =
                                remote_event_to_local(&remote, &operation.source, Some(local));
                            crate::link_calendar_event_after_exchange_create(
                                &app, &local.id, &linked,
                            )
                            .map(|linked| {
                                result.calendar_upserts.push(linked);
                                result.created += 1;
                            })
                        }
                    }
                    Err(error) => Err(error),
                }
            }
            (
                PlannedPayload::Calendar {
                    local: None,
                    remote: Some(remote),
                },
                "createLocal",
            ) => {
                result.calendar_upserts.push(remote_event_to_local(
                    remote,
                    &operation.source,
                    None,
                ));
                result.created += 1;
                Ok(())
            }
            (
                PlannedPayload::Calendar {
                    local: Some(local),
                    remote: Some(remote),
                },
                "link",
            ) => {
                // Calendar links are encoded in the local event ID. Remap the
                // existing row in place; never send a technical ID change to
                // the trash as if the user had deleted the appointment.
                let linked = remote_event_to_local(remote, &operation.source, Some(local));
                crate::link_calendar_event_after_exchange_create(&app, &local.id, &linked).map(
                    |linked| {
                        result.calendar_upserts.push(linked);
                        result.ignored += 1;
                    },
                )
            }
            (
                PlannedPayload::Calendar {
                    local: Some(local),
                    remote: Some(remote),
                },
                "updateRemote" | "keepApp",
            ) => {
                let url = format!(
                    "{}/events/{}",
                    operation.source.resource_path,
                    encode_graph_path_segment(value_text(remote, "id"))
                );
                event_sync::patch_event(&access_token, &url, local, &master_category_names, false)
                    .await
                    .map(|_| {
                        result.updated += 1;
                    })
            }
            (
                PlannedPayload::Calendar {
                    local: Some(local),
                    remote: Some(remote),
                },
                "updateLocal" | "keepM365",
            ) => {
                let linked = remote_event_to_local(remote, &operation.source, Some(local));
                if linked.id != local.id {
                    result.calendar_deletes.push(local.id.clone());
                }
                result.calendar_upserts.push(linked);
                result.updated += 1;
                Ok(())
            }
            (
                PlannedPayload::Calendar {
                    local: Some(local),
                    remote: Some(remote),
                },
                "merge",
            ) => {
                let merged = merge_event(local, remote, &operation.source);
                let url = format!(
                    "{}/events/{}",
                    operation.source.resource_path,
                    encode_graph_path_segment(value_text(remote, "id"))
                );
                match event_sync::patch_event(
                    &access_token,
                    &url,
                    &merged,
                    &master_category_names,
                    false,
                )
                .await
                {
                    Ok(_) => {
                        result.calendar_upserts.push(merged);
                        result.updated += 2;
                        Ok(())
                    }
                    Err(error) => Err(error),
                }
            }
            (
                PlannedPayload::Calendar {
                    local: Some(_local),
                    remote: Some(remote),
                },
                "deleteRemote",
            ) => {
                let url = format!(
                    "{}/events/{}",
                    operation.source.resource_path,
                    encode_graph_path_segment(value_text(remote, "id"))
                );
                graph_write(&access_token, reqwest::Method::DELETE, &url, &Value::Null)
                    .await
                    .map(|_| {
                        result.calendar_deletes.push(_local.id.clone());
                        result.deleted += 1;
                    })
            }
            (
                PlannedPayload::Calendar {
                    local: Some(local),
                    remote: None,
                },
                "deleteLocal",
            ) => {
                if m365_read_only_test_mode() {
                    // A diagnostic import must never remove a local event on
                    // the strength of a Graph @removed marker.
                    result.ignored += 1;
                } else {
                    result.calendar_deletes.push(local.id.clone());
                    result.deleted += 1;
                }
                Ok(())
            }
            _ => {
                result.ignored += 1;
                Ok(())
            }
        };
        if execution.is_ok() && conflict_was_decided {
            if let Some((source_id, remote_id)) = delta_ack {
                delta_acks_to_commit.push((source_id, remote_id));
            }
        }
        if let Err(error) = execution {
            result.errors += 1;
            if result.error_messages.len() < 20 {
                result
                    .error_messages
                    .push(format!("{}: {error}", operation.change.title));
            }
        }
    }
    crate::commit_m365_calendar_changes(
        &app,
        &result.calendar_upserts,
        &result.calendar_deletes,
        &delta_acks_to_commit,
    )?;
    if needs_calendar_write_categories {
        result.calendar_categories = m365_master_categories(&access_token).await?;
    }
    let recolored = refresh_calendar_category_colors_in_db(
        &open_db(&app)?,
        &result.calendar_categories,
        Some(&category_import_source_ids),
    )?;
    let upsert_indices: HashMap<_, _> = result
        .calendar_upserts
        .iter()
        .enumerate()
        .map(|(index, event)| (event.id.clone(), index))
        .collect();
    for event in recolored {
        if let Some(index) = upsert_indices.get(&event.id) {
            result.calendar_upserts[*index] = event;
        } else {
            // Category metadata makes the WebView reload its visible range.
            // Avoid shipping every historical event when one category changes.
            result.updated += 1;
        }
    }
    result.finished_at = Utc::now().to_rfc3339();
    Ok(result)
}

fn account_from_profile(profile: GraphProfile) -> Microsoft365Account {
    Microsoft365Account {
        id: profile.id,
        display_name: profile.display_name,
        email: profile.mail,
        user_principal_name: profile.user_principal_name,
        connected_at: Utc::now().to_rfc3339(),
    }
}

async fn request_token(fields: &[(&str, &str)]) -> Result<OAuthTokenResponse, OAuthErrorResponse> {
    let response = http_client()
        .post(oauth_url("token"))
        .header("content-type", "application/x-www-form-urlencoded")
        .body(form_body(fields))
        .send()
        .await
        .map_err(|_| OAuthErrorResponse {
            error: "network_error".to_string(),
            error_description:
                "Microsoft-Anmeldedienst ist nicht erreichbar. Internetverbindung prüfen."
                    .to_string(),
        })?;
    if response.status().is_success() {
        return response
            .json::<OAuthTokenResponse>()
            .await
            .map_err(|_| OAuthErrorResponse {
                error: "invalid_response".to_string(),
                error_description: "Microsoft hat eine ungültige Antwort geliefert.".to_string(),
            });
    }
    let error = response
        .json::<OAuthErrorResponse>()
        .await
        .unwrap_or(OAuthErrorResponse {
            error: "unknown_error".to_string(),
            error_description: "Microsoft-Anmeldung ist fehlgeschlagen.".to_string(),
        });
    Err(error)
}

fn pending_flow(state: &State<'_, AppState>) -> Result<PendingDeviceFlow, String> {
    state
        .m365
        .pending_device_flow
        .lock()
        .map_err(|_| "Microsoft-Anmeldung konnte intern nicht gelesen werden.".to_string())?
        .clone()
        .ok_or_else(|| "Es läuft keine Microsoft-Anmeldung mehr.".to_string())
}

fn clear_pending_flow(state: &State<'_, AppState>) -> Result<(), String> {
    *state
        .m365
        .pending_device_flow
        .lock()
        .map_err(|_| "Microsoft-Anmeldung konnte intern nicht beendet werden.".to_string())? = None;
    Ok(())
}

#[tauri::command]
pub async fn get_m365_connection_status(
    app: AppHandle,
) -> Result<Microsoft365ConnectionStatus, String> {
    let account = read_account(&app)?;
    let locally_connected = account.is_some() && get_setting(&app, TOKEN_SETTING_KEY)?.is_some();
    let connected = if locally_connected && client_id().is_some() {
        match refreshed_access_token(&app).await {
            Ok(mut access_token) => {
                access_token.zeroize();
                true
            }
            Err(error) if microsoft_session_requires_reconnect(&error) => false,
            Err(_) => true,
        }
    } else {
        false
    };
    Ok(Microsoft365ConnectionStatus {
        configured: client_id().is_some(),
        connected,
        account,
    })
}

#[tauri::command]
pub async fn list_m365_master_categories(
    app: AppHandle,
) -> Result<Vec<Microsoft365CalendarCategory>, String> {
    let mut access_token = refreshed_access_token(&app).await?;
    let categories = m365_master_categories(&access_token).await;
    access_token.zeroize();
    if let Ok(categories) = &categories {
        category_management::reconcile_recreated_categories(&app, categories)?;
    }
    categories
}

fn calendar_outbox_repair_counts(app: &AppHandle) -> Result<(usize, usize), String> {
    open_db(app)?
        .query_row(
            "SELECT COUNT(*), COALESCE(SUM(CASE WHEN action = 'delete' THEN 1 ELSE 0 END), 0)
             FROM calendar_sync_outbox",
            [],
            |row| Ok((row.get::<_, usize>(0)?, row.get::<_, usize>(1)?)),
        )
        .map_err(|error| error.to_string())
}

async fn calendar_category_repair_context(
    app: &AppHandle,
) -> Result<(String, Vec<CalendarCategoryRepairTarget>), String> {
    ensure_read_only_test_account(app)?;
    let access_token = refreshed_access_token(app).await?;
    let sources =
        list_m365_sync_sources_filtered(app.clone(), Some(Vec::new()), false, true).await?;
    let events = crate::read_calendar_events(&open_db(app)?, false)?;
    let targets = calendar_category_repair_targets(&events, &sources.calendars);
    Ok((access_token, targets))
}

/// Read-only inspection for the isolated colour repair. It deliberately does
/// not enqueue, complete or otherwise touch the regular calendar outbox.
#[tauri::command]
pub async fn preview_m365_calendar_category_repair(
    app: AppHandle,
) -> Result<Microsoft365CalendarCategoryRepairPreview, String> {
    let (mut access_token, targets) = calendar_category_repair_context(&app).await?;
    let preview = async {
        let existing = graph_collection(
            &access_token,
            "https://graph.microsoft.com/v1.0/me/outlook/masterCategories?$select=displayName,color",
        )
        .await?
        .into_iter()
        .filter_map(|category| {
            let name = value_text(&category, "displayName").trim().to_lowercase();
            (!name.is_empty()).then(|| (name, value_text(&category, "color").to_string()))
        })
        .collect::<HashMap<_, _>>();
        let required = required_calendar_category_colors(&targets);
        let categories_to_repair = required
            .iter()
            .filter(|(key, (_, expected))| {
                existing
                    .get(*key)
                    .map(|actual| category_needs_repair(key, actual, expected))
                    .unwrap_or(true)
            })
            .count();
        let mut category_names = required
            .into_values()
            .map(|(name, _)| name)
            .collect::<Vec<_>>();
        category_names.sort_by(|left, right| left.to_lowercase().cmp(&right.to_lowercase()));
        let (pending_operations, pending_deletions) = calendar_outbox_repair_counts(&app)?;
        Ok::<_, String>(Microsoft365CalendarCategoryRepairPreview {
            linked_events: targets.len(),
            category_names,
            categories_to_repair,
            pending_operations,
            pending_deletions,
        })
    }
    .await;
    access_token.zeroize();
    preview
}

/// Repairs only Exchange master-category colours and the `categories` field of
/// already linked appointments. It never creates/deletes appointments and does
/// not consume the normal outbox, so unrelated pending work remains untouched.
#[tauri::command]
pub async fn repair_m365_calendar_categories(
    app: AppHandle,
) -> Result<Microsoft365CalendarCategoryRepairResult, String> {
    if m365_read_only_test_mode() {
        return Err("Der sichere M365-Testmodus sperrt ausgehende Änderungen.".to_string());
    }
    let state = app.state::<crate::AppState>();
    let _sync_guard = state.m365.calendar_sync_gate.lock().await;
    let (mut access_token, targets) = calendar_category_repair_context(&app).await?;
    let result = async {
        let sources =
            list_m365_sync_sources_filtered(app.clone(), Some(Vec::new()), false, true).await?;
        for source in sources.calendars.iter().filter(|source| source.editable) {
            ensure_calendar_default_blue(&access_token, source).await?;
        }
        let master_category_names = ensure_m365_calendar_categories(
            &access_token,
            targets
                .iter()
                .map(|target| (target.category.clone(), target.color.clone(), true)),
        )
        .await?;
        let scanned = targets.len();
        let writes = stream::iter(targets.into_iter().map(|target| {
            let access_token = &access_token;
            let category = master_category_names
                .get(&target.category.to_lowercase())
                .cloned()
                .unwrap_or(target.category.clone());
            async move {
                let outcome = async {
                    graph_write(
                        access_token,
                        reqwest::Method::PATCH,
                        &target.url,
                        &json!({ "categories": graph_category_values(&category) }),
                    )
                    .await?;
                    let saved = graph_json(
                        access_token,
                        &format!("{}?$select=id,categories", target.url),
                    )
                    .await?;
                    verify_calendar_event_category(&saved, &category)
                }
                .await;
                (target.title, outcome)
            }
        }))
        .buffer_unordered(4)
        .collect::<Vec<_>>()
        .await;
        let mut updated = 0;
        let mut errors = 0;
        let mut error_messages = Vec::new();
        for (title, outcome) in writes {
            match outcome {
                Ok(_) => updated += 1,
                Err(error) => {
                    errors += 1;
                    if error_messages.len() < 10 {
                        error_messages.push(format!(
                            "{}: {error}",
                            if title.trim().is_empty() {
                                "Ohne Titel"
                            } else {
                                title.trim()
                            }
                        ));
                    }
                }
            }
        }
        Ok::<_, String>(Microsoft365CalendarCategoryRepairResult {
            scanned,
            updated,
            errors,
            error_messages,
        })
    }
    .await;
    access_token.zeroize();
    result
}

/// Creates a mailbox category or changes its Outlook colour. Categories are
/// deliberately not deleted here: an Outlook category can also label mail,
/// contacts and tasks, not only calendar events.
#[tauri::command]
pub async fn save_m365_master_category(
    app: AppHandle,
    name: String,
    color: String,
) -> Result<Microsoft365CalendarCategory, String> {
    if m365_read_only_test_mode() {
        return Err("Der sichere M365-Testmodus sperrt ausgehende Änderungen.".to_string());
    }
    let state = app.state::<crate::AppState>();
    let _sync_guard = state.m365.calendar_sync_gate.lock().await;
    let name = name.trim();
    category_management::ensure_no_pending_operation(&app)?;
    if name.is_empty() {
        return Err("Bitte geben Sie einen Kategorienamen ein.".to_string());
    }
    if name.chars().count() > 255 {
        return Err("Der Kategoriename darf höchstens 255 Zeichen lang sein.".to_string());
    }

    let (_, outlook_color) = dmh_category_for_calendar_color(&color);
    let mut access_token = refreshed_access_token(&app).await?;
    let result = async {
        let existing = graph_collection(
            &access_token,
            "https://graph.microsoft.com/v1.0/me/outlook/masterCategories?$select=id,displayName,color",
        )
        .await?
        .into_iter()
        .find(|category| value_text(category, "displayName").trim().eq_ignore_ascii_case(name));

        if let Some(category) = existing {
            let id = value_text(&category, "id").trim();
            if id.is_empty() {
                return Err("Microsoft 365 hat die vorhandene Kategorie ohne Kennung geliefert.".to_string());
            }
            graph_write(
                &access_token,
                reqwest::Method::PATCH,
                &format!(
                    "https://graph.microsoft.com/v1.0/me/outlook/masterCategories/{}",
                    encode_graph_path_segment(id)
                ),
                &json!({ "color": outlook_color }),
            )
            .await?;
        } else {
            graph_write(
                &access_token,
                reqwest::Method::POST,
                "https://graph.microsoft.com/v1.0/me/outlook/masterCategories",
                &json!({ "displayName": name, "color": outlook_color }),
            )
            .await?;
        }

        let saved = graph_collection(
            &access_token,
            "https://graph.microsoft.com/v1.0/me/outlook/masterCategories?$select=displayName,color",
        )
        .await?
        .into_iter()
        .find(|category| value_text(category, "displayName").trim().eq_ignore_ascii_case(name))
        .filter(|category| value_text(category, "color").eq_ignore_ascii_case(outlook_color))
        .ok_or_else(|| "Microsoft 365 hat die neue Kategorienfarbe noch nicht bestätigt. Bitte versuchen Sie es erneut.".to_string())?;
        let category = m365_master_category_from_value(&saved)
            .ok_or_else(|| "Microsoft 365 hat die Kategorie unvollständig zurückgegeben.".to_string())?;
        category_management::allow_category_name(&app, &category.name)?;
        refresh_calendar_category_colors_in_db(&open_db(&app)?, std::slice::from_ref(&category), None)?;
        Ok(category)
    }
    .await;
    access_token.zeroize();
    result
}

#[tauri::command]
pub async fn start_m365_interactive_connection(
    app: AppHandle,
) -> Result<Microsoft365Account, String> {
    let client_id = client_id().ok_or_else(|| {
        "Die EDV muss zuerst die Microsoft-Anwendungs-ID für diesen Build hinterlegen.".to_string()
    })?;
    let listener = TcpListener::bind("127.0.0.1:0").map_err(|_| {
        "Die sichere Microsoft-Rückmeldung konnte nicht vorbereitet werden.".to_string()
    })?;
    listener.set_nonblocking(true).map_err(|_| {
        "Die sichere Microsoft-Rückmeldung konnte nicht vorbereitet werden.".to_string()
    })?;
    let port = listener
        .local_addr()
        .map_err(|_| {
            "Die sichere Microsoft-Rückmeldung konnte nicht vorbereitet werden.".to_string()
        })?
        .port();
    let redirect_uri = format!("http://localhost:{port}");
    let state_token = secure_url_token(32);
    let mut verifier = secure_url_token(64);
    let challenge = pkce_challenge(&verifier);
    {
        let runtime = app.state::<AppState>();
        *runtime.m365.pending_interactive_state.lock().map_err(|_| {
            "Microsoft-Anmeldung konnte intern nicht vorbereitet werden.".to_string()
        })? = Some(state_token.clone());
    }
    let authorization_url =
        interactive_authorization_url(client_id, &redirect_uri, &state_token, &challenge);
    if let Err(error) = app.opener().open_url(authorization_url, None::<&str>) {
        let _ = clear_interactive_state(&app, &state_token);
        verifier.zeroize();
        return Err(format!(
            "Microsoft-Anmeldung konnte nicht im Browser geöffnet werden: {error}"
        ));
    }
    let callback = wait_for_authorization_callback(&app, &listener, &state_token).await;
    let _ = clear_interactive_state(&app, &state_token);
    let mut callback = callback?;
    let token_result = request_token(&[
        ("grant_type", "authorization_code"),
        ("client_id", client_id),
        ("code", &callback.code),
        ("redirect_uri", &redirect_uri),
        ("code_verifier", &verifier),
        ("scope", LOGIN_SCOPES),
    ])
    .await;
    verifier.zeroize();
    callback.code.zeroize();
    let token = token_result.map_err(|error| oauth_error_message(&error))?;
    let refresh_token = token.refresh_token.ok_or_else(|| {
        "Microsoft hat keine erneuerbare Anmeldung bereitgestellt. Die EDV muss offline_access erlauben."
            .to_string()
    })?;
    let mut access_token = token.access_token;
    let profile_result = graph_profile(&access_token).await;
    access_token.zeroize();
    let account = account_from_profile(profile_result?);
    save_connection(
        &app,
        &account,
        &StoredTokenBundle {
            refresh_token,
            scope: token.scope,
        },
    )?;
    Ok(account)
}

#[tauri::command]
pub async fn start_m365_connection(
    state: State<'_, AppState>,
) -> Result<Microsoft365DeviceCode, String> {
    let client_id = client_id().ok_or_else(|| {
        "Die EDV muss zuerst die Microsoft-Anwendungs-ID für diesen Build hinterlegen.".to_string()
    })?;
    let response = http_client()
        .post(oauth_url("devicecode"))
        .header("content-type", "application/x-www-form-urlencoded")
        .body(form_body(&[
            ("client_id", client_id),
            ("scope", LOGIN_SCOPES),
        ]))
        .send()
        .await
        .map_err(|_| {
            "Microsoft-Anmeldedienst ist nicht erreichbar. Internetverbindung prüfen.".to_string()
        })?;
    if !response.status().is_success() {
        let error = response
            .json::<OAuthErrorResponse>()
            .await
            .unwrap_or(OAuthErrorResponse {
                error: "unknown_error".to_string(),
                error_description: String::new(),
            });
        return Err(oauth_error_message(&error));
    }
    let device = response
        .json::<DeviceCodeResponse>()
        .await
        .map_err(|_| "Microsoft-Anmeldedienst hat eine ungültige Antwort geliefert.".to_string())?;
    let expires_at = (Utc::now() + ChronoDuration::seconds(device.expires_in)).to_rfc3339();
    *state
        .m365
        .pending_device_flow
        .lock()
        .map_err(|_| "Microsoft-Anmeldung konnte intern nicht vorbereitet werden.".to_string())? =
        Some(PendingDeviceFlow {
            device_code: device.device_code,
            expires_at: expires_at.clone(),
            interval_seconds: device.interval.max(3),
        });
    Ok(Microsoft365DeviceCode {
        user_code: device.user_code,
        verification_uri: device.verification_uri,
        expires_at,
        interval_seconds: device.interval.max(3),
    })
}

#[tauri::command]
pub async fn poll_m365_connection(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<Microsoft365PollResult, String> {
    let client_id = client_id().ok_or_else(|| {
        "Die Microsoft-Anwendungs-ID ist in diesem Build nicht hinterlegt.".to_string()
    })?;
    let flow = pending_flow(&state)?;
    if flow
        .expires_at
        .parse::<chrono::DateTime<Utc>>()
        .is_ok_and(|expires_at| expires_at <= Utc::now())
    {
        clear_pending_flow(&state)?;
        return Err(
            "Der Anmeldecode ist abgelaufen. Starten Sie die Verbindung erneut.".to_string(),
        );
    }
    let token = match request_token(&[
        ("grant_type", "urn:ietf:params:oauth:grant-type:device_code"),
        ("client_id", client_id),
        ("device_code", &flow.device_code),
    ])
    .await
    {
        Ok(token) => token,
        Err(error) if error.error == "authorization_pending" => {
            return Ok(Microsoft365PollResult {
                state: "pending".to_string(),
                account: None,
                interval_seconds: flow.interval_seconds,
            })
        }
        Err(error) if error.error == "slow_down" => {
            let slower_interval = flow.interval_seconds + 5;
            if let Ok(mut pending) = state.m365.pending_device_flow.lock() {
                if let Some(pending) = pending.as_mut() {
                    pending.interval_seconds = slower_interval;
                }
            }
            return Ok(Microsoft365PollResult {
                state: "pending".to_string(),
                account: None,
                interval_seconds: slower_interval,
            });
        }
        Err(error) => {
            clear_pending_flow(&state)?;
            return Err(oauth_error_message(&error));
        }
    };
    let refresh_token = token.refresh_token.ok_or_else(|| {
        "Microsoft hat keine erneuerbare Anmeldung bereitgestellt. Die EDV muss offline_access erlauben."
            .to_string()
    })?;
    let mut access_token = token.access_token;
    let profile_result = graph_profile(&access_token).await;
    access_token.zeroize();
    let account = account_from_profile(profile_result?);
    save_connection(
        &app,
        &account,
        &StoredTokenBundle {
            refresh_token,
            scope: token.scope,
        },
    )?;
    clear_pending_flow(&state)?;
    Ok(Microsoft365PollResult {
        state: "connected".to_string(),
        account: Some(account),
        interval_seconds: flow.interval_seconds,
    })
}

#[tauri::command]
pub fn cancel_m365_connection(state: State<'_, AppState>) -> Result<(), String> {
    clear_pending_flow(&state)?;
    *state
        .m365
        .pending_interactive_state
        .lock()
        .map_err(|_| "Microsoft-Anmeldung konnte intern nicht beendet werden.".to_string())? = None;
    Ok(())
}

#[tauri::command]
pub fn open_m365_sign_in() -> Result<(), String> {
    hidden_command("explorer.exe")
        .arg("https://microsoft.com/devicelogin")
        .spawn()
        .map_err(|error| format!("Microsoft-Anmeldung konnte nicht geöffnet werden: {error}"))?;
    Ok(())
}

#[tauri::command]
pub async fn test_m365_connection(app: AppHandle) -> Result<Microsoft365ConnectionStatus, String> {
    let client_id = client_id().ok_or_else(|| {
        "Die Microsoft-Anwendungs-ID ist in diesem Build nicht hinterlegt.".to_string()
    })?;
    let stored = read_token(&app)?;
    let token = request_token(&[
        ("grant_type", "refresh_token"),
        ("client_id", client_id),
        ("refresh_token", &stored.refresh_token),
        ("scope", LOGIN_SCOPES),
    ])
    .await
    .map_err(|error| oauth_error_message(&error))?;
    let refresh_token = token.refresh_token.unwrap_or(stored.refresh_token);
    let mut access_token = token.access_token;
    let profile_result = graph_profile(&access_token).await;
    access_token.zeroize();
    let account = account_from_profile(profile_result?);
    save_connection(
        &app,
        &account,
        &StoredTokenBundle {
            refresh_token,
            scope: token.scope,
        },
    )?;
    Ok(Microsoft365ConnectionStatus {
        configured: true,
        connected: true,
        account: Some(account),
    })
}

#[tauri::command]
pub fn disconnect_m365_account(app: AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    clear_pending_flow(&state)?;
    *state.m365.pending_interactive_state.lock().map_err(|_| {
        "Microsoft-Anmeldung konnte intern nicht zurückgesetzt werden.".to_string()
    })? = None;
    *state.m365.access_token.lock().map_err(|_| {
        "Microsoft-Anmeldung konnte intern nicht zurückgesetzt werden.".to_string()
    })? = None;
    delete_connection_settings(&app)
}

pub(crate) fn clear_runtime(app: &AppHandle) -> Result<(), String> {
    let state = app.state::<AppState>();
    *state.m365.pending_device_flow.lock().map_err(|_| {
        "Microsoft-Anmeldung konnte intern nicht zurückgesetzt werden.".to_string()
    })? = None;
    *state.m365.pending_interactive_state.lock().map_err(|_| {
        "Microsoft-Anmeldung konnte intern nicht zurückgesetzt werden.".to_string()
    })? = None;
    *state.m365.access_token.lock().map_err(|_| {
        "Microsoft-Anmeldung konnte intern nicht zurückgesetzt werden.".to_string()
    })? = None;
    Ok(())
}

#[cfg(target_os = "windows")]
fn protect_secret(secret: &[u8]) -> Result<Vec<u8>, String> {
    use windows::{
        core::PCWSTR,
        Win32::{
            Foundation::{LocalFree, HLOCAL},
            Security::Cryptography::{
                CryptProtectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB,
            },
        },
    };

    let input = CRYPT_INTEGER_BLOB {
        cbData: secret.len() as u32,
        pbData: secret.as_ptr() as *mut u8,
    };
    let entropy = CRYPT_INTEGER_BLOB {
        cbData: DPAPI_ENTROPY.len() as u32,
        pbData: DPAPI_ENTROPY.as_ptr() as *mut u8,
    };
    let mut output = CRYPT_INTEGER_BLOB::default();
    unsafe {
        CryptProtectData(
            &input,
            PCWSTR::null(),
            Some(&entropy),
            None,
            None,
            CRYPTPROTECT_UI_FORBIDDEN,
            &mut output,
        )
    }
    .map_err(|error| {
        format!("Microsoft-Anmeldung konnte von Windows nicht geschützt werden: {error}")
    })?;
    if output.pbData.is_null() || output.cbData == 0 {
        return Err("Windows hat keine geschützten Anmeldedaten geliefert.".to_string());
    }
    let protected =
        unsafe { std::slice::from_raw_parts(output.pbData, output.cbData as usize).to_vec() };
    unsafe {
        LocalFree(Some(HLOCAL(output.pbData.cast())));
    }
    Ok(protected)
}

#[cfg(target_os = "windows")]
fn unprotect_secret(protected_secret: &[u8]) -> Result<Vec<u8>, String> {
    use windows::Win32::{
        Foundation::{LocalFree, HLOCAL},
        Security::Cryptography::{
            CryptUnprotectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB,
        },
    };

    let input = CRYPT_INTEGER_BLOB {
        cbData: protected_secret.len() as u32,
        pbData: protected_secret.as_ptr() as *mut u8,
    };
    let entropy = CRYPT_INTEGER_BLOB {
        cbData: DPAPI_ENTROPY.len() as u32,
        pbData: DPAPI_ENTROPY.as_ptr() as *mut u8,
    };
    let mut output = CRYPT_INTEGER_BLOB::default();
    unsafe {
        CryptUnprotectData(
            &input,
            None,
            Some(&entropy),
            None,
            None,
            CRYPTPROTECT_UI_FORBIDDEN,
            &mut output,
        )
    }
    .map_err(|_| {
        "Die Microsoft-Anmeldung gehört zu einem anderen Windows-Benutzer oder Computer."
            .to_string()
    })?;
    if output.pbData.is_null() || output.cbData == 0 {
        return Err("Die geschützte Microsoft-Anmeldung ist ungültig.".to_string());
    }
    let secret = unsafe {
        let bytes = std::slice::from_raw_parts_mut(output.pbData, output.cbData as usize);
        let secret = bytes.to_vec();
        bytes.zeroize();
        LocalFree(Some(HLOCAL(output.pbData.cast())));
        secret
    };
    Ok(secret)
}

#[cfg(not(target_os = "windows"))]
fn protect_secret(_secret: &[u8]) -> Result<Vec<u8>, String> {
    Err("Microsoft-365-Anmeldung wird derzeit nur unter Windows unterstützt.".to_string())
}

#[cfg(not(target_os = "windows"))]
fn unprotect_secret(_protected_secret: &[u8]) -> Result<Vec<u8>, String> {
    Err("Microsoft-365-Anmeldung wird derzeit nur unter Windows unterstützt.".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn graph_retry_uses_retry_after_and_only_transient_statuses() {
        let mut headers = reqwest::header::HeaderMap::new();
        headers.insert(
            reqwest::header::RETRY_AFTER,
            reqwest::header::HeaderValue::from_static("7"),
        );
        let delay = graph_retry_delay(reqwest::StatusCode::TOO_MANY_REQUESTS, &headers, 0)
            .expect("429 must be retried");
        assert!(delay >= Duration::from_secs(7));
        assert!(delay < Duration::from_secs(8));
        assert!(
            graph_retry_delay(reqwest::StatusCode::INTERNAL_SERVER_ERROR, &headers, 0).is_some()
        );
        assert!(graph_retry_delay(reqwest::StatusCode::BAD_REQUEST, &headers, 0).is_none());
    }

    #[test]
    fn calendar_delta_uses_a_bounded_rolling_window() {
        assert_eq!(
            calendar_delta_window(2026),
            (
                "2025-01-01T00:00:00Z".to_string(),
                "2029-01-01T00:00:00Z".to_string()
            )
        );
        assert_eq!(calendar_delta_window(2027).0, "2026-01-01T00:00:00Z");
    }

    fn contact_for_identity(name: &str, email: &str, phone: &str) -> crate::Contact {
        crate::Contact {
            id: Some(1),
            first_name: String::new(),
            last_name: String::new(),
            display_name: name.to_string(),
            email: email.to_string(),
            private_email: String::new(),
            second_private_email: String::new(),
            phone: phone.to_string(),
            mobile_phone: String::new(),
            private_phone: String::new(),
            second_private_phone: String::new(),
            company: String::new(),
            street: String::new(),
            postal_code: String::new(),
            city: String::new(),
            country: String::new(),
            short_info: String::new(),
            notes: String::new(),
            groups: Vec::new(),
            created_at: String::new(),
            updated_at: String::new(),
            deleted_at: None,
        }
    }

    #[test]
    fn contact_identity_accepts_complementary_email_and_phone() {
        let local = contact_for_identity("Erika Muster", "", "+49 711 12345");
        let remote = serde_json::json!({
            "displayName": "Erika Muster",
            "emailAddresses": [{ "address": "erika@example.org" }],
            "businessPhones": []
        });
        assert!(contact_identity_matches(&local, &remote));
    }

    #[test]
    fn graph_contact_roundtrip_preserves_multiple_addresses_and_company() {
        let mut local = contact_for_identity("Erika Muster", "arbeit@example.org", "+49 711 100");
        local.private_email = "privat@example.org".to_string();
        local.second_private_email = "zweite@example.org".to_string();
        local.private_phone = "+49 711 200".to_string();
        local.second_private_phone = "+49 711 300".to_string();
        local.company = "Beispiel GmbH".to_string();

        let payload = graph_contact_payload(&local);
        let restored = remote_contact_input(&payload, None);
        assert_eq!(restored.email, "arbeit@example.org");
        assert_eq!(restored.private_email, "privat@example.org");
        assert_eq!(restored.second_private_email, "zweite@example.org");
        assert_eq!(restored.private_phone, "+49 711 200");
        assert_eq!(restored.second_private_phone, "+49 711 300");
        assert_eq!(restored.company, "Beispiel GmbH");
    }

    #[test]
    fn contact_identity_rejects_same_name_with_different_emails() {
        let local = contact_for_identity("Erika Muster", "erika.one@example.org", "");
        let remote = serde_json::json!({
            "displayName": "Erika Muster",
            "emailAddresses": [{ "address": "erika.two@example.org" }],
            "businessPhones": []
        });
        assert!(!contact_identity_matches(&local, &remote));
    }

    #[test]
    fn contact_identity_rejects_conflicting_phone_numbers_without_email() {
        let local = contact_for_identity("Erika Muster", "", "+49 711 11111");
        let remote = serde_json::json!({
            "displayName": "Erika Muster",
            "emailAddresses": [],
            "businessPhones": ["+49 711 22222"]
        });
        assert!(!contact_identity_matches(&local, &remote));
    }

    #[test]
    fn contact_identity_matches_mobile_phone_with_different_formatting() {
        let mut local = contact_for_identity("Erika Muster", "", "");
        local.mobile_phone = "+49 171 123 45 67".to_string();
        let remote = serde_json::json!({
            "displayName": "Erika Muster",
            "emailAddresses": [],
            "businessPhones": [],
            "mobilePhone": "0171/1234567"
        });
        assert!(contact_identity_matches(&local, &remote));
    }

    #[test]
    fn import_only_contacts_are_not_blocked_by_an_old_local_queue() {
        assert!(!should_defer_inbound_contact("import", false, true));
    }

    #[test]
    fn pending_local_contact_is_protected_while_an_export_target_exists() {
        assert!(should_defer_inbound_contact("import", true, true));
        assert!(!should_defer_inbound_contact("import", true, false));
    }

    #[test]
    fn matches_calendar_times_independent_of_graph_seconds() {
        assert_eq!(
            normalized_calendar_start("2026-09-10T14:30"),
            normalized_calendar_start("2026-09-10T14:30:00.0000000")
        );
        assert_eq!(
            normalized_calendar_start("2026-09-10T14:30:42Z"),
            "2026-09-10T14:30"
        );
    }

    fn calendar_source(id: &str) -> Microsoft365SyncSource {
        Microsoft365SyncSource {
            id: id.to_string(),
            name: id.to_string(),
            kind: "calendar".to_string(),
            editable: true,
            shared: false,
            resource_path: format!("/me/calendars/{id}/events"),
            mailbox: None,
        }
    }

    #[test]
    fn keeps_the_primary_calendar_instead_of_a_duplicate_group_alias() {
        let primary = calendar_source("calendar-a");
        let mut alias = primary.clone();
        alias.name = "My Calendars · calendar-a".to_string();
        alias.shared = true;
        alias.resource_path = "/me/calendarGroups/group/calendars/calendar-a".to_string();
        let mut calendars = vec![primary.clone()];

        append_unique_calendar_sources(&mut calendars, [alias, calendar_source("calendar-b")]);

        assert_eq!(calendars.len(), 2);
        assert_eq!(calendars[0].resource_path, primary.resource_path);
    }

    #[test]
    fn normalizes_an_old_group_alias_without_changing_the_event() {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE calendar_events (
                id TEXT PRIMARY KEY, event_json TEXT NOT NULL, deleted_at TEXT
            );",
        )
        .unwrap();
        let source = calendar_source("calendar-a");
        let original = json!({
            "title": "Mittagspause",
            "source": "Microsoft 365 · My Calendars · calendar-a"
        });
        conn.execute(
            "INSERT INTO calendar_events (id, event_json) VALUES (?1, ?2)",
            params!["m365:calendar-a:event-1", original.to_string()],
        )
        .unwrap();

        assert_eq!(normalize_calendar_source_label(&conn, &source).unwrap(), 1);
        let updated: String = conn
            .query_row("SELECT event_json FROM calendar_events", [], |row| {
                row.get(0)
            })
            .unwrap();
        let updated: Value = serde_json::from_str(&updated).unwrap();
        assert_eq!(updated["title"], original["title"]);
        assert_eq!(updated["source"], "Microsoft 365 · calendar-a");
        assert_eq!(normalize_calendar_source_label(&conn, &source).unwrap(), 0);
    }

    #[test]
    fn selects_blank_local_and_pending_titles_without_repeating_deferred_attempts() {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE calendar_events (
                id TEXT PRIMARY KEY, starts_at TEXT NOT NULL,
                event_json TEXT NOT NULL, deleted_at TEXT
            );
            CREATE TABLE m365_calendar_delta_changes (
                source_id TEXT NOT NULL, remote_id TEXT NOT NULL,
                change_kind TEXT NOT NULL, payload_json TEXT
            );
            CREATE TABLE m365_calendar_title_repair_attempts (
                source_id TEXT NOT NULL, remote_id TEXT NOT NULL,
                retry_after TEXT NOT NULL,
                PRIMARY KEY (source_id, remote_id)
            );",
        )
        .unwrap();
        let source = calendar_source("calendar-a");
        conn.execute(
            "INSERT INTO calendar_events (id, starts_at, event_json) VALUES (?1, ?2, ?3)",
            params![
                "m365:calendar-a:event-1",
                "2026-10-02T12:00:00",
                json!({"title":"","source":"Microsoft 365 · My Calendars · calendar-a"})
                    .to_string()
            ],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO m365_calendar_delta_changes (source_id, remote_id, change_kind, payload_json)
             VALUES (?1, ?2, 'upsert', ?3)",
            params!["calendar-a", "event-2", json!({"id":"event-2","subject":""}).to_string()],
        )
        .unwrap();
        assert_eq!(
            blank_calendar_title_candidates(&conn, &source, "2026-10-02T13:00:00Z", 10).unwrap(),
            vec!["event-2", "event-1"]
        );
        conn.execute(
            "INSERT INTO m365_calendar_title_repair_attempts VALUES ('calendar-a', 'event-1', '2026-10-02T15:00:00Z')",
            [],
        )
        .unwrap();
        assert_eq!(
            blank_calendar_title_candidates(&conn, &source, "2026-10-02T13:00:00Z", 10).unwrap(),
            vec!["event-2"]
        );
        conn.execute(
            "UPDATE calendar_events SET event_json = ?1 WHERE id = ?2",
            params![
                json!({"title":"Mittagspause"}).to_string(),
                "m365:calendar-a:event-1"
            ],
        )
        .unwrap();
        assert_eq!(
            blank_calendar_title_candidates(&conn, &source, "2026-10-02T16:00:00Z", 10).unwrap(),
            vec!["event-2"]
        );
    }

    #[test]
    fn calendar_delta_quarters_prioritize_today_and_cover_the_entire_window() {
        let windows = calendar_delta_quarters(2026, 10);
        assert_eq!(windows.len(), 16);
        assert_eq!(
            windows[0],
            (
                "2026-10-01T00:00:00Z".to_string(),
                "2027-01-01T00:00:00Z".to_string()
            )
        );
        let mut sorted = windows.clone();
        sorted.sort();
        let range = calendar_delta_window(2026);
        assert_eq!(sorted.first().unwrap().0, range.0);
        assert_eq!(sorted.last().unwrap().1, range.1);
        for pair in sorted.windows(2) {
            assert_eq!(pair[0].1, pair[1].0);
        }
        assert_eq!(
            calendar_delta_quarters(2026, 1)[0].0,
            "2026-01-01T00:00:00Z"
        );
    }

    #[test]
    fn outbox_lookup_covers_local_times_across_summer_and_winter_offsets() {
        for (date, start, end) in [
            (
                "2026-10-08T08:30",
                "2026-10-07T00:00:00Z",
                "2026-10-10T00:00:00Z",
            ),
            (
                "2026-03-29T00:15:00",
                "2026-03-28T00:00:00Z",
                "2026-03-31T00:00:00Z",
            ),
            (
                "2026-10-25T23:45:00",
                "2026-10-24T00:00:00Z",
                "2026-10-27T00:00:00Z",
            ),
        ] {
            assert_eq!(
                calendar_outbox_lookup_window(date).unwrap(),
                (start.to_string(), end.to_string())
            );
        }
        assert!(calendar_outbox_lookup_window("invalid").is_err());
    }

    #[test]
    fn calendar_delta_checkpoint_resumes_pages_and_rolls_back_on_failure() {
        let mut conn = rusqlite::Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE m365_calendar_delta_changes (
                source_id TEXT NOT NULL, remote_id TEXT NOT NULL,
                change_kind TEXT NOT NULL, payload_json TEXT, received_at TEXT NOT NULL,
                PRIMARY KEY (source_id, remote_id));
             CREATE TABLE m365_calendar_delta_state (
                source_id TEXT PRIMARY KEY, delta_link TEXT NOT NULL,
                window_start TEXT NOT NULL, window_end TEXT NOT NULL, updated_at TEXT NOT NULL);",
        )
        .unwrap();
        checkpoint_calendar_delta_page(
            &mut conn,
            "calendar-a",
            &[json!({"id":"event-1", "subject":"First"})],
            "next-page-2",
        )
        .unwrap();
        checkpoint_calendar_delta_page(
            &mut conn,
            "calendar-a",
            &[json!({"id":"event-2", "subject":"Second"})],
            "next-page-3",
        )
        .unwrap();
        let cursor: String = conn
            .query_row(
                "SELECT delta_link FROM m365_calendar_delta_state",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(cursor, "next-page-3");
        let count: usize = conn
            .query_row(
                "SELECT COUNT(*) FROM m365_calendar_delta_changes",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(count, 2);
        conn.execute_batch("CREATE TRIGGER fail_checkpoint BEFORE UPDATE ON m365_calendar_delta_state BEGIN SELECT RAISE(ABORT, 'checkpoint failed'); END;").unwrap();
        assert!(checkpoint_calendar_delta_page(
            &mut conn,
            "calendar-a",
            &[json!({"id":"event-3"})],
            "final-delta"
        )
        .is_err());
        let count: usize = conn
            .query_row(
                "SELECT COUNT(*) FROM m365_calendar_delta_changes",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(count, 2);
        let cursor: String = conn
            .query_row(
                "SELECT delta_link FROM m365_calendar_delta_state",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(cursor, "next-page-3");
        conn.execute_batch("DROP TRIGGER fail_checkpoint;").unwrap();
        checkpoint_calendar_delta_page(&mut conn, "calendar-a", &[], "final-delta").unwrap();
        let cursor: String = conn
            .query_row(
                "SELECT delta_link FROM m365_calendar_delta_state",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(cursor, "final-delta");
    }

    #[test]
    fn sparse_graph_events_preserve_existing_details_while_updating_present_fields() {
        let source = calendar_source("calendar-a");
        let mut existing = calendar_event("m365:calendar-a:event-1");
        existing.title = "Mittagspause".to_string();
        existing.location = "Besprechungsraum".to_string();
        existing.description = "Wichtige Notizen".to_string();
        existing.category = "Red category".to_string();
        existing.meeting.required_attendees = vec!["person@example.org".to_string()];
        existing.meeting.is_private = true;
        let incoming = json!({
            "id": "event-1", "subject": "",
            "start": {"dateTime":"2026-10-02T12:00:00"},
            "end": {"dateTime":"2026-10-02T13:00:00"}
        });
        let mapped = remote_event_to_local(&incoming, &source, Some(&existing));
        assert_eq!(mapped.title, "Mittagspause");
        assert_eq!(mapped.starts_at, "2026-10-02T12:00:00");
        assert_eq!(mapped.location, existing.location);
        assert_eq!(mapped.description, existing.description);
        assert_eq!(mapped.category, existing.category);
        assert_eq!(
            mapped.meeting.required_attendees,
            existing.meeting.required_attendees
        );
        assert!(mapped.meeting.is_private);
    }

    fn calendar_sync_request(selected_ids: &[&str]) -> Microsoft365SyncPreviewRequest {
        Microsoft365SyncPreviewRequest {
            direction: "bidirectional".to_string(),
            base: "local".to_string(),
            contacts: false,
            contact_groups: false,
            calendars: true,
            shared_calendars: false,
            shared_mailboxes: false,
            shared_mailbox_addresses: Vec::new(),
            selected_contact_source_ids: Vec::new(),
            selected_calendar_source_ids: selected_ids.iter().map(|id| (*id).to_string()).collect(),
            source_directions: HashMap::new(),
            backup: crate::BackupData {
                version: "test".to_string(),
                exported_at: "2026-09-01T00:00:00Z".to_string(),
                contacts: Vec::new(),
                groups: Vec::new(),
                settings: Vec::new(),
                browser_storage: HashMap::new(),
            },
        }
    }

    fn calendar_event(id: &str) -> crate::CalendarEvent {
        crate::CalendarEvent {
            calendar_source_id: None,
            id: id.to_string(),
            updated_at: "2026-09-01T00:00:00Z".to_string(),
            title: "Besprechung".to_string(),
            starts_at: "2026-09-01T09:00:00".to_string(),
            ends_at: "2026-09-01T10:00:00".to_string(),
            is_all_day: false,
            location: String::new(),
            description: String::new(),
            color: "blue".to_string(),
            category: String::new(),
            source: "AgendaKontakte".to_string(),
            recurrence: None,
            excluded_dates: Vec::new(),
            deleted_at: None,
            recurrence_master_id: None,
            recurrence_id: None,
            meeting: crate::CalendarMeetingOptions::default(),
        }
    }

    fn planned_operation(kind: &str, action: &str, id: usize) -> PlannedOperation {
        PlannedOperation {
            change: Microsoft365SyncChange {
                id: format!("{kind}-{id}"),
                kind: kind.to_string(),
                action: action.to_string(),
                source_id: "source".to_string(),
                source_name: "Testquelle".to_string(),
                title: "Test".to_string(),
                detail: String::new(),
                local_summary: None,
                remote_summary: None,
            },
            source: calendar_source("source"),
            payload: PlannedPayload::Calendar {
                local: Some(calendar_event(&format!("event-{id}"))),
                remote: None,
            },
        }
    }

    #[test]
    fn calendar_writes_are_not_starved_by_a_large_contact_queue() {
        let mut operations = Vec::new();
        for id in 0..MAX_CONTACT_OPERATIONS_PER_SYNC {
            push_operation(&mut operations, planned_operation("Kontakt", "link", id));
        }
        for id in 0..MAX_CALENDAR_OPERATIONS_PER_SYNC {
            push_operation(
                &mut operations,
                planned_operation("Kalender", "createRemote", id),
            );
        }

        assert_eq!(
            operations
                .iter()
                .filter(|operation| operation.change.kind == "Kontakt")
                .count(),
            MAX_CONTACT_OPERATIONS_PER_SYNC
        );
        assert_eq!(
            operations
                .iter()
                .filter(|operation| operation.change.kind == "Kalender")
                .count(),
            MAX_CALENDAR_OPERATIONS_PER_SYNC
        );
    }

    #[test]
    fn a_calendar_write_replaces_a_low_priority_link_in_a_full_batch() {
        let mut operations = Vec::new();
        for id in 0..MAX_CALENDAR_OPERATIONS_PER_SYNC {
            push_operation(&mut operations, planned_operation("Kalender", "link", id));
        }
        push_operation(
            &mut operations,
            planned_operation("Kalender", "createRemote", 999),
        );

        assert!(operations.iter().any(|operation| {
            operation.change.kind == "Kalender"
                && operation.change.action == "createRemote"
                && operation.change.id == "Kalender-999"
        }));
    }

    #[test]
    fn calendar_writes_run_before_a_contact_backlog() {
        let mut operations = vec![
            planned_operation("Kontakt", "createRemote", 1),
            planned_operation("Kalender", "link", 2),
            planned_operation("Kalender", "createRemote", 3),
        ];
        prioritize_operations(&mut operations);

        assert_eq!(operations[0].change.kind, "Kalender");
        assert_eq!(operations[0].change.action, "createRemote");
    }

    #[test]
    fn form_values_are_encoded_without_losing_scopes() {
        assert_eq!(
            form_body(&[("scope", LOGIN_SCOPES)]),
            "scope=openid+profile+offline_access+User.Read+Contacts.ReadWrite+Contacts.ReadWrite.Shared+Calendars.ReadWrite+Calendars.ReadWrite.Shared+Calendars.Read.Shared+MailboxSettings.ReadWrite+Files.ReadWrite.All+Sites.Read.All"
        );
    }

    #[test]
    fn exports_a_new_local_event_to_only_one_selected_calendar() {
        let sources = vec![calendar_source("calendar-a"), calendar_source("calendar-b")];
        let request = calendar_sync_request(&["calendar-a", "calendar-b"]);
        let selected = request
            .selected_calendar_source_ids
            .iter()
            .map(String::as_str)
            .collect::<HashSet<_>>();
        let target = calendar_export_target_id(&request, &sources, &selected);
        let event = calendar_event("local-event");

        assert_eq!(target, Some("calendar-a"));
        assert!(local_event_belongs_to_calendar_source(
            &event,
            &sources[0],
            &sources,
            target
        ));
        assert!(!local_event_belongs_to_calendar_source(
            &event,
            &sources[1],
            &sources,
            target
        ));
    }

    #[test]
    fn keeps_an_imported_event_bound_to_its_exchange_calendar() {
        let sources = vec![calendar_source("calendar-a"), calendar_source("calendar-b")];
        let request = calendar_sync_request(&["calendar-a", "calendar-b"]);
        let selected = request
            .selected_calendar_source_ids
            .iter()
            .map(String::as_str)
            .collect::<HashSet<_>>();
        let target = calendar_export_target_id(&request, &sources, &selected);
        let event = calendar_event("m365:calendar-b:remote-event");

        assert!(!local_event_belongs_to_calendar_source(
            &event,
            &sources[0],
            &sources,
            target
        ));
        assert!(local_event_belongs_to_calendar_source(
            &event,
            &sources[1],
            &sources,
            target
        ));
    }

    #[test]
    fn explicit_calendar_destination_overrides_the_default_export_target() {
        let sources = vec![calendar_source("a"), calendar_source("b")];
        let mut event = calendar_event("draft");
        event.calendar_source_id = Some("b".to_string());
        assert!(!local_event_belongs_to_calendar_source(
            &event,
            &sources[0],
            &sources,
            Some("a")
        ));
        assert!(local_event_belongs_to_calendar_source(
            &event,
            &sources[1],
            &sources,
            Some("a")
        ));
        event.calendar_source_id = Some("local:DMH Backup".to_string());
        assert!(!local_event_belongs_to_calendar_source(
            &event,
            &sources[0],
            &sources,
            Some("a")
        ));
        assert!(!local_event_belongs_to_calendar_source(
            &event,
            &sources[1],
            &sources,
            Some("a")
        ));
        event.id = "m365:a:existing".to_string();
        event.calendar_source_id = Some("b".to_string());
        // Existing appointments move through the durable outbox, not a second
        // create operation in a simultaneous/manual reconciliation plan.
        assert!(!local_event_belongs_to_calendar_source(
            &event,
            &sources[0],
            &sources,
            Some("a")
        ));
        assert!(!local_event_belongs_to_calendar_source(
            &event,
            &sources[1],
            &sources,
            Some("a")
        ));
    }

    #[test]
    fn skips_import_only_calendars_when_choosing_the_export_target() {
        let sources = vec![calendar_source("calendar-a"), calendar_source("calendar-b")];
        let mut request = calendar_sync_request(&["calendar-a", "calendar-b"]);
        request
            .source_directions
            .insert("calendar-a".to_string(), "import".to_string());
        let selected = request
            .selected_calendar_source_ids
            .iter()
            .map(String::as_str)
            .collect::<HashSet<_>>();

        assert_eq!(
            calendar_export_target_id(&request, &sources, &selected),
            Some("calendar-b")
        );
    }

    #[test]
    fn converts_exchange_html_descriptions_to_readable_text() {
        let source = calendar_source("calendar-a");
        let event = remote_event_to_local(
            &json!({
                "id": "event-html",
                "subject": "Besprechung",
                "start": { "dateTime": "2026-09-01T09:00:00" },
                "end": { "dateTime": "2026-09-01T10:00:00" },
                "body": {
                    "contentType": "html",
                    "content": "<html><head><style>.x{color:red}</style></head><body><p>Hallo&nbsp;Team</p><div>Termin &amp; Planung<br>Raum 2</div></body></html>"
                }
            }),
            &source,
            None,
        );

        assert_eq!(event.description, "Hallo Team\nTermin & Planung\nRaum 2");

        let mut local = calendar_event("local-html");
        local.description = "<p>Lokaler&nbsp;Text</p>".to_string();
        assert_eq!(
            graph_event_payload(&local)["body"]["content"],
            "Lokaler Text"
        );
    }

    #[test]
    fn swaps_reversed_calendar_times_before_sending_to_graph() {
        let mut event = calendar_event("reversed-times");
        event.starts_at = "2026-10-02T15:00:00".to_string();
        event.ends_at = "2026-10-02T09:00:00".to_string();

        let payload = graph_event_payload(&event);

        assert_eq!(payload["start"]["dateTime"], "2026-10-02T09:00:00");
        assert_eq!(payload["end"]["dateTime"], "2026-10-02T15:00:00");
    }

    #[test]
    fn sends_a_color_category_for_local_calendar_events() {
        let mut event = calendar_event("category-color");
        event.color = "green".to_string();

        assert_eq!(
            graph_event_payload(&event)["categories"][0],
            "DMH Farbe: Grün"
        );

        event.category = "Ausgangskalender".to_string();
        assert_eq!(
            graph_event_payload(&event)["categories"][0],
            "Ausgangskalender"
        );

        event.category.clear();
        event.color = "gray".to_string();
        assert_eq!(graph_event_payload(&event)["categories"], json!([]));
        event.color = "blue".to_string();
        assert_eq!(graph_event_payload(&event)["categories"], json!([]));

        event.category = "DMH Farbe: Grau".to_string();
        assert_eq!(
            graph_event_payload(&event)["categories"][0],
            "DMH Farbe: Blau"
        );
    }

    #[test]
    fn preserves_teams_meeting_options_in_calendar_sync() {
        let source = calendar_source("calendar-a");
        let imported = remote_event_to_local(
            &json!({
                "id": "teams-event",
                "subject": "Planung",
                "start": { "dateTime": "2026-09-01T09:00:00" },
                "end": { "dateTime": "2026-09-01T10:00:00" },
                "attendees": [
                    { "emailAddress": { "address": "required@example.org" }, "type": "required" },
                    { "emailAddress": { "address": "optional@example.org" }, "type": "optional" }
                ],
                "showAs": "tentative",
                "isReminderOn": true,
                "reminderMinutesBeforeStart": 30,
                "sensitivity": "private",
                "isOnlineMeeting": true,
                "onlineMeeting": { "joinUrl": "https://teams.microsoft.com/l/meetup-join/test" }
            }),
            &source,
            None,
        );

        assert_eq!(
            imported.meeting.required_attendees,
            ["required@example.org"]
        );
        assert_eq!(
            imported.meeting.optional_attendees,
            ["optional@example.org"]
        );
        assert_eq!(imported.meeting.show_as, "tentative");
        assert_eq!(imported.meeting.reminder_minutes, Some(30));
        assert!(imported.meeting.is_private);
        assert!(imported.meeting.is_online_meeting);
        assert!(imported
            .meeting
            .online_meeting_url
            .contains("teams.microsoft.com"));

        let payload = graph_event_payload(&imported);
        assert_eq!(payload["attendees"].as_array().map(Vec::len), Some(2));
        assert_eq!(payload["showAs"], "tentative");
        assert_eq!(payload["reminderMinutesBeforeStart"], 30);
        assert_eq!(payload["sensitivity"], "private");
        assert_eq!(payload["onlineMeetingProvider"], "teamsForBusiness");
    }

    #[test]
    fn preserves_all_day_events_in_calendar_sync() {
        let source = calendar_source("calendar-a");
        let imported = remote_event_to_local(
            &json!({
                "id": "all-day-event",
                "subject": "Fortbildung",
                "start": { "dateTime": "2026-09-22T00:00:00" },
                "end": { "dateTime": "2026-09-23T00:00:00" },
                "isAllDay": true
            }),
            &source,
            None,
        );

        assert!(imported.is_all_day);
        assert_eq!(imported.starts_at, "2026-09-22T00:00:00");
        assert_eq!(imported.ends_at, "2026-09-23T00:00:00");

        let payload = graph_event_payload(&imported);
        assert_eq!(payload["isAllDay"], true);
        assert_eq!(payload["start"]["dateTime"], "2026-09-22T00:00:00");
        assert_eq!(payload["end"]["dateTime"], "2026-09-23T00:00:00");
    }

    #[test]
    fn marks_only_extra_calendar_copies_for_cleanup() {
        let sources = vec![
            calendar_source("calendar-a"),
            calendar_source("calendar-b"),
            calendar_source("calendar-c"),
        ];
        let kept = calendar_event("m365:calendar-a:event-1");
        let duplicate_two = calendar_event("m365:calendar-b:event-2");
        let duplicate_three = calendar_event("m365:calendar-c:event-3");
        let mut single = calendar_event("m365:calendar-b:event-single");
        single.title = "Einmaliger Termin".to_string();

        let duplicate_ids = duplicate_calendar_event_ids(
            &[kept, duplicate_two, duplicate_three, single],
            &sources,
            Some("calendar-a"),
        );

        assert_eq!(duplicate_ids.len(), 2);
        assert!(duplicate_ids.contains("m365:calendar-b:event-2"));
        assert!(duplicate_ids.contains("m365:calendar-c:event-3"));
        assert!(!duplicate_ids.contains("m365:calendar-a:event-1"));
        assert!(!duplicate_ids.contains("m365:calendar-b:event-single"));
    }

    #[test]
    fn import_only_calendar_refresh_never_plans_duplicate_cleanup() {
        let sources = vec![calendar_source("calendar-a")];
        let mut request = calendar_sync_request(&["calendar-a"]);
        request
            .source_directions
            .insert("calendar-a".to_string(), "import".to_string());
        let selected = HashSet::from(["calendar-a"]);

        assert!(!should_plan_calendar_duplicate_cleanup(
            &request, &sources, &selected
        ));
        request
            .source_directions
            .insert("calendar-a".to_string(), "bidirectional".to_string());
        assert!(should_plan_calendar_duplicate_cleanup(
            &request, &sources, &selected
        ));
    }

    #[test]
    fn rejects_unsafe_tenant_values() {
        assert!(is_tenant("organizations"));
        assert!(is_tenant("tenant.onmicrosoft.com"));
        assert!(!is_tenant("../common?redirect=evil"));
    }

    #[test]
    fn encodes_shared_mailbox_path_segments() {
        assert_eq!(
            encode_graph_path_segment("team+archive@example.com"),
            "team%2Barchive%40example.com"
        );
        assert_eq!(
            encode_graph_path_segment("shared mailbox@example.com"),
            "shared%20mailbox%40example.com"
        );
    }

    #[test]
    fn oauth_errors_are_safe_and_understandable() {
        assert_eq!(
            oauth_error_message(&OAuthErrorResponse {
                error: "authorization_declined".to_string(),
                error_description: "untrusted detail".to_string(),
            }),
            "Die Microsoft-Anmeldung wurde abgelehnt."
        );
    }

    #[test]
    fn builds_pkce_authorization_url_for_the_loopback_callback() {
        let url = interactive_authorization_url(
            "11111111-2222-3333-4444-555555555555",
            "http://localhost:45678",
            "expected-state",
            "expected-challenge",
        );
        let parsed = url::Url::parse(&url).expect("authorization URL");
        let query = parsed.query_pairs().into_owned().collect::<HashMap<_, _>>();

        assert!(parsed.path().ends_with("/oauth2/v2.0/authorize"));
        assert_eq!(query.get("response_type").map(String::as_str), Some("code"));
        assert_eq!(
            query.get("redirect_uri").map(String::as_str),
            Some("http://localhost:45678")
        );
        assert_eq!(
            query.get("state").map(String::as_str),
            Some("expected-state")
        );
        assert_eq!(
            query.get("code_challenge_method").map(String::as_str),
            Some("S256")
        );
        assert_eq!(
            query.get("code_challenge").map(String::as_str),
            Some("expected-challenge")
        );
    }

    #[test]
    fn parses_and_decodes_the_interactive_callback() {
        let callback = parse_authorization_callback(
            "/?code=abc%2B123&state=expected-state&session_state=ignored",
        )
        .expect("valid callback");

        assert_eq!(callback.code, "abc+123");
        assert_eq!(callback.state, "expected-state");
        assert!(
            parse_authorization_callback("/?error=access_denied&state=expected-state")
                .unwrap_err()
                .contains("abgebrochen")
        );
    }

    #[test]
    fn creates_a_valid_pkce_s256_challenge() {
        assert_eq!(
            pkce_challenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"),
            "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
        );
    }

    #[test]
    fn distinguishes_expired_sessions_from_temporary_connection_errors() {
        assert!(microsoft_session_requires_reconnect(
            "Die Microsoft-Sitzung ist abgelaufen. Verbinden Sie das Konto erneut."
        ));
        assert!(!microsoft_session_requires_reconnect(
            "Microsoft Graph ist derzeit nicht erreichbar. Internetverbindung prüfen."
        ));
    }

    #[test]
    fn maps_graph_contact_fields_into_a_local_contact() {
        let contact = remote_contact_input(
            &json!({
                "givenName": "Ada",
                "surname": "Lovelace",
                "displayName": "Ada Lovelace",
                "emailAddresses": [{ "address": "ada@example.com" }],
                "businessPhones": ["+49 711 1234"],
                "mobilePhone": "+49 170 1234",
                "businessAddress": {
                    "street": "Musterweg 1",
                    "postalCode": "70173",
                    "city": "Stuttgart",
                    "countryOrRegion": "Deutschland"
                },
                "personalNotes": "Aus Microsoft 365"
            }),
            None,
        );

        assert_eq!(contact.display_name, "Ada Lovelace");
        assert_eq!(contact.email, "ada@example.com");
        assert_eq!(contact.phone, "+49 711 1234");
        assert_eq!(contact.city, "Stuttgart");
        assert_eq!(contact.notes, "Aus Microsoft 365");
    }

    #[test]
    fn maps_graph_event_and_keeps_its_selected_source_visible() {
        let source = Microsoft365SyncSource {
            id: "me:calendar:team".to_string(),
            name: "Teamkalender".to_string(),
            kind: "calendar".to_string(),
            editable: true,
            shared: false,
            resource_path: "/me/calendars/team/events".to_string(),
            mailbox: None,
        };
        let event = remote_event_to_local(
            &json!({
                "id": "event-42",
                "subject": "Besprechung",
                "start": { "dateTime": "2026-08-18T09:00:00" },
                "end": { "dateTime": "2026-08-18T10:00:00" },
                "location": { "displayName": "Büro" },
                "body": { "content": "Planung" },
                "categories": ["Wichtig"],
                "_dmhCategoryColor": "red"
            }),
            &source,
            None,
        );

        assert_eq!(event.id, "m365:me:calendar:team:event-42");
        assert_eq!(event.title, "Besprechung");
        assert_eq!(event.category, "Wichtig");
        assert_eq!(event.color, "red");
        assert_eq!(event.source, "Microsoft 365 · Teamkalender");
        assert_eq!(
            linked_calendar_remote_id(&event, &source.id),
            Some("event-42")
        );
    }

    #[test]
    fn relinks_legacy_local_calendar_ids_to_the_graph_event() {
        let source = Microsoft365SyncSource {
            id: "me:calendar:team".to_string(),
            name: "Teamkalender".to_string(),
            kind: "calendar".to_string(),
            editable: true,
            shared: false,
            resource_path: "/me/calendars/team/events".to_string(),
            mailbox: None,
        };
        let remote = json!({
            "id": "event-99",
            "lastModifiedDateTime": "2026-08-27T10:00:00Z",
            "subject": "Arzttermin",
            "start": { "dateTime": "2026-08-28T09:00:00" },
            "end": { "dateTime": "2026-08-28T10:00:00" }
        });
        let mut legacy = remote_event_to_local(&remote, &source, None);
        legacy.id = "local-before-link".to_string();

        let linked = remote_event_to_local(&remote, &source, Some(&legacy));

        assert_eq!(linked.id, "m365:me:calendar:team:event-99");
        assert_eq!(linked.updated_at, "2026-08-27T10:00:00Z");
    }

    #[test]
    fn maps_outlook_category_presets_to_the_local_palette() {
        assert_eq!(outlook_category_color("preset0"), "red");
        assert_eq!(outlook_category_color("preset4"), "green");
        assert_eq!(outlook_category_color("preset7"), "blue");
        assert_eq!(outlook_category_color("preset8"), "purple");
        assert_eq!(outlook_category_color("preset12"), "gray");
        assert_eq!(outlook_category_color("preset18"), "yellow");
        assert_eq!(outlook_category_color("None"), "gray");
        assert_eq!(outlook_category_color("unknown"), "gray");
        assert_eq!(dmh_category_for_calendar_color("yellow").1, "preset3");
    }

    #[test]
    fn stale_event_colors_do_not_reset_the_chosen_exchange_color() {
        let chosen = json!({ "displayName": "DMH Farbe: Blau", "color": "preset4" });
        assert_eq!(
            expected_calendar_category_preset("DMH Farbe: Blau", "blue", Some(&chosen), false),
            "preset4"
        );
        let uncolored = json!({ "displayName": "DMH Farbe: Blau", "color": "None" });
        assert_eq!(
            expected_calendar_category_preset("DMH Farbe: Blau", "green", Some(&uncolored), false),
            "preset7"
        );
        assert_eq!(
            expected_calendar_category_preset("DMH Farbe: Blau", "green", None, false),
            "preset7"
        );
        assert_eq!(
            expected_calendar_category_preset("Vortrag", "green", None, false),
            "preset4"
        );
    }

    #[test]
    fn explicit_app_color_choices_override_remote_color_for_the_color_category() {
        let old = json!({ "displayName": "DMH Farbe: Blau", "color": "preset4" });
        for (color, preset) in [
            ("blue", "preset7"),
            ("green", "preset4"),
            ("yellow", "preset3"),
            ("red", "preset0"),
            ("purple", "preset8"),
        ] {
            assert_eq!(
                expected_calendar_category_preset("DMH Farbe: Blau", color, Some(&old), true),
                preset
            );
        }
        let gray = json!({ "color": "preset14" });
        assert_eq!(
            expected_calendar_category_preset("Kategorie", "blue", Some(&gray), false),
            "preset14"
        );
    }

    #[test]
    fn remote_category_assignment_and_removal_update_the_local_color() {
        let source = calendar_source("calendar-a");
        let mut local = calendar_event("m365:calendar-a:event-1");
        local.category = "Vortrag".to_string();
        local.color = "red".to_string();
        let colors = HashMap::from([("vortrag".to_string(), "green".to_string())]);
        for (categories, expected_category, expected_color) in [
            (json!(["Vortrag"]), "Vortrag", "green"),
            (json!([]), "", "blue"),
            (
                json!(["Unbekannte Kategorie"]),
                "Unbekannte Kategorie",
                "gray",
            ),
        ] {
            let mut remote = json!({ "id": "event-1", "categories": categories });
            apply_m365_category_color(&mut remote, &colors);
            let mapped = remote_event_to_local(&remote, &source, Some(&local));
            assert_eq!(mapped.category, expected_category);
            assert_eq!(mapped.color, expected_color);
            assert_eq!(mapped.title, local.title);
        }
    }

    #[test]
    fn master_category_color_changes_refresh_events_without_event_delta_or_outgoing_writes() {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        conn.execute_batch("CREATE TABLE calendar_events (id TEXT PRIMARY KEY, starts_at TEXT, updated_at TEXT, deleted_at TEXT, event_json TEXT);
            CREATE TABLE audit_context (id INTEGER PRIMARY KEY, source TEXT);
            INSERT INTO audit_context VALUES (1, 'user');
            CREATE TABLE calendar_sync_outbox (event_id TEXT PRIMARY KEY, action TEXT, attempts INTEGER);").unwrap();
        for id in [
            "m365:calendar-a:event-1",
            "m365:calendar-b:event-2",
            "local-event",
        ] {
            let mut event = calendar_event(id);
            event.category = "Vortrag".to_string();
            event.color = "red".to_string();
            conn.execute(
                "INSERT INTO calendar_events VALUES (?1, ?2, 'unchanged', NULL, ?3)",
                params![id, event.starts_at, serde_json::to_string(&event).unwrap()],
            )
            .unwrap();
        }
        conn.execute(
            "INSERT INTO calendar_sync_outbox VALUES ('m365:calendar-a:event-1', 'upsert', 2)",
            [],
        )
        .unwrap();
        let categories = vec![Microsoft365CalendarCategory {
            name: "vOrTrAg".to_string(),
            color: "green".to_string(),
        }];
        let changed = refresh_calendar_category_colors_in_db(
            &conn,
            &categories,
            Some(&["calendar-a".to_string()]),
        )
        .unwrap();
        assert_eq!(changed.len(), 1);
        assert_eq!(changed[0].color, "green");
        assert_eq!(
            changed[0].updated_at,
            calendar_event("m365:calendar-a:event-1").updated_at
        );
        let events = crate::read_calendar_events(&conn, false).unwrap();
        assert!(events
            .iter()
            .filter(|event| event.id != changed[0].id)
            .all(|event| event.color == "red"));
        let (action, attempts): (String, usize) = conn
            .query_row(
                "SELECT action, attempts FROM calendar_sync_outbox",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!((action.as_str(), attempts), ("upsert", 2));
        assert_eq!(
            conn.query_row(
                "SELECT updated_at FROM calendar_events WHERE id = ?1",
                [&changed[0].id],
                |row| row.get::<_, String>(0)
            )
            .unwrap(),
            "unchanged"
        );
        assert!(refresh_calendar_category_colors_in_db(
            &conn,
            &categories,
            Some(&["calendar-a".to_string()])
        )
        .unwrap()
        .is_empty());
        let local_category_change = vec![Microsoft365CalendarCategory {
            name: "Vortrag".to_string(),
            color: "purple".to_string(),
        }];
        assert_eq!(
            refresh_calendar_category_colors_in_db(&conn, &local_category_change, None)
                .unwrap()
                .len(),
            3
        );
        assert_eq!(
            conn.query_row("SELECT COUNT(*) FROM calendar_sync_outbox", [], |row| row
                .get::<_, usize>(
                0
            ))
            .unwrap(),
            1
        );
    }

    #[test]
    fn category_verification_rejects_missing_gray_and_wrong_visible_colors() {
        let needed = HashMap::from([(
            "dmh farbe: blau".to_string(),
            ("DMH Farbe: Blau".to_string(), "preset7".to_string()),
        )]);
        assert!(verified_calendar_category_names(vec![], &needed).is_err());
        for color in ["None", "preset12", "preset14", "preset4"] {
            let actual = vec![json!({ "displayName": "DMH Farbe: Blau", "color": color })];
            assert!(
                verified_calendar_category_names(actual, &needed).is_err(),
                "{color}"
            );
        }
        let actual = vec![json!({ "displayName": "DMH Farbe: Blau", "color": "Preset7" })];
        assert_eq!(
            verified_calendar_category_names(actual, &needed).unwrap()["dmh farbe: blau"],
            "DMH Farbe: Blau"
        );
    }

    #[test]
    fn accepted_patch_is_not_success_without_the_persisted_event_category() {
        for saved in [
            json!({}),
            json!({ "categories": [] }),
            json!({ "categories": ["Black category"] }),
            json!({ "categories": ["Black category", "DMH Farbe: Blau"] }),
        ] {
            assert!(verify_calendar_event_category(&saved, "DMH Farbe: Blau").is_err());
        }
        assert!(verify_calendar_event_category(
            &json!({ "categories": ["DMH Farbe: Blau"] }),
            "DMH Farbe: Blau"
        )
        .is_ok());
    }

    #[test]
    fn treats_uncolored_and_gray_exchange_categories_as_needing_repair() {
        for value in [
            "None", "preset10", "preset11", "preset12", "preset13", "preset14", "",
        ] {
            assert!(
                !outlook_category_has_color(value),
                "{value} should be repaired"
            );
        }
        for value in [
            "preset0", "preset1", "preset4", "preset7", "preset8", "preset24",
        ] {
            assert!(
                outlook_category_has_color(value),
                "{value} has a visible color"
            );
        }
        assert_eq!(
            dmh_category_for_calendar_color("gray"),
            ("DMH Farbe: Blau", "preset7")
        );
        assert!(category_needs_repair(
            "DMH Farbe: Blau",
            "preset12",
            "preset7"
        ));
        assert!(category_needs_repair(
            "DMH Farbe: Blau",
            "preset0",
            "preset7"
        ));
        assert!(!category_needs_repair(
            "DMH Farbe: Blau",
            "preset7",
            "preset7"
        ));
        assert!(category_needs_repair(
            "Eigene Kategorie",
            "preset0",
            "preset7"
        ));
    }

    #[test]
    fn isolated_category_repair_only_targets_linked_editable_events() {
        let mut editable = calendar_source("calendar-a");
        editable.resource_path =
            "https://graph.microsoft.com/v1.0/me/calendars/calendar-a".to_string();
        let mut read_only = calendar_source("calendar-b");
        read_only.editable = false;
        let linked = calendar_event("m365:calendar-a:event-1");
        let read_only_link = calendar_event("m365:calendar-b:event-2");
        let local_only = calendar_event("local-event");

        let targets = calendar_category_repair_targets(
            &[linked, read_only_link, local_only],
            &[editable, read_only],
        );

        assert_eq!(targets.len(), 1);
        assert_eq!(
            targets[0].url,
            "https://graph.microsoft.com/v1.0/me/calendars/calendar-a/events/event-1"
        );
        assert_eq!(targets[0].category, "");
        assert_eq!(targets[0].color, "blue");
    }

    #[test]
    fn uses_the_exact_exchange_category_name_for_a_calendar_event() {
        let mut event = calendar_event("category-name");
        event.category = "vortrag".to_string();
        let names = HashMap::from([("vortrag".to_string(), "Vortrag".to_string())]);
        assert_eq!(master_category_for_event(&event, &names), "Vortrag");
        assert_eq!(
            graph_event_payload_for_master(&event, &names)["categories"][0],
            "Vortrag"
        );
    }
}
