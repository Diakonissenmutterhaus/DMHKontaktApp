//! Removing a mailbox unmounts its local archive view. Originals and snapshots
//! stay intact; restoration works offline and new copied subfolders stay hidden.
use super::*;

const SOURCE_KEY: &str = "CASE WHEN f.source_id<>'' THEN f.source_id ELSE f.source||':'||CASE WHEN instr(f.path,'/')>0 THEN substr(f.path,1,instr(f.path,'/')-1) ELSE f.path END END";
pub(super) const VISIBLE_FOLDER: &str = "NOT EXISTS(SELECT 1 FROM email_archive_removed r WHERE r.source=f.source AND r.source_id=CASE WHEN f.source_id<>'' THEN f.source_id ELSE f.source||':'||CASE WHEN instr(f.path,'/')>0 THEN substr(f.path,1,instr(f.path,'/')-1) ELSE f.path END END AND (f.path=r.path OR substr(f.path,1,length(r.path)+1)=r.path||'/'))";

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Target {
    source: String,
    source_id: String,
    path: String,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemovalPreview {
    target: Target,
    name: String,
    folders: usize,
    messages: i64,
    token: String,
}

pub(super) fn initialize(conn: &Connection) -> Result<(), String> {
    conn.execute_batch("CREATE TABLE IF NOT EXISTS email_archive_removed(source TEXT NOT NULL,source_id TEXT NOT NULL,path TEXT NOT NULL,removed_at TEXT NOT NULL,PRIMARY KEY(source,source_id,path));").map_err(|e| e.to_string())
}

fn preview(conn: &Connection, target: Target) -> Result<RemovalPreview, String> {
    if target.source_id.is_empty() || target.path.is_empty() {
        return Err("Bitte ein vorhandenes Postfach oder einen Ordner wählen.".into());
    }
    // Path boundaries are literal; Inbox never includes Inbox2 or wildcard names.
    let mut statement = conn
        .prepare(&format!(
            "SELECT f.id,f.path,coalesce(n.total,0),coalesce(n.latest,'')
        FROM folders f {} WHERE f.source=?1 AND {SOURCE_KEY}=?2
        AND (f.path=?3 OR substr(f.path,1,length(?3)+1)=?3||'/') AND {VISIBLE_FOLDER}
        GROUP BY f.id ORDER BY f.id",
            message_actions::COUNTS_JOIN
        ))
        .map_err(|e| e.to_string())?;
    let rows = statement
        .query_map(
            params![target.source, target.source_id, target.path],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, i64>(2)?,
                    row.get::<_, String>(3)?,
                ))
            },
        )
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    if rows.is_empty() {
        return Err(
            "Dieses Postfach ist nicht mehr in der Archivansicht. Bitte die Auswahl aktualisieren."
                .into(),
        );
    }
    let token = hash(serde_json::to_vec(&(&target, &rows)).map_err(|e| e.to_string())?);
    Ok(RemovalPreview {
        name: target
            .path
            .rsplit('/')
            .next()
            .unwrap_or(&target.path)
            .into(),
        messages: rows.iter().map(|row| row.2).sum(),
        folders: rows.len(),
        target,
        token,
    })
}

