use super::*;

pub(super) fn blue(event: &crate::CalendarEvent) -> crate::CalendarEvent {
    let mut fallback = event.clone();
    fallback.category.clear();
    fallback.color = "blue".into();
    fallback
}

pub(super) fn save_blue(conn: &rusqlite::Connection, id: &str) -> Result<(), String> {
    // Metadata only: retain ID, title, time, meeting, recurrence and content
    // timestamp. An existing content/deletion outbox must remain untouched.
    conn.execute("UPDATE calendar_events SET event_json=json_set(event_json,'$.category','','$.color','blue') WHERE id=?1 AND deleted_at IS NULL AND (COALESCE(json_extract(event_json,'$.category'),'')!='' OR COALESCE(json_extract(event_json,'$.color'),'')!='blue')",[id]).map_err(|e|e.to_string())?;
    Ok(())
}

pub(super) fn queue(conn: &rusqlite::Connection, id: &str) -> Result<(), String> {
    conn.execute("INSERT OR IGNORE INTO calendar_sync_outbox(event_id,action,queued_at,attempts,last_error) SELECT id,'category',?2,0,NULL FROM calendar_events WHERE id=?1 AND deleted_at IS NULL",params![id,Utc::now().to_rfc3339()]).map_err(|e|e.to_string())?;
    Ok(())
}

pub(super) fn names(
    events: impl IntoIterator<Item = crate::CalendarEvent>,
) -> HashMap<String, String> {
    events
        .into_iter()
        .map(|event| {
            (
                graph_category_for_event(&event).to_lowercase(),
                String::new(),
            )
        })
        .collect()
}

pub(super) fn record(app: &AppHandle, event: Option<&crate::CalendarEvent>, error: &str) {
    let _ = crate::diagnostics::record(
        app,
        crate::diagnostics::DiagnosticMessage {
            origin: "Microsoft 365 · Farben".into(),
            level: "warning".into(),
            entity_kind: "calendar".into(),
            entity_id: event.map(|event| event.id.clone()),
            title: event.map(|event| event.title.clone()),
            starts_at: event.map(|event| event.starts_at.clone()),
            operation: Some("category-fallback".into()),
            message: error.into(),
            ..Default::default()
        },
    );
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn blue_fallback_preserves_content_and_user_pending_changes() {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        conn.execute_batch("CREATE TABLE calendar_events(id TEXT PRIMARY KEY,event_json TEXT,updated_at TEXT,deleted_at TEXT); CREATE TABLE calendar_sync_outbox(event_id TEXT PRIMARY KEY,action TEXT,queued_at TEXT,attempts INTEGER,last_error TEXT);").unwrap();
        let event:crate::CalendarEvent=serde_json::from_value(json!({"id":"one","title":"Besprechung","startsAt":"2026-10-12T12:00","endsAt":"2026-10-12T13:00","description":"Agenda","location":"SR2","category":"Unknown","color":"unknown","source":"M365","recurrence":{"frequency":"weekly","interval":1},"meeting":{"isOnlineMeeting":true,"onlineMeetingUrl":"https://teams.microsoft.com/meet/one"}})).unwrap();
        conn.execute(
            "INSERT INTO calendar_events VALUES('one',?1,'original',NULL)",
            [serde_json::to_string(&event).unwrap()],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO calendar_sync_outbox VALUES('one','upsert','original',2,'pending')",
            [],
        )
        .unwrap();
        save_blue(&conn, "one").unwrap();
        queue(&conn, "one").unwrap();
        let stored: String = conn
            .query_row("SELECT event_json FROM calendar_events", [], |r| r.get(0))
            .unwrap();
        assert_eq!(
            serde_json::from_str::<Value>(&stored).unwrap(),
            serde_json::to_value(blue(&event)).unwrap()
        );
        assert_eq!(
            conn.query_row("SELECT updated_at FROM calendar_events", [], |r| r
                .get::<_, String>(0))
                .unwrap(),
            "original"
        );
        assert_eq!(
            conn.query_row("SELECT action FROM calendar_sync_outbox", [], |r| r
                .get::<_, String>(0))
                .unwrap(),
            "upsert"
        );
        conn.execute("DELETE FROM calendar_sync_outbox", [])
            .unwrap();
        queue(&conn, "one").unwrap();
        assert_eq!(
            conn.query_row("SELECT action FROM calendar_sync_outbox", [], |r| r
                .get::<_, String>(0))
                .unwrap(),
            "category"
        );
    }
}
