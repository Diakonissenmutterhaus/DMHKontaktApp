//! Optional EDV reporting: per-PC write-only credentials, Windows-protected,
//! with a durable local outbox. Reporting never determines procedure success.
use crate::{diagnostics, now, open_db, protect_backup_bytes, unprotect_backup_bytes};
use base64::Engine;
use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::time::Duration;
use tauri::AppHandle;
use uuid::Uuid;

const KEY: &str = "m365_procedure_reporting_credentials_v1";
static GATE: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());
pub(crate) fn protected_key(key: &str) -> bool {
    key == KEY
}
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Config {
    schema_version: u32,
    endpoint: String,
    device_id: String,
    token: String,
}
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Event {
    event_id: String,
    attempt_id: String,
    sequence: u32,
    procedure: String,
    status: String,
    account_email: String,
    step: String,
    message: String,
    profile: String,
}
fn ensure(conn: &rusqlite::Connection) -> Result<(), String> {
    conn.execute_batch("CREATE TABLE IF NOT EXISTS procedure_report_outbox (event_id TEXT PRIMARY KEY, payload TEXT NOT NULL, created_at TEXT NOT NULL, error TEXT); CREATE TABLE IF NOT EXISTS procedure_report_history (event_id TEXT PRIMARY KEY, payload TEXT NOT NULL, created_at TEXT NOT NULL);") .map_err(|e| e.to_string())
}
fn credentials(app: &AppHandle) -> Result<Option<Config>, String> {
    let conn = open_db(app)?;
    let encoded: Option<String> = conn
        .query_row(
            "SELECT value FROM app_settings WHERE key=?1",
            [KEY],
            |row| row.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    encoded
        .map(|encoded| {
            base64::engine::general_purpose::STANDARD
                .decode(encoded)
                .map_err(|e| e.to_string())
                .and_then(|bytes| unprotect_backup_bytes(&bytes))
                .and_then(|raw| serde_json::from_slice(&raw).map_err(|e| e.to_string()))
        })
        .transpose()
}
fn validate(config: &Config) -> bool {
    config.schema_version == 1
        && Uuid::parse_str(&config.device_id).is_ok()
        && config.token.len() == 43
        && config
            .token
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || c == b'-' || c == b'_')
        && [
            "https://dmh-backup.vercel.app/api/edv?action=ingest",
            "https://migration.dmh-aidlingen.de/api/edv?action=ingest",
        ]
        .contains(&config.endpoint.as_str())
}
#[tauri::command]
pub fn configure_procedure_reporting(app: AppHandle, config: Config) -> Result<(), String> {
    diagnostics::require_edv(&app)?;
    if !validate(&config) {
        return Err("Ungültige PC-Konfigurationsdatei.".into());
    }
    let encrypted = protect_backup_bytes(&serde_json::to_vec(&config).map_err(|e| e.to_string())?)?;
    open_db(&app)?.execute("INSERT INTO app_settings(key,value,updated_at) VALUES(?1,?2,?3) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at", params![KEY,base64::engine::general_purpose::STANDARD.encode(encrypted),now()]).map_err(|e| e.to_string())?;
    Ok(())
}
#[tauri::command]
pub fn get_procedure_reporting_status(app: AppHandle) -> Result<serde_json::Value, String> {
    let configured = credentials(&app)?.is_some();
    let conn = open_db(&app)?;
    ensure(&conn)?;
    let pending: i64 = conn
        .query_row("SELECT COUNT(*) FROM procedure_report_outbox", [], |row| {
            row.get(0)
        })
        .map_err(|e| e.to_string())?;
    let error: Option<String> = conn.query_row("SELECT error FROM procedure_report_outbox WHERE error IS NOT NULL ORDER BY rowid DESC LIMIT 1", [], |row| row.get(0)).optional().map_err(|e| e.to_string())?;
    Ok(serde_json::json!({"configured":configured,"pending":pending,"error":error}))
}
#[tauri::command]
pub fn record_procedure_report(app: AppHandle, mut event: Event) -> Result<(), String> {
    if Uuid::parse_str(&event.event_id).is_err()
        || Uuid::parse_str(&event.attempt_id).is_err()
        || !["m365_login", "outlook_exchange", "diagnostics"].contains(&event.procedure.as_str())
        || !["running", "success", "error", "cancelled", "interrupted"]
            .contains(&event.status.as_str())
        || event.sequence > 10000
        || event.message.len() > 8000
        || event.step.len() > 200
        || event.account_email.len() > 300
        || event.profile.len() > 200
    {
        return Err("Ungültiger Verfahrensbericht.".into());
    }
    let configured = credentials(&app)?.is_some();
    if event.procedure == "diagnostics" && !configured {
        return Err("Kein PC-Zugang für den Diagnoseversand eingerichtet.".into());
    }
    event.message = diagnostics::redact(&event.message);
    let mut payload = serde_json::to_value(&event).map_err(|e| e.to_string())?;
    payload["computer"] = std::env::var("COMPUTERNAME").unwrap_or_default().into();
    payload["windowsUser"] = std::env::var("USERNAME").unwrap_or_default().into();
    payload["appVersion"] = app.package_info().version.to_string().into();
    payload["occurredAt"] = now().into();
    let mut conn = open_db(&app)?;
    persist_event(&mut conn, &event.event_id, &payload.to_string(), configured)?;
    if !configured {
        return Ok(());
    }
    // The small local write is finished before returning. Network delivery is independent.
    tauri::async_runtime::spawn(async move {
        let _ = flush_procedure_reports(app).await;
    });
    Ok(())
}
#[tauri::command]
pub async fn flush_procedure_reports(app: AppHandle) -> Result<(), String> {
    let Ok(_guard) = GATE.try_lock() else {
        return Ok(());
    };
    let Some(config) = credentials(&app)? else {
        return Ok(());
    };
    if !validate(&config) {
        return Err("Ungültige Berichtskonfiguration.".into());
    }
    let pending = {
        let conn = open_db(&app)?;
        ensure(&conn)?;
        let mut stmt = conn
            .prepare("SELECT event_id,payload FROM procedure_report_outbox ORDER BY rowid LIMIT 25")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            })
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?
    };
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(10))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|e| e.to_string())?;
    for (id, payload) in pending {
        let result = client
            .post(&config.endpoint)
            .bearer_auth(&config.token)
            .header("X-DMH-Device", &config.device_id)
            .header("Content-Type", "application/json")
            .body(payload)
            .send()
            .await;
        let accepted = match result {
            Ok(response) if response.status().is_success() => response
                .json::<serde_json::Value>()
                .await
                .ok()
                .is_some_and(|body| body["accepted"] == true && body["eventId"] == id),
            _ => false,
        };
        let conn = open_db(&app)?;
        if accepted {
            conn.execute(
                "DELETE FROM procedure_report_outbox WHERE event_id=?1",
                [&id],
            )
            .map_err(|e| e.to_string())?;
        } else {
            conn.execute(
                "UPDATE procedure_report_outbox SET error=?2 WHERE event_id=?1",
                params![
                    id,
                    "Bericht konnte noch nicht bestätigt werden. Wird automatisch erneut versucht."
                ],
            )
            .map_err(|e| e.to_string())?;
            break;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_arbitrary_endpoints_and_invalid_device_credentials() {
        let mut config = Config {
            schema_version: 1,
            endpoint: "https://dmh-backup.vercel.app/api/edv?action=ingest".into(),
            device_id: Uuid::new_v4().to_string(),
            token: "a".repeat(43),
        };
        assert!(validate(&config));
        config.endpoint = "https://external.example/api".into();
        assert!(!validate(&config));
        config.endpoint = "http://dmh-backup.vercel.app/api/edv?action=ingest".into();
        assert!(!validate(&config));
    }
}

#[tauri::command]
pub fn list_local_procedure_reports(app: AppHandle) -> Result<Vec<serde_json::Value>, String> {
    let conn = open_db(&app)?;
    ensure(&conn)?;
    let mut stmt = conn
        .prepare("SELECT payload FROM procedure_report_history ORDER BY rowid DESC LIMIT 500")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |r| r.get::<_, String>(0))
        .map_err(|e| e.to_string())?;
    let mut result = Vec::new();
    for row in rows {
        if let Ok(value) =
            serde_json::from_str::<serde_json::Value>(&row.map_err(|e| e.to_string())?)
        {
            result.push(value);
        }
    }
    Ok(result)
}

