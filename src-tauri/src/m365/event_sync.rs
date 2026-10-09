use super::*;

const DAYS: [&str; 7] = [
    "sunday",
    "monday",
    "tuesday",
    "wednesday",
    "thursday",
    "friday",
    "saturday",
];
const EVENT_FIELDS: &str = "id,subject,start,end,isAllDay,lastModifiedDateTime,location,body,categories,attendees,showAs,isReminderOn,reminderMinutesBeforeStart,sensitivity,isOnlineMeeting,onlineMeeting,onlineMeetingUrl,recurrence,type,seriesMasterId,originalStart,occurrenceId,isOrganizer,hasAttachments";

pub(super) fn recurrence_from_graph(value: &Value) -> Option<crate::CalendarRecurrence> {
    let pattern = value.get("pattern")?;
    let range = value.get("range")?;
    let kind = value_text(pattern, "type");
    let frequency = match kind {
        "daily" => "daily",
        "weekly" => "weekly",
        "absoluteMonthly" | "relativeMonthly" => "monthly",
        "absoluteYearly" | "relativeYearly" => "yearly",
        _ => return None,
    };
    let days_of_week = pattern
        .get("daysOfWeek")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|day| {
            DAYS.iter()
                .position(|name| Some(*name) == day.as_str())
                .map(|index| index as u32)
        })
        .collect();
    Some(crate::CalendarRecurrence {
        frequency: frequency.to_string(),
        interval: pattern
            .get("interval")
            .and_then(Value::as_u64)
            .unwrap_or(1)
            .max(1) as u32,
        days_of_week,
        first_day_of_week: (kind == "weekly").then(|| {
            DAYS.iter()
                .position(|name| *name == value_text(pattern, "firstDayOfWeek"))
                .unwrap_or(0) as u32
        }),
        day_of_month: pattern
            .get("dayOfMonth")
            .and_then(Value::as_u64)
            .filter(|day| *day > 0)
            .map(|day| day as u32),
        month_of_year: pattern
            .get("month")
            .and_then(Value::as_u64)
            .filter(|month| *month > 0)
            .map(|month| month as u32),
        week_of_month: if kind.starts_with("relative") {
            Some(match value_text(pattern, "index") {
                "second" => 2,
                "third" => 3,
                "fourth" => 4,
                "last" => -1,
                _ => 1,
            })
        } else {
            None
        },
        until: (value_text(range, "type") == "endDate")
            .then(|| value_text(range, "endDate").to_string()),
        weekday_set_position: kind.starts_with("relative").then_some(true),
        count: (value_text(range, "type") == "numbered").then(|| {
            range
                .get("numberOfOccurrences")
                .and_then(Value::as_u64)
                .unwrap_or(1) as u32
        }),
    })
}

pub(super) fn recurrence_to_graph(event: &crate::CalendarEvent) -> Value {
    let Some(rule) = &event.recurrence else {
        return Value::Null;
    };
    let date = event
        .starts_at
        .get(..10)
        .and_then(|date| chrono::NaiveDate::parse_from_str(date, "%Y-%m-%d").ok());
    let mut pattern = json!({ "interval": rule.interval.max(1) });
    let kind = match rule.frequency.as_str() {
        "daily" => "daily",
        "weekly" => "weekly",
        "monthly" if rule.week_of_month.is_some() => "relativeMonthly",
        "monthly" => "absoluteMonthly",
        "yearly" if rule.week_of_month.is_some() => "relativeYearly",
        _ => "absoluteYearly",
    };
    pattern["type"] = json!(kind);
    if kind == "weekly" || kind.starts_with("relative") {
        let mut days = rule.days_of_week.clone();
        if days.is_empty() {
            days.push(
                date.map(|date| date.weekday().num_days_from_sunday())
                    .unwrap_or(1),
            );
        }
        days.sort_unstable();
        days.dedup();
        pattern["daysOfWeek"] = json!(days
            .into_iter()
            .filter_map(|day| DAYS.get(day as usize))
            .collect::<Vec<_>>());
    }
    if kind == "weekly" {
        pattern["firstDayOfWeek"] = json!(DAYS
            .get(rule.first_day_of_week.unwrap_or(1) as usize)
            .unwrap_or(&"monday"));
    }
    if kind.starts_with("relative") {
        pattern["index"] = json!(match rule.week_of_month.unwrap_or(1) {
            2 => "second",
            3 => "third",
            4 => "fourth",
            -1 | 5 => "last",
            _ => "first",
        });
    } else if kind.starts_with("absolute") {
        pattern["dayOfMonth"] = json!(rule
            .day_of_month
            .unwrap_or_else(|| date.map(|date| date.day()).unwrap_or(1)));
    }
    if kind.ends_with("Yearly") {
        pattern["month"] = json!(rule
            .month_of_year
            .unwrap_or_else(|| date.map(|date| date.month()).unwrap_or(1)));
    }
    let mut range = json!({ "type": "noEnd", "startDate": event.starts_at.get(..10).unwrap_or(""), "recurrenceTimeZone": "W. Europe Standard Time" });
    if let Some(count) = rule.count {
        range["type"] = json!("numbered");
        range["numberOfOccurrences"] = json!(count.max(1));
    } else if let Some(until) = &rule.until {
        range["type"] = json!("endDate");
        range["endDate"] = json!(until);
    }
    json!({ "pattern": pattern, "range": range })
}

