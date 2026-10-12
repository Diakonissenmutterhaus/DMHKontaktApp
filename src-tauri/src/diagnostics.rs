use crate::*;
use std::sync::atomic::Ordering;

const EDV_PASSWORD_SHA256: &str =
    "923d72f89f878899e8324c05323c9d925ec895b57bf593f287e30f4a31b47c35";

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiagnosticMessage {
    pub origin: String,
    pub level: String,
    #[serde(default)]
    pub entity_kind: String,
    pub entity_id: Option<String>,
    pub title: Option<String>,
    pub starts_at: Option<String>,
    pub occurred_at: Option<String>,
    pub operation: Option<String>,
    pub message: String,
}

#[tauri::command]
pub fn unlock_edv_tools(app: AppHandle, password: String) -> bool {
    unlock_state(&app.state::<AppState>().edv_unlocked, &password)
}

#[tauri::command]
pub fn lock_edv_tools(app: AppHandle) {
    app.state::<AppState>()
        .edv_unlocked
        .store(false, Ordering::Relaxed);
}

fn unlock_state(state: &AtomicBool, password: &str) -> bool {
    let hash = format!("{:x}", Sha256::digest(password.as_bytes()));
    let allowed = hash == EDV_PASSWORD_SHA256;
    state.store(allowed, Ordering::Relaxed);
    allowed
}

pub fn require_edv(app: &AppHandle) -> Result<(), String> {
    if app.state::<AppState>().edv_unlocked.load(Ordering::Relaxed) {
        Ok(())
    } else {
        Err("Bitte zuerst EDV Tools mit dem EDV-Kennwort öffnen.".to_string())
    }
}

#[tauri::command]
pub fn record_ui_diagnostic(app: AppHandle, entry: DiagnosticMessage) -> Result<(), String> {
    record(&app, entry)
}

pub fn record(app: &AppHandle, mut entry: DiagnosticMessage) -> Result<(), String> {
    entry.occurred_at.get_or_insert_with(now);
    record_in_db(&open_db(app)?, entry)
}

fn redact(message: &str) -> String {
    // Never persist credential-bearing server responses. Identity and operation
    // are stored separately, so the error remains searchable after redaction.
    let lower = message.to_ascii_lowercase();
    if [
        "bearer ",
        "access_token",
        "refresh_token",
        "client_secret",
        "password=",
        "kennwort=",
        "authorization:",
        "otpauth",
    ]
    .iter()
    .any(|token| lower.contains(token))
    {
        "Technische Meldung enthält Zugangsdaten und wurde ausgeblendet.".to_string()
    } else {
        message.chars().take(12000).collect()
    }
}

