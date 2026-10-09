use super::*;

const CHECKPOINT_PREFIX: &str = "m365_calendar_transfer_v1:";
const ALLOW_MEETINGS_KEY: &str = "m365_allow_calendar_transfer_meetings_v1";
const TRANSFER_PROPERTY: &str =
    "String {d2d6cc21-12ea-4f82-a075-5cf50993af61} Name DMHCalendarTransfer";

#[derive(Serialize, Deserialize)]
struct TransferCheckpoint {
    target_id: String,
    transaction_id: String,
    origin_url: String,
    origin_change_key: String,
    create_payload: Value,
    destination: Option<Value>,
}

fn checkpoint_key(event_id: &str) -> String {
    format!("{CHECKPOINT_PREFIX}{event_id}")
}

fn clear_checkpoint(app: &AppHandle, event_id: &str) -> Result<(), String> {
    open_db(app)?
        .execute(
            "DELETE FROM app_settings WHERE key = ?1",
            [checkpoint_key(event_id)],
        )
        .map_err(|error| error.to_string())?;
    Ok(())
}

pub(super) fn ensure_no_pending_transfer(app: &AppHandle) -> Result<(), String> {
    let pending: bool = open_db(app)?.query_row(
        "SELECT EXISTS(SELECT 1 FROM app_settings WHERE key LIKE 'm365_calendar_transfer_v1:%')", [], |row| row.get(0),
    ).map_err(|error| error.to_string())?;
    if pending {
        return Err("Eine Kalender-Verschiebung ist noch nicht abgeschlossen. Die automatische Ausgangssynchronisierung setzt sie fort, bevor Kalender erneut eingelesen werden.".to_string());
    }
    Ok(())
}

pub(super) async fn discard_pending_transfer(
    app: &AppHandle,
    token: &str,
    event_id: &str,
) -> Result<(), String> {
    let Some(raw) = get_setting(app, &checkpoint_key(event_id))? else {
        return Ok(());
    };
    let checkpoint: TransferCheckpoint =
        serde_json::from_str(&raw).map_err(|error| error.to_string())?;
    // Never discard the only surviving copy after a successful remote deletion
    // followed by a local database failure. Finish that transfer first.
    graph_json(token, &checkpoint.origin_url).await.map_err(|_| "Die bisherige Verschiebung muss zuerst mit dem bisherigen Zielkalender abgeschlossen werden. Der ursprüngliche Termin konnte nicht bestätigt werden; die Zielkopie wurde beibehalten.".to_string())?;
    if let Some(destination) = checkpoint.destination {
        let url = destination
            .get("_dmhResourceUrl")
            .and_then(Value::as_str)
            .ok_or_else(|| {
                "Die noch offene Kalender-Verschiebung hat keinen Zielpfad.".to_string()
            })?;
        graph_write(token, reqwest::Method::DELETE, url, &Value::Null).await?;
    }
    clear_checkpoint(app, event_id)
}

fn validate_transfer(
    remote: &Value,
    event: &crate::CalendarEvent,
    allow_meetings: bool,
) -> Result<(), String> {
    let attendees = remote
        .get("attendees")
        .and_then(Value::as_array)
        .is_some_and(|items| !items.is_empty())
        || !event.meeting.required_attendees.is_empty()
        || !event.meeting.optional_attendees.is_empty();
    if attendees && !allow_meetings {
        return Err("Besprechungen mit Teilnehmern bleiben im bisherigen Kalender. Neue Einladungen und Absagen sind für eine Verschiebung nicht freigegeben.".to_string());
    }
    if remote.get("isOrganizer").and_then(Value::as_bool) == Some(false) {
        return Err("Eine empfangene Besprechung kann hier nicht mit einem anderen Organisator neu erstellt werden.".to_string());
    }
    if event.meeting.is_online_meeting
        || remote.get("isOnlineMeeting").and_then(Value::as_bool) == Some(true)
    {
        return Err("Eine bestehende Online-Besprechung bitte in Outlook verschieben, damit der ursprüngliche Teams-Link erhalten bleibt.".to_string());
    }
    if remote.get("hasAttachments").and_then(Value::as_bool) == Some(true) {
        return Err("Termine mit Anhängen bitte in Outlook verschieben, damit alle Anhänge erhalten bleiben.".to_string());
    }
    if matches!(
        remote.get("type").and_then(Value::as_str),
        Some("seriesMaster" | "occurrence" | "exception")
    ) || event.recurrence.is_some()
        || event.recurrence_master_id.is_some()
        || !event.excluded_dates.is_empty()
    {
        return Err("Terminserien und Serienausnahmen bitte in Outlook verschieben, damit alle Wiederholungen und Ausnahmen erhalten bleiben.".to_string());
    }
    Ok(())
}

