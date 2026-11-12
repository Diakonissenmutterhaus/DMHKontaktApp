//! Read-only workstation checks. Never launches Outlook or changes profiles.
use crate::{hidden_command, now, open_db};
use rusqlite::{params, OptionalExtension};
use serde_json::{json, Value};
use std::time::Duration;
use tauri::AppHandle;

const NEWS_KEY: &str = "edv_announcements_cache_v1";
const NEWS_URL: &str = "https://raw.githubusercontent.com/Diakonissenmutterhaus/DMHKontaktApp/feature-flags/edv-news.json";
pub(crate) fn protected_key(key: &str) -> bool {
    key == NEWS_KEY
}
static NEWS_GATE: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

#[tauri::command]
pub async fn get_workstation_health(app: AppHandle) -> Result<Value, String> {
    let version = app.package_info().version.to_string();
    let script = r#"
$ErrorActionPreference='Stop'
[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
$installed=$false
foreach($key in @('Registry::HKEY_LOCAL_MACHINE\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\OUTLOOK.EXE','Registry::HKEY_LOCAL_MACHINE\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\App Paths\OUTLOOK.EXE','Registry::HKEY_CURRENT_USER\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\OUTLOOK.EXE')) {
 if(Test-Path -LiteralPath $key){$p=(Get-Item -LiteralPath $key).GetValue('');if($p -and (Test-Path -LiteralPath $p)){$installed=$true}}
}
$running=@(Get-Process -Name OUTLOOK -ErrorAction SilentlyContinue).Count -gt 0
if($running){$installed=$true}
$drive=Get-PSDrive -Name ($env:SystemDrive.TrimEnd(':')) -ErrorAction SilentlyContinue
@{outlookInstalled=$installed;outlookRunning=$running;freeBytes=if($drive){[double]$drive.Free}else{$null};drive=$env:SystemDrive;computer=$env:COMPUTERNAME;windowsUser=$env:USERNAME} | ConvertTo-Json -Compress
"#;
    let mut command = tokio::process::Command::from(hidden_command("powershell.exe"));
    command
        .args(["-NoProfile", "-NonInteractive", "-Command", script])
        .kill_on_drop(true);
    let output = tokio::time::timeout(Duration::from_secs(12), command.output())
        .await
        .map_err(|_| "PC-Prüfung hat zu lange gedauert.")?
        .map_err(|_| "PC-Prüfung konnte nicht gestartet werden.")?;
    if !output.status.success() {
        return Err("PC-Informationen konnten nicht gelesen werden.".into());
    }
    let text = String::from_utf8_lossy(&output.stdout);
    let mut result: Value = serde_json::from_str(text.trim_start_matches('\u{feff}').trim())
        .map_err(|_| "PC-Informationen konnten nicht ausgewertet werden.")?;
    result["appVersion"] = version.into();
    result["checkedAt"] = now().into();
    Ok(result)
}

#[tauri::command]
pub async fn check_migration_services() -> Result<Value, String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(8))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|e| e.to_string())?;
    async fn probe(client: &reqwest::Client, name: &str, url: &str) -> Value {
        match client.get(url).send().await {
            Ok(response) => {
                json!({"name":name,"reachable":!response.status().is_server_error() && response.status().as_u16()!=429,"httpStatus":response.status().as_u16()})
            }
            Err(_) => json!({"name":name,"reachable":false,"httpStatus":null}),
        }
    }
    let (login, graph, outlook, reports) = futures_util::join!(
        probe(
            &client,
            "Microsoft-Anmeldung",
            "https://login.microsoftonline.com/common/v2.0/.well-known/openid-configuration"
        ),
        probe(
            &client,
            "Microsoft Graph",
            "https://graph.microsoft.com/v1.0/$metadata"
        ),
        probe(
            &client,
            "Exchange Online",
            "https://outlook.office365.com/autodiscover/autodiscover.xml"
        ),
        probe(
            &client,
            "EDV-Berichte",
            "https://migration.dmh-aidlingen.de/api/edv?action=session"
        )
    );
    Ok(
        json!({"checkedAt":now(),"services":[login,graph,outlook,reports],"note":"Erreichbarkeit geprüft. Dies bestätigt keine Anmeldung oder Postfachberechtigung."}),
    )
}