fn persist_event(
    conn: &mut rusqlite::Connection,
    id: &str,
    payload: &str,
    enqueue: bool,
) -> Result<(), String> {
    ensure(conn)?;
    let transaction = conn.transaction().map_err(|e| e.to_string())?;
    transaction.execute("INSERT OR IGNORE INTO procedure_report_history(event_id,payload,created_at) VALUES(?1,?2,?3)",params![id,payload,now()]).map_err(|e|e.to_string())?;
    transaction.execute("DELETE FROM procedure_report_history WHERE rowid NOT IN (SELECT rowid FROM procedure_report_history ORDER BY rowid DESC LIMIT 500)",[]).map_err(|e|e.to_string())?;
    if enqueue {
        transaction.execute("INSERT OR IGNORE INTO procedure_report_outbox(event_id,payload,created_at) VALUES(?1,?2,?3)",params![id,payload,now()]).map_err(|e|e.to_string())?;
    }
    transaction.commit().map_err(|e| e.to_string())
}
#[cfg(test)]
mod durable_history_tests {
    use super::*;
    #[test]
    fn history_retention_does_not_drop_unsent_events_and_retries_are_idempotent() {
        let mut conn = rusqlite::Connection::open_in_memory().unwrap();
        for i in 0..502 {
            persist_event(&mut conn, &format!("event-{i}"), "{}", true).unwrap();
        }
        persist_event(&mut conn, "event-501", "{}", true).unwrap();
        assert_eq!(
            conn.query_row("SELECT count(*) FROM procedure_report_history", [], |r| r
                .get::<_, i64>(
                0
            ))
            .unwrap(),
            500
        );
        assert_eq!(
            conn.query_row("SELECT count(*) FROM procedure_report_outbox", [], |r| r
                .get::<_, i64>(0))
                .unwrap(),
            502
        );
        persist_event(&mut conn, "offline-only", "{}", false).unwrap();
        assert_eq!(
            conn.query_row("SELECT count(*) FROM procedure_report_outbox", [], |r| r
                .get::<_, i64>(0))
                .unwrap(),
            502
        );
    }
    #[test]
    fn a_queue_write_failure_does_not_claim_the_event_was_saved() {
        let mut conn = rusqlite::Connection::open_in_memory().unwrap();
        ensure(&conn).unwrap();
        conn.execute_batch("CREATE TRIGGER fail_queue BEFORE INSERT ON procedure_report_outbox BEGIN SELECT RAISE(ABORT,'disk write failed'); END;").unwrap();
        assert!(persist_event(&mut conn, "event", "{}", true).is_err());
        assert_eq!(
            conn.query_row("SELECT count(*) FROM procedure_report_history", [], |r| r
                .get::<_, i64>(
                0
            ))
            .unwrap(),
            0
        );
    }
}