fn transfer_payload(
    remote: &Value,
    event: &crate::CalendarEvent,
    names: &HashMap<String, String>,
    transaction_id: &str,
) -> Value {
    let mut payload = graph_event_payload_for_master(event, names);
    // Preserve HTML and all remote categories when the editor did not change them.
    if html_to_plain_text(&event.description) == remote_event_description(remote) {
        if let Some(body) = remote.get("body") {
            payload["body"] = body.clone();
        }
    }
    if event.category
        == remote
            .get("categories")
            .and_then(Value::as_array)
            .and_then(|items| items.first())
            .and_then(Value::as_str)
            .unwrap_or("")
    {
        if let Some(categories) = remote.get("categories") {
            payload["categories"] = categories.clone();
        }
    }
    for key in ["importance", "responseRequested", "allowNewTimeProposals"] {
        if let Some(value) = remote.get(key) {
            payload[key] = value.clone();
        }
    }
    payload["transactionId"] = json!(transaction_id);
    payload["singleValueExtendedProperties"] =
        json!([{ "id": TRANSFER_PROPERTY, "value": transaction_id }]);
    payload
}

pub(super) async fn transfer_event(
    app: &AppHandle,
    token: &str,
    origin: &Microsoft365SyncSource,
    remote_id: &str,
    target: Option<&Microsoft365SyncSource>,
    event: &crate::CalendarEvent,
    names: &HashMap<String, String>,
) -> Result<(), String> {
    let target_id = event
        .calendar_source_id
        .as_deref()
        .ok_or("Kein Zielkalender gewählt.")?;
    let key = checkpoint_key(&event.id);
    let mut checkpoint: Option<TransferCheckpoint> = get_setting(app, &key)?
        .map(|raw| serde_json::from_str(&raw))
        .transpose()
        .map_err(|error| error.to_string())?;
    if checkpoint
        .as_ref()
        .is_some_and(|value| value.target_id != target_id)
    {
        discard_pending_transfer(app, token, &event.id).await?;
        checkpoint = None;
    }
    let origin_url = format!(
        "{}/events/{}",
        origin.resource_path,
        encode_graph_path_segment(remote_id)
    );
    if checkpoint.is_none() {
        let remote = graph_json(token, &origin_url).await?;
        let allow_meetings = get_setting(app, ALLOW_MEETINGS_KEY)?.as_deref() == Some("true");
        validate_transfer(&remote, event, allow_meetings)?;
        checkpoint = Some(TransferCheckpoint {
            target_id: target_id.to_string(),
            transaction_id: uuid::Uuid::new_v4().to_string(),
            origin_url: origin_url.clone(),
            origin_change_key: value_text(&remote, "changeKey").to_string(),
            create_payload: remote,
            destination: None,
        });
    }
    let mut checkpoint = checkpoint.unwrap();
    if checkpoint.create_payload.get("transactionId").is_none() {
        checkpoint.create_payload = transfer_payload(
            &checkpoint.create_payload,
            event,
            names,
            &checkpoint.transaction_id,
        );
    }
    set_setting(
        app,
        &key,
        &serde_json::to_string(&checkpoint).map_err(|error| error.to_string())?,
    )?;
    let linked = if let Some(target) = target {
        if checkpoint.destination.is_none() {
            let filter = encode_graph_path_segment(&format!("singleValueExtendedProperties/Any(ep: ep/id eq '{TRANSFER_PROPERTY}' and ep/value eq '{}')", checkpoint.transaction_id));
            let mut matches = graph_collection(
                token,
                &format!("{}/events?$filter={filter}&$top=2", target.resource_path),
            )
            .await?;
            if matches.len() > 1 {
                return Err("Exchange enthält mehrere Kopien dieser Verschiebung. Der ursprüngliche Termin wurde beibehalten.".to_string());
            }
            let mut destination = if let Some(existing) = matches.pop() {
                existing
            } else {
                graph_write(
                    token,
                    reqwest::Method::POST,
                    &format!("{}/events", target.resource_path),
                    &checkpoint.create_payload,
                )
                .await?
            };
            let destination_id = value_text(&destination, "id").to_string();
            if destination_id.is_empty() {
                return Err("Exchange hat keine Termin-ID für den Zielkalender zurückgegeben. Der ursprüngliche Termin wurde beibehalten.".to_string());
            }
            destination["_dmhResourceUrl"] = json!(format!(
                "{}/events/{}",
                target.resource_path,
                encode_graph_path_segment(&destination_id)
            ));
            checkpoint.destination = Some(destination);
            set_setting(
                app,
                &key,
                &serde_json::to_string(&checkpoint).map_err(|error| error.to_string())?,
            )?;
        }
        let destination = checkpoint.destination.as_ref().unwrap();
        let destination_url = value_text(destination, "_dmhResourceUrl");
        let remote_destination = graph_json(token, destination_url).await?;
        let mut update = transfer_payload(
            &remote_destination,
            event,
            names,
            &checkpoint.transaction_id,
        );
        update.as_object_mut().unwrap().remove("transactionId");
        update
            .as_object_mut()
            .unwrap()
            .remove("singleValueExtendedProperties");
        graph_write(token, reqwest::Method::PATCH, destination_url, &update).await?;
        let mut linked = event.clone();
        linked.id = format!("m365:{}:{}", target.id, value_text(destination, "id"));
        linked.source = format!("Microsoft 365 · {}", target.name);
        linked.meeting.online_meeting_url = destination
            .pointer("/onlineMeeting/joinUrl")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string();
        linked
    } else {
        let mut linked = event.clone();
        linked.id = format!("calendar-local:{}", checkpoint.transaction_id);
        linked
    };
    // The original is removed only after creation and its durable checkpoint succeed.
    match graph_json(token, &origin_url).await {
        Ok(remote)
            if !checkpoint.origin_change_key.is_empty()
                && value_text(&remote, "changeKey") != checkpoint.origin_change_key =>
        {
            return Err("Der ursprüngliche Termin wurde zwischenzeitlich in Exchange geändert. Beide Kopien wurden beibehalten; die Verschiebung wurde nicht durch Löschen abgeschlossen.".to_string());
        }
        Ok(_) => {}
        Err(error) if error.contains("404") => {}
        Err(error) => return Err(error),
    }
    graph_write(token, reqwest::Method::DELETE, &origin_url, &Value::Null).await?;
    crate::link_calendar_event_after_exchange_create(app, &event.id, &linked)?;
    clear_checkpoint(app, &event.id)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn event() -> crate::CalendarEvent {
        serde_json::from_value(json!({"id":"m365:a:one", "title":"Termin", "startsAt":"2026-10-09T09:00", "endsAt":"2026-10-09T10:00", "source":"A", "location":"", "description":"Text", "calendarSourceId":"b"})).unwrap()
    }
    #[test]
    fn meeting_moves_require_explicit_authorization() {
        let remote = json!({"attendees":[{"type":"required"}], "isOrganizer":true});
        assert!(validate_transfer(&remote, &event(), false).is_err());
        assert!(validate_transfer(&remote, &event(), true).is_ok());
        assert!(validate_transfer(&json!({"isOrganizer":false}), &event(), true).is_err());
    }
    #[test]
    fn refuses_transfers_that_would_drop_attachments_or_series() {
        assert!(validate_transfer(&json!({"hasAttachments":true}), &event(), false).is_err());
        assert!(validate_transfer(&json!({"isOnlineMeeting":true}), &event(), true).is_err());
        let mut online = event();
        online.meeting.is_online_meeting = true;
        assert!(validate_transfer(&json!({}), &online, true).is_err());
        for kind in ["seriesMaster", "occurrence", "exception"] {
            assert!(validate_transfer(&json!({"type":kind}), &event(), true).is_err());
        }
    }
    #[test]
    fn payload_preserves_html_categories_and_retry_identity() {
        let payload = transfer_payload(
            &json!({"body":{"contentType":"html","content":"<p>Text</p>"}, "categories":[], "importance":"high"}),
            &event(),
            &HashMap::new(),
            "retry-id",
        );
        assert_eq!(payload["body"]["content"], "<p>Text</p>");
        assert_eq!(payload["transactionId"], "retry-id");
        assert_eq!(payload["importance"], "high");
    }
}
