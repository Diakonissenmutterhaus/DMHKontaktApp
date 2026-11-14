//! Build-enabled EDV diagnostics. No token stores, credentials, or mailbox data.
use crate::{diagnostics, hidden_command, open_db, AppState};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::io::Read;
use std::{collections::VecDeque, process::Stdio, sync::Mutex, time::Duration};
use tauri::{AppHandle, Manager};

static TRACE: Mutex<VecDeque<Value>> = Mutex::new(VecDeque::new());
const LIMIT: usize = 100;
const TRACE_ENTRY_BYTES: usize = 8192;

pub fn enabled() -> bool {
    option_env!("DMH_SUPPORT_DIAGNOSTICS") == Some("1")
}

pub fn trace(operation: &str, detail: Value) {
    if !enabled() {
        return;
    }
    if let Ok(mut entries) = TRACE.lock() {
        if entries.len() >= LIMIT {
            entries.pop_front();
        }
        entries.push_back(json!({"at": chrono::Utc::now().to_rfc3339(), "operation": operation, "detail": bounded_detail(detail)}));
    }
}

fn bounded_detail(value: Value) -> Value {
    let sanitized = clean(value);
    let serialized = serde_json::to_string(&sanitized).unwrap_or_default();
    if serialized.len() > TRACE_ENTRY_BYTES {
        json!({"truncated": true, "originalBytes": serialized.len(), "preview": serialized.chars().take(TRACE_ENTRY_BYTES / 4).collect::<String>()})
    } else {
        sanitized
    }
}

fn clean(value: Value) -> Value {
    match value {
        Value::String(text) => Value::String(diagnostics::redact(&text)),
        Value::Array(values) => Value::Array(values.into_iter().take(100).map(clean).collect()),
        Value::Object(values) => Value::Object(
            values
                .into_iter()
                .filter(|(key, _)| {
                    ![
                        "token",
                        "password",
                        "secret",
                        "credential",
                        "cookie",
                        "authorization",
                    ]
                    .iter()
                    .any(|word| key.to_ascii_lowercase().contains(word))
                })
                .map(|(key, value)| (key, clean(value)))
                .collect(),
        ),
        other => other,
    }
}

fn file_hash(path: &std::path::Path) -> Option<String> {
    let mut file = std::fs::File::open(path).ok()?;
    let mut hash = Sha256::new();
    let mut buffer = [0u8; 32768];
    loop {
        let count = file.read(&mut buffer).ok()?;
        if count == 0 {
            break;
        }
        hash.update(&buffer[..count]);
    }
    Some(format!("{:x}", hash.finalize()))
}

