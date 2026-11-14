//! Automatic EDV reporting: installation-specific write-only credentials, Windows-protected,
//! with a durable local outbox. Reporting never determines procedure success.
use crate::{diagnostics, now, open_db, protect_backup_bytes, unprotect_backup_bytes};
use base64::Engine;
use rand::RngCore;
use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
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
    #[serde(default)]
    automatic: bool,
}
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Event {
    event_id: String,
    attempt_id: String,
    sequence: u32,
    procedure: String,
    status: String,
    #[serde(default)]
    account_email: String,
    step: String,
    message: String,
    profile: String,
    #[serde(default)]
    occurred_at: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    diagnostic: Option<SupportLog>,
}
#[derive(Serialize, Deserialize)]
pub struct SupportLog {
    code: String,
    text: String,
}
impl SupportLog {
    fn sanitize(&mut self) -> Result<(), String> {
        if self.code.len() > 64
            || !self.code.starts_with("DMH-")
            || !self
                .code
                .bytes()
                .all(|c| c.is_ascii_uppercase() || c.is_ascii_digit() || c == b'-')
            || self.text.len() > 240_000
            || self.text.chars().count() > 60_000
        {
            return Err("Ungültiger Diagnosebericht.".into());
        }
        self.text = self
            .text
            .lines()
            .map(diagnostics::redact)
            .collect::<Vec<_>>()
            .join("\n");
        Ok(())
    }
}
fn ensure(conn: &rusqlite::Connection) -> Result<(), String> {
    conn.execute_batch("CREATE TABLE IF NOT EXISTS procedure_report_deliveries (event_id TEXT NOT NULL, device_id TEXT NOT NULL, delivered_at TEXT NOT NULL, PRIMARY KEY(event_id,device_id)); CREATE TABLE IF NOT EXISTS procedure_report_outbox (event_id TEXT PRIMARY KEY, payload TEXT NOT NULL, created_at TEXT NOT NULL, error TEXT); CREATE TABLE IF NOT EXISTS procedure_report_history (event_id TEXT PRIMARY KEY, payload TEXT NOT NULL, created_at TEXT NOT NULL);") .map_err(|e| e.to_string())
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
    save_credentials(&app, &config)
}
fn save_credentials(app: &AppHandle, config: &Config) -> Result<(), String> {
    let encrypted = protect_backup_bytes(&serde_json::to_vec(&config).map_err(|e| e.to_string())?)?;
    open_db(app)?.execute("INSERT INTO app_settings(key,value,updated_at) VALUES(?1,?2,?3) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at", params![KEY,base64::engine::general_purpose::STANDARD.encode(encrypted),now()]).map_err(|e| e.to_string())?;
    Ok(())
}
fn automatic_credentials(app: &AppHandle) -> Result<Config, String> {
    if let Some(config) = credentials(app)? {
        return Ok(config);
    }
    let mut bytes = [0u8; 32];
    rand::rngs::OsRng.fill_bytes(&mut bytes);
    let config = Config {
        schema_version: 1,
        endpoint: "https://migration.dmh-aidlingen.de/api/edv?action=ingest".into(),
        device_id: Uuid::new_v4().to_string(),
        token: base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes),
        automatic: true,
    };
    // Persist before any request so retries, restarts and revocations retain this identity.
    save_credentials(app, &config)?;
    Ok(config)
}
async fn enroll(client: &reqwest::Client, config: &Config) -> Result<(), String> {
    let endpoint = config
        .endpoint
        .replace("action=ingest", "action=enroll-challenge");
    let response = client.post(endpoint).json(&serde_json::json!({"deviceId":config.device_id,"credentialHash":format!("{:x}",Sha256::digest(config.token.as_bytes()))})).send().await.map_err(|_| "Automatische PC-Registrierung wird erneut versucht.")?;
    if !response.status().is_success() {
        return Err("Automatische PC-Registrierung wird erneut versucht.".into());
    }
    let value: serde_json::Value = response.json().await.map_err(|e| e.to_string())?;
    if value["difficulty"] != 18 {
        return Err("Ungültige Registrierungsantwort.".into());
    }
    let challenge = value["challenge"]
        .as_str()
        .filter(|v| v.len() <= 1024)
        .ok_or("Ungültige Registrierungsantwort.")?
        .to_owned();
    let work = challenge.clone();
    let nonce = tauri::async_runtime::spawn_blocking(move || solve_proof(&work))
        .await
        .map_err(|e| e.to_string())??;
    let response=client.post(config.endpoint.replace("action=ingest","action=enroll")).json(&serde_json::json!({"deviceId":config.device_id,"token":config.token,"computer":std::env::var("COMPUTERNAME").unwrap_or_else(|_|"Windows-PC".into()),"windowsUser":std::env::var("USERNAME").unwrap_or_default(),"challenge":challenge,"nonce":nonce})).send().await.map_err(|_|"PC-Registrierung wird erneut versucht.")?;
    if response.status() == reqwest::StatusCode::FORBIDDEN {
        return Err("PC-Zugang wurde durch die EDV gesperrt.".into());
    }
    if !response.status().is_success() {
        return Err("PC-Registrierung wird erneut versucht.".into());
    }
    let ack: serde_json::Value = response.json().await.map_err(|e| e.to_string())?;
    if ack["registered"] != true || ack["deviceId"] != config.device_id {
        return Err("PC-Registrierung nicht bestätigt.".into());
    }
    Ok(())
}
fn solve_proof(work: &str) -> Result<u64, &'static str> {
    let deadline = std::time::Instant::now() + Duration::from_secs(10);
    for nonce in 0u64..=10_000_000 {
        let hash = Sha256::digest(format!("{work}:{nonce}").as_bytes());
        if hash[0] == 0 && hash[1] == 0 && hash[2] < 64 {
            return Ok(nonce);
        }
        if nonce % 4096 == 0 && std::time::Instant::now() > deadline {
            break;
        }
    }
    Err("PC-Registrierung wird beim nächsten Versand erneut versucht.")
}
fn backfill(conn: &rusqlite::Connection, device: &str) -> Result<(), String> {
    ensure(conn)?;
    conn.execute("INSERT OR IGNORE INTO procedure_report_outbox(event_id,payload,created_at) SELECT h.event_id,h.payload,h.created_at FROM procedure_report_history h WHERE NOT EXISTS (SELECT 1 FROM procedure_report_deliveries d WHERE d.event_id=h.event_id AND d.device_id=?1)",[device]).map_err(|e|e.to_string())?;
    Ok(())
}
// Previous releases saved sync failures outside the reporting outbox. Recover the
// last persisted failure without requiring a Microsoft account or a new attempt.
fn import_saved_sync_failure(
    conn: &mut rusqlite::Connection,
    device: &str,
    version: &str,
) -> Result<(), String> {
    ensure(conn)?;
    let raw: Option<String> = conn
        .query_row(
            "SELECT value FROM app_settings WHERE key='synchronization_runtime_status_v1'",
            [],
            |r| r.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    let Some(value) = raw.and_then(|v| serde_json::from_str::<serde_json::Value>(&v).ok()) else {
        return Ok(());
    };
    let Some(message) = value["lastError"].as_str().filter(|s| !s.trim().is_empty()) else {
        return Ok(());
    };
    let stamp = value["lastAttemptAt"].as_str().unwrap_or("");
    let digest =
        Sha256::digest(format!("dmh-sync-history-v1:{device}:{stamp}:{message}").as_bytes());
    let mut bytes = [0u8; 16];
    bytes.copy_from_slice(&digest[..16]);
    bytes[6] = (bytes[6] & 15) | 64;
    bytes[8] = (bytes[8] & 63) | 128;
    let id = Uuid::from_bytes(bytes).to_string();
    let delivered:bool=conn.query_row("SELECT EXISTS(SELECT 1 FROM procedure_report_deliveries WHERE event_id=?1 AND device_id=?2)",params![id,device],|r|r.get(0)).map_err(|e|e.to_string())?;
    if delivered {
        return Ok(());
    }
    let timestamp = if chrono::DateTime::parse_from_rfc3339(stamp).is_ok() {
        stamp.to_owned()
    } else {
        now()
    };
    let payload = serde_json::json!({"eventId":id,"attemptId":id,"sequence":1,"procedure":"m365_sync","status":"error","accountEmail":"","step":"Gespeicherter Synchronisationsfehler","message":diagnostics::redact(message).chars().take(1800).collect::<String>(),"profile":"","computer":std::env::var("COMPUTERNAME").unwrap_or_default(),"windowsUser":std::env::var("USERNAME").unwrap_or_default(),"appVersion":version,"occurredAt":timestamp});
    persist_event(conn, &id, &payload.to_string(), true)
}
fn acknowledge(conn: &mut rusqlite::Connection, id: &str, device: &str) -> Result<(), String> {
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    tx.execute(
        "INSERT OR IGNORE INTO procedure_report_deliveries VALUES(?1,?2,?3)",
        params![id, device, now()],
    )
    .map_err(|e| e.to_string())?;
    tx.execute(
        "DELETE FROM procedure_report_outbox WHERE event_id=?1",
        [id],
    )
    .map_err(|e| e.to_string())?;
    tx.execute("DELETE FROM procedure_report_deliveries WHERE event_id NOT IN (SELECT event_id FROM procedure_report_history UNION SELECT event_id FROM procedure_report_outbox)",[]).map_err(|e|e.to_string())?;
    tx.commit().map_err(|e| e.to_string())
}
#[tauri::command]
pub fn get_procedure_reporting_status(app: AppHandle) -> Result<serde_json::Value, String> {
    let config = credentials(&app)?;
    let configured = config.is_some();
    let conn = open_db(&app)?;
    ensure(&conn)?;
    let pending: i64 = conn
        .query_row("SELECT COUNT(*) FROM procedure_report_outbox", [], |row| {
            row.get(0)
        })
        .map_err(|e| e.to_string())?;
    let error: Option<String> = conn.query_row("SELECT error FROM procedure_report_outbox WHERE error IS NOT NULL ORDER BY rowid DESC LIMIT 1", [], |row| row.get(0)).optional().map_err(|e| e.to_string())?;
    let last_delivery: Option<String> = conn
        .query_row(
            "SELECT MAX(delivered_at) FROM procedure_report_deliveries",
            [],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;
    Ok(
        serde_json::json!({"configured":configured,"automatic":config.as_ref().is_none_or(|c|c.automatic),"pending":pending,"error":error,"lastDeliveryAt":last_delivery}),
    )
}
#[tauri::command]
pub fn record_procedure_report(app: AppHandle, mut event: Event) -> Result<(), String> {
    if Uuid::parse_str(&event.event_id).is_err()
        || Uuid::parse_str(&event.attempt_id).is_err()
        || !["m365_login", "outlook_exchange", "m365_sync", "diagnostics"]
            .contains(&event.procedure.as_str())
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
    event.message = diagnostics::redact(&event.message);
    if let Some(log) = event.diagnostic.as_mut() {
        log.sanitize()?;
    }
    let mut payload = serde_json::to_value(&event).map_err(|e| e.to_string())?;
    payload["computer"] = std::env::var("COMPUTERNAME").unwrap_or_default().into();
    payload["windowsUser"] = std::env::var("USERNAME").unwrap_or_default().into();
    payload["appVersion"] = app.package_info().version.to_string().into();
    payload["occurredAt"] = event
        .occurred_at
        .as_deref()
        .filter(|value| chrono::DateTime::parse_from_rfc3339(value).is_ok())
        .map(str::to_owned)
        .unwrap_or_else(now)
        .into();
    let mut conn = open_db(&app)?;
    persist_event(&mut conn, &event.event_id, &payload.to_string(), true)?;
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
    let config = automatic_credentials(&app)?;
    backfill(&open_db(&app)?, &config.device_id)?;
    import_saved_sync_failure(
        &mut open_db(&app)?,
        &config.device_id,
        &app.package_info().version.to_string(),
    )?;
    if !validate(&config) {
        return Err("Ungültige Berichtskonfiguration.".into());
    }
    let pending = {
        let conn = open_db(&app)?;
        ensure(&conn)?;
        let mut stmt = conn
            .prepare(
                "SELECT event_id,payload FROM procedure_report_outbox ORDER BY rowid LIMIT 100",
            )
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
    // Enroll only when necessary; credentials alone cannot read portal data.
    if config.automatic {
        let probe = client
            .get(
                config
                    .endpoint
                    .replace("action=ingest", "action=device-status"),
            )
            .bearer_auth(&config.token)
            .header("X-DMH-Device", &config.device_id)
            .send()
            .await;
        match probe {
            Ok(response) if response.status() == reqwest::StatusCode::UNAUTHORIZED => {
                if let Err(error) = enroll(&client, &config).await {
                    open_db(&app)?
                        .execute("UPDATE procedure_report_outbox SET error=?1", [&error])
                        .map_err(|e| e.to_string())?;
                    return Err(error);
                }
            }
            Err(_) => return Ok(()),
            _ => {}
        }
    }
    let deadline = std::time::Instant::now() + Duration::from_secs(30);
    for (id, payload) in pending {
        if std::time::Instant::now() > deadline {
            break;
        }
        let has_diagnostic = serde_json::from_str::<serde_json::Value>(&payload)
            .ok()
            .is_some_and(|v| v.get("diagnostic").is_some_and(|d| !d.is_null()));
        // A distinct endpoint prevents older servers from silently dropping the log and acknowledging it.
        let endpoint = if has_diagnostic {
            config
                .endpoint
                .replace("action=ingest", "action=ingest-diagnostic")
        } else {
            config.endpoint.clone()
        };
        let result = client
            .post(&endpoint)
            .bearer_auth(&config.token)
            .header("X-DMH-Device", &config.device_id)
            .header("Content-Type", "application/json")
            .body(payload)
            .send()
            .await;
        let rejected_record = result.as_ref().is_ok_and(|response| {
            matches!(response.status().as_u16(), 400 | 409 | 413 | 422)
                || (has_diagnostic && matches!(response.status().as_u16(), 401 | 403 | 404))
        });
        let accepted = match result {
            Ok(response) if response.status().is_success() => response
                .json::<serde_json::Value>()
                .await
                .ok()
                .is_some_and(|body| {
                    body["accepted"] == true
                        && body["eventId"] == id
                        && (!has_diagnostic || body["diagnosticAccepted"] == true)
                }),
            _ => false,
        };
        let mut conn = open_db(&app)?;
        if accepted {
            acknowledge(&mut conn, &id, &config.device_id)?;
        } else {
            conn.execute(
                "UPDATE procedure_report_outbox SET error=?2 WHERE event_id=?1",
                params![
                    id,
                    "Bericht konnte noch nicht bestätigt werden. Wird automatisch erneut versucht."
                ],
            )
            .map_err(|e| e.to_string())?;
            // Keep rejected records for inspection/retry, but do not let one
            // incompatible or oversized record block all subsequent reports.
            if !rejected_record {
                break;
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn diagnostic_keeps_process_evidence_and_rejects_oversized_logs() {
        let mut log = SupportLog {
            code: "DMH-M365-SYNC".into(),
            text: "PC: LOCAL-LAPTOP\nprocessId: 42\npassword=hidden\npath: C:\\Office".into(),
        };
        log.sanitize().unwrap();
        assert!(log.text.contains("processId: 42"));
        assert!(log.text.contains("C:\\Office"));
        assert!(!log.text.contains("hidden"));
        log.text = "x".repeat(60_001);
        assert!(log.sanitize().is_err());
    }
    #[test]
    fn diagnostic_survives_durable_queue_and_acknowledgement() {
        let mut conn = rusqlite::Connection::open_in_memory().unwrap();
        ensure(&conn).unwrap();
        let payload = serde_json::json!({"eventId":"log-event", "attemptId":"same-attempt", "sequence":2, "procedure":"m365_sync", "status":"error", "occurredAt":"2026-11-14T10:00:00Z", "diagnostic":{"code":"DMH-M365-SYNC", "text":"PC: LOCAL-LAPTOP\nprocessId: 42"}}).to_string();
        persist_event(&mut conn, "log-event", &payload, true).unwrap();
        let queued: String = conn
            .query_row(
                "SELECT payload FROM procedure_report_outbox WHERE event_id='log-event'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(queued, payload);
        acknowledge(&mut conn, "log-event", "device").unwrap();
        let history: String = conn
            .query_row(
                "SELECT payload FROM procedure_report_history WHERE event_id='log-event'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(history, payload);
    }
    #[test]
    fn old_manual_configuration_remains_readable() {
        let value = serde_json::json!({"schemaVersion":1,"endpoint":"https://migration.dmh-aidlingen.de/api/edv?action=ingest","deviceId":Uuid::new_v4().to_string(),"token":"a".repeat(43)});
        let config: Config = serde_json::from_value(value).unwrap();
        assert!(!config.automatic);
        assert!(validate(&config));
    }
    #[test]
    fn enrollment_work_matches_server_sha256_contract() {
        let nonce = solve_proof("dmh-proof-test").unwrap();
        assert_eq!(nonce, 282952);
    }
    #[test]
    fn rejects_arbitrary_endpoints_and_invalid_device_credentials() {
        let mut config = Config {
            schema_version: 1,
            endpoint: "https://dmh-backup.vercel.app/api/edv?action=ingest".into(),
            device_id: Uuid::new_v4().to_string(),
            token: "a".repeat(43),
            automatic: false,
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
    fn backfill_preserves_original_payload_and_does_not_requeue_confirmed_events() {
        let mut conn = rusqlite::Connection::open_in_memory().unwrap();
        let old = r#"{"status":"error","occurredAt":"2026-11-01T10:00:00Z","message":"Office account unavailable","eventId":"old"}"#;
        persist_event(&mut conn, "old", old, false).unwrap();
        persist_event(&mut conn, "success", r#"{"status":"success"}"#, false).unwrap();
        backfill(&conn, "pc").unwrap();
        backfill(&conn, "pc").unwrap();
        assert_eq!(
            conn.query_row("SELECT count(*) FROM procedure_report_outbox", [], |r| r
                .get::<_, i64>(0))
                .unwrap(),
            2
        );
        assert_eq!(
            conn.query_row(
                "SELECT payload FROM procedure_report_outbox WHERE event_id='old'",
                [],
                |r| r.get::<_, String>(0)
            )
            .unwrap(),
            old
        );
        acknowledge(&mut conn, "old", "pc").unwrap();
        backfill(&conn, "pc").unwrap();
        assert_eq!(
            conn.query_row("SELECT count(*) FROM procedure_report_outbox", [], |r| r
                .get::<_, i64>(0))
                .unwrap(),
            1
        );
        assert_eq!(
            conn.query_row("SELECT count(*) FROM procedure_report_history", [], |r| r
                .get::<_, i64>(
                0
            ))
            .unwrap(),
            2
        );
    }
    #[test]
    fn failed_receipt_transaction_keeps_event_for_retry() {
        let mut conn = rusqlite::Connection::open_in_memory().unwrap();
        persist_event(&mut conn, "old", "{}", true).unwrap();
        conn.execute_batch("CREATE TRIGGER fail_receipt BEFORE INSERT ON procedure_report_deliveries BEGIN SELECT RAISE(ABORT,'disk full'); END;").unwrap();
        assert!(acknowledge(&mut conn, "old", "pc").is_err());
        assert_eq!(
            conn.query_row("SELECT count(*) FROM procedure_report_outbox", [], |r| r
                .get::<_, i64>(0))
                .unwrap(),
            1
        );
    }
    #[test]
    fn saved_sync_failure_is_backfilled_once_without_an_email() {
        let mut conn = rusqlite::Connection::open_in_memory().unwrap();
        conn.execute_batch("CREATE TABLE app_settings(key TEXT PRIMARY KEY,value TEXT);")
            .unwrap();
        conn.execute("INSERT INTO app_settings VALUES('synchronization_runtime_status_v1',?1)",[r#"{"lastError":"3 ausgewählte Microsoft-365-Kalender sind momentan nicht erreichbar.","lastAttemptAt":"2026-11-12T10:00:00Z"}"#]).unwrap();
        let device = Uuid::new_v4().to_string();
        import_saved_sync_failure(&mut conn, &device, "test").unwrap();
        import_saved_sync_failure(&mut conn, &device, "test").unwrap();
        let (id, raw): (String, String) = conn
            .query_row(
                "SELECT event_id,payload FROM procedure_report_outbox",
                [],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap();
        let event: serde_json::Value = serde_json::from_str(&raw).unwrap();
        assert_eq!(event["accountEmail"], "");
        assert_eq!(event["procedure"], "m365_sync");
        assert_eq!(event["occurredAt"], "2026-11-12T10:00:00Z");
        assert!(event.get("computer").is_some());
        assert!(event.get("windowsUser").is_some());
        acknowledge(&mut conn, &id, &device).unwrap();
        import_saved_sync_failure(&mut conn, &device, "test").unwrap();
        assert_eq!(
            conn.query_row("SELECT count(*) FROM procedure_report_outbox", [], |r| r
                .get::<_, i64>(0))
                .unwrap(),
            0
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
