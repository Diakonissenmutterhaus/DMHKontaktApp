use crate::{diagnostics, now, open_db};
use chrono::{Local, NaiveDate};
use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};
use tauri::AppHandle;
use uuid::Uuid;

const KEY: &str = "ki_news_v1";
pub(crate) fn is_news_key(key: &str) -> bool {
    key == KEY
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KiNews {
    pub id: String,
    pub date: String,
    pub title: String,
    pub summary: String,
    pub body: String,
    pub category: String,
    pub published: bool,
    pub source_url: String,
    pub updated_at: String,
}

fn defaults() -> Vec<KiNews> {
    vec![KiNews {
        id: "guideline-2026-11-10".into(), date: "2026-11-10".into(),
        title: "KI-Leitlinie vom 10. November 2026 verfügbar".into(),
        summary: "Das vollständige Dokument steht im Bereich Richtlinien bereit.".into(),
        body: "Die KI-Leitlinie des Diakonissenmutterhauses Aidlingen e. V. mit Stand 10. November 2026 ist in der App hinterlegt.\n\nDas Original-PDF finden Sie unter Richtlinien. Unter Formulare können Sie die Kenntnisnahme und eine bereits besuchte IT-Schulung bestätigen. Dort steht auch der Antrag auf einen kostenpflichtigen KI-Zugang zur Verfügung.".into(),
        category: "Richtlinie".into(), published: true, source_url: String::new(), updated_at: "2026-11-10T00:00:00Z".into(),
    }]
}

fn read(conn: &rusqlite::Connection) -> Result<Vec<KiNews>, String> {
    let raw: Option<String> = conn
        .query_row(
            "SELECT value FROM app_settings WHERE key=?1",
            [KEY],
            |row| row.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    match raw {
        Some(value) => serde_json::from_str(&value).map_err(|e| e.to_string()),
        None => Ok(defaults()),
    }
}

fn visible(mut entries: Vec<KiNews>, drafts: bool) -> Vec<KiNews> {
    let today = Local::now().date_naive().to_string();
    entries.retain(|entry| drafts || (entry.published && entry.date <= today));
    entries.sort_by(|a, b| b.date.cmp(&a.date).then(b.updated_at.cmp(&a.updated_at)));
    entries
}

fn save_in_db(conn: &mut rusqlite::Connection, mut article: KiNews) -> Result<KiNews, String> {
    article.title = article.title.trim().into();
    article.body = article.body.trim().into();
    article.source_url = article.source_url.trim().into();
    if article.title.is_empty()
        || article.title.len() > 240
        || article.body.is_empty()
        || article.body.len() > 30000
        || article.summary.len() > 600
        || !["Mitteilung", "Richtlinie", "Schulung", "KI-Neuigkeit"]
            .contains(&article.category.as_str())
    {
        return Err("Bitte Titel, Kategorie und Beitrag vollständig ausfüllen.".into());
    }
    let date = NaiveDate::parse_from_str(&article.date, "%Y-%m-%d")
        .map_err(|_| "Bitte ein gültiges Datum angeben.")?;
    if article.published && date > Local::now().date_naive() {
        return Err("Ein veröffentlichter Beitrag darf nicht in der Zukunft liegen.".into());
    }
    if !article.source_url.is_empty() {
        let url = reqwest::Url::parse(&article.source_url)
            .map_err(|_| "Bitte einen gültigen HTTPS-Quellenlink angeben.")?;
        if url.scheme() != "https"
            || url.host_str().is_none()
            || !url.username().is_empty()
            || url.password().is_some()
        {
            return Err("Der Quellenlink muss HTTPS ohne Zugangsdaten verwenden.".into());
        }
    }
    if article.summary.trim().is_empty() {
        article.summary = article.body.chars().take(160).collect();
    }
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    let mut entries = read(&tx)?;
    if article.id.is_empty() {
        if entries.len() >= 200 {
            return Err("Maximal 200 Beiträge pro PC.".into());
        }
        article.id = Uuid::new_v4().to_string();
        article.updated_at = now();
        entries.push(article.clone());
    } else {
        let entry = entries
            .iter_mut()
            .find(|entry| entry.id == article.id)
            .ok_or("Dieser Beitrag ist nicht mehr vorhanden. Bitte neu laden.")?;
        article.updated_at = now();
        *entry = article.clone();
    }
    tx.execute("INSERT INTO app_settings(key,value,updated_at) VALUES(?1,?2,?3) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at", params![KEY, serde_json::to_string(&entries).map_err(|e| e.to_string())?, now()]).map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())?;
    Ok(article)
}

#[tauri::command]
pub fn list_ki_news(app: AppHandle, include_drafts: Option<bool>) -> Result<Vec<KiNews>, String> {
    let drafts = include_drafts.unwrap_or(false);
    if drafts {
        diagnostics::require_edv(&app)?;
    }
    Ok(visible(read(&open_db(&app)?)?, drafts))
}

#[tauri::command]
pub fn save_ki_news(app: AppHandle, article: KiNews) -> Result<KiNews, String> {
    diagnostics::require_edv(&app)?;
    save_in_db(&mut open_db(&app)?, article)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn conn() -> rusqlite::Connection {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE app_settings(key TEXT PRIMARY KEY,value TEXT,updated_at TEXT);",
        )
        .unwrap();
        conn
    }
    #[test]
    fn drafts_stay_private_and_updates_preserve_existing_news() {
        let mut conn = conn();
        let mut draft = defaults().remove(0);
        draft.id.clear();
        draft.published = false;
        draft.title = "Neue Schulung".into();
        let saved = save_in_db(&mut conn, draft).unwrap();
        assert_eq!(visible(read(&conn).unwrap(), false).len(), 1);
        assert_eq!(visible(read(&conn).unwrap(), true).len(), 2);
        let mut publish = saved;
        publish.published = true;
        let id = publish.id.clone();
        save_in_db(&mut conn, publish).unwrap();
        assert_eq!(visible(read(&conn).unwrap(), false).len(), 2);
        assert!(read(&conn).unwrap().iter().any(|entry| entry.id == id));
    }
    #[test]
    fn rejects_unsafe_sources_future_publications_and_unknown_ids() {
        let mut conn = conn();
        let mut article = defaults().remove(0);
        article.source_url = "javascript:alert(1)".into();
        assert!(save_in_db(&mut conn, article.clone()).is_err());
        article.source_url.clear();
        article.date = "2999-01-01".into();
        assert!(save_in_db(&mut conn, article.clone()).is_err());
        article.date = "2026-11-10".into();
        article.id = "missing".into();
        assert!(save_in_db(&mut conn, article).is_err());
        assert_eq!(read(&conn).unwrap().len(), 1);
    }
}