// occurrenceId uses OID.<master ID>.<original local date>, including when an
// exception was moved to another day. Never derive exclusions from its new start.
fn occurrence_date(value: &str) -> Option<String> {
    let date = value.rsplit('.').next()?;
    chrono::NaiveDate::parse_from_str(date, "%Y-%m-%d")
        .ok()
        .map(|_| date.to_string())
}

pub(super) fn original_occurrence_date(value: &Value) -> Option<String> {
    occurrence_date(value_text(value, "occurrenceId")).or_else(|| {
        value
            .get("originalStart")
            .and_then(Value::as_str)
            .and_then(|date| date.get(..10))
            .map(str::to_string)
    })
}

fn meeting_block_start(html: &str) -> Option<usize> {
    let lower = html.to_ascii_lowercase();
    ["me-email-text", "divskypemeeting"]
        .iter()
        .filter_map(|marker| {
            let marker = lower.find(marker)?;
            let start = lower[..marker].rfind('<')?;
            let end = lower[start..].find('>')? + start;
            (marker < end).then_some(start)
        })
        .min()
}

fn meeting_block_end(html: &str, start: usize) -> Option<usize> {
    let lower = html.to_ascii_lowercase();
    let first_end = lower[start..].find('>')? + start;
    let name = lower[start + 1..first_end]
        .split_ascii_whitespace()
        .next()?;
    let mut depth = 0usize;
    let mut position = start;
    while let Some(offset) = lower[position..].find('<') {
        let opening = position + offset;
        let end = lower[opening..].find('>')? + opening;
        let tag = lower[opening + 1..end].trim();
        let tag_name = tag
            .trim_start_matches('/')
            .split_ascii_whitespace()
            .next()
            .unwrap_or("");
        if tag_name == name {
            if tag.starts_with('/') {
                depth = depth.checked_sub(1)?;
                if depth == 0 {
                    return Some(end + 1);
                }
            } else if !tag.ends_with('/') {
                depth += 1;
            }
        }
        position = end + 1;
    }
    None
}

pub(super) fn description_html(value: &Value) -> &str {
    let html = value
        .get("body")
        .and_then(|body| body.get("content"))
        .and_then(Value::as_str)
        .unwrap_or("");
    if let Some(start) = meeting_block_start(html) {
        &html[..start]
    } else {
        html
    }
}

fn escaped_html(text: &str) -> String {
    text.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\n', "<br>")
}

