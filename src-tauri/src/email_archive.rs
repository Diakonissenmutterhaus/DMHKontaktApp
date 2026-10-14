//! A local, read-only mail archive. Client stores are read; only our own archive
//! is written. No server credentials, sync, send, delete or read-flag commands.
use chrono::Utc;
use mailparse::{MailHeaderMap, ParsedMail};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet};
use std::fs::{self, File};
use std::io::{BufRead, BufReader, Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};
use uuid::Uuid;
pub(crate) mod attachments;
pub(crate) mod management;
pub(crate) mod message_actions;
pub(crate) mod ordering;

static COPY_GATE: Mutex<()> = Mutex::new(());
static ARCHIVE_DB_INIT_GATE: Mutex<()> = Mutex::new(());
static COPY_STATUS: Mutex<CopyStatus> = Mutex::new(CopyStatus {
    running: false,
    progress: String::new(),
    result: None,
    failed: false,
});
const MAX_PARSE_BYTES: u64 = 64 * 1024 * 1024;
const MAX_VIEW_BYTES: usize = 512 * 1024;
const PROGRESS_EVENT: &str = "local-email-copy-progress";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Source {
    pub id: String,
    pub name: String,
    pub kind: String,
    pub path: String,
    #[serde(default)]
    pub account_kind: String,
}

#[derive(Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Scan {
    pub sources: Vec<Source>,
    pub issues: Vec<String>,
    #[serde(default)]
    pub folders: Vec<SourceFolder>,
    #[serde(default)]
    pub archive_path: String,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceFolder {
    id: String,
    source_id: String,
    name: String,
    path: String,
    source: String,
    account_kind: String,
    imported_order: Option<i64>,
    sort_key: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Folder {
    id: String,
    name: String,
    path: String,
    source: String,
    account_kind: String,
    count: i64,
    source_id: String,
    imported_order: Option<i64>,
    sort_key: Option<String>,
}

#[derive(Debug, Default, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Message {
    pub id: String,
    pub folder_id: String,
    pub subject: String,
    pub sender: String,
    pub recipient: String,
    pub cc: String,
    pub date: String,
    #[serde(default)]
    pub body: String,
    #[serde(default)]
    pub html: String,
    #[serde(default)]
    pub attachments: Vec<String>,
    #[serde(default)]
    pub large: bool,
    #[serde(default)]
    pub category: String,
    #[serde(default)]
    pub category_color: String,
    #[serde(default)]
    pub deleted: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MessagePage {
    items: Vec<Message>,
    total: i64,
}

#[derive(Default, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CopyResult {
    pub copied: usize,
    pub folders: usize,
    pub issues: Vec<String>,
    pub completed_at: String,
}

#[derive(Default, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CopyStatus {
    running: bool,
    progress: String,
    result: Option<CopyResult>,
    failed: bool,
}

fn progress(app: &AppHandle, source: &str) {
    if let Ok(mut status) = COPY_STATUS.lock() {
        status.progress = source.into();
    }
    let _ = app.emit(PROGRESS_EVENT, source);
}

#[tauri::command]
pub fn get_local_email_copy_status() -> Result<CopyStatus, String> {
    COPY_STATUS
        .lock()
        .map(|status| status.clone())
        .map_err(|_| "Der Kopierstatus konnte nicht gelesen werden.".into())
}

#[derive(Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Query {
    folder_id: Option<String>,
    #[serde(default)]
    search: String,
    #[serde(default)]
    offset: usize,
    from_at: Option<String>,
    before_at: Option<String>,
    #[serde(default)]
    attachments_only: bool,
    #[serde(default)]
    sort: MessageSort,
    #[serde(default)]
    include_deleted: bool,
    category: Option<String>,
}

#[derive(Default, Deserialize)]
#[serde(rename_all = "camelCase")]
enum MessageSort {
    #[default]
    Newest,
    Oldest,
    Subject,
    SubjectDesc,
    Sender,
    SenderDesc,
}