#[tauri::command]
pub async fn get_edv_announcements(app: AppHandle, refresh: bool) -> Result<Value, String> {
    let _guard = NEWS_GATE.lock().await;
    let raw: Option<String> = open_db(&app)?
        .query_row(
            "SELECT value FROM app_settings WHERE key=?1",
            [NEWS_KEY],
            |r| r.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    let mut status = raw
        .and_then(|v| serde_json::from_str::<Value>(&v).ok())
        .unwrap_or(json!({"items":[],"lastSuccessAt":null,"lastCheckedAt":null,"error":null}));
    if refresh {
        status["lastCheckedAt"] = now().into();
        match fetch_news().await {
            Ok(items) => {
                status["items"] = items;
                status["lastSuccessAt"] = now().into();
                status["error"] = Value::Null;
            }
            Err(message) => {
                status["error"] = message.into();
            }
        }
        open_db(&app)?.execute("INSERT INTO app_settings(key,value,updated_at) VALUES(?1,?2,?3) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at",params![NEWS_KEY,status.to_string(),now()]).map_err(|e|e.to_string())?;
    }
    let instant = chrono::Utc::now();
    if let Some(items) = status["items"].as_array_mut() {
        items.retain(|item| {
            let started = item["publishAt"]
                .as_str()
                .and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok())
                .is_some_and(|date| date <= instant);
            let unexpired = item["expiresAt"].is_null()
                || item["expiresAt"]
                    .as_str()
                    .and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok())
                    .is_some_and(|date| date > instant);
            started && unexpired
        });
    }
    Ok(status)
}
async fn fetch_news() -> Result<Value, String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(8))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|_| "EDV-Mitteilungen konnten nicht geladen werden.")?;
    let mut response = client
        .get(NEWS_URL)
        .header("User-Agent", "DMH-Backup-Mitteilungen")
        .send()
        .await
        .map_err(|_| "EDV-Mitteilungen sind momentan nicht erreichbar.")?;
    if response.status() == reqwest::StatusCode::NOT_FOUND {
        return Err("Noch keine zentralen EDV-Mitteilungen veröffentlicht.".into());
    }
    if !response.status().is_success() {
        return Err("EDV-Mitteilungen konnten nicht geladen werden.".into());
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| "EDV-Mitteilungen konnten nicht gelesen werden.")?
    {
        if bytes.len() + chunk.len() > 65536 {
            return Err("EDV-Mitteilungen sind zu groß.".into());
        }
        bytes.extend_from_slice(&chunk);
    }
    let value: Value = serde_json::from_slice(&bytes).map_err(|_| "Ungültige EDV-Mitteilungen.")?;
    let items = value["items"]
        .as_array()
        .ok_or("Ungültige EDV-Mitteilungen.")?;
    if value["schemaVersion"] != 1 || items.len() > 30 {
        return Err("Ungültige EDV-Mitteilungen.".into());
    }
    for item in items {
        if item["id"]
            .as_str()
            .is_none_or(|v| v.is_empty() || v.len() > 100)
            || item["title"]
                .as_str()
                .is_none_or(|v| v.trim().is_empty() || v.len() > 200)
            || item["body"].as_str().is_none_or(|v| v.len() > 6000)
            || item["publishAt"]
                .as_str()
                .and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok())
                .is_none()
            || (!item["expiresAt"].is_null()
                && item["expiresAt"]
                    .as_str()
                    .and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok())
                    .is_none())
        {
            return Err("Ungültige EDV-Mitteilungen.".into());
        }
    }
    Ok(Value::Array(items.clone()))
}