pub(super) fn update_payload(
    remote: &Value,
    event: &crate::CalendarEvent,
    names: &HashMap<String, String>,
) -> Result<Value, String> {
    let mut payload = graph_event_payload_for_master(event, names);
    let online = remote
        .get("isOnlineMeeting")
        .and_then(Value::as_bool)
        .unwrap_or(false)
        || remote
            .get("onlineMeeting")
            .and_then(|meeting| meeting.get("joinUrl"))
            .and_then(Value::as_str)
            .is_some();
    if online && !event.meeting.is_online_meeting {
        return Err("Eine bestehende Teams-Besprechung kann in Exchange nicht in einen Offline-Termin umgewandelt werden. Der Teams-Link bleibt erhalten.".to_string());
    }
    let object = payload.as_object_mut().unwrap();
    object.remove("transactionId");
    if online {
        object.remove("isOnlineMeeting");
        object.remove("onlineMeetingProvider");
    }
    if matches!(value_text(remote, "type"), "occurrence" | "exception") {
        object.remove("recurrence");
    }
    // Preserve response status, resource attendees, room metadata and secondary
    // categories when the single-category/text editor did not change them.
    if event.category.trim().eq_ignore_ascii_case(
        remote
            .get("categories")
            .and_then(Value::as_array)
            .and_then(|values| values.first())
            .and_then(Value::as_str)
            .unwrap_or(""),
    ) {
        object.remove("categories");
    }
    if event.location.trim()
        == remote
            .get("location")
            .and_then(|part| part.get("displayName"))
            .and_then(Value::as_str)
            .unwrap_or("")
    {
        object.remove("location");
    }
    if event.meeting.required_attendees == remote_event_attendees(remote, "required")
        && event.meeting.optional_attendees == remote_event_attendees(remote, "optional")
    {
        object.remove("attendees");
    }
    if html_to_plain_text(&event.description).trim()
        == html_to_plain_text(&remote_event_description(remote)).trim()
        || html_to_plain_text(&event.description).trim()
            == html_to_plain_text(
                remote
                    .get("body")
                    .map(|body| value_text(body, "content"))
                    .unwrap_or(""),
            )
            .trim()
    {
        object.remove("body");
    } else if online {
        let body = remote.get("body").ok_or(
            "Der Inhalt der Teams-Besprechung fehlt; die Beschreibung wurde nicht überschrieben.",
        )?;
        let html = value_text(body, "content");
        let block = meeting_block_start(html).ok_or("Der geschützte Teams-Besprechungsblock konnte nicht erkannt werden. Bitte die Beschreibung dieses Termins in Outlook bearbeiten; der bestehende Link wurde nicht verändert.")?;
        let lower = html.to_ascii_lowercase();
        let content_start = lower
            .find("<body")
            .and_then(|start| lower[start..].find('>').map(|end| start + end + 1))
            .unwrap_or(0);
        let block_end = meeting_block_end(html, block).ok_or("Der Teams-Besprechungsblock ist unvollständig; die Beschreibung wurde nicht überschrieben.")?;
        let document_end = lower.rfind("</body").unwrap_or(html.len());
        object.insert("body".to_string(), json!({ "contentType": "html", "content": format!("{}<div>{}</div>{}{}", &html[..content_start], escaped_html(&event.description), &html[block..block_end], &html[document_end..]) }));
    }
    for key in [
        "subject",
        "isAllDay",
        "showAs",
        "isReminderOn",
        "reminderMinutesBeforeStart",
    ] {
        if remote.get(key) == object.get(key) {
            object.remove(key);
        }
    }
    if (value_text(remote, "sensitivity") == "private") == event.meeting.is_private {
        object.remove("sensitivity");
    }
    for key in ["start", "end"] {
        if normalized_calendar_start(
            remote
                .get(key)
                .map(|part| value_text(part, "dateTime"))
                .unwrap_or(""),
        ) == normalized_calendar_start(
            object
                .get(key)
                .map(|part| value_text(part, "dateTime"))
                .unwrap_or(""),
        ) {
            object.remove(key);
        }
    }
    let mut previous = event.clone();
    previous.recurrence = recurrence_from_graph(&remote["recurrence"]);
    if let Some(start) = remote
        .get("start")
        .and_then(|start| start.get("dateTime"))
        .and_then(Value::as_str)
    {
        previous.starts_at = start.to_string();
    }
    if recurrence_to_graph(&previous) == recurrence_to_graph(event) {
        object.remove("recurrence");
    }
    Ok(payload)
}

pub(super) async fn patch_event(
    token: &str,
    url: &str,
    event: &crate::CalendarEvent,
    names: &HashMap<String, String>,
    category_only: bool,
) -> Result<Value, String> {
    // Always read the current HTML, not a possibly stale preview snapshot.
    let remote = graph_json(token, url).await?;
    let payload = if category_only {
        json!({ "categories": graph_category_values(&master_category_for_event(event, names)) })
    } else {
        update_payload(&remote, event, names)?
    };
    let updated = if payload.as_object().is_some_and(|fields| fields.is_empty()) {
        remote
    } else {
        graph_write(token, reqwest::Method::PATCH, url, &payload).await?
    };
    if !category_only {
        apply_exclusions(token, url, event).await?;
    }
    Ok(updated)
}

pub(super) async fn create_event(
    token: &str,
    url: &str,
    event: &crate::CalendarEvent,
    names: &HashMap<String, String>,
) -> Result<Value, String> {
    let remote = graph_write(
        token,
        reqwest::Method::POST,
        url,
        &graph_event_payload_for_master(event, names),
    )
    .await?;
    let id = value_text(&remote, "id");
    if !id.is_empty() {
        apply_exclusions(
            token,
            &format!("{url}/{}", encode_graph_path_segment(id)),
            event,
        )
        .await?;
    }
    Ok(remote)
}

