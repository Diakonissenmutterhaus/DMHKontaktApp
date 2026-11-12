use crate::{diagnostics, m365, now, open_db};
use base64::{engine::general_purpose::STANDARD, Engine};
use chrono::{Local, NaiveDate};
use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::AppHandle;
use uuid::Uuid;

const CONFIG_KEY: &str = "ki_config_v1";
const RECEIPT_PREFIX: &str = "ki_receipt_v1:";
const PDF_PREFIX: &str = "ki_pdf_v1:";
const ACCESS_PREFIX: &str = "ki_access_request_v1:";
const CURRENT_PDF: &[u8] = include_bytes!("../resources/ki/ki-leitlinie-2026-11-10.pdf");
const CURRENT_SHA: &str = "3d0aa3ce7b3745c51b63485f85bbd9f0b9f2825a5f1e9197c765a153ff3fab72";

pub(crate) fn protected_key(key: &str) -> bool {
    key == CONFIG_KEY
        || key.starts_with(RECEIPT_PREFIX)
        || key.starts_with(PDF_PREFIX)
        || key.starts_with(ACCESS_PREFIX)
        || crate::ki_news::is_news_key(key)
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KiAccessInput {
    full_name: String,
    email: String,
    department: String,
    tool: String,
    purpose: String,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KiAccessRequest {
    id: String,
    created_at: String,
    status: String,
    #[serde(flatten)]
    input: KiAccessInput,
}

fn persist_access_request(
    conn: &rusqlite::Connection,
    input: KiAccessInput,
) -> Result<KiAccessRequest, String> {
    if input.full_name.trim().len() < 3
        || input.full_name.len() > 200
        || input.email.len() > 254
        || input.email.split('@').count() != 2
        || input.email.starts_with('@')
        || input.email.ends_with('@')
        || !input.email.contains('@')
        || input.email.chars().any(char::is_whitespace)
        || input.department.len() > 200
        || input.tool.trim().is_empty()
        || input.tool.len() > 200
        || input.purpose.trim().len() < 10
        || input.purpose.len() > 4000
        || [
            &input.full_name,
            &input.email,
            &input.department,
            &input.tool,
        ]
        .iter()
        .any(|value| value.chars().any(char::is_control))
    {
        return Err(
            "Bitte Name, dienstliche E-Mail, KI-Anwendung und Einsatzzweck vollständig angeben."
                .into(),
        );
    }
    let request = KiAccessRequest {
        id: Uuid::new_v4().to_string(),
        created_at: now(),
        status: "prepared".into(),
        input,
    };
    conn.execute(
        "INSERT INTO app_settings(key,value,updated_at) VALUES(?1,?2,?3)",
        params![
            format!("{ACCESS_PREFIX}{}", request.id),
            serde_json::to_string(&request).map_err(|e| e.to_string())?,
            request.created_at
        ],
    )
    .map_err(|e| e.to_string())?;
    Ok(request)
}

#[tauri::command]
pub fn save_ki_access_request(
    app: AppHandle,
    input: KiAccessInput,
) -> Result<KiAccessRequest, String> {
    persist_access_request(&open_db(&app)?, input)
}

#[tauri::command]
pub fn list_ki_access_requests(app: AppHandle) -> Result<Vec<KiAccessRequest>, String> {
    diagnostics::require_edv(&app)?;
    let conn = open_db(&app)?;
    let mut stmt = conn.prepare("SELECT value FROM app_settings WHERE key LIKE 'ki_access_request_v1:%' ORDER BY updated_at DESC").map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(|e| e.to_string())?;
    rows.map(|row| {
        serde_json::from_str(&row.map_err(|e| e.to_string())?).map_err(|e| e.to_string())
    })
    .collect()
}

#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KiConfig {
    pub revision: String,
    pub title: String,
    pub version: String,
    pub body: String,
    pub training_url: String,
    pub published: bool,
    #[serde(default)]
    pub pdf_sha256: String,
    #[serde(default)]
    pub pdf_name: String,
}

fn bundled_config() -> KiConfig {
    KiConfig {
        revision: format!("ki-2026-11-10-{CURRENT_SHA}"),
        title: "KI-Leitlinie · Diakonissenmutterhaus Aidlingen e. V.".into(),
        version: "10.11.2026".into(),
        body: "KI-Leitlinie · Stand: 10. November 2026. Das vollständige Originaldokument umfasst 11 Seiten.".into(),
        published: true,
        pdf_sha256: CURRENT_SHA.into(),
        pdf_name: "KI-Leitlinie 10.11.2026.pdf".into(),
        ..Default::default()
    }
}

fn read_pdf(conn: &rusqlite::Connection, sha: &str) -> Result<Vec<u8>, String> {
    if sha.len() != 64
        || !sha
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    {
        return Err("Ungültige Dokumentkennung.".into());
    }
    let bytes = if sha == CURRENT_SHA {
        CURRENT_PDF.to_vec()
    } else {
        let encoded: String = conn
            .query_row(
                "SELECT value FROM app_settings WHERE key=?1",
                [format!("{PDF_PREFIX}{sha}")],
                |row| row.get(0),
            )
            .map_err(|_| "Das ursprüngliche PDF ist nicht verfügbar.")?;
        STANDARD
            .decode(encoded)
            .map_err(|_| "Das gespeicherte PDF ist beschädigt.")?
    };
    if format!("{:x}", Sha256::digest(&bytes)) != sha {
        return Err("Die PDF-Prüfsumme stimmt nicht überein.".into());
    }
    Ok(bytes)
}

fn preserve_pdf(conn: &rusqlite::Connection, config: &KiConfig) -> Result<(), String> {
    if config.pdf_sha256.is_empty() {
        return Ok(());
    }
    let bytes = read_pdf(conn, &config.pdf_sha256)?;
    conn.execute(
        "INSERT OR IGNORE INTO app_settings(key,value,updated_at) VALUES(?1,?2,?3)",
        params![
            format!("{PDF_PREFIX}{}", config.pdf_sha256),
            STANDARD.encode(bytes),
            now()
        ],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn get_ki_pdf(app: AppHandle, sha256: String) -> Result<String, String> {
    Ok(STANDARD.encode(read_pdf(&open_db(&app)?, &sha256)?))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KiPdfInfo {
    sha256: String,
    name: String,
}

#[tauri::command]
pub fn import_ki_pdf(app: AppHandle, name: String, base64: String) -> Result<KiPdfInfo, String> {
    diagnostics::require_edv(&app)?;
    if base64.len() > 14_000_000 || name.len() > 200 || !name.to_lowercase().ends_with(".pdf") {
        return Err("Bitte eine PDF-Datei bis 10 MB auswählen.".into());
    }
    let bytes = STANDARD
        .decode(&base64)
        .map_err(|_| "Die PDF-Datei konnte nicht gelesen werden.")?;
    if bytes.len() > 10 * 1024 * 1024 || !bytes.starts_with(b"%PDF-") {
        return Err("Keine unterstützte PDF-Datei.".into());
    }
    let sha256 = format!("{:x}", Sha256::digest(&bytes));
    let conn = open_db(&app)?;
    conn.execute(
        "INSERT OR IGNORE INTO app_settings(key,value,updated_at) VALUES(?1,?2,?3)",
        params![
            format!("{PDF_PREFIX}{sha256}"),
            STANDARD.encode(bytes),
            now()
        ],
    )
    .map_err(|e| e.to_string())?;
    Ok(KiPdfInfo { sha256, name })
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KiSubmission {
    pub revision: String,
    pub full_name: String,
    pub email: String,
    pub department: String,
    pub read_confirmed: bool,
    pub training_confirmed: bool,
    pub training_mode: String,
    pub training_date: String,
    pub signature_method: String,
    pub signature_png: String,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KiReceipt {
    id: String,
    submitted_at: String,
    policy_sha256: String,
    policy: KiConfig,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    windows_owner: String,
    #[serde(flatten)]
    submission: KiSubmission,
}

fn read_config(conn: &rusqlite::Connection) -> Result<KiConfig, String> {
    let raw: Option<String> = conn
        .query_row(
            "SELECT value FROM app_settings WHERE key=?1",
            [CONFIG_KEY],
            |row| row.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    raw.map(|value| serde_json::from_str(&value).map_err(|e| e.to_string()))
        .unwrap_or_else(|| Ok(bundled_config()))
}

fn validate_config(config: &KiConfig) -> Result<(), String> {
    if config.body.len() > 200_000
        || config.title.len() > 200
        || config.version.len() > 80
        || config.training_url.len() > 2048
    {
        return Err("Der Inhalt ist zu lang.".into());
    }
    if config.published
        && (config.title.trim().is_empty()
            || config.version.trim().is_empty()
            || config.body.trim().is_empty())
    {
        return Err(
            "Zum Veröffentlichen Titel, Version und offizielle Richtlinien eintragen.".into(),
        );
    }
    if !config.training_url.is_empty() {
        let url = reqwest::Url::parse(&config.training_url)
            .map_err(|_| "Bitte einen gültigen HTTPS-Link zur Schulung eintragen.")?;
        if url.scheme() != "https"
            || url.host_str().is_none()
            || !url.username().is_empty()
            || url.password().is_some()
        {
            return Err("Die Schulung benötigt einen HTTPS-Link ohne Zugangsdaten.".into());
        }
    }
    Ok(())
}

fn validate_submission(config: &KiConfig, input: &KiSubmission) -> Result<(), String> {
    if !config.published || config.body.trim().is_empty() || input.revision != config.revision {
        return Err("Die Richtlinien sind noch nicht veröffentlicht oder wurden geändert. Bitte neu laden und erneut lesen.".into());
    }
    if !input.read_confirmed
        || !input.training_confirmed
        || input.full_name.trim().len() < 3
        || input.full_name.len() > 200
        || input.department.len() > 200
        || input.email.len() > 254
        || !input.email.contains('@')
        || input.email.chars().any(char::is_whitespace)
    {
        return Err("Bitte Name, E-Mail, Richtlinien und Schulung vollständig bestätigen.".into());
    }
    let date = NaiveDate::parse_from_str(&input.training_date, "%Y-%m-%d")
        .map_err(|_| "Bitte das Datum der besuchten Schulung angeben.")?;
    if date > Local::now().date_naive()
        || !["onsite", "online"].contains(&input.training_mode.as_str())
        || !["draw", "typed", "import"].contains(&input.signature_method.as_str())
    {
        return Err("Bitte Schulungsart, Datum und Unterschrift prüfen.".into());
    }
    if !valid_signature(&input.signature_png) {
        return Err("Bitte eine Unterschrift hinzufügen.".into());
    }
    Ok(())
}

fn valid_signature(value: &str) -> bool {
    if value.len() > 1_500_000 {
        return false;
    }
    let Some(encoded) = value.strip_prefix("data:image/png;base64,") else {
        return false;
    };
    let Ok(png) = STANDARD.decode(encoded) else {
        return false;
    };
    // Canvas normalizes all three signature methods to the same raster size.
    png.len() >= 45
        && png.starts_with(b"\x89PNG\r\n\x1a\n")
        && &png[12..16] == b"IHDR"
        && u32::from_be_bytes(png[16..20].try_into().unwrap()) == 900
        && u32::from_be_bytes(png[20..24].try_into().unwrap()) == 220
        && png.ends_with(b"IEND\xaeB\x60\x82")
}

#[tauri::command]
pub fn get_ki_config(app: AppHandle) -> Result<KiConfig, String> {
    read_config(&open_db(&app)?)
}

#[tauri::command]
pub fn save_ki_config(app: AppHandle, mut config: KiConfig) -> Result<KiConfig, String> {
    diagnostics::require_edv(&app)?;
    config.training_url = config.training_url.trim().into();
    validate_config(&config)?;
    config.revision = Uuid::new_v4().to_string();
    let conn = open_db(&app)?;
    preserve_pdf(&conn, &config)?;
    conn.execute("INSERT INTO app_settings(key,value,updated_at) VALUES(?1,?2,?3) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at", params![CONFIG_KEY, serde_json::to_string(&config).map_err(|e| e.to_string())?, now()]).map_err(|e| e.to_string())?;
    Ok(config)
}

#[tauri::command]
pub fn submit_ki_acknowledgement(
    app: AppHandle,
    submission: KiSubmission,
) -> Result<KiReceipt, String> {
    let mut conn = open_db(&app)?;
    persist_receipt(&mut conn, submission)
}

fn persist_receipt(
    conn: &mut rusqlite::Connection,
    submission: KiSubmission,
) -> Result<KiReceipt, String> {
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    let policy = read_config(&tx)?;
    validate_submission(&policy, &submission)?;
    preserve_pdf(&tx, &policy)?;
    let snapshot = serde_json::to_vec(&policy).map_err(|e| e.to_string())?;
    let receipt = KiReceipt {
        id: Uuid::new_v4().to_string(),
        submitted_at: now(),
        policy_sha256: format!("{:x}", Sha256::digest(snapshot)),
        policy,
        windows_owner: receipt_owner(),
        submission,
    };
    tx.execute(
        "INSERT INTO app_settings(key,value,updated_at) VALUES(?1,?2,?3)",
        params![
            format!("{RECEIPT_PREFIX}{}", receipt.id),
            serde_json::to_string(&receipt).map_err(|e| e.to_string())?,
            receipt.submitted_at
        ],
    )
    .map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())?;
    Ok(receipt)
}

#[tauri::command]
pub fn list_ki_acknowledgements(app: AppHandle) -> Result<Vec<KiReceipt>, String> {
    diagnostics::require_edv(&app)?;
    let conn = open_db(&app)?;
    read_receipts(&conn)
}

fn receipt_owner() -> String {
    format!(
        "{:x}",
        Sha256::digest(format!(
            "ki-owner-v1:{}",
            crate::audit_actor().trim().to_lowercase()
        ))
    )
}

fn belongs_to_user(receipt: &KiReceipt, owner: &str, aliases: &[String]) -> bool {
    if !receipt.windows_owner.is_empty() {
        return receipt.windows_owner == owner;
    }
    // Legacy receipts have no Windows binding. Only the native connected
    // Microsoft identity can expose matching older records, never an email
    // supplied by the frontend. EDV keeps access to the complete archive.
    aliases
        .iter()
        .any(|alias| alias.eq_ignore_ascii_case(receipt.submission.email.trim()))
}

#[tauri::command]
pub fn list_my_ki_acknowledgements(app: AppHandle) -> Result<Vec<KiReceipt>, String> {
    let owner = receipt_owner();
    let aliases = m365::excel_account_aliases(&app).unwrap_or_default();
    Ok(read_receipts(&open_db(&app)?)?
        .into_iter()
        .filter(|receipt| belongs_to_user(receipt, &owner, &aliases))
        .collect())
}

fn read_receipts(conn: &rusqlite::Connection) -> Result<Vec<KiReceipt>, String> {
    let mut stmt = conn.prepare("SELECT value FROM app_settings WHERE key LIKE 'ki_receipt_v1:%' ORDER BY updated_at DESC").map_err(|e| e.to_string())?;
    let values = stmt
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(|e| e.to_string())?;
    values
        .map(|value| {
            serde_json::from_str(&value.map_err(|e| e.to_string())?).map_err(|e| e.to_string())
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn personal_receipts_do_not_expose_other_owners_or_unmatched_legacy_records() {
        let mut conn = rusqlite::Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE app_settings(key TEXT PRIMARY KEY,value TEXT,updated_at TEXT);",
        )
        .unwrap();
        conn.execute(
            "INSERT INTO app_settings VALUES (?1,?2,'now')",
            params![CONFIG_KEY, serde_json::to_string(&config()).unwrap()],
        )
        .unwrap();
        let mut receipt = persist_receipt(&mut conn, input()).unwrap();
        let owner = receipt_owner();
        assert!(belongs_to_user(&receipt, &owner, &[]));
        assert!(!belongs_to_user(
            &receipt,
            "other-windows-user",
            &[receipt.submission.email.clone()]
        ));
        receipt.windows_owner.clear();
        assert!(!belongs_to_user(&receipt, &owner, &[]));
        assert!(!belongs_to_user(
            &receipt,
            &owner,
            &["other@example.test".into()]
        ));
        assert!(belongs_to_user(
            &receipt,
            &owner,
            &[receipt.submission.email.to_uppercase()]
        ));
    }
    #[test]
    fn access_request_is_validated_and_saved_as_prepared_without_claiming_delivery() {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE app_settings(key TEXT PRIMARY KEY,value TEXT,updated_at TEXT);",
        )
        .unwrap();
        let input = || KiAccessInput {
            full_name: "Anna Test".into(),
            email: "anna@example.test".into(),
            department: "Verwaltung".into(),
            tool: "ChatGPT Business".into(),
            purpose: "Öffentliche Texte sprachlich überarbeiten".into(),
        };
        let mut invalid = input();
        invalid.email = "invalid".into();
        assert!(persist_access_request(&conn, invalid).is_err());
        assert_eq!(
            conn.query_row("SELECT count(*) FROM app_settings", [], |row| row
                .get::<_, i64>(0))
                .unwrap(),
            0
        );
        let saved = persist_access_request(&conn, input()).unwrap();
        assert_eq!(saved.status, "prepared");
        let raw: String = conn
            .query_row(
                "SELECT value FROM app_settings WHERE key=?1",
                [format!("{ACCESS_PREFIX}{}", saved.id)],
                |row| row.get(0),
            )
            .unwrap();
        let restored: KiAccessRequest = serde_json::from_str(&raw).unwrap();
        assert_eq!(restored.input.tool, "ChatGPT Business");
        assert_eq!(restored.status, "prepared");
        assert!(protected_key(&format!("{ACCESS_PREFIX}{}", saved.id)));
    }
    fn config() -> KiConfig {
        KiConfig {
            revision: "r1".into(),
            title: "Official".into(),
            version: "1".into(),
            body: "Rules".into(),
            published: true,
            ..Default::default()
        }
    }
    fn input() -> KiSubmission {
        KiSubmission {
            revision: "r1".into(),
            full_name: "Anna Test".into(),
            email: "anna@example.test".into(),
            department: "".into(),
            read_confirmed: true,
            training_confirmed: true,
            training_mode: "onsite".into(),
            training_date: "2026-01-01".into(),
            signature_method: "typed".into(),
            signature_png: {
                let mut png = vec![0; 45];
                png[..8].copy_from_slice(b"\x89PNG\r\n\x1a\n");
                png[12..16].copy_from_slice(b"IHDR");
                png[16..20].copy_from_slice(&900u32.to_be_bytes());
                png[20..24].copy_from_slice(&220u32.to_be_bytes());
                png[37..].copy_from_slice(b"IEND\xaeB\x60\x82");
                format!("data:image/png;base64,{}", STANDARD.encode(png))
            },
        }
    }
    #[test]
    fn blocks_unpublished_changed_and_unconfirmed_policies() {
        let mut policy = config();
        let mut submission = input();
        assert!(validate_submission(&policy, &submission).is_ok());
        policy.published = false;
        assert!(validate_submission(&policy, &submission).is_err());
        policy.published = true;
        policy.revision = "r2".into();
        assert!(validate_submission(&policy, &submission).is_err());
        policy.revision = "r1".into();
        submission.training_confirmed = false;
        assert!(validate_submission(&policy, &submission).is_err());
    }
    #[test]
    fn rejects_future_training_and_external_signatures() {
        let mut submission = input();
        submission.training_date = "2999-01-01".into();
        assert!(validate_submission(&config(), &submission).is_err());
        submission.training_date = "2026-01-01".into();
        submission.signature_png = "https://example.test/signature.svg".into();
        assert!(validate_submission(&config(), &submission).is_err());
    }
    #[test]
    fn requires_official_content_and_safe_training_link() {
        let mut policy = config();
        policy.body.clear();
        assert!(validate_config(&policy).is_err());
        policy.body = "Rules".into();
        policy.training_url = "javascript:alert(1)".into();
        assert!(validate_config(&policy).is_err());
        policy.training_url = "https://user:password@example.test".into();
        assert!(validate_config(&policy).is_err());
        policy.training_url = "https://example.test/training".into();
        assert!(validate_config(&policy).is_ok());
    }

    #[test]
    fn supplied_pdf_is_current_and_preserved_in_signed_record_archive() {
        assert_eq!(format!("{:x}", Sha256::digest(CURRENT_PDF)), CURRENT_SHA);
        let mut conn = rusqlite::Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE app_settings(key TEXT PRIMARY KEY,value TEXT,updated_at TEXT);",
        )
        .unwrap();
        let current = read_config(&conn).unwrap();
        assert_eq!(current.version, "10.11.2026");
        assert!(current.published);
        let mut submission = input();
        submission.revision = current.revision;
        let receipt = persist_receipt(&mut conn, submission).unwrap();
        assert_eq!(receipt.policy.pdf_sha256, CURRENT_SHA);
        let archived: String = conn
            .query_row(
                "SELECT value FROM app_settings WHERE key=?1",
                [format!("{PDF_PREFIX}{CURRENT_SHA}")],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(STANDARD.decode(archived).unwrap(), CURRENT_PDF);
        assert!(read_pdf(&conn, "../outside.pdf").is_err());
    }

    #[test]
    fn receipt_keeps_original_document_and_stale_form_cannot_write() {
        let mut conn = rusqlite::Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE app_settings(key TEXT PRIMARY KEY,value TEXT,updated_at TEXT);",
        )
        .unwrap();
        conn.execute(
            "INSERT INTO app_settings VALUES (?1,?2,'now')",
            params![CONFIG_KEY, serde_json::to_string(&config()).unwrap()],
        )
        .unwrap();
        let receipt = persist_receipt(&mut conn, input()).unwrap();
        assert_eq!(receipt.policy.body, "Rules");
        assert_eq!(receipt.policy_sha256.len(), 64);
        let mut updated = config();
        updated.revision = "r2".into();
        updated.body = "New rules".into();
        conn.execute(
            "UPDATE app_settings SET value=?1 WHERE key=?2",
            params![serde_json::to_string(&updated).unwrap(), CONFIG_KEY],
        )
        .unwrap();
        assert!(persist_receipt(&mut conn, input()).is_err());
        let raw: String = conn
            .query_row(
                "SELECT value FROM app_settings WHERE key=?1",
                [format!("{RECEIPT_PREFIX}{}", receipt.id)],
                |row| row.get(0),
            )
            .unwrap();
        let stored: KiReceipt = serde_json::from_str(&raw).unwrap();
        assert_eq!(stored.policy.body, "Rules");
        assert_eq!(stored.policy_sha256, receipt.policy_sha256);
        assert_eq!(
            conn.query_row("SELECT count(*) FROM app_settings", [], |row| row
                .get::<_, i64>(0))
                .unwrap(),
            2
        );
    }
}