fn hash(value: impl AsRef<[u8]>) -> String {
    format!("{:x}", Sha256::digest(value.as_ref()))
}
fn root(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("email-archive"))
}
fn db(root: &Path) -> Result<Connection, String> {
    // The UI requests folders and messages concurrently on first open. SQLite
    // can reject two simultaneous WAL/schema upgrades before busy_timeout can
    // help. Serialize initialization, then release before any archive queries.
    let _initialization = ARCHIVE_DB_INIT_GATE
        .lock()
        .map_err(|_| "Das E-Mail-Archiv konnte nicht vorbereitet werden.".to_string())?;
    fs::create_dir_all(root).map_err(|e| e.to_string())?;
    let conn = Connection::open(root.join("archive.sqlite")).map_err(|e| e.to_string())?;
    conn.busy_timeout(Duration::from_secs(10))
        .map_err(|e| e.to_string())?;
    conn.execute_batch("PRAGMA journal_mode=WAL;
        CREATE TABLE IF NOT EXISTS folders(id TEXT PRIMARY KEY, name TEXT NOT NULL, path TEXT NOT NULL, source TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS messages(id TEXT PRIMARY KEY, folder_id TEXT NOT NULL, subject TEXT NOT NULL,
          sender TEXT NOT NULL, recipient TEXT NOT NULL, cc TEXT NOT NULL, date TEXT NOT NULL,
          raw_path TEXT NOT NULL, byte_offset INTEGER NOT NULL, byte_length INTEGER NOT NULL,
          format TEXT NOT NULL, content TEXT NOT NULL, copied_at TEXT NOT NULL);
        CREATE INDEX IF NOT EXISTS email_archive_folder ON messages(folder_id, date);")
        .map_err(|e| e.to_string())?;
    management::initialize(&conn)?;
    ordering::initialize(&conn)?;
    message_actions::initialize(&conn)?;
    conn.execute_batch("CREATE TABLE IF NOT EXISTS email_archive_source_details(source_id TEXT PRIMARY KEY,account_kind TEXT NOT NULL);").map_err(|e| e.to_string())?;
    if !has_source_column(&conn)? {
        // Folder/message reads may open the old archive simultaneously. Check
        // again under the write lock so migration cannot run twice.
        conn.execute_batch("BEGIN IMMEDIATE")
            .map_err(|e| e.to_string())?;
        if !has_source_column(&conn)? {
            conn.execute_batch(
                "ALTER TABLE folders ADD COLUMN source_id TEXT NOT NULL DEFAULT '';",
            )
            .map_err(|e| e.to_string())?;
        }
        conn.execute_batch("COMMIT").map_err(|e| e.to_string())?;
    }
    Ok(conn)
}

fn record_source_details(conn: &Connection, sources: &[Source]) -> Result<(), String> {
    for source in sources
        .iter()
        .filter(|source| !source.account_kind.is_empty())
    {
        conn.execute("INSERT INTO email_archive_source_details(source_id,account_kind) VALUES(?1,?2) ON CONFLICT(source_id) DO UPDATE SET account_kind=excluded.account_kind", params![source.id, source.account_kind]).map_err(|e| e.to_string())?;
    }
    Ok(())
}
fn folder(conn: &Connection, source: &Source, path: &str) -> Result<String, String> {
    let id = hash(format!("{}\n{path}", source.id));
    conn.execute(
        "INSERT INTO folders(id,name,path,source,source_id) VALUES(?1,?2,?3,?4,?5) ON CONFLICT(id) DO UPDATE SET source_id=excluded.source_id",
        params![
            id,
            path.rsplit('/').next().unwrap_or(path),
            path,
            source.kind,
            source.id
        ],
    )
    .map_err(|e| e.to_string())?;
    Ok(id)
}

fn has_source_column(conn: &Connection) -> Result<bool, String> {
    Ok(conn
        .prepare("PRAGMA table_info(folders)")
        .map_err(|e| e.to_string())?
        .query_map([], |row| row.get::<_, String>(1))
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?
        .iter()
        .any(|name| name == "source_id"))
}

// profiles.ini can include absolute/custom profile locations, not only the
// currently active profile. prefs.js can move individual mail stores elsewhere.
fn profile_paths(base: &Path) -> Vec<PathBuf> {
    let mut paths = Vec::new();
    let ini = fs::read_to_string(base.join("profiles.ini")).unwrap_or_default();
    let mut section: HashMap<String, String> = HashMap::new();
    let add = |section: &HashMap<String, String>, paths: &mut Vec<PathBuf>| {
        if let Some(value) = section.get("Path") {
            let path = if section.get("IsRelative").map(String::as_str) == Some("0") {
                PathBuf::from(value)
            } else {
                base.join(value)
            };
            if path.is_dir() {
                paths.push(path);
            }
        }
    };
    for line in ini.lines().chain(std::iter::once("[end]")) {
        let line = line.trim();
        if line.starts_with('[') {
            add(&section, &mut paths);
            section.clear();
        } else if let Some((key, value)) = line.split_once('=') {
            section.insert(key.trim().into(), value.trim().into());
        }
    }
    if let Ok(entries) = fs::read_dir(base.join("Profiles")) {
        paths.extend(
            entries
                .flatten()
                .map(|entry| entry.path())
                .filter(|path| path.is_dir()),
        );
    }
    paths.sort();
    paths.dedup();
    paths
}
fn prefs(profile: &Path) -> HashMap<String, String> {
    let mut values = HashMap::new();
    for line in fs::read_to_string(profile.join("prefs.js"))
        .unwrap_or_default()
        .lines()
    {
        if let Some(raw) = line
            .trim()
            .strip_prefix("user_pref(")
            .and_then(|line| line.strip_suffix(");"))
        {
            if let Ok(pair) = serde_json::from_str::<Vec<serde_json::Value>>(&format!("[{raw}]")) {
                if let (Some(key), Some(value)) = (
                    pair.first().and_then(|v| v.as_str()),
                    pair.get(1).and_then(|v| v.as_str()),
                ) {
                    values.insert(key.into(), value.into());
                }
            }
        }
    }
    values
}
fn thunderbird_sources(base: &Path) -> Vec<Source> {
    let mut sources = Vec::new();
    let mut seen = HashSet::new();
    for profile in profile_paths(base) {
        let settings = prefs(&profile);
        let mut roots = Vec::new();
        for kind in ["Mail", "ImapMail"] {
            if let Ok(entries) = fs::read_dir(profile.join(kind)) {
                roots.extend(
                    entries
                        .flatten()
                        .map(|entry| entry.path())
                        .filter(|path| path.is_dir()),
                );
            }
        }
        for (key, value) in &settings {
            if key.starts_with("mail.server.")
                && (key.ends_with(".directory") || key.ends_with(".directory-rel"))
            {
                let path = value
                    .strip_prefix("[ProfD]")
                    .map(|relative| profile.join(relative.trim_start_matches(['/', '\\'])))
                    .unwrap_or_else(|| PathBuf::from(value));
                if path.is_dir() {
                    roots.push(path);
                }
            }
        }
        for path in roots {
            let Ok(path) = fs::canonicalize(path) else {
                continue;
            };
            if !seen.insert(path.clone()) {
                continue;
            }
            let profile_name = profile.file_name().unwrap_or_default().to_string_lossy();
            let account = path.file_name().unwrap_or_default().to_string_lossy();
            sources.push(Source {
                id: hash(path.to_string_lossy().as_bytes()),
                name: format!("Thunderbird · {profile_name} · {account}"),
                kind: "thunderbird".into(),
                account_kind: String::new(),
                path: path.to_string_lossy().into(),
            });
        }
    }
    sources
}

#[derive(Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct OutlookResult {
    #[serde(default)]
    sources: Vec<Source>,
    #[serde(default)]
    folders: Vec<OutlookFolder>,
    #[serde(default)]
    issues: Vec<String>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct OutlookFolder {
    source_id: String,
    path: String,
    #[serde(default)]
    imported_order: Option<i64>,
    #[serde(default)]
    sort_key: Option<String>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct OutlookMessage {
    source_id: String,
    path: String,
    native_id: String,
    raw_file: String,
    subject: String,
    sender: String,
    recipient: String,
    cc: String,
    date: String,
    body: String,
    html: String,
    attachments: Vec<String>,
}
fn outlook(mode: &str, destination: &Path, ids: &[String]) -> Result<OutlookResult, String> {
    fs::create_dir_all(destination).map_err(|e| e.to_string())?;
    let config = destination.join("input.json");
    fs::write(
        &config,
        serde_json::to_vec(
            &serde_json::json!({"mode": mode, "destination": destination, "sourceIds": ids}),
        )
        .map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    let script = destination.join("outlook-copy.ps1");
    fs::write(&script, include_str!("email_archive_outlook.ps1")).map_err(|e| e.to_string())?;
    let output = crate::hidden_command("powershell")
        .args(["-NoProfile", "-STA", "-ExecutionPolicy", "Bypass", "-File"])
        .arg(&script)
        .arg("-ConfigPath")
        .arg(&config)
        .output()
        .map_err(|e| e.to_string())?;
    if !output.status.success() {
        return Err("Outlook Classic konnte nicht gelesen werden. Bitte Outlook Classic öffnen und erneut prüfen.".into());
    }
    serde_json::from_slice(&output.stdout).map_err(|_| {
        "Die Outlook-Antwort konnte nicht gelesen werden. Bitte Outlook Classic prüfen.".into()
    })
}
fn source_folder(source: &Source, path: &str) -> SourceFolder {
    SourceFolder {
        id: hash(format!("{}\n{path}", source.id)),
        source_id: source.id.clone(),
        name: path.rsplit('/').next().unwrap_or(path).into(),
        path: path.into(),
        source: source.kind.clone(),
        account_kind: source.account_kind.clone(),
        imported_order: None,
        sort_key: None,
    }
}

// Preview folder names only: do not parse messages, MSF files or attachments.
fn thunderbird_folder_preview(
    source: &Source,
    directory: &Path,
    path: &str,
    depth: usize,
    paths: &mut HashSet<String>,
) -> Result<(), String> {
    if depth > 128 || paths.len() > 100_000 {
        return Err("Die Ordnerstruktur ist zu groß für die Vorschau.".into());
    }
    paths.insert(path.into());
    for entry in fs::read_dir(directory).map_err(|e| e.to_string())? {
        if paths.len() > 100_000 {
            return Err("Die Ordnerstruktur ist zu groß für die Vorschau.".into());
        }
        let entry = entry.map_err(|e| e.to_string())?;
        let kind = entry.file_type().map_err(|e| e.to_string())?;
        let name = entry.file_name().to_string_lossy().into_owned();
        if kind.is_dir() && !matches!(name.as_str(), "cur" | "new" | "tmp") {
            thunderbird_folder_preview(
                source,
                &entry.path(),
                &format!("{path}/{}", name.strip_suffix(".sbd").unwrap_or(&name)),
                depth + 1,
                paths,
            )?;
        } else if kind.is_file()
            && (name.ends_with(".msf")
                || !name.contains('.')
                || name.ends_with(".mbox")
                || directory.join(format!("{name}.msf")).exists())
        {
            paths.insert(format!(
                "{path}/{}",
                name.strip_suffix(".msf").unwrap_or(&name)
            ));
        }
    }
    Ok(())
}

fn scan(root: &Path) -> Scan {
    let mut scan = Scan::default();
    scan.archive_path = root.to_string_lossy().into_owned();
    if let Some(roaming) = std::env::var_os("APPDATA") {
        scan.sources = thunderbird_sources(&PathBuf::from(roaming).join("Thunderbird"));
    }
    for source in &scan.sources {
        let mut paths = HashSet::new();
        if thunderbird_folder_preview(source, Path::new(&source.path), &source.name, 0, &mut paths)
            .is_err()
        {
            scan.issues.push(format!(
                "{}: Ordnerübersicht ist unvollständig. Bitte Quelle prüfen.",
                source.name
            ));
        }
        let mut paths = paths.into_iter().collect::<Vec<_>>();
        paths.sort();
        scan.folders
            .extend(paths.iter().map(|path| source_folder(source, path)));
    }
    let staging = root.join("jobs").join(Uuid::new_v4().to_string());
    match outlook("scan", &staging, &[]) {
        Ok(result) => {
            for item in result.folders {
                if let Some(source) = result
                    .sources
                    .iter()
                    .find(|source| source.id == item.source_id)
                {
                    let mut folder = source_folder(source, &item.path);
                    folder.imported_order = item.imported_order;
                    folder.sort_key = item.sort_key;
                    scan.folders.push(folder);
                }
            }
            scan.sources.extend(result.sources);
            scan.issues.extend(result.issues);
        }
        Err(error) => scan.issues.push(error),
    }
    // This is a generated metadata-only staging directory beneath our archive.
    let _ = fs::remove_dir_all(&staging);
    scan
}

fn copy_file(source: &Path, destination: &Path) -> Result<(), String> {
    let before = source.metadata().map_err(|e| e.to_string())?;
    if let Some(parent) = destination.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::copy(source, destination).map_err(|e| e.to_string())?;
    let after = source.metadata().map_err(|e| e.to_string())?;
    if before.len() != after.len() || before.modified().ok() != after.modified().ok() {
        return Err("Die Quelldatei hat sich während der Kopie geändert. Bitte Thunderbird schließen und erneut kopieren.".into());
    }
    Ok(())
}
fn copy_tree(
    source: &Path,
    destination: &Path,
    depth: usize,
    issues: &mut Vec<String>,
) -> Result<(), String> {
    if depth > 128 {
        return Err("Die Ordnerstruktur ist zu tief. Bitte die EDV um Prüfung bitten.".into());
    }
    fs::create_dir_all(destination).map_err(|e| e.to_string())?;
    for entry in fs::read_dir(source).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let kind = entry.file_type().map_err(|e| e.to_string())?;
        let path = entry.path();
        if kind.is_symlink() {
            issues.push(format!(
                "{} : Verknüpfung wurde nicht kopiert. Bitte die Originaldateien prüfen.",
                path.display()
            ));
            continue;
        }
        let target = destination.join(entry.file_name());
        let result = if kind.is_dir() {
            copy_tree(&path, &target, depth + 1, issues)
        } else if kind.is_file() {
            copy_file(&path, &target)
        } else {
            Ok(())
        };
        if let Err(error) = result {
            return Err(format!("{}: {error}", path.display()));
        }
    }
    Ok(())
}
fn mime_parts(mail: &ParsedMail<'_>, message: &mut Message) {
    let disposition = mail.get_content_disposition();
    let filename = disposition
        .params
        .get("filename")
        .or_else(|| mail.ctype.params.get("name"));
    if let Some(filename) = filename {
        message.attachments.push(filename.clone());
        return;
    }
    if matches!(
        disposition.disposition,
        mailparse::DispositionType::Attachment
    ) {
        message.attachments.push("Anhang".into());
        return;
    }
    if mail.subparts.is_empty() {
        match mail.ctype.mimetype.as_str() {
            "text/plain" => {
                if let Ok(body) = mail.get_body() {
                    if !message.body.is_empty() {
                        message.body.push('\n');
                    }
                    message.body.push_str(&body);
                }
            }
            "text/html" => {
                if message.html.is_empty() {
                    message.html = mail.get_body().unwrap_or_default();
                }
            }
            _ => {}
        }
    } else {
        for part in &mail.subparts {
            mime_parts(part, message);
        }
    }
}
fn parse_message(bytes: &[u8]) -> Result<Message, String> {
    let mail = mailparse::parse_mail(bytes).map_err(|e| e.to_string())?;
    let mut message = Message {
        subject: mail.headers.get_first_value("Subject").unwrap_or_default(),
        sender: mail.headers.get_first_value("From").unwrap_or_default(),
        recipient: mail.headers.get_first_value("To").unwrap_or_default(),
        cc: mail.headers.get_first_value("Cc").unwrap_or_default(),
        date: mail
            .headers
            .get_first_value("Date")
            .and_then(|value| mailparse::dateparse(&value).ok())
            .and_then(|value| chrono::DateTime::from_timestamp(value, 0))
            .map(|date| date.to_rfc3339())
            .unwrap_or_default(),
        ..Message::default()
    };
    mime_parts(&mail, &mut message);
    Ok(message)
}
fn slice(path: &Path, offset: u64, length: u64) -> Result<Vec<u8>, String> {
    let mut file = File::open(path).map_err(|e| e.to_string())?;
    file.seek(SeekFrom::Start(offset))
        .map_err(|e| e.to_string())?;
    let mut bytes = Vec::new();
    file.take(length.min(MAX_PARSE_BYTES))
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    Ok(bytes)
}
fn put(
    conn: &Connection,
    folder_id: &str,
    mut message: Message,
    path: &Path,
    offset: u64,
    length: u64,
    format: &str,
    identity: &str,
) -> Result<(), String> {
    message.id = hash(format!("{folder_id}\n{identity}"));
    message.folder_id = folder_id.into();
    let json = serde_json::to_string(&message).map_err(|e| e.to_string())?;
    conn.execute("INSERT INTO messages VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13)
      ON CONFLICT(id) DO UPDATE SET subject=excluded.subject,sender=excluded.sender,recipient=excluded.recipient,
      cc=excluded.cc,date=excluded.date,raw_path=excluded.raw_path,byte_offset=excluded.byte_offset,
      byte_length=excluded.byte_length,format=excluded.format,content=excluded.content,copied_at=excluded.copied_at",
      params![message.id, folder_id, message.subject, message.sender, message.recipient, message.cc, message.date,
        path.to_string_lossy(), offset, length, format, json, Utc::now().to_rfc3339()]).map_err(|e| e.to_string())?;
    Ok(())
}
fn index_slice(
    conn: &Connection,
    folder_id: &str,
    path: &Path,
    offset: u64,
    length: u64,
    seen: &mut HashMap<String, usize>,
) -> Result<(), String> {
    if length == 0 {
        return Ok(());
    }
    let bytes = slice(path, offset, length)?;
    let mut message = parse_message(&bytes)?;
    message.large = length > MAX_PARSE_BYTES;
    // Headers are kept in the index. Bodies are decoded from the local raw copy
    // only when opened; opening a message never touches the original client.
    message.body.clear();
    message.html.clear();
    let fingerprint = message_fingerprint(&bytes, length);
    let occurrence = seen.entry(fingerprint.clone()).or_default();
    *occurrence += 1;
    put(
        conn,
        folder_id,
        message,
        path,
        offset,
        length,
        "mime",
        &format!("{fingerprint}:{occurrence}"),
    )
}
fn message_fingerprint(bytes: &[u8], length: u64) -> String {
    let mut digest = Sha256::new();
    let mut headers = true;
    let mut skip = false;
    let mut removed = 0u64;
    for line in bytes.split_inclusive(|byte| *byte == b'\n') {
        if headers {
            let trimmed = line
                .strip_suffix(b"\n")
                .unwrap_or(line)
                .strip_suffix(b"\r")
                .unwrap_or(line.strip_suffix(b"\n").unwrap_or(line));
            if trimmed.is_empty() {
                headers = false;
                skip = false;
            } else if !line.starts_with(b" ") && !line.starts_with(b"\t") {
                let key = line.split(|byte| *byte == b':').next().unwrap_or_default();
                skip = [
                    "x-mozilla-status",
                    "x-mozilla-status2",
                    "x-mozilla-keys",
                    "status",
                    "x-status",
                ]
                .iter()
                .any(|value| key.eq_ignore_ascii_case(value.as_bytes()));
            }
        }
        if !skip {
            digest.update(line);
        } else {
            removed += line.len() as u64;
        }
    }
    digest.update(length.saturating_sub(removed).to_le_bytes());
    format!("{:x}", digest.finalize())
}
fn read_line_prefix(reader: &mut impl BufRead, prefix: &mut Vec<u8>) -> std::io::Result<u64> {
    prefix.clear();
    let mut count = 0;
    loop {
        let buffer = reader.fill_buf()?;
        if buffer.is_empty() {
            return Ok(count);
        }
        let newline = buffer.iter().position(|byte| *byte == b'\n');
        let used = newline.map(|index| index + 1).unwrap_or(buffer.len());
        prefix.extend_from_slice(&buffer[..used.min(256usize.saturating_sub(prefix.len()))]);
        count += used as u64;
        reader.consume(used);
        if newline.is_some() {
            return Ok(count);
        }
    }
}
fn index_mbox(conn: &Connection, folder_id: &str, path: &Path) -> Result<usize, String> {
    let mut reader = BufReader::new(File::open(path).map_err(|e| e.to_string())?);
    let mut line = Vec::new();
    let mut offset = 0u64;
    let mut start = 0u64;
    let mut count = 0;
    let mut seen = HashMap::new();
    loop {
        let size = read_line_prefix(&mut reader, &mut line).map_err(|e| e.to_string())?;
        if size == 0 {
            break;
        }
        let separator = line.starts_with(b"From ") && line.contains(&b':');
        if separator {
            if offset > start {
                index_slice(conn, folder_id, path, start, offset - start, &mut seen)?;
                count += 1;
            }
            start = offset + size;
        }
        offset += size;
    }
    if offset > start {
        index_slice(conn, folder_id, path, start, offset - start, &mut seen)?;
        count += 1;
    }
    Ok(count)
}
fn index_tree(
    conn: &Connection,
    source: &Source,
    directory: &Path,
    display_path: &str,
    depth: usize,
    result: &mut CopyResult,
) -> Result<(), String> {
    if depth > 128 {
        return Err("Die Ordnerstruktur ist zu tief.".into());
    }
    let current_folder = folder(conn, source, display_path)?;
    result.folders += 1;
    let mut direct_seen = HashMap::new();
    for entry in fs::read_dir(directory).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        let kind = entry.file_type().map_err(|e| e.to_string())?;
        let name = entry.file_name().to_string_lossy().into_owned();
        if kind.is_dir() {
            if matches!(name.as_str(), "cur" | "new") {
                for file in fs::read_dir(&path).map_err(|e| e.to_string())? {
                    let file = file.map_err(|e| e.to_string())?;
                    if file.file_type().map_err(|e| e.to_string())?.is_file() {
                        index_slice(
                            conn,
                            &current_folder,
                            &file.path(),
                            0,
                            file.metadata().map_err(|e| e.to_string())?.len(),
                            &mut direct_seen,
                        )?;
                        result.copied += 1;
                    }
                }
            } else if name != "tmp" {
                index_tree(
                    conn,
                    source,
                    &path,
                    &format!(
                        "{display_path}/{}",
                        name.strip_suffix(".sbd").unwrap_or(&name)
                    ),
                    depth + 1,
                    result,
                )?;
            }
        } else if kind.is_file() {
            if name.ends_with(".msf") {
                folder(
                    conn,
                    source,
                    &format!("{display_path}/{}", name.trim_end_matches(".msf")),
                )?;
            } else if !name.contains('.')
                || directory.join(format!("{name}.msf")).exists()
                || name.ends_with(".mbox")
            {
                let id = folder(conn, source, &format!("{display_path}/{name}"))?;
                result.copied += index_mbox(conn, &id, &path)?;
            } else if name.ends_with(".eml") {
                index_slice(
                    conn,
                    &current_folder,
                    &path,
                    0,
                    entry.metadata().map_err(|e| e.to_string())?.len(),
                    &mut direct_seen,
                )?;
                result.copied += 1;
            }
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn scan_local_email_sources(app: AppHandle) -> Result<Scan, String> {
    let root = root(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        let scan = scan(&root);
        // A scan during a long Outlook copy must not contend with its writer.
        // The running copy records the same metadata when it finishes.
        if let Ok(_gate) = COPY_GATE.try_lock() {
            let mut conn = db(&root)?;
            let transaction = conn.transaction().map_err(|e| e.to_string())?;
            record_source_details(&transaction, &scan.sources)?;
            for folder in &scan.folders {
                ordering::record_imported(
                    &transaction,
                    &folder.id,
                    folder.imported_order,
                    folder.sort_key.as_deref(),
                )?;
            }
            transaction.commit().map_err(|e| e.to_string())?;
        }
        Ok(scan)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn copy_local_emails(
    app: AppHandle,
    source_ids: Vec<String>,
) -> Result<CopyResult, String> {
    if source_ids.is_empty() {
        return Err("Bitte mindestens eine E-Mail-Quelle auswählen.".into());
    }
    let root = root(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        let _gate = COPY_GATE.try_lock().map_err(|_| "Eine E-Mail-Kopie läuft bereits. Bitte warten.".to_string())?;
        if let Ok(mut status) = COPY_STATUS.lock() { *status = CopyStatus { running: true, ..Default::default() }; }
        let outcome: Result<CopyResult, String> = (|| {
        let available = scan(&root);
        let selected: Vec<_> = available.sources.into_iter().filter(|source| source_ids.contains(&source.id)).collect();
        if selected.len() != source_ids.iter().collect::<HashSet<_>>().len() { return Err("Eine gewählte E-Mail-Quelle ist nicht mehr verfügbar. Bitte Quellen erneut prüfen.".into()); }
        let conn = db(&root)?;
        record_source_details(&conn, &selected)?;
        let snapshot = root.join("copies").join(Uuid::new_v4().to_string());
        fs::create_dir_all(&snapshot).map_err(|e| e.to_string())?;
        let mut result = CopyResult::default();
        for source in selected.iter().filter(|source| source.kind == "thunderbird") {
            progress(&app, &source.name);
            let destination = snapshot.join(&source.id);
            let counts_before = (result.copied, result.folders);
            let outcome = copy_tree(Path::new(&source.path), &destination, 0, &mut result.issues)
                .and_then(|_| {
                    conn.execute_batch("SAVEPOINT email_source").map_err(|e| e.to_string())?;
                    let indexed = index_tree(&conn, source, &destination, &source.name, 0, &mut result);
                    match indexed {
                        Ok(()) => conn.execute_batch("RELEASE email_source").map_err(|e| e.to_string()),
                        Err(error) => { let _ = conn.execute_batch("ROLLBACK TO email_source; RELEASE email_source"); Err(error) }
                    }
                });
            if let Err(error) = outcome {
                (result.copied, result.folders) = counts_before;
                let _ = crate::diagnostics::record(&app, crate::diagnostics::DiagnosticMessage { origin: "email-archive".into(), level: "error".into(), entity_kind: "email-folder".into(), title: Some(source.name.clone()), operation: Some("copy".into()), message: error, ..Default::default() });
                result.issues.push(format!("{} : Nicht vollständig kopiert. Bitte Thunderbird schließen, freien Speicher prüfen und erneut kopieren.", source.name));
            }
        }
        let outlook_ids: Vec<_> = selected.iter().filter(|source| source.kind == "outlook").map(|source| source.id.clone()).collect();
        if !outlook_ids.is_empty() {
            progress(&app, "Outlook Classic");
            let destination = snapshot.join("outlook");
            match outlook("copy", &destination, &outlook_ids) {
                Ok(export) => {
                    result.issues.extend(export.issues);
                    conn.execute_batch("BEGIN IMMEDIATE").map_err(|e| e.to_string())?;
                    for item in export.folders {
                        if let Some(source) = selected.iter().find(|source| source.id == item.source_id) {
                            let id = folder(&conn, source, &item.path)?;
                            ordering::record_imported(&conn, &id, item.imported_order, item.sort_key.as_deref())?;
                            result.folders += 1;
                        }
                    }
                    let file = File::open(destination.join("messages.jsonl")).map_err(|e| e.to_string())?;
                    for line in BufReader::new(file).lines() {
                        let line = line.map_err(|e| e.to_string())?;
                        let item: OutlookMessage = serde_json::from_str(&line).map_err(|e| e.to_string())?;
                        let Some(source) = selected.iter().find(|source| source.id == item.source_id) else { continue };
                        let id = folder(&conn, source, &item.path)?;
                        let path = destination.join(&item.raw_file);
                        if !matches!(Path::new(&item.raw_file).components().collect::<Vec<_>>().as_slice(), [std::path::Component::Normal(_)]) || !item.raw_file.ends_with(".msg") || !path.is_file() { return Err("Eine Outlook-Kopie ist unvollständig. Bitte erneut kopieren.".into()); }
                        let message = Message { subject: item.subject, sender: item.sender, recipient: item.recipient, cc: item.cc, date: item.date, body: item.body, html: item.html, attachments: item.attachments, ..Default::default() };
                        put(&conn, &id, message, &path, 0, path.metadata().map_err(|e| e.to_string())?.len(), "outlook", &item.native_id)?;
                        result.copied += 1;
                    }
                    conn.execute_batch("COMMIT").map_err(|e| e.to_string())?;
                }
                Err(error) => result.issues.push(error),
            }
        }
        result.completed_at = Utc::now().to_rfc3339();
        Ok(result)
        })();
        if let Ok(mut status) = COPY_STATUS.lock() {
            status.running = false;
            match &outcome { Ok(result) => status.result = Some(result.clone()), Err(_) => status.failed = true }
        }
        outcome
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn list_email_archive_folders(app: AppHandle) -> Result<Vec<Folder>, String> {
    let root = root(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        let conn = db(&root)?;
        let mut query = conn.prepare(&format!("SELECT f.id,f.name,f.path,f.source,coalesce(n.total,0),f.source_id,o.position,o.sort_key,coalesce(d.account_kind,'') FROM folders f {} LEFT JOIN email_archive_imported_order o ON o.folder_id=f.id LEFT JOIN email_archive_source_details d ON d.source_id=f.source_id WHERE {} ORDER BY f.source,f.path COLLATE NOCASE", message_actions::COUNTS_JOIN, management::VISIBLE_FOLDER)).map_err(|e| e.to_string())?;
        let rows = query.query_map([], |row| Ok(Folder { id: row.get(0)?, name: row.get(1)?, path: row.get(2)?, source: row.get(3)?, count: row.get(4)?, source_id: row.get(5)?, imported_order: row.get(6)?, sort_key: row.get(7)?, account_kind:row.get(8)? })).map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn list_email_archive_messages(
    app: AppHandle,
    query: Query,
) -> Result<MessagePage, String> {
    let root = root(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        let conn = db(&root)?;
        query_messages(&conn, query)
    })
    .await
    .map_err(|e| e.to_string())?
}

fn query_messages(conn: &Connection, query: Query) -> Result<MessagePage, String> {
    // Compare instants rather than ISO text: old copies may use different UTC offsets.
    let parse_boundary =
        |value: &Option<String>| -> Result<Option<chrono::DateTime<chrono::FixedOffset>>, String> {
            value
                .as_deref()
                .map(|value| {
                    chrono::DateTime::parse_from_rfc3339(value)
                        .map_err(|_| "Ungültiger Zeitraum für die E-Mail-Suche.".to_string())
                })
                .transpose()
        };
    let from = parse_boundary(&query.from_at)?;
    let before = parse_boundary(&query.before_at)?;
    if matches!((from, before), (Some(from), Some(before)) if from >= before) {
        return Err("Das Enddatum muss nach dem Anfang des Suchzeitraums liegen.".into());
    }
    conn.create_scalar_function(
        "email_lower",
        1,
        rusqlite::functions::FunctionFlags::SQLITE_UTF8
            | rusqlite::functions::FunctionFlags::SQLITE_DETERMINISTIC,
        |ctx| Ok(ctx.get::<String>(0)?.to_lowercase()),
    )
    .map_err(|e| e.to_string())?;
    let pattern = format!(
        "%{}%",
        query
            .search
            .trim()
            .to_lowercase()
            .replace('\\', "\\\\")
            .replace('%', "\\%")
            .replace('_', "\\_")
    );
    // Search concatenated headers like Contacts, with Unicode casing and literal wildcards.
    // Never load the raw mail files or bodies to list/filter messages.
    let filter = format!("WHERE (?1 IS NULL OR coalesce(s.folder_id,messages.folder_id)=?1) AND {}
        AND (?2='%%' OR email_lower(subject || ' ' || sender || ' ' || recipient || ' ' || cc || ' ' ||
          coalesce((SELECT group_concat(value, ' ') FROM json_each(content, '$.attachments')), '')) LIKE ?2 ESCAPE '\\')
        AND (?3 IS NULL OR julianday(date)>=julianday(?3))
        AND (?4 IS NULL OR julianday(date)<julianday(?4))
        AND (?5=0 OR coalesce(json_array_length(content, '$.attachments'), 0)>0)
        AND ((s.deleted_at IS NOT NULL)=?7) AND (?8 IS NULL OR ?8='' OR s.category=?8)", management::VISIBLE_FOLDER);
    let order = match query.sort {
        MessageSort::Newest => "julianday(date) IS NULL, julianday(date) DESC, messages.id",
        MessageSort::Oldest => "julianday(date) IS NULL, julianday(date) ASC, messages.id",
        MessageSort::Subject => "email_lower(subject), julianday(date) DESC, messages.id",
        MessageSort::SubjectDesc => "email_lower(subject) DESC, julianday(date) DESC, messages.id",
        MessageSort::Sender => "email_lower(sender), julianday(date) DESC, messages.id",
        MessageSort::SenderDesc => "email_lower(sender) DESC, julianday(date) DESC, messages.id",
    };
    let total = conn
        .query_row(
            &format!("SELECT COUNT(*) {} {filter}", message_actions::MESSAGE_JOIN),
            params![
                query.folder_id,
                pattern,
                query.from_at,
                query.before_at,
                query.attachments_only,
                0,
                query.include_deleted,
                query.category
            ],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;
    let mut statement = conn.prepare(&format!("SELECT messages.id,coalesce(s.folder_id,messages.folder_id),subject,sender,recipient,cc,date,
        coalesce(json_extract(content,'$.attachments'), '[]'),coalesce(json_extract(content,'$.large'), 0)
        ,coalesce(s.category,''),coalesce(s.category_color,'#0078d4'),s.deleted_at IS NOT NULL
        {} {filter} ORDER BY {order} LIMIT 100 OFFSET ?6",message_actions::MESSAGE_JOIN)).map_err(|e| e.to_string())?;
    let rows = statement
        .query_map(
            params![
                query.folder_id,
                pattern,
                query.from_at,
                query.before_at,
                query.attachments_only,
                query.offset.min(i64::MAX as usize) as i64,
                query.include_deleted,
                query.category
            ],
            |row| {
                let attachments: String = row.get(7)?;
                Ok(Message {
                    id: row.get(0)?,
                    folder_id: row.get(1)?,
                    subject: row.get(2)?,
                    sender: row.get(3)?,
                    recipient: row.get(4)?,
                    cc: row.get(5)?,
                    date: row.get(6)?,
                    attachments: serde_json::from_str(&attachments).unwrap_or_default(),
                    large: row.get(8)?,
                    category: row.get(9)?,
                    category_color: row.get(10)?,
                    deleted: row.get(11)?,
                    ..Default::default()
                })
            },
        )
        .map_err(|e| e.to_string())?;
    Ok(MessagePage {
        items: rows
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?,
        total,
    })
}

#[tauri::command]
pub async fn read_email_archive_message(app: AppHandle, id: String) -> Result<Message, String> {
    let root = root(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        let conn = db(&root)?;
        let record: Option<(String, u64, u64, String, String)> = conn
            .query_row(
                &format!("SELECT raw_path,byte_offset,byte_length,format,content {} WHERE messages.id=?1 AND {}", message_actions::MESSAGE_JOIN, management::VISIBLE_FOLDER),
                [&id],
                |row| {
                    Ok((
                        row.get(0)?,
                        row.get(1)?,
                        row.get(2)?,
                        row.get(3)?,
                        row.get(4)?,
                    ))
                },
            )
            .optional()
            .map_err(|e| e.to_string())?;
        let (path, offset, length, format, json) = record
            .ok_or_else(|| "Die Nachricht ist nicht im lokalen Archiv vorhanden.".to_string())?;
        let path = fs::canonicalize(path)
            .map_err(|_| "Die lokale Kopie fehlt. Bitte die Quelle erneut kopieren.".to_string())?;
        let archive_root = fs::canonicalize(root.join("copies")).map_err(|e| e.to_string())?;
        if !path.starts_with(archive_root) {
            return Err("Die Nachricht liegt außerhalb des lokalen Archivs.".into());
        }
        let mut message: Message = serde_json::from_str(&json).map_err(|e| e.to_string())?;
        let (folder_id,category,color,deleted): (String,String,String,bool) = conn.query_row(
            &format!("SELECT coalesce(s.folder_id,messages.folder_id),coalesce(s.category,''),coalesce(s.category_color,'#0078d4'),s.deleted_at IS NOT NULL {} WHERE messages.id=?1",message_actions::MESSAGE_JOIN),
            [id],|row| Ok((row.get(0)?,row.get(1)?,row.get(2)?,row.get(3)?))).map_err(|e| e.to_string())?;
        message.folder_id=folder_id; message.category=category; message.category_color=color; message.deleted=deleted;
        if format == "mime" {
            let decoded = parse_message(&slice(&path, offset, length)?)?;
            message.body = decoded.body;
            message.html = decoded.html;
            message.attachments = decoded.attachments;
        }
        for text in [&mut message.body, &mut message.html] {
            if text.len() > MAX_VIEW_BYTES {
                let mut end = MAX_VIEW_BYTES;
                while !text.is_char_boundary(end) {
                    end -= 1;
                }
                text.truncate(end);
                message.large = true;
            }
        }
        Ok(message)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    fn query_fixture() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("CREATE TABLE messages(id TEXT PRIMARY KEY,folder_id TEXT,subject TEXT,sender TEXT,recipient TEXT,cc TEXT,date TEXT,content TEXT);").unwrap();
        conn.execute_batch("CREATE TABLE folders(id TEXT PRIMARY KEY,name TEXT,path TEXT,source TEXT,source_id TEXT); INSERT INTO folders VALUES('inbox','Inbox','Account/Inbox','thunderbird','one'),('archive','Archiv','Account/Archiv','thunderbird','one');").unwrap();
        management::initialize(&conn).unwrap();
        message_actions::initialize(&conn).unwrap();
        for (id, folder, subject, sender, cc, date, names) in [
            (
                "a",
                "inbox",
                "Überblick 100%_final",
                "Zoe",
                "MÜLLER@example.test",
                "2026-10-25T00:00:00+02:00",
                vec!["PrÜfung.pdf"],
            ),
            (
                "b",
                "archive",
                "Angebot",
                "Anna",
                "",
                "2026-10-24T23:00:00Z",
                vec![],
            ),
            (
                "c",
                "inbox",
                "Brief",
                "Bernd",
                "",
                "2026-10-25T23:00:00+01:00",
                vec!["foto.jpg"],
            ),
            (
                "d",
                "archive",
                "Danach",
                "Cora",
                "",
                "2026-10-26T00:00:00+01:00",
                vec![],
            ),
            ("e", "inbox", "Ohne Datum", "Dora", "", "", vec![]),
        ] {
            let content = serde_json::json!({"attachments": names, "large": false, "body": "private body only"}).to_string();
            conn.execute(
                "INSERT INTO messages VALUES(?1,?2,?3,?4,'Julius',?5,?6,?7)",
                params![id, folder, subject, sender, cc, date, content],
            )
            .unwrap();
        }
        conn
    }
    fn ids(page: &MessagePage) -> Vec<&str> {
        page.items.iter().map(|item| item.id.as_str()).collect()
    }

    #[test]
    fn archive_search_matches_unicode_headers_and_attachment_names_literally() {
        let conn = query_fixture();
        for search in [
            " überblick ",
            "müller",
            "prüfung.pdf",
            "100%_final",
            "zoe julius",
        ] {
            let page = query_messages(
                &conn,
                Query {
                    search: search.into(),
                    ..Default::default()
                },
            )
            .unwrap();
            assert_eq!(ids(&page), ["a"]);
            assert!(page.items[0].body.is_empty());
        }
        assert_eq!(
            query_messages(
                &conn,
                Query {
                    search: "private body".into(),
                    ..Default::default()
                }
            )
            .unwrap()
            .total,
            0
        );
        assert_eq!(
            query_messages(
                &conn,
                Query {
                    search: "%".into(),
                    ..Default::default()
                }
            )
            .unwrap()
            .total,
            1
        );
        assert_eq!(
            query_messages(
                &conn,
                Query {
                    search: "' OR 1=1 --".into(),
                    ..Default::default()
                }
            )
            .unwrap()
            .total,
            0
        );
    }

    #[test]
    fn archive_filter_uses_instants_and_includes_the_whole_dst_calendar_day() {
        let conn = query_fixture();
        assert_eq!(
            ids(&query_messages(&conn, Query::default()).unwrap()),
            ["d", "c", "b", "a", "e"]
        );
        assert_eq!(
            ids(&query_messages(
                &conn,
                Query {
                    sort: MessageSort::Oldest,
                    ..Default::default()
                }
            )
            .unwrap()),
            ["a", "b", "c", "d", "e"]
        );
        let range = || Query {
            from_at: Some("2026-10-25T00:00:00+02:00".into()),
            before_at: Some("2026-10-26T00:00:00+01:00".into()),
            ..Default::default()
        };
        assert_eq!(
            ids(&query_messages(&conn, range()).unwrap()),
            ["c", "b", "a"]
        );
        assert_eq!(
            ids(&query_messages(
                &conn,
                Query {
                    attachments_only: true,
                    folder_id: Some("inbox".into()),
                    ..range()
                }
            )
            .unwrap()),
            ["c", "a"]
        );
        assert_eq!(
            ids(&query_messages(
                &conn,
                Query {
                    sort: MessageSort::Subject,
                    ..Default::default()
                }
            )
            .unwrap()),
            ["b", "c", "d", "e", "a"]
        );
        assert_eq!(
            ids(&query_messages(
                &conn,
                Query {
                    sort: MessageSort::Sender,
                    ..Default::default()
                }
            )
            .unwrap()),
            ["b", "c", "d", "e", "a"]
        );
        for sort in [MessageSort::SubjectDesc, MessageSort::SenderDesc] {
            assert_eq!(
                ids(&query_messages(
                    &conn,
                    Query {
                        sort,
                        ..Default::default()
                    }
                )
                .unwrap()),
                ["a", "e", "d", "c", "b"]
            );
        }
        assert!(query_messages(
            &conn,
            Query {
                from_at: Some("invalid".into()),
                ..Default::default()
            }
        )
        .is_err());
        assert!(query_messages(
            &conn,
            Query {
                from_at: Some("2026-10-27T00:00:00Z".into()),
                ..range()
            }
        )
        .is_err());
        assert!(serde_json::from_str::<Query>(r#"{"sort":"date; DROP TABLE messages"}"#).is_err());
    }

    #[test]
    fn archive_filters_before_pagination_and_keeps_a_stable_order() {
        let conn = query_fixture();
        for index in 0..105 {
            conn.execute("INSERT INTO messages VALUES(?1,'inbox','Batch','Anna','Julius','','2026-10-13T12:00:00Z',?2)",
                params![format!("batch-{index:03}"), r#"{"attachments":[],"large":false}"#]).unwrap();
        }
        let before: String = conn
            .query_row("SELECT content FROM messages WHERE id='a'", [], |row| {
                row.get(0)
            })
            .unwrap();
        let first = query_messages(
            &conn,
            Query {
                search: "batch".into(),
                ..Default::default()
            },
        )
        .unwrap();
        let second = query_messages(
            &conn,
            Query {
                search: "batch".into(),
                offset: 100,
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(first.total, 105);
        assert_eq!(first.items.len(), 100);
        assert_eq!(second.total, 105);
        assert_eq!(second.items.len(), 5);
        assert_eq!(first.items[99].id, "batch-099");
        assert_eq!(second.items[0].id, "batch-100");
        let after: String = conn
            .query_row("SELECT content FROM messages WHERE id='a'", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(before, after);
    }
    #[test]
    fn folder_preview_matches_mail_hierarchy_without_reading_messages() {
        let root = temporary();
        fs::create_dir_all(root.join("Inbox.sbd/Archive/cur")).unwrap();
        fs::create_dir_all(root.join("Inbox.sbd/Archive/new")).unwrap();
        fs::create_dir_all(root.join("Inbox.sbd/Archive/tmp")).unwrap();
        fs::write(root.join("Inbox"), "not a valid mail file").unwrap();
        fs::write(root.join("Inbox.msf"), "not a valid MSF").unwrap();
        fs::write(root.join("Inbox.sbd/Archive/cur/one"), "private body").unwrap();
        fs::write(root.join("Inbox.sbd/Empty.msf"), "").unwrap();
        let source = Source {
            id: "one".into(),
            name: "Account".into(),
            kind: "thunderbird".into(),
            account_kind: String::new(),
            path: root.to_string_lossy().into_owned(),
        };
        let mut paths = HashSet::new();
        thunderbird_folder_preview(&source, &root, "Account", 0, &mut paths).unwrap();
        assert_eq!(
            paths,
            HashSet::from([
                "Account".into(),
                "Account/Inbox".into(),
                "Account/Inbox/Archive".into(),
                "Account/Inbox/Empty".into()
            ])
        );
        assert_eq!(
            fs::read_to_string(root.join("Inbox.sbd/Archive/cur/one")).unwrap(),
            "private body"
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn old_archive_migration_preserves_folders_under_concurrent_reads() {
        let root = temporary();
        let conn = Connection::open(root.join("archive.sqlite")).unwrap();
        conn.execute_batch("CREATE TABLE folders(id TEXT PRIMARY KEY,name TEXT NOT NULL,path TEXT NOT NULL,source TEXT NOT NULL); INSERT INTO folders VALUES('legacy','Inbox','Account/Inbox','outlook');").unwrap();
        drop(conn);
        let barrier = std::sync::Arc::new(std::sync::Barrier::new(2));
        let handles = (0..2)
            .map(|_| {
                let root = root.clone();
                let barrier = barrier.clone();
                std::thread::spawn(move || {
                    barrier.wait();
                    let conn = db(&root).unwrap();
                    assert!(has_source_column(&conn).unwrap());
                    assert_eq!(
                        conn.query_row(
                            "SELECT COUNT(*) FROM folders WHERE id='legacy'",
                            [],
                            |row| row.get::<_, i64>(0)
                        )
                        .unwrap(),
                        1
                    );
                })
            })
            .collect::<Vec<_>>();
        for handle in handles {
            handle.join().unwrap();
        }
        fs::remove_dir_all(root).unwrap();
    }
    fn temporary() -> PathBuf {
        let path = std::env::temp_dir().join(format!("dmh-email-test-{}", Uuid::new_v4()));
        fs::create_dir_all(&path).unwrap();
        path
    }
    #[test]
    fn copies_and_indexes_mbox_without_changing_original_and_preserves_duplicate_messages() {
        let root = temporary();
        let original = root.join("original");
        fs::create_dir_all(original.join("Inbox.sbd")).unwrap();
        let mail = "From - Mon Oct 12 12:00:00 2026\nSubject: Mittag\nFrom: Anna <anna@example.test>\nTo: Julius\n\nHallo\n>From escaped\n";
        let raw = mail.repeat(2);
        fs::write(original.join("Inbox"), &raw).unwrap();
        fs::write(original.join("Inbox.sbd/Empty"), "").unwrap();
        let copied = root.join("copies/snapshot");
        copy_tree(&original, &copied, 0, &mut Vec::new()).unwrap();
        let conn = db(&root).unwrap();
        let source = Source {
            id: "test".into(),
            name: "Thunderbird/Test".into(),
            kind: "thunderbird".into(),
            account_kind: String::new(),
            path: original.to_string_lossy().into(),
        };
        let mut result = CopyResult::default();
        index_tree(&conn, &source, &copied, &source.name, 0, &mut result).unwrap();
        assert_eq!(result.copied, 2);
        assert_eq!(fs::read_to_string(original.join("Inbox")).unwrap(), raw);
        assert_eq!(
            conn.query_row("SELECT COUNT(*) FROM messages", [], |r| r.get::<_, i64>(0))
                .unwrap(),
            2
        );
        assert!(
            conn.query_row(
                "SELECT COUNT(*) FROM folders WHERE path='Thunderbird/Test/Inbox/Empty'",
                [],
                |r| r.get::<_, i64>(0)
            )
            .unwrap()
                > 0
        );
        index_tree(
            &conn,
            &source,
            &copied,
            &source.name,
            0,
            &mut CopyResult::default(),
        )
        .unwrap();
        assert_eq!(
            conn.query_row("SELECT COUNT(*) FROM messages", [], |r| r.get::<_, i64>(0))
                .unwrap(),
            2
        );
        drop(conn);
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn decodes_mime_headers_body_and_lists_attachments() {
        let bytes = b"Subject: =?UTF-8?B?R3LDvMOfZQ==?=\r\nContent-Type: multipart/mixed; boundary=x\r\n\r\n--x\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Transfer-Encoding: quoted-printable\r\n\r\nOl=C3=A1\r\n--x\r\nContent-Type: application/pdf; name=agenda.pdf\r\nContent-Disposition: attachment; filename=agenda.pdf\r\nContent-Transfer-Encoding: base64\r\n\r\nSGVsbG8=\r\n--x--\r\n";
        let message = parse_message(bytes).unwrap();
        assert_eq!(message.subject, "Grüße");
        assert!(message.body.contains("Olá"));
        assert_eq!(message.attachments, ["agenda.pdf"]);
    }
    #[test]
    fn changing_read_flags_does_not_duplicate_archived_messages() {
        let first = b"Subject: Mail\r\nX-Mozilla-Status: 0000\r\nX-Mozilla-Keys: \r\n\r\nHallo";
        let second =
            b"Subject: Mail\r\nX-Mozilla-Status: 0001\r\nX-Mozilla-Keys: important\r\n\r\nHallo";
        assert_eq!(
            message_fingerprint(first, first.len() as u64),
            message_fingerprint(second, second.len() as u64)
        );
    }
    #[test]
    fn scans_very_long_lines_with_bounded_memory() {
        let content = vec![b'a'; 1024 * 1024];
        let mut reader = BufReader::new(content.as_slice());
        let mut prefix = Vec::new();
        assert_eq!(
            read_line_prefix(&mut reader, &mut prefix).unwrap(),
            content.len() as u64
        );
        assert_eq!(prefix.len(), 256);
    }
    #[test]
    fn preserves_and_indexes_maildir_and_empty_folders() {
        let root = temporary();
        let original = root.join("original");
        fs::create_dir_all(original.join("Inbox/cur")).unwrap();
        fs::create_dir_all(original.join("Inbox/new")).unwrap();
        fs::create_dir_all(original.join("Empty/cur")).unwrap();
        fs::write(
            original.join("Inbox/cur/1"),
            "Subject: One\nFrom: Anna\n\nFirst body",
        )
        .unwrap();
        fs::write(
            original.join("Inbox/new/2"),
            "Subject: Two\nFrom: Anna\n\nSecond body",
        )
        .unwrap();
        let copied = root.join("copies/snapshot");
        copy_tree(&original, &copied, 0, &mut Vec::new()).unwrap();
        let conn = db(&root).unwrap();
        let source = Source {
            id: "maildir".into(),
            name: "Maildir".into(),
            kind: "thunderbird".into(),
            account_kind: String::new(),
            path: original.to_string_lossy().into(),
        };
        let mut result = CopyResult::default();
        index_tree(&conn, &source, &copied, &source.name, 0, &mut result).unwrap();
        assert_eq!(result.copied, 2);
        let (path, offset, length): (String, u64, u64) = conn
            .query_row(
                "SELECT raw_path,byte_offset,byte_length FROM messages WHERE subject='One'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .unwrap();
        // Reader still uses only the archive, even after originals disappear.
        fs::remove_dir_all(&original).unwrap();
        assert_eq!(
            parse_message(&slice(Path::new(&path), offset, length).unwrap())
                .unwrap()
                .body,
            "First body"
        );
        assert_eq!(
            conn.query_row(
                "SELECT COUNT(*) FROM folders WHERE path='Maildir/Empty'",
                [],
                |row| row.get::<_, i64>(0)
            )
            .unwrap(),
            1
        );
        drop(conn);
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn discovers_all_profiles_and_custom_mail_roots() {
        let root = temporary();
        let first = root.join("Profiles/one");
        let other = root.join("custom");
        fs::create_dir_all(first.join("Mail/Local Folders")).unwrap();
        fs::create_dir_all(&other).unwrap();
        fs::write(
            root.join("profiles.ini"),
            "[Profile0]\nIsRelative=1\nPath=Profiles/one\n",
        )
        .unwrap();
        let custom = other.to_string_lossy();
        fs::write(
            first.join("prefs.js"),
            format!(
                "user_pref(\"mail.server.server1.directory\", {});",
                serde_json::to_string(custom.as_ref()).unwrap()
            ),
        )
        .unwrap();
        assert_eq!(thunderbird_sources(&root).len(), 2);
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn same_address_imap_and_exchange_keep_distinct_ids_and_persistent_labels() {
        let root = std::env::temp_dir().join(format!("email-source-test-{}", Uuid::new_v4()));
        let conn = db(&root).unwrap();
        let sources = [
            Source {
                id: "exchange".into(),
                name: "same@example.test".into(),
                kind: "outlook".into(),
                path: String::new(),
                account_kind: "Exchange".into(),
            },
            Source {
                id: "imap".into(),
                name: "same@example.test".into(),
                kind: "outlook".into(),
                path: String::new(),
                account_kind: "IMAP".into(),
            },
        ];
        record_source_details(&conn, &sources).unwrap();
        let first = folder(&conn, &sources[0], "same@example.test/Inbox").unwrap();
        let second = folder(&conn, &sources[1], "same@example.test/Inbox").unwrap();
        assert_ne!(first, second);
        assert_eq!(
            source_folder(&sources[1], "same@example.test/Inbox").account_kind,
            "IMAP"
        );
        let old: Source = serde_json::from_str(
            r#"{"id":"exchange","name":"same@example.test","kind":"outlook","path":""}"#,
        )
        .unwrap();
        record_source_details(&conn, &[old]).unwrap();
        drop(conn);
        let conn = db(&root).unwrap();
        let labels: Vec<String> = conn.prepare("SELECT d.account_kind FROM folders f JOIN email_archive_source_details d ON d.source_id=f.source_id ORDER BY d.account_kind").unwrap().query_map([], |row| row.get(0)).unwrap().collect::<Result<_,_>>().unwrap();
        assert_eq!(labels, ["Exchange", "IMAP"]);
        drop(conn);
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn outlook_adapter_has_no_client_mutations_or_network_downloads() {
        let script = include_str!("email_archive_outlook.ps1");
        for forbidden in [
            ".Send(",
            ".Save(",
            ".Delete(",
            ".UnRead =",
            ".MarkForDownload",
            ".AddStore",
            ".Logon(",
            ".Quit(",
            "New-Object -ComObject",
            ".SetProperty(",
            ".MoveTo(",
        ] {
            assert!(!script.contains(forbidden), "{forbidden}");
        }
        assert!(script.contains(".SaveAs($rawPath, 9)"));
        assert!(script.contains("$item.DownloadState"));
        assert!(script.contains("0x30200102"));
    }
}
