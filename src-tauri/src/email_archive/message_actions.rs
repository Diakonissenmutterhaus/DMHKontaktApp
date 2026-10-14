//! Archive-only message edits. Imported rows and raw MIME/MSG snapshots remain
//! immutable; a separate overlay survives reimports of the original mailbox.
use super::*;
pub(super) const MESSAGE_JOIN: &str = "FROM messages LEFT JOIN email_archive_message_state s ON s.message_id=messages.id JOIN folders f ON f.id=coalesce(s.folder_id,messages.folder_id)";
pub(super) const COUNTS_JOIN: &str = "LEFT JOIN (SELECT coalesce(s.folder_id,m.folder_id) AS folder_id,COUNT(*) AS total,coalesce(MAX(m.copied_at),'') AS latest FROM messages m LEFT JOIN email_archive_message_state s ON s.message_id=m.id WHERE s.deleted_at IS NULL GROUP BY coalesce(s.folder_id,m.folder_id)) n ON n.folder_id=f.id";

pub(super) fn initialize(conn: &Connection) -> Result<(), String> {
    conn.execute_batch("CREATE TABLE IF NOT EXISTS email_archive_message_state(message_id TEXT PRIMARY KEY,folder_id TEXT,deleted_at TEXT,category TEXT NOT NULL DEFAULT '',category_color TEXT NOT NULL DEFAULT '#0078d4');").map_err(|e| e.to_string())
}
#[derive(Deserialize, Clone, Copy)]
#[serde(rename_all = "camelCase")]
enum Action {
    Move,
    Trash,
    Restore,
    Category,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Edit {
    id: String,
    action: Action,
    folder_id: Option<String>,
    category: Option<String>,
    color: Option<String>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Category {
    name: String,
    color: String,
}

fn apply_edit(conn: &mut Connection, edit: Edit) -> Result<(), String> {
    let transaction = conn
        .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
        .map_err(|e| e.to_string())?;
    let deleted: Option<Option<String>> = transaction
        .query_row(
            &format!(
                "SELECT s.deleted_at {MESSAGE_JOIN} WHERE messages.id=?1 AND {}",
                management::VISIBLE_FOLDER
            ),
            [&edit.id],
            |row| row.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    let deleted = deleted.ok_or(
        "Die Nachricht ist nicht mehr in der Archivansicht. Bitte die Liste aktualisieren.",
    )?;
    if deleted.is_some() && !matches!(edit.action, Action::Restore) {
        return Err(
            "Bitte die Nachricht zuerst aus dem Archiv-Papierkorb wiederherstellen.".into(),
        );
    }
    transaction
        .execute(
            "INSERT OR IGNORE INTO email_archive_message_state(message_id) VALUES(?1)",
            [&edit.id],
        )
        .map_err(|e| e.to_string())?;
    match edit.action {
        Action::Move => {
            let destination = edit.folder_id.ok_or("Bitte einen Zielordner wählen.")?;
            let exists: bool = transaction
                .query_row(
                    &format!(
                        "SELECT EXISTS(SELECT 1 FROM folders f WHERE f.id=?1 AND {})",
                        management::VISIBLE_FOLDER
                    ),
                    [&destination],
                    |row| row.get(0),
                )
                .map_err(|e| e.to_string())?;
            if !exists {
                return Err("Der Zielordner ist nicht mehr verfügbar. Bitte einen anderen Archivordner wählen.".into());
            }
            transaction
                .execute(
                    "UPDATE email_archive_message_state SET folder_id=?2 WHERE message_id=?1",
                    params![edit.id, destination],
                )
                .map_err(|e| e.to_string())?;
        }
        Action::Trash => {
            transaction
                .execute(
                    "UPDATE email_archive_message_state SET deleted_at=?2 WHERE message_id=?1",
                    params![edit.id, Utc::now().to_rfc3339()],
                )
                .map_err(|e| e.to_string())?;
        }
        Action::Restore => {
            transaction
                .execute(
                    "UPDATE email_archive_message_state SET deleted_at=NULL WHERE message_id=?1",
                    [edit.id],
                )
                .map_err(|e| e.to_string())?;
        }
        Action::Category => {
            let category = edit.category.unwrap_or_default().trim().to_owned();
            let color = edit.color.unwrap_or_else(|| "#0078d4".into());
            if category.chars().count() > 100
                || category.chars().any(char::is_control)
                || color.len() != 7
                || !color.starts_with('#')
                || !color[1..].bytes().all(|byte| byte.is_ascii_hexdigit())
            {
                return Err("Bitte einen gültigen Kategorienamen und eine Farbe wählen.".into());
            }
            transaction.execute("UPDATE email_archive_message_state SET category=?2,category_color=?3 WHERE message_id=?1",params![edit.id,category,color.to_ascii_lowercase()]).map_err(|e| e.to_string())?;
        }
    }
    transaction.commit().map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn update_email_archive_message(app: AppHandle, edit: Edit) -> Result<(), String> {
    let root = root(&app)?;
    let id = edit.id.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let _gate = COPY_GATE
            .try_lock()
            .map_err(|_| "Bitte warten, bis die E-Mail-Kopie abgeschlossen ist.".to_string())?;
        apply_edit(&mut db(&root)?, edit)
    })
    .await
    .map_err(|e| e.to_string())??;
    for (label, _) in app.webview_windows() {
        if label.starts_with("email-reader-") {
            let _ = app.emit_to(label, "email-archive-message-changed", &id);
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn fixture() -> (Connection, String) {
        let conn = Connection::open_in_memory().unwrap();
        initialize(&conn).unwrap();
        management::initialize(&conn).unwrap();
        conn.execute_batch("CREATE TABLE folders(id TEXT PRIMARY KEY,name TEXT,path TEXT,source TEXT,source_id TEXT);
          INSERT INTO folders VALUES('inbox','Inbox','Account/Inbox','outlook','one'),('archive','Archiv','Account/Archiv','outlook','one');
          CREATE TABLE messages(id TEXT PRIMARY KEY,folder_id TEXT,subject TEXT,sender TEXT,recipient TEXT,cc TEXT,date TEXT,raw_path TEXT,byte_offset INTEGER,byte_length INTEGER,format TEXT,content TEXT,copied_at TEXT);").unwrap();
        put(
            &conn,
            "inbox",
            Message {
                subject: "Copied message".into(),
                date: "2026-10-14T10:00:00Z".into(),
                ..Default::default()
            },
            Path::new("retained.eml"),
            0,
            100,
            "mime",
            "source-id",
        )
        .unwrap();
        (conn, hash("inbox\nsource-id"))
    }
    fn edit(id: &str, action: Action) -> Edit {
        Edit {
            id: id.into(),
            action,
            folder_id: None,
            category: None,
            color: None,
        }
    }
    #[test]
    fn move_category_trash_restore_preserve_imported_content_and_survive_reimport() {
        let (mut conn, id) = fixture();
        let original: String = conn
            .query_row("SELECT content FROM messages WHERE id=?1", [&id], |row| {
                row.get(0)
            })
            .unwrap();
        apply_edit(
            &mut conn,
            Edit {
                category: Some("Arbeit".into()),
                color: Some("#008a45".into()),
                ..edit(&id, Action::Category)
            },
        )
        .unwrap();
        apply_edit(
            &mut conn,
            Edit {
                folder_id: Some("archive".into()),
                ..edit(&id, Action::Move)
            },
        )
        .unwrap();
        let page = query_messages(
            &conn,
            Query {
                folder_id: Some("archive".into()),
                category: Some("Arbeit".into()),
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(page.total, 1);
        assert_eq!(page.items[0].id, id);
        assert_eq!(page.items[0].category_color, "#008a45");
        assert_eq!(
            query_messages(
                &conn,
                Query {
                    folder_id: Some("inbox".into()),
                    ..Default::default()
                }
            )
            .unwrap()
            .total,
            0
        );
        assert_eq!(
            conn.query_row("SELECT content FROM messages WHERE id=?1", [&id], |row| row
                .get::<_, String>(0))
                .unwrap(),
            original
        );
        let raw: (String, String) = conn
            .query_row(
                "SELECT folder_id,raw_path FROM messages WHERE id=?1",
                [&id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!(raw, ("inbox".into(), "retained.eml".into()));
        put(
            &conn,
            "inbox",
            Message {
                subject: "Updated from source".into(),
                date: "2026-10-14T10:00:00Z".into(),
                ..Default::default()
            },
            Path::new("retained.eml"),
            0,
            100,
            "mime",
            "source-id",
        )
        .unwrap();
        assert_eq!(
            query_messages(&conn, Query::default()).unwrap().items[0].folder_id,
            "archive"
        );
        apply_edit(&mut conn, edit(&id, Action::Trash)).unwrap();
        assert_eq!(query_messages(&conn, Query::default()).unwrap().total, 0);
        let trash = query_messages(
            &conn,
            Query {
                include_deleted: true,
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(trash.total, 1);
        assert!(trash.items[0].deleted);
        assert_eq!(trash.items[0].category, "Arbeit");
        assert!(apply_edit(
            &mut conn,
            Edit {
                folder_id: Some("inbox".into()),
                ..edit(&id, Action::Move)
            }
        )
        .is_err());
        apply_edit(&mut conn, edit(&id, Action::Restore)).unwrap();
        assert_eq!(query_messages(&conn, Query::default()).unwrap().total, 1);
        assert_eq!(
            conn.query_row(
                &format!("SELECT n.total FROM folders f {COUNTS_JOIN} WHERE f.id='archive'"),
                [],
                |row| row.get::<_, i64>(0)
            )
            .unwrap(),
            1
        );
        assert_eq!(
            query_messages(
                &conn,
                Query {
                    include_deleted: true,
                    ..Default::default()
                }
            )
            .unwrap()
            .total,
            0
        );
    }
    #[test]
    fn invalid_or_hidden_destinations_and_invalid_categories_roll_back() {
        let (mut conn, id) = fixture();
        for destination in ["missing", "archive"] {
            conn.execute("INSERT OR IGNORE INTO email_archive_removed VALUES('outlook','one','Account/Archiv','now')",[]).unwrap();
            assert!(apply_edit(
                &mut conn,
                Edit {
                    folder_id: Some(destination.into()),
                    ..edit(&id, Action::Move)
                }
            )
            .is_err());
        }
        for (name, color) in [
            ("Bad\nName", "#0078d4"),
            ("Work", "javascript:alert(1)"),
            ("Work", "#GGGGGG"),
        ] {
            assert!(apply_edit(
                &mut conn,
                Edit {
                    category: Some(name.into()),
                    color: Some(color.into()),
                    ..edit(&id, Action::Category)
                }
            )
            .is_err());
        }
        assert_eq!(
            conn.query_row(
                "SELECT COUNT(*) FROM email_archive_message_state",
                [],
                |row| row.get::<_, i64>(0)
            )
            .unwrap(),
            0
        );
        assert_eq!(query_messages(&conn, Query::default()).unwrap().total, 1);
    }
}

#[tauri::command]
pub async fn list_email_archive_categories(app: AppHandle) -> Result<Vec<Category>, String> {
    let root = root(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        let conn=db(&root)?; let mut statement=conn.prepare("SELECT category,MAX(category_color) FROM email_archive_message_state WHERE category<>'' GROUP BY category ORDER BY category COLLATE NOCASE").map_err(|e| e.to_string())?;
        let rows=statement.query_map([],|row| Ok(Category { name:row.get(0)?,color:row.get(1)? })).map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>,_>>().map_err(|e| e.to_string())
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn open_email_archive_window(app: AppHandle, id: String) -> Result<(), String> {
    let root = root(&app)?;
    let record_id = id.clone();
    let title: String = tauri::async_runtime::spawn_blocking(move || {
        db(&root)?
            .query_row(
                &format!(
                    "SELECT subject {MESSAGE_JOIN} WHERE messages.id=?1 AND {}",
                    management::VISIBLE_FOLDER
                ),
                [record_id],
                |row| row.get(0),
            )
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())??;
    let label = format!("email-reader-{}", &hash(&id)[..24]);
    if let Some(window) = app.get_webview_window(&label) {
        window.show().map_err(|e| e.to_string())?;
        return window.set_focus().map_err(|e| e.to_string());
    }
    let query = url::form_urlencoded::Serializer::new(String::new())
        .append_pair("emailArchiveMessage", &id)
        .finish();
    let builder = tauri::WebviewWindowBuilder::new(
        &app,
        &label,
        tauri::WebviewUrl::App(format!("index.html?{query}").into()),
    )
    .title(format!(
        "{} · E-Mail-Archiv",
        title.chars().take(150).collect::<String>()
    ))
    .inner_size(900., 720.)
    .min_inner_size(560., 400.);
    #[cfg(target_os = "windows")]
    let builder = if let Some(args) = app
        .config()
        .app
        .windows
        .first()
        .and_then(|window| window.additional_browser_args.as_deref())
    {
        builder.additional_browser_args(args)
    } else {
        builder
    };
    builder.build().map_err(|e| e.to_string())?;
    Ok(())
}