fn remove(conn: &mut Connection, requested: RemovalPreview) -> Result<(), String> {
    let transaction = conn
        .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
        .map_err(|e| e.to_string())?;
    let current = preview(&transaction, requested.target)?;
    if current.token != requested.token {
        return Err(
            "Das Archiv hat sich geändert. Bitte die Entfernung erneut prüfen und bestätigen."
                .into(),
        );
    }
    transaction
        .execute(
            "INSERT INTO email_archive_removed VALUES(?1,?2,?3,?4)",
            params![
                current.target.source,
                current.target.source_id,
                current.target.path,
                Utc::now().to_rfc3339()
            ],
        )
        .map_err(|e| e.to_string())?;
    transaction.commit().map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn preview_email_archive_removal(
    app: AppHandle,
    target: Target,
) -> Result<RemovalPreview, String> {
    let root = root(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        let _gate = COPY_GATE
            .try_lock()
            .map_err(|_| "Bitte warten, bis die E-Mail-Kopie abgeschlossen ist.".to_string())?;
        preview(&db(&root)?, target)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn remove_email_archive_folder(
    app: AppHandle,
    preview: RemovalPreview,
) -> Result<(), String> {
    let root = root(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        let _gate = COPY_GATE
            .try_lock()
            .map_err(|_| "Bitte warten, bis die E-Mail-Kopie abgeschlossen ist.".to_string())?;
        remove(&mut db(&root)?, preview)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn count_email_archive_removals(app: AppHandle) -> Result<i64, String> {
    let root = root(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        db(&root)?
            .query_row("SELECT COUNT(*) FROM email_archive_removed", [], |row| {
                row.get(0)
            })
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn restore_email_archive_folders(app: AppHandle) -> Result<(), String> {
    let root = root(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        let _gate = COPY_GATE
            .try_lock()
            .map_err(|_| "Bitte warten, bis die E-Mail-Kopie abgeschlossen ist.".to_string())?;
        db(&root)?
            .execute("DELETE FROM email_archive_removed", [])
            .map_err(|e| e.to_string())?;
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    fn fixture() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        initialize(&conn).unwrap();
        message_actions::initialize(&conn).unwrap();
        conn.execute_batch("CREATE TABLE folders(id TEXT PRIMARY KEY,name TEXT,path TEXT,source TEXT,source_id TEXT);
          CREATE TABLE messages(id TEXT PRIMARY KEY,folder_id TEXT,subject TEXT,sender TEXT,recipient TEXT,cc TEXT,date TEXT,raw_path TEXT,byte_offset INTEGER,byte_length INTEGER,format TEXT,content TEXT,copied_at TEXT);").unwrap();
        for (id, path, source_id) in [
            ("inbox", "Account/Inbox", "one"),
            ("child", "Account/Inbox/Work", "one"),
            ("sibling", "Account/Inbox2", "one"),
            ("other", "Account/Inbox", "two"),
            ("legacy", "OldAccount/Inbox", ""),
        ] {
            conn.execute(
                "INSERT INTO folders VALUES(?1,?2,?2,'thunderbird',?3)",
                params![id, path, source_id],
            )
            .unwrap();
            put(
                &conn,
                id,
                Message {
                    subject: id.into(),
                    date: "2026-10-14T12:00:00Z".into(),
                    ..Default::default()
                },
                Path::new("retained-raw-copy.eml"),
                0,
                100,
                "mime",
                id,
            )
            .unwrap();
        }
        conn
    }
    fn target(source_id: &str, path: &str) -> Target {
        Target {
            source: "thunderbird".into(),
            source_id: source_id.into(),
            path: path.into(),
        }
    }

    #[test]
    fn removal_is_reversible_and_isolates_accounts_and_path_boundaries() {
        let mut conn = fixture();
        let plan = preview(&conn, target("one", "Account/Inbox")).unwrap();
        assert_eq!((plan.folders, plan.messages), (2, 2));
        remove(&mut conn, plan).unwrap();
        let page = query_messages(&conn, Query::default()).unwrap();
        assert_eq!(page.total, 3);
        assert!(page
            .items
            .iter()
            .all(|m| !["inbox", "child"].contains(&m.subject.as_str())));
        // Index and raw-file references stay intact, including on reopened archives.
        assert_eq!(
            conn.query_row(
                "SELECT COUNT(*) FROM messages WHERE raw_path='retained-raw-copy.eml'",
                [],
                |r| r.get::<_, i64>(0)
            )
            .unwrap(),
            5
        );
        initialize(&conn).unwrap();
        assert_eq!(query_messages(&conn, Query::default()).unwrap().total, 3);
        conn.execute(
            "INSERT INTO folders VALUES('new','New','Account/Inbox/New','thunderbird','one')",
            [],
        )
        .unwrap();
        put(
            &conn,
            "new",
            Message {
                subject: "new".into(),
                ..Default::default()
            },
            Path::new("retained-raw-copy.eml"),
            0,
            100,
            "mime",
            "new",
        )
        .unwrap();
        assert_eq!(query_messages(&conn, Query::default()).unwrap().total, 3);
        conn.execute("DELETE FROM email_archive_removed", [])
            .unwrap();
        assert_eq!(query_messages(&conn, Query::default()).unwrap().total, 6);
    }

    #[test]
    fn removal_of_root_and_legacy_account_preserves_other_sources() {
        let mut conn = fixture();
        let plan = preview(&conn, target("one", "Account")).unwrap();
        assert_eq!((plan.folders, plan.messages), (3, 3));
        remove(&mut conn, plan).unwrap();
        let plan = preview(&conn, target("thunderbird:OldAccount", "OldAccount")).unwrap();
        remove(&mut conn, plan).unwrap();
        let page = query_messages(&conn, Query::default()).unwrap();
        assert_eq!(page.total, 1);
        assert_eq!(page.items[0].subject, "other");
        assert!(preview(&conn, target("two", "Account/%")).is_err());
        assert!(preview(&conn, target("one", "Account")).is_err());
    }

    #[test]
    fn changed_archive_requires_a_new_confirmation_without_partial_removal() {
        let mut conn = fixture();
        let plan = preview(&conn, target("one", "Account")).unwrap();
        put(
            &conn,
            "inbox",
            Message::default(),
            Path::new("raw.eml"),
            0,
            100,
            "mime",
            "new-message",
        )
        .unwrap();
        assert!(remove(&mut conn, plan).is_err());
        assert_eq!(
            conn.query_row("SELECT COUNT(*) FROM email_archive_removed", [], |r| r
                .get::<_, i64>(0))
                .unwrap(),
            0
        );
        assert_eq!(query_messages(&conn, Query::default()).unwrap().total, 6);
    }
}
