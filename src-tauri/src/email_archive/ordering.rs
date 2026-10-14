//! Local display preferences are independent of imported Outlook metadata.
use super::*;

pub(super) fn initialize(conn: &Connection) -> Result<(), String> {
    conn.execute_batch("CREATE TABLE IF NOT EXISTS email_archive_imported_order(folder_id TEXT PRIMARY KEY,position INTEGER,sort_key TEXT);
        CREATE TABLE IF NOT EXISTS email_archive_folder_preferences(scope TEXT PRIMARY KEY,keys TEXT NOT NULL);").map_err(|e| e.to_string())
}

pub(super) fn record_imported(
    conn: &Connection,
    id: &str,
    position: Option<i64>,
    sort_key: Option<&str>,
) -> Result<(), String> {
    let Some(position) = position.filter(|position| *position >= 0) else {
        return Ok(());
    };
    let key = sort_key
        .filter(|value| {
            !value.is_empty()
                && value.len() <= 4096
                && value.len() % 2 == 0
                && value.bytes().all(|byte| byte.is_ascii_hexdigit())
        })
        .map(str::to_ascii_uppercase);
    conn.execute(
        "INSERT INTO email_archive_imported_order SELECT id,?2,?3 FROM folders WHERE id=?1
        ON CONFLICT(folder_id) DO UPDATE SET position=excluded.position,sort_key=excluded.sort_key",
        params![id, position, key],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

fn read_preferences(conn: &Connection) -> Result<HashMap<String, Vec<String>>, String> {
    let mut statement = conn
        .prepare("SELECT scope,keys FROM email_archive_folder_preferences")
        .map_err(|e| e.to_string())?;
    let rows = statement
        .query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })
        .map_err(|e| e.to_string())?;
    let mut preferences = HashMap::new();
    for row in rows {
        let (scope, json) = row.map_err(|e| e.to_string())?;
        preferences.insert(
            scope,
            serde_json::from_str(&json).map_err(|e| e.to_string())?,
        );
    }
    Ok(preferences)
}

fn save_preferences(
    conn: &Connection,
    scope: &str,
    keys: Option<Vec<String>>,
) -> Result<(), String> {
    let parent: Option<Vec<String>> = if scope == "roots" {
        None
    } else {
        Some(serde_json::from_str(scope).map_err(|_| "Ungültige Ordnergruppe.".to_string())?)
    };
    if parent.as_ref().is_some_and(|parts| parts.len() != 3) {
        return Err("Ungültige Ordnergruppe.".into());
    }
    if let Some(keys) = keys {
        if keys.is_empty()
            || keys.len() > 100_000
            || keys.iter().collect::<HashSet<_>>().len() != keys.len()
        {
            return Err("Ungültige Ordnerreihenfolge.".into());
        }
        for key in &keys {
            let parts: Vec<String> =
                serde_json::from_str(key).map_err(|_| "Ungültiger Ordnerschlüssel.".to_string())?;
            if parts.len() != 3 || parts.iter().any(|part| part.is_empty()) {
                return Err("Ungültiger Ordnerschlüssel.".into());
            }
            let belongs = match &parent {
                Some(parent) => {
                    parts[0] == parent[0]
                        && parts[1] == parent[1]
                        && parts[2]
                            .rsplit_once('/')
                            .is_some_and(|(path, _)| path == parent[2])
                }
                None => !parts[2].contains('/'),
            };
            if !belongs {
                return Err(
                    "Nur Ordner innerhalb derselben Ebene können umsortiert werden.".into(),
                );
            }
        }
        conn.execute("INSERT INTO email_archive_folder_preferences VALUES(?1,?2) ON CONFLICT(scope) DO UPDATE SET keys=excluded.keys",params![scope,serde_json::to_string(&keys).map_err(|e| e.to_string())?]).map_err(|e| e.to_string())?;
    } else {
        conn.execute(
            "DELETE FROM email_archive_folder_preferences WHERE scope=?1",
            [scope],
        )
        .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub async fn get_email_archive_folder_preferences(
    app: AppHandle,
) -> Result<HashMap<String, Vec<String>>, String> {
    let root = root(&app)?;
    tauri::async_runtime::spawn_blocking(move || read_preferences(&db(&root)?))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn set_email_archive_folder_preferences(
    app: AppHandle,
    scope: String,
    keys: Option<Vec<String>>,
) -> Result<(), String> {
    let root = root(&app)?;
    tauri::async_runtime::spawn_blocking(move || save_preferences(&db(&root)?, &scope, keys))
        .await
        .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    fn key(source: &str, path: &str) -> String {
        serde_json::to_string(&["outlook", source, path]).unwrap()
    }
    #[test]
    fn preferences_survive_reopening_and_reset_without_replacing_imported_metadata() {
        let path = std::env::temp_dir().join(format!("dmh-order-test-{}.sqlite", Uuid::new_v4()));
        let conn = Connection::open(&path).unwrap();
        initialize(&conn).unwrap();
        conn.execute_batch("CREATE TABLE folders(id TEXT PRIMARY KEY); INSERT INTO folders VALUES('inbox'),('archive');").unwrap();
        record_imported(&conn, "inbox", Some(1), Some("10ab")).unwrap();
        record_imported(&conn, "archive", Some(0), None).unwrap();
        let scope = key("one", "Account");
        let keys = vec![key("one", "Account/Inbox"), key("one", "Account/Archiv")];
        save_preferences(&conn, &scope, Some(keys.clone())).unwrap();
        drop(conn);
        let conn = Connection::open(&path).unwrap();
        initialize(&conn).unwrap();
        assert_eq!(read_preferences(&conn).unwrap().get(&scope), Some(&keys));
        record_imported(&conn, "inbox", Some(9), Some("00")).unwrap();
        assert_eq!(read_preferences(&conn).unwrap().get(&scope), Some(&keys));
        save_preferences(&conn, &scope, None).unwrap();
        assert!(read_preferences(&conn).unwrap().is_empty());
        assert_eq!(
            conn.query_row(
                "SELECT position FROM email_archive_imported_order WHERE folder_id='inbox'",
                [],
                |row| row.get::<_, i64>(0)
            )
            .unwrap(),
            9
        );
        drop(conn);
        fs::remove_file(path).unwrap();
    }
    #[test]
    fn preference_validation_prevents_cross_account_or_hierarchy_moves_and_duplicate_keys() {
        let conn = Connection::open_in_memory().unwrap();
        initialize(&conn).unwrap();
        let scope = key("one", "Account");
        let inbox = key("one", "Account/Inbox");
        for keys in [
            vec![key("two", "Account/Inbox")],
            vec![key("one", "Account/Inbox/Child")],
            vec![inbox.clone(), inbox.clone()],
            vec![],
        ] {
            assert!(save_preferences(&conn, &scope, Some(keys)).is_err());
        }
        assert!(read_preferences(&conn).unwrap().is_empty());
        save_preferences(
            &conn,
            "roots",
            Some(vec![key("two", "Other"), key("one", "Account")]),
        )
        .unwrap();
        assert_eq!(read_preferences(&conn).unwrap().len(), 1);
    }
}