async fn apply_exclusions(
    token: &str,
    url: &str,
    event: &crate::CalendarEvent,
) -> Result<(), String> {
    if event.recurrence.is_none() || event.excluded_dates.is_empty() {
        return Ok(());
    }
    let master = graph_json(token, &format!("{url}?$select=id,cancelledOccurrences,exceptionOccurrences,occurrenceId&$expand=exceptionOccurrences")).await?;
    let cancelled: HashSet<String> = master["cancelledOccurrences"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|item| item.as_str().and_then(occurrence_date))
        .collect();
    let exceptions: HashSet<String> = master["exceptionOccurrences"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(original_occurrence_date)
        .collect();
    for date in &event.excluded_dates {
        if cancelled.contains(date) || exceptions.contains(date) {
            continue;
        }
        let (start, end) = calendar_outbox_lookup_window(date)?;
        let instances = graph_collection(token, &format!("{url}/instances?startDateTime={}&endDateTime={}&$select=id,start,type,originalStart,occurrenceId", encode_graph_path_segment(&start), encode_graph_path_segment(&end))).await?;
        if let Some(instance) = instances.iter().find(|instance| {
            value_text(instance, "type") != "exception"
                && original_occurrence_date(instance).unwrap_or_else(|| {
                    instance
                        .get("start")
                        .map(|start| {
                            value_text(start, "dateTime")
                                .get(..10)
                                .unwrap_or("")
                                .to_string()
                        })
                        .unwrap_or_default()
                }) == *date
        }) {
            let events_url = url
                .rsplit_once('/')
                .map(|(parent, _)| parent)
                .ok_or("Ungültiger Exchange-Terminpfad.")?;
            graph_write(
                token,
                reqwest::Method::DELETE,
                &format!(
                    "{events_url}/{}",
                    encode_graph_path_segment(value_text(instance, "id"))
                ),
                &Value::Null,
            )
            .await?;
        }
    }
    Ok(())
}

async fn read_master(
    token: &str,
    source: &Microsoft365SyncSource,
    id: &str,
) -> Result<(Value, Vec<Value>), String> {
    let url = format!("{}/events/{}?$select={EVENT_FIELDS},cancelledOccurrences,exceptionOccurrences&$expand=exceptionOccurrences", source.resource_path, encode_graph_path_segment(id));
    let mut master = graph_json(token, &url).await?;
    let mut exceptions = master
        .get("exceptionOccurrences")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    if let Some(next) = master
        .get("exceptionOccurrences@odata.nextLink")
        .and_then(Value::as_str)
    {
        exceptions.extend(graph_collection(token, next).await?);
    }
    let mut exclusions = master
        .get("cancelledOccurrences")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|id| id.as_str().and_then(occurrence_date))
        .collect::<Vec<_>>();
    for exception in &mut exceptions {
        exception["seriesMasterId"] = json!(id);
        exception["type"] = json!("exception");
        if let Some(date) = occurrence_date(value_text(exception, "occurrenceId")) {
            exclusions.push(date);
        }
    }
    exclusions.sort();
    exclusions.dedup();
    master["_dmhExcludedDates"] = json!(exclusions);
    if master.get("type").is_none() {
        master["type"] = json!(if master
            .get("recurrence")
            .is_some_and(|value| !value.is_null())
        {
            "seriesMaster"
        } else {
            "singleInstance"
        });
    }

    Ok((master, exceptions))
}

pub(super) async fn normalize_series(
    app: &AppHandle,
    token: &str,
    source: &Microsoft365SyncSource,
    values: Vec<Value>,
) -> Result<Vec<Value>, String> {
    let values = stream::iter(values.into_iter().map(|value| async move {
        let kind = value_text(&value, "type");
        if value.get("@removed").is_none()
            && (kind.is_empty()
                || (matches!(kind, "occurrence" | "exception")
                    && value_text(&value, "seriesMasterId").is_empty()))
            && !value_text(&value, "id").is_empty()
        {
            let url = format!(
                "{}/events/{}",
                source.resource_path,
                encode_graph_path_segment(value_text(&value, "id"))
            );
            return graph_json(token, &url).await;
        }
        Ok(value)
    }))
    .buffer_unordered(6)
    .collect::<Vec<Result<Value, String>>>()
    .await
    .into_iter()
    .collect::<Result<Vec<_>, _>>()?;
    let mut master_ids = HashSet::new();
    for value in &values {
        if value_text(value, "type") == "seriesMaster" {
            master_ids.insert(value_text(value, "id").to_string());
        }
        let parent = value_text(value, "seriesMasterId");
        if !parent.is_empty() {
            master_ids.insert(parent.to_string());
        }
        if value.get("@removed").is_some() {
            let local_id = format!("m365:{}:{}", source.id, value_text(value, "id"));
            let parent: Option<String> = open_db(app)?.query_row("SELECT json_extract(event_json, '$.recurrenceMasterId') FROM calendar_events WHERE id = ?1", [&local_id], |row| row.get(0)).optional().map_err(|error| error.to_string())?.flatten();
            if let Some(parent) = parent.and_then(|id| {
                id.strip_prefix(&format!("m365:{}:", source.id))
                    .map(str::to_string)
            }) {
                master_ids.insert(parent);
            }
        }
    }
    let mut result = values
        .into_iter()
        .filter_map(|value| {
            if value_text(&value, "type") == "seriesMaster" {
                None
            } else if !value_text(&value, "seriesMasterId").is_empty()
                && value.get("@removed").is_none()
            {
                Some(json!({ "id": value_text(&value, "id"), "@removed": { "reason": "changed" } }))
            } else {
                Some(value)
            }
        })
        .collect::<Vec<_>>();
    let snapshots = stream::iter(master_ids.into_iter().map(|id| async move {
        let snapshot = read_master(token, source, &id).await;
        (id, snapshot)
    }))
    .buffer_unordered(6)
    .collect::<Vec<_>>()
    .await;
    for (id, snapshot) in snapshots {
        let (master, exceptions) = match snapshot {
            Ok(snapshot) => snapshot,
            Err(error) if error.contains("HTTP 404") || error.contains("HTTP 410") => {
                result.push(json!({ "id": id, "@removed": { "reason": "deleted" } }));
                continue;
            }
            Err(error) => return Err(error),
        };
        // A current exception wins over a removal marker for the same ID.
        let exception_ids: HashSet<String> = exceptions
            .iter()
            .map(|item| value_text(item, "id").to_string())
            .collect();
        result.retain(|item| {
            !exception_ids.contains(value_text(item, "id")) && value_text(item, "id") != id
        });
        let local_master = format!("m365:{}:{id}", source.id);
        let connection = open_db(app)?;
        let mut statement = connection.prepare("SELECT id FROM calendar_events WHERE deleted_at IS NULL AND json_extract(event_json, '$.recurrenceMasterId') = ?1").map_err(|error| error.to_string())?;
        let previous_children = statement
            .query_map([&local_master], |row| row.get::<_, String>(0))
            .map_err(|error| error.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| error.to_string())?;
        for child in previous_children {
            let Some(remote_id) = child.strip_prefix(&format!("m365:{}:", source.id)) else {
                continue;
            };
            if !exception_ids.contains(remote_id) {
                result.push(json!({ "id": remote_id, "@removed": { "reason": "deleted" } }));
            }
        }
        result.push(master);
        result.extend(exceptions);
    }
    Ok(result)
}