fn record_in_db(conn: &Connection, entry: DiagnosticMessage) -> Result<(), String> {
    if entry.message.trim().is_empty() {
        return Ok(());
    }
    let action = match entry.level.as_str() {
        "error" => "error",
        "warning" => "warning",
        "success" => "success",
        _ => "info",
    };
    let summary = format!(
        "{}\nItem: {}\nTermin: {}\nVorgang: {}\nUrsprung: {}\nMeldung: {}",
        entry.title.as_deref().unwrap_or("Anwendung"),
        entry.entity_id.as_deref().unwrap_or("—"),
        entry.starts_at.as_deref().unwrap_or("—"),
        entry.operation.as_deref().unwrap_or("—"),
        entry.origin,
        redact(&entry.message)
    );
    // Deduplicate only identical immediate reports from the native operation,
    // bridge and StrictMode. Different items/errors and later attempts remain.
    let occurred_at = entry
        .occurred_at
        .as_deref()
        .and_then(|date| chrono::DateTime::parse_from_rfc3339(date).ok())
        .map(|date| date.with_timezone(&chrono::Utc).to_rfc3339())
        .unwrap_or_else(now);
    // One atomic statement prevents concurrent IPC reports from racing between
    // checking and inserting. Historic imports deduplicate by original timestamp.
    conn.execute("INSERT INTO audit_log(occurred_at,actor,source,action,entity_kind,entity_id,summary)
        SELECT ?1,?2,'diagnostic',?3,?4,?5,?6
        WHERE NOT EXISTS(SELECT 1 FROM audit_log WHERE source='diagnostic' AND action=?3 AND summary=?6
        AND (occurred_at=?1 OR (julianday(?1)>=julianday('now','-15 seconds') AND julianday(occurred_at)>=julianday('now','-15 seconds'))))", params![occurred_at, audit_actor(), action, if entry.entity_kind.is_empty() {"notification"} else {&entry.entity_kind}, entry.entity_id, summary]).map_err(|e| e.to_string())?;
    Ok(())
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncFailure {
    pub entity_kind: String,
    pub entity_id: String,
    pub title: String,
    pub starts_at: Option<String>,
    pub operation: String,
    pub source_id: String,
    pub error: String,
    pub user_message: Option<String>,
}

pub fn sync_failure(
    app: &AppHandle,
    kind: &str,
    id: &str,
    title: &str,
    starts: Option<&str>,
    operation: &str,
    source: &str,
    error: &str,
    outbound: bool,
) -> SyncFailure {
    let user_message = user_failure_instruction(kind, operation, error, outbound);
    let failure = SyncFailure {
        entity_kind: kind.to_string(),
        entity_id: id.to_string(),
        title: title.to_string(),
        starts_at: starts.map(str::to_string),
        operation: operation.to_string(),
        source_id: source.to_string(),
        error: redact(error),
        user_message,
    };
    let _ = record(
        app,
        DiagnosticMessage {
            origin: format!("Microsoft 365 · {source}"),
            level: "error".into(),
            entity_kind: kind.into(),
            entity_id: Some(id.into()),
            title: Some(title.into()),
            starts_at: starts.map(str::to_string),
            operation: Some(operation.into()),
            message: error.into(),
            ..Default::default()
        },
    );
    failure
}

fn user_failure_instruction(
    kind: &str,
    operation: &str,
    error: &str,
    outbound: bool,
) -> Option<String> {
    user_sync_instruction(
        kind,
        error,
        outbound
            && !matches!(
                operation,
                "category" | "category-fallback" | "outbox:category"
            ),
    )
}

fn user_sync_instruction(kind: &str, error: &str, outbound: bool) -> Option<String> {
    if !outbound { None } else if error.contains("HTTP 401") {
        Some("Microsoft 365 hat die Anmeldung abgelehnt. Bitte die EDV bitten, das Microsoft-365-Konto erneut zu verbinden. Die lokale Änderung bleibt gespeichert.")
    } else if kind == "contact" && error.contains("HTTP 403") {
        Some("Keine Schreibberechtigung für diesen Kontaktordner. Bitte die EDV um Freigabe des Microsoft-365-Zielordners bitten.")
    } else if error.contains("HTTP 403") {
        Some("Keine Schreibberechtigung für diesen Kalender. Bitte in der App einen beschreibbaren Zielkalender wählen oder die EDV um Freigabe bitten.")
    } else if kind == "contact" && error.contains("HTTP 404") {
        Some("Der verknüpfte Kontakt wurde in Exchange nicht gefunden. Bitte die EDV bitten, den Microsoft-365-Kontaktordner und die Verknüpfung zu prüfen. Die lokale Änderung bleibt gespeichert.")
    } else if error.contains("HTTP 404") {
        Some("Der verknüpfte Eintrag wurde in Exchange nicht gefunden. Bitte den Zielkalender in Outlook prüfen und die EDV bitten, die Verknüpfung zu reparieren. Die lokale Änderung bleibt gespeichert.")
    } else if kind == "contact" && ["HTTP 400", "HTTP 422"].iter().any(|code| error.contains(code)) {
        Some("Exchange hat die Kontaktänderung abgelehnt. Bitte die Kontaktangaben prüfen und erneut speichern. Falls das nicht hilft, die EDV kontaktieren.")
    } else if error.contains("HTTP 405") {
        Some("Diese Änderung ist im ausgewählten Zielordner nicht möglich. Bitte die EDV bitten, den Microsoft-365-Zielordner zu prüfen.")
    } else if ["HTTP 400", "HTTP 422"].iter().any(|code| error.contains(code)) {
        Some("Exchange hat die Änderung abgelehnt. Bitte Datum, Uhrzeit, Teilnehmer und Serieneinstellungen prüfen und erneut speichern. Falls das nicht hilft, die EDV kontaktieren.")
    } else if error.contains("Teams-Besprechungsblock") || error.contains("geschützte Teams") {
        Some("Die Beschreibung kann hier nicht sicher übertragen werden. Bitte diese Besprechung in Outlook bearbeiten; der vorhandene Teams-Link bleibt erhalten.")
    } else if error.contains("Kein beschreibbarer Exchange-Kalender") {
        Some("Bitte in der App einen beschreibbaren Microsoft-365-Zielkalender wählen und erneut speichern.")
    } else { None }.map(str::to_string)
}

pub fn outbox_preparation_failure(
    app: &AppHandle,
    kind: &str,
    id: &str,
    title: &str,
    starts: Option<&str>,
    action: &str,
    error: &str,
) -> SyncFailure {
    // A failure outside the per-item execution blocked the queue as a whole.
    // Identify pending items without claiming their own PATCH was rejected or
    // that a specific remote item is missing. SQL/temporary faults stay silent.
    let mut failure = sync_failure(
        app,
        kind,
        id,
        title,
        starts,
        &format!("outbox:{action}"),
        "Microsoft 365 / Vorbereitung und Verarbeitung",
        error,
        false,
    );
    if action != "category"
        && [
            "HTTP 400", "HTTP 401", "HTTP 403", "HTTP 404", "HTTP 405", "HTTP 422",
        ]
        .iter()
        .any(|code| error.contains(code))
    {
        failure.user_message = Some("Die Microsoft-365-Verbindung oder der Zielordner muss geprüft werden, bevor die Übertragung fortgesetzt werden kann. Bitte die EDV bitten, Anmeldung und Zielordner zu prüfen. Die lokale Änderung bleibt gespeichert.".to_string());
    }
    failure
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn colour_maintenance_never_becomes_a_user_content_failure() {
        for operation in ["category", "category-fallback", "outbox:category"] {
            for error in ["HTTP 400", "HTTP 401", "HTTP 403", "HTTP 404"] {
                assert!(user_failure_instruction("calendar", operation, error, true).is_none());
            }
        }
        assert!(user_failure_instruction("calendar", "upsert", "HTTP 404", true).is_some());
        assert!(user_failure_instruction("calendar", "upsert", "HTTP 403", true).is_some());
    }
    #[test]
    fn invalid_edv_password_revokes_access_and_temporary_errors_are_silent() {
        let flag = AtomicBool::new(true);
        assert!(!unlock_state(&flag, "invalid-password"));
        assert!(!flag.load(Ordering::Relaxed));
        for error in [
            "HTTP 429",
            "HTTP 500",
            "HTTP 503",
            "request timed out",
            "UNIQUE constraint failed: m365_contact_links",
        ] {
            assert!(user_sync_instruction("calendar", error, true).is_none());
        }
        assert!(
            user_sync_instruction("calendar", "HTTP 404 ErrorItemNotFound", true)
                .unwrap()
                .contains("Verknüpfung")
        );
        assert!(user_sync_instruction("calendar", "HTTP 403 ErrorAccessDenied", false).is_none());
        assert!(user_sync_instruction("calendar", "HTTP 400", true)
            .unwrap()
            .contains("Datum"));
    }
    #[test]
    fn diagnostics_keep_item_operation_and_error_searchable_without_secrets() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("CREATE TABLE audit_log(id INTEGER PRIMARY KEY,occurred_at TEXT,actor TEXT,source TEXT,action TEXT,entity_kind TEXT,entity_id TEXT,summary TEXT);").unwrap();
        record_in_db(
            &conn,
            DiagnosticMessage {
                origin: "Exchange".into(),
                level: "error".into(),
                entity_kind: "calendar".into(),
                entity_id: Some("event-1".into()),
                title: Some("Mittagspause".into()),
                starts_at: Some("2026-10-12T12:00".into()),
                operation: Some("upsert".into()),
                message: "HTTP 404 ErrorItemNotFound".into(),
                ..Default::default()
            },
        )
        .unwrap();
        let summary: String = conn
            .query_row("SELECT summary FROM audit_log", [], |r| r.get(0))
            .unwrap();
        assert!(
            summary.contains("Mittagspause")
                && summary.contains("event-1")
                && summary.contains("12:00")
                && summary.contains("HTTP 404")
        );
        assert!(!redact("Authorization: Bearer secret-token").contains("secret-token"));
        let page = query_audit_log(
            &conn,
            AuditLogFilter {
                search: Some("404 Mittagspause event-1".into()),
                action: Some("error".into()),
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(page.entries.len(), 1);
        assert!(query_audit_log(
            &conn,
            AuditLogFilter {
                action: Some("success".into()),
                ..Default::default()
            }
        )
        .unwrap()
        .entries
        .is_empty());
    }
}
