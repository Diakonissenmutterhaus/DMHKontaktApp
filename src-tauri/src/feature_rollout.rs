use crate::{now, open_db};
use chrono::{DateTime, Utc};
use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::time::Duration;
use tauri::AppHandle;

const CACHE_KEY: &str = "ki_rollout_cache_v1";
const URL: &str =
    "https://raw.githubusercontent.com/Diakonissenmutterhaus/DMHKontaktApp/feature-flags/ki.json";
static REFRESH_GATE: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

pub(crate) fn protected_key(key: &str) -> bool {
    key == CACHE_KEY
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Policy {
    schema_version: u32,
    enabled: bool,
    activate_at: Option<String>,
    updated_at: String,
}

#[derive(Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    policy: Option<Policy>,
    last_checked_at: Option<String>,
    last_success_at: Option<String>,
    error: Option<String>,
}

fn parse_policy(bytes: &[u8]) -> Result<Policy, String> {
    if bytes.len() > 8192 {
        return Err("Die zentrale Konfiguration ist zu groß.".into());
    }
    let policy: Policy =
        serde_json::from_slice(bytes).map_err(|_| "Die zentrale Konfiguration ist ungültig.")?;
    if policy.schema_version != 1
        || DateTime::parse_from_rfc3339(&policy.updated_at).is_err()
        || policy
            .activate_at
            .as_ref()
            .is_some_and(|date| DateTime::parse_from_rfc3339(date).is_err())
    {
        return Err("Version oder Zeitpunkt der zentralen Konfiguration ist ungültig.".into());
    }
    Ok(policy)
}

fn accept_policy(status: &mut Status, policy: Policy) -> Result<(), String> {
    if let Some(previous) = &status.policy {
        if DateTime::parse_from_rfc3339(&policy.updated_at).map_err(|e| e.to_string())?
            < DateTime::parse_from_rfc3339(&previous.updated_at).map_err(|e| e.to_string())?
        {
            return Err("Eine ältere zentrale Konfiguration wurde ignoriert.".into());
        }
    }
    status.policy = Some(policy);
    status.last_success_at = Some(now());
    status.error = None;
    Ok(())
}

async fn fetch_policy() -> Result<Policy, String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(8))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|_| "Zentrale Freigabe konnte nicht geprüft werden.")?;
    let mut response = client
        .get(format!("{}?check={}", URL, Utc::now().timestamp() / 60))
        .header("Cache-Control", "no-cache")
        .header("User-Agent", "DMH-Backup-KI-Freigabe")
        .send()
        .await
        .map_err(|_| "Zentrale Freigabe ist momentan nicht erreichbar.")?;
    if response.status() == reqwest::StatusCode::NOT_FOUND {
        return Err("Die zentrale Freigabe wurde noch nicht veröffentlicht.".into());
    }
    if !response.status().is_success() {
        return Err("Zentrale Freigabe konnte nicht geladen werden.".into());
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| "Zentrale Freigabe konnte nicht gelesen werden.")?
    {
        if bytes.len() + chunk.len() > 8192 {
            return Err("Die zentrale Konfiguration ist zu groß.".into());
        }
        bytes.extend_from_slice(&chunk);
    }
    parse_policy(&bytes)
}

#[tauri::command]
pub async fn get_ki_rollout_status(
    app: AppHandle,
    refresh: Option<bool>,
) -> Result<Status, String> {
    let _guard = REFRESH_GATE.lock().await;
    let mut status = {
        let conn = open_db(&app)?;
        let raw: Option<String> = conn
            .query_row(
                "SELECT value FROM app_settings WHERE key=?1",
                [CACHE_KEY],
                |row| row.get(0),
            )
            .optional()
            .map_err(|e| e.to_string())?;
        raw.and_then(|raw| serde_json::from_str::<Status>(&raw).ok())
            .filter(|status| {
                status.policy.as_ref().is_none_or(|policy| {
                    serde_json::to_vec(policy)
                        .ok()
                        .is_some_and(|bytes| parse_policy(&bytes).is_ok())
                })
            })
            .unwrap_or_default()
    };
    if refresh == Some(true) {
        status.last_checked_at = Some(now());
        match fetch_policy()
            .await
            .and_then(|policy| accept_policy(&mut status, policy))
        {
            Ok(()) => {}
            Err(error) => status.error = Some(error),
        }
        open_db(&app)?.execute("INSERT INTO app_settings(key,value,updated_at) VALUES(?1,?2,?3) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at", params![CACHE_KEY,serde_json::to_string(&status).map_err(|e| e.to_string())?,now()]).map_err(|e| e.to_string())?;
    }
    Ok(status)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_invalid_schedules_and_keeps_last_good_policy_on_rollback() {
        let policy = parse_policy(br#"{"schemaVersion":1,"enabled":true,"activateAt":"2026-12-01T08:00:00+01:00","updatedAt":"2026-11-12T10:00:00Z"}"#).unwrap();
        let mut status = Status::default();
        accept_policy(&mut status, policy.clone()).unwrap();
        let mut stale = policy.clone();
        stale.updated_at = "2026-11-01T10:00:00Z".into();
        assert!(accept_policy(&mut status, stale).is_err());
        assert!(status.policy.as_ref().unwrap().enabled);
        for invalid in [br#"{"schemaVersion":2,"enabled":true,"activateAt":null,"updatedAt":"2026-11-12T10:00:00Z"}"#.as_slice(), br#"{"schemaVersion":1,"enabled":true,"activateAt":"2026-12-01T08:00:00","updatedAt":"2026-11-12T10:00:00Z"}"#.as_slice(), br#"{"schemaVersion":1,"enabled":true,"activateAt":null,"updatedAt":"bad"}"#.as_slice()] { assert!(parse_policy(invalid).is_err()); }
    }
}