pub(super) fn prepare_series_upgrade(
    app: &AppHandle,
    source: &Microsoft365SyncSource,
) -> Result<(), String> {
    prepare_series_upgrade_in_db(&open_db(app)?, &source.id)
}

fn prepare_series_upgrade_in_db(
    conn: &rusqlite::Connection,
    source_id: &str,
) -> Result<(), String> {
    let key = format!("m365_calendar_series_v1:{source_id}");
    let tx = conn
        .unchecked_transaction()
        .map_err(|error| error.to_string())?;
    let complete: bool = tx
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM app_settings WHERE key = ?1)",
            [&key],
            |row| row.get(0),
        )
        .map_err(|error| error.to_string())?;
    if !complete {
        // Replay bounded inbound windows once to consolidate occurrences imported
        // by older app versions. Outbound edits remain in their durable outbox.
        let prefix = format!("{source_id}:period:");
        tx.execute("DELETE FROM m365_calendar_delta_state WHERE source_id = ?1 OR substr(source_id, 1, length(?2)) = ?2", params![source_id, prefix]).map_err(|error| error.to_string())?;
        tx.execute(
            "DELETE FROM m365_calendar_delta_changes WHERE source_id = ?1",
            [source_id],
        )
        .map_err(|error| error.to_string())?;
        tx.execute(
            "INSERT INTO app_settings(key, value) VALUES (?1, 'complete')",
            [&key],
        )
        .map_err(|error| error.to_string())?;
    }
    tx.commit().map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{BufRead, BufReader};

    fn event() -> crate::CalendarEvent {
        serde_json::from_value(json!({ "id":"draft-id", "title":"Stand-up", "startsAt":"2026-10-09T09:00:00", "endsAt":"2026-10-09T10:00:00", "location":"SR2", "description":"Agenda", "source":"DMH Backup", "category":"Work", "color":"blue" })).unwrap()
    }
    fn source() -> Microsoft365SyncSource {
        Microsoft365SyncSource {
            id: "cal".into(),
            name: "Work".into(),
            kind: "calendar".into(),
            editable: true,
            shared: false,
            resource_path: "https://graph.microsoft.com/v1.0/me/calendar".into(),
            mailbox: None,
        }
    }
    fn online_remote() -> Value {
        json!({ "id":"remote", "subject":"Stand-up", "start":{"dateTime":"2026-10-09T09:00:00.0000000"}, "end":{"dateTime":"2026-10-09T10:00:00.0000000"}, "isAllDay":false, "location":{"displayName":"SR2","locationType":"conferenceRoom"}, "attendees":[], "categories":["Work","Keep"], "recurrence":null, "showAs":"busy", "isReminderOn":true,"reminderMinutesBeforeStart":15, "sensitivity":"confidential", "isOnlineMeeting":true, "onlineMeeting":{"joinUrl":"https://teams.microsoft.com/l/meetup-join/protected"}, "body":{"contentType":"html", "content":"<html><head><meta charset=\"utf-8\"></head><body><p>Agenda</p><div class=\"me-email-text\"><a href=\"https://teams.microsoft.com/l/meetup-join/protected\">Join</a><p>Dial-in: +49 123</p><div>Meeting ID: 123</div></div></body></html>"} })
    }

    #[test]
    fn documented_patterns_and_ranges_round_trip() {
        let patterns = [
            json!({"type":"daily","interval":3}),
            json!({"type":"weekly","interval":2,"daysOfWeek":["monday","friday"],"firstDayOfWeek":"sunday"}),
            json!({"type":"absoluteMonthly","interval":6,"dayOfMonth":9}),
            json!({"type":"relativeMonthly","interval":1,"daysOfWeek":["friday"],"index":"last"}),
            json!({"type":"absoluteYearly","interval":1,"dayOfMonth":9,"month":10}),
            json!({"type":"relativeYearly","interval":2,"daysOfWeek":["tuesday"],"index":"second","month":10}),
        ];
        for pattern in patterns {
            for range in [
                json!({"type":"noEnd"}),
                json!({"type":"endDate","endDate":"2027-12-31"}),
                json!({"type":"numbered","numberOfOccurrences":12}),
            ] {
                let mut local = event();
                local.recurrence = recurrence_from_graph(&json!({"pattern":pattern,"range":range}));
                let written = recurrence_to_graph(&local);
                assert_eq!(written["pattern"], pattern);
                for (key, value) in range.as_object().unwrap() {
                    assert_eq!(&written["range"][key], value);
                }
                assert_eq!(written["range"]["startDate"], "2026-10-09");
                assert_eq!(recurrence_from_graph(&written), local.recurrence);
            }
        }
    }

    #[test]
    fn imports_series_and_removal_of_recurrence_authoritatively() {
        let mut remote = online_remote();
        remote["type"] = json!("seriesMaster");
        remote["recurrence"] = json!({ "pattern":{"type":"weekly","interval":2,"daysOfWeek":["friday"],"firstDayOfWeek":"monday"},"range":{"type":"numbered","numberOfOccurrences":8,"startDate":"2026-10-09"} });
        remote["_dmhExcludedDates"] = json!(["2026-10-23"]);
        let imported = remote_event_to_local(&remote, &source(), None);
        assert_eq!(imported.recurrence.as_ref().unwrap().count, Some(8));
        assert_eq!(imported.excluded_dates, vec!["2026-10-23"]);
        assert_eq!(imported.description, "Agenda");
        let mut local_without_series = imported.clone();
        local_without_series.recurrence = None;
        local_without_series.excluded_dates = vec!["2026-11-06".to_string()];
        let merged = merge_event(&local_without_series, &remote, &source());
        assert_eq!(merged.recurrence, imported.recurrence);
        assert_eq!(merged.excluded_dates, vec!["2026-10-23", "2026-11-06"]);
        let mut changed = imported.clone();
        changed.recurrence.as_mut().unwrap().interval = 3;
        assert!(!event_equivalent(&changed, &remote, &source()));
        remote["recurrence"] = Value::Null;
        assert!(remote_event_to_local(&remote, &source(), Some(&imported))
            .recurrence
            .is_none());
        remote["type"] = json!("exception");
        remote["seriesMasterId"] = json!("master");
        remote["occurrenceId"] = json!("OID.master.2026-10-23");
        remote["start"]["dateTime"] = json!("2026-10-24T09:00:00");
        let exception = remote_event_to_local(&remote, &source(), None);
        assert_eq!(
            exception.recurrence_master_id.as_deref(),
            Some("m365:cal:master")
        );
        assert_eq!(exception.recurrence_id.as_deref(), Some("2026-10-23"));
        assert!(exception.recurrence.is_none());
    }

    #[test]
    fn changing_title_preserves_body_categories_resources_and_responses() {
        let remote = online_remote();
        let mut local = remote_event_to_local(&remote, &source(), None);
        local.title = "New title".to_string();
        assert_eq!(
            update_payload(&remote, &local, &HashMap::new()).unwrap(),
            json!({"subject":"New title"})
        );
        // A legacy imported description containing the Teams boilerplate is
        // unchanged too; editing just its title must not duplicate the blob.
        local.description = html_to_plain_text(value_text(&remote["body"], "content"));
        assert_eq!(
            update_payload(&remote, &local, &HashMap::new()).unwrap(),
            json!({"subject":"New title"})
        );
    }

    #[test]
    fn description_edits_preserve_the_exact_teams_blob_and_escape_text() {
        let remote = online_remote();
        let mut local = remote_event_to_local(&remote, &source(), None);
        local.description = "Updated <agenda> & notes\nSecond line".to_string();
        let payload = update_payload(&remote, &local, &HashMap::new()).unwrap();
        let original = value_text(&remote["body"], "content");
        let block = &original[meeting_block_start(original).unwrap()..];
        assert!(value_text(&payload["body"], "content").ends_with(block));
        assert!(value_text(&payload["body"], "content")
            .contains("&lt;agenda&gt; &amp; notes<br>Second line"));
        assert_eq!(
            remote_event_description(&json!({"body":payload["body"]})),
            local.description
        );
        assert!(payload.get("isOnlineMeeting").is_none());
    }

    #[test]
    fn refuses_to_strip_an_unrecognized_blob_or_disable_an_existing_meeting() {
        let mut remote = online_remote();
        let mut local = remote_event_to_local(&remote, &source(), None);
        local.meeting.is_online_meeting = false;
        assert!(update_payload(&remote, &local, &HashMap::new())
            .unwrap_err()
            .contains("Offline"));
        local.meeting.is_online_meeting = true;
        local.description = "Changed".into();
        remote["body"]["content"] = json!("<p>Unknown meeting template</p>");
        assert!(update_payload(&remote, &local, &HashMap::new()).is_err());
    }

    #[test]
    fn occurrence_patch_never_turns_an_exception_into_a_new_series() {
        let mut remote = online_remote();
        remote["type"] = json!("exception");
        let mut local = remote_event_to_local(&remote, &source(), None);
        local.recurrence = recurrence_from_graph(
            &json!({"pattern":{"type":"daily","interval":1},"range":{"type":"noEnd"}}),
        );
        local.title = "Exception".into();
        assert_eq!(
            update_payload(&remote, &local, &HashMap::new()).unwrap(),
            json!({"subject":"Exception"})
        );
    }

    #[test]
    fn upgrade_replays_only_this_calendar_once_and_keeps_outgoing_changes() {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        conn.execute_batch("CREATE TABLE app_settings(key TEXT PRIMARY KEY, value TEXT); CREATE TABLE m365_calendar_delta_state(source_id TEXT); CREATE TABLE m365_calendar_delta_changes(source_id TEXT); CREATE TABLE calendar_sync_outbox(event_id TEXT); INSERT INTO m365_calendar_delta_state VALUES ('cal:period:old'), ('cal2:period:old'); INSERT INTO m365_calendar_delta_changes VALUES ('cal'), ('cal2'); INSERT INTO calendar_sync_outbox VALUES ('pending-edit');").unwrap();
        prepare_series_upgrade_in_db(&conn, "cal").unwrap();
        assert_eq!(
            conn.query_row(
                "SELECT count(*) FROM m365_calendar_delta_state",
                [],
                |row| row.get::<_, u32>(0)
            )
            .unwrap(),
            1
        );
        assert_eq!(
            conn.query_row("SELECT count(*) FROM calendar_sync_outbox", [], |row| row
                .get::<_, u32>(
                0
            ))
            .unwrap(),
            1
        );
        conn.execute(
            "INSERT INTO m365_calendar_delta_state VALUES ('cal:period:new')",
            [],
        )
        .unwrap();
        prepare_series_upgrade_in_db(&conn, "cal").unwrap();
        assert_eq!(
            conn.query_row(
                "SELECT count(*) FROM m365_calendar_delta_state",
                [],
                |row| row.get::<_, u32>(0)
            )
            .unwrap(),
            2
        );
    }

    fn mock_graph(
        responses: Vec<Value>,
    ) -> (String, std::thread::JoinHandle<Vec<(String, Value)>>) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        listener.set_nonblocking(true).unwrap();
        let url = format!("http://{}", listener.local_addr().unwrap());
        let handle = std::thread::spawn(move || {
            let mut requests = Vec::new();
            for response in responses {
                let deadline = Instant::now() + Duration::from_secs(10);
                let mut stream = loop {
                    match listener.accept() {
                        Ok((stream, _)) => break stream,
                        Err(error)
                            if error.kind() == ErrorKind::WouldBlock
                                && Instant::now() < deadline =>
                        {
                            std::thread::sleep(Duration::from_millis(5))
                        }
                        Err(error) => panic!("Mock Graph: {error}"),
                    }
                };
                stream
                    .set_read_timeout(Some(Duration::from_secs(5)))
                    .unwrap();
                stream.set_nonblocking(false).unwrap();
                let mut reader = BufReader::new(stream.try_clone().unwrap());
                let mut line = String::new();
                reader.read_line(&mut line).unwrap();
                let request = line.trim().to_string();
                let mut length = 0;
                loop {
                    line.clear();
                    reader.read_line(&mut line).unwrap();
                    if line == "\r\n" {
                        break;
                    }
                    if let Some(value) = line.to_ascii_lowercase().strip_prefix("content-length:") {
                        length = value.trim().parse::<usize>().unwrap();
                    }
                }
                let mut body = vec![0; length];
                reader.read_exact(&mut body).unwrap();
                requests.push((
                    request,
                    serde_json::from_slice(&body).unwrap_or(Value::Null),
                ));
                let body = response.to_string();
                write!(stream, "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}", body.len(), body).unwrap();
            }
            requests
        });
        (url, handle)
    }

    #[test]
    fn http_patch_reads_fresh_body_and_sends_only_changed_fields() {
        let remote = online_remote();
        let (url, server) = mock_graph(vec![remote.clone(), remote.clone()]);
        let mut local = remote_event_to_local(&remote, &source(), None);
        local.title = "Changed".into();
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        runtime
            .block_on(patch_event(
                "mock-token",
                &format!("{url}/events/remote"),
                &local,
                &HashMap::new(),
                false,
            ))
            .unwrap();
        let requests = server.join().unwrap();
        assert!(requests[0].0.starts_with("GET /events/remote "));
        assert!(requests[1].0.starts_with("PATCH /events/remote "));
        assert_eq!(requests[1].1, json!({"subject":"Changed"}));
    }

    #[test]
    fn http_import_reads_the_master_and_uses_original_dates_for_exceptions() {
        let mut remote = online_remote();
        remote["id"] = json!("master");
        remote["type"] = json!("seriesMaster");
        remote["recurrence"] = json!({ "pattern":{"type":"weekly","interval":1,"daysOfWeek":["friday"],"firstDayOfWeek":"monday"}, "range":{"type":"noEnd","startDate":"2026-10-09"} });
        remote["cancelledOccurrences"] = json!(["OID.master.2026-10-16"]);
        let mut exception = online_remote();
        exception["id"] = json!("exception");
        exception["occurrenceId"] = json!("OID.master.2026-10-23");
        exception["start"]["dateTime"] = json!("2026-10-24T11:00:00");
        remote["exceptionOccurrences"] = json!([exception]);
        let (url, server) = mock_graph(vec![remote]);
        let mut source = source();
        source.resource_path = url;
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        let (master, children) = runtime
            .block_on(read_master("mock-token", &source, "master"))
            .unwrap();
        let requests = server.join().unwrap();
        assert!(requests[0]
            .0
            .contains("cancelledOccurrences,exceptionOccurrences"));
        assert!(requests[0].0.contains("$expand=exceptionOccurrences"));
        let imported = remote_event_to_local(&master, &source, None);
        assert_eq!(imported.excluded_dates, vec!["2026-10-16", "2026-10-23"]);
        assert_eq!(children.len(), 1);
        let imported_child = remote_event_to_local(&children[0], &source, None);
        assert_eq!(
            imported_child.recurrence_master_id.as_deref(),
            Some("m365:cal:master")
        );
        assert_eq!(imported_child.recurrence_id.as_deref(), Some("2026-10-23"));
        assert_eq!(imported_child.starts_at, "2026-10-24T11:00:00");
        assert!(imported_child.recurrence.is_none());
    }

    #[test]
    fn http_creates_one_series_and_deletes_only_an_excluded_occurrence() {
        let (url, server) = mock_graph(vec![
            json!({"id":"master"}),
            json!({"cancelledOccurrences":[],"exceptionOccurrences":[]}),
            json!({"value":[{"id":"excluded","type":"occurrence","occurrenceId":"OID.master.2026-10-16","start":{"dateTime":"2026-10-16T09:00:00"}},{"id":"keep","type":"occurrence","occurrenceId":"OID.master.2026-10-17"}]}),
            Value::Null,
        ]);
        let mut local = event();
        local.recurrence = recurrence_from_graph(
            &json!({"pattern":{"type":"weekly","interval":1,"daysOfWeek":["friday"],"firstDayOfWeek":"monday"},"range":{"type":"numbered","numberOfOccurrences":4}}),
        );
        local.excluded_dates = vec!["2026-10-16".into()];
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        runtime
            .block_on(create_event(
                "mock-token",
                &format!("{url}/events"),
                &local,
                &HashMap::new(),
            ))
            .unwrap();
        let requests = server.join().unwrap();
        assert!(requests[0].0.starts_with("POST /events "));
        assert_eq!(
            requests[0].1["recurrence"]["pattern"]["daysOfWeek"],
            json!(["friday"])
        );
        assert_eq!(
            requests[0].1["recurrence"]["range"]["numberOfOccurrences"],
            4
        );
        assert_eq!(requests[0].1["transactionId"], "draft-id");
        assert!(requests[3].0.starts_with("DELETE /events/excluded "));
    }
}