pub fn error_code(procedure: &str, stage: &str, message: &str) -> &'static str {
    if message.contains("OFFICE_ACCOUNT_NOT_DETECTED") {
        "DMH-OFFICE-IDENTITY"
    } else if message.contains("OUTLOOK_HELPER_TIMEOUT") {
        "DMH-OUTLOOK-TIMEOUT"
    } else if stage == "outlook_open" {
        "DMH-OUTLOOK-CLOSE-BLOCKED"
    } else if stage == "timeout" {
        "DMH-SETUP-TIMEOUT"
    } else if procedure == "m365_login" {
        "DMH-M365-LOGIN"
    } else if procedure == "m365_sync" {
        "DMH-M365-SYNC"
    } else {
        "DMH-EXCHANGE-SETUP"
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiagnosticRequest {
    pub attempt_id: String,
    pub procedure: String,
    pub stage: String,
    pub message: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiagnosticReport {
    code: String,
    file_name: String,
    text: String,
    local_path: Option<String>,
    save_error: Option<String>,
}

fn recent_auth(app: &AppHandle) -> Result<Vec<Value>, String> {
    let db = open_db(app)?;
    let mut statement = db.prepare("SELECT occurred_at, summary FROM audit_log WHERE source='diagnostic' AND entity_kind='authentication' ORDER BY rowid DESC LIMIT 12").map_err(|e| e.to_string())?;
    let rows = statement
        .query_map([], |row| {
            Ok(json!({"at": row.get::<_, String>(0)?, "message": row.get::<_, String>(1)?}))
        })
        .map_err(|e| e.to_string())?;
    rows.map(|row| row.map(clean).map_err(|e| e.to_string()))
        .collect()
}

async fn environment() -> Result<Value, String> {
    let script = include_str!("support_diagnostic.ps1");
    let mut command = tokio::process::Command::from(hidden_command("powershell.exe"));
    command.args([
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        script,
    ]);
    command
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .kill_on_drop(true);
    let output = tokio::time::timeout(Duration::from_secs(20), command.output())
        .await
        .map_err(|_| "Environment snapshot timed out; original failure is preserved.")?
        .map_err(|e| format!("Environment reader could not start: {e}"))?;
    if !output.status.success() {
        return Err(format!(
            "Environment reader exit: {:?}",
            output.status.code()
        ));
    }
    serde_json::from_slice(&output.stdout)
        .map(clean)
        .map_err(|_| "Environment reader returned invalid JSON.".into())
}

#[tauri::command]
pub async fn collect_support_diagnostic(
    app: AppHandle,
    request: DiagnosticRequest,
) -> Result<DiagnosticReport, String> {
    if !enabled() {
        return Err("Die lokale Diagnose ist in diesem Build nicht aktiviert.".into());
    }
    if request.message.len() > 32000
        || request.stage.len() > 100
        || uuid::Uuid::parse_str(&request.attempt_id).is_err()
        || !matches!(
            request.procedure.as_str(),
            "m365_login" | "outlook_exchange" | "m365_sync"
        )
    {
        return Err("Ungültige Diagnose-Anfrage.".into());
    }
    // Freeze operation evidence before the snapshot; never run setup/auth again.
    let trace = TRACE
        .lock()
        .map(|entries| entries.iter().cloned().collect::<Vec<_>>())
        .unwrap_or_default();
    let code = error_code(&request.procedure, &request.stage, &request.message).to_string();
    let generated_at = chrono::Utc::now();
    let auth = recent_auth(&app)
        .unwrap_or_else(|error| vec![json!({"readError": diagnostics::redact(&error)})]);
    let database_path = app
        .state::<AppState>()
        .db_path
        .lock()
        .ok()
        .map(|path| path.to_string_lossy().to_string());
    let executable = std::env::current_exe().ok();
    let mut helpers = Vec::new();
    if let Ok(root) = app.path().resource_dir() {
        for name in [
            "resources/m365-wam/dmh-m365-wam.exe",
            "resources/m365-wam/dmh-m365-wam.dll",
            "resources/outlook-profile-reader-x64.exe",
            "resources/outlook-profile-reader-x86.exe",
        ] {
            let path = root.join(name);
            helpers.push(json!({"path": path, "exists": path.is_file(), "bytes": std::fs::metadata(&path).ok().map(|m| m.len()), "sha256": file_hash(&path)}));
        }
    }
    let snapshot = environment()
        .await
        .unwrap_or_else(|error| json!({"readError": diagnostics::redact(&error)}));
    let payload = json!({
        "schemaVersion": 1, "code": code, "attemptId": request.attempt_id,
        "generatedAt": generated_at.to_rfc3339(), "procedure": request.procedure,
        "stage": request.stage, "error": diagnostics::redact(&request.message),
        "app": {"version": app.package_info().version.to_string(), "executable": executable, "sha256": executable.as_deref().and_then(file_hash),
            "processId": std::process::id(), "databasePath": database_path, "helpers": helpers},
        "environment": snapshot, "operationTrace": trace, "recentAuthentication": auth,
        "notes": ["EDV diagnostic; delivered through the authenticated procedure reporting queue.",
            "Includes PC/user names, account addresses and paths. Contains no credential stores or mail contents.",
            "Registered identities are metadata, not proof of the active Excel account or a working Outlook connection.",
            "Unknown, unreadable and timeout states are not evidence that an account/process is absent."]
    });
    let text = format!(
        "DMH Backup – Diagnose\nFehlercode: {code}\nVersuch: {}\n\n{}\n",
        request.attempt_id,
        serde_json::to_string_pretty(&payload).map_err(|e| e.to_string())?
    );
    let file_name = format!(
        "DMH-Diagnose-{}-{}.log",
        generated_at.format("%Y%m%d-%H%M%S"),
        request.attempt_id
    );
    let saved = (|| -> Result<String, String> {
        let dir = app
            .path()
            .app_local_data_dir()
            .map_err(|e| e.to_string())?
            .join("SupportDiagnostics");
        std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        let path = dir.join(&file_name);
        std::fs::write(&path, text.as_bytes()).map_err(|e| e.to_string())?;
        Ok(path.to_string_lossy().to_string())
    })();
    let (local_path, save_error) = match saved {
        Ok(path) => (Some(path), None),
        Err(error) => (None, Some(diagnostics::redact(&error))),
    };
    Ok(DiagnosticReport {
        code,
        file_name,
        text,
        local_path,
        save_error,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn diagnostic_excludes_credentials_but_keeps_process_evidence() {
        let result = clean(
            json!({"processId": 31, "path": "C:\\Office\\OUTLOOK.EXE", "accessToken": "secret", "nested": {"message": "Bearer hidden", "status": "not_ready"}}),
        );
        assert!(result.get("accessToken").is_none());
        assert!(!result.to_string().contains("hidden"));
        assert_eq!(result["nested"]["status"], "not_ready");
        assert_eq!(result["processId"], 31);
    }
    #[test]
    fn blocked_outlook_is_distinct_from_identity_failure() {
        assert_eq!(
            error_code("outlook_exchange", "outlook_open", "open"),
            "DMH-OUTLOOK-CLOSE-BLOCKED"
        );
        assert_eq!(
            error_code(
                "outlook_exchange",
                "error",
                "OFFICE_ACCOUNT_NOT_DETECTED: mismatch"
            ),
            "DMH-OFFICE-IDENTITY"
        );
        assert_eq!(
            error_code("m365_login", "error", "failed"),
            "DMH-M365-LOGIN"
        );
        assert_eq!(
            error_code("m365_sync", "error", "calendar unavailable"),
            "DMH-M365-SYNC"
        );
    }
    #[test]
    fn trace_memory_is_bounded_without_leaking_secrets_in_previews() {
        let result = bounded_detail(
            json!({"accounts": (0..100).map(|_| "a".repeat(300)).collect::<Vec<_>>(), "password": "do-not-export"}),
        );
        assert_eq!(result["truncated"], true);
        let text = result.to_string();
        assert!(text.len() < TRACE_ENTRY_BYTES);
        assert!(!text.contains("do-not-export"));
    }
}
