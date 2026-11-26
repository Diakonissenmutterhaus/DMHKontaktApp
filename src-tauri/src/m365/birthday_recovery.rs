//! Birthday backfill is deliberately separate from contact upserts. It can only
//! fill an existing contact, never POST a contact or touch a calendar event.
use super::*;
use crate::contact_birthdays::{self as birthdays, SourceContact, SourceSnapshot};
use rusqlite::OptionalExtension;
use sha2::{Digest, Sha256};

#[derive(Default, Serialize, Deserialize)]
struct Checkpoint {
    profile: String,
    #[serde(default)]
    snapshot: Option<SourceSnapshot>,
    #[serde(default)]
    completed: HashSet<String>,
    #[serde(default)]
    last_scan: i64,
    #[serde(default)]
    last_attempt: i64,
    #[serde(default)]
    last_report: String,
    #[serde(default)]
    finished: bool,
}

fn save(app: &AppHandle, key: &str, state: &Checkpoint) -> Result<(), String> {
    save_checkpoint(&crate::open_db(app)?, key, state)
}

fn save_checkpoint(
    conn: &rusqlite::Connection,
    key: &str,
    state: &Checkpoint,
) -> Result<(), String> {
    conn.execute("INSERT INTO app_settings(key,value,updated_at) VALUES(?1,?2,?3) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at",
        rusqlite::params![key,serde_json::to_string(state).map_err(|e|e.to_string())?,crate::now()]).map_err(|e|e.to_string())?;
    Ok(())
}

fn report(
    app: &AppHandle,
    email: &str,
    profile: &str,
    message: &str,
    pending: bool,
) -> Result<(), String> {
    let id = uuid::Uuid::new_v4().to_string();
    let event = serde_json::from_value(serde_json::json!({
        "eventId":id,"attemptId":id,"sequence":1,"procedure":"diagnostics",
        "status":if pending {"error"} else {"success"},"accountEmail":email,
        "step":"Kontakt-Geburtstage wiederherstellen","message":message,"profile":profile,
        "diagnostic":{"code":"DMH-CONTACT-BIRTHDAYS","text":message}
    }))
    .map_err(|e| e.to_string())?;
    crate::procedure_reports::record_procedure_report(app.clone(), event)
}

fn local_contacts(app: &AppHandle) -> Result<Vec<(i64, SourceContact)>, String> {
    let conn = crate::open_db(app)?;
    let mut statement=conn.prepare("SELECT id,coalesce(outlook_entry_id,''),coalesce(outlook_store_id,''),display_name,email,private_email,second_private_email,phone,mobile_phone,private_phone,second_private_phone,birthday FROM contacts WHERE deleted_at IS NULL").map_err(|e|e.to_string())?;
    let values = statement
        .query_map([], |row| {
            Ok((
                row.get(0)?,
                SourceContact {
                    entry_id: row.get(1)?,
                    store_id: row.get(2)?,
                    display_name: row.get(3)?,
                    emails: (4..=6)
                        .map(|i| row.get::<_, String>(i))
                        .collect::<Result<Vec<_>, _>>()?
                        .into_iter()
                        .filter(|v| !v.trim().is_empty())
                        .collect(),
                    phones: (7..=10)
                        .map(|i| row.get::<_, String>(i))
                        .collect::<Result<Vec<_>, _>>()?,
                    birthday: row.get(11)?,
                },
            ))
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(values)
}

fn remote_identity(remote: &Value, source: &str) -> SourceContact {
    let mut phones = Vec::new();
    for field in ["homePhones", "businessPhones"] {
        phones.extend(
            remote
                .get(field)
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
                .filter_map(Value::as_str)
                .map(str::to_string),
        );
    }
    phones.push(value_text(remote, "mobilePhone").into());
    SourceContact {
        entry_id: value_text(remote, "id").into(),
        store_id: source.into(),
        display_name: value_text(remote, "displayName").into(),
        emails: remote
            .get("emailAddresses")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .filter_map(|v| v.get("address").and_then(Value::as_str))
            .filter(|v| !v.trim().is_empty())
            .map(str::to_string)
            .collect(),
        phones,
        birthday: value_text(remote, "birthday").into(),
    }
}

fn fill_local(conn: &rusqlite::Connection, id: i64, birthday: &str) -> Result<usize, String> {
    let date = birthdays::normalize(birthday);
    if date.is_empty() {
        return Ok(0);
    }
    // The backup_contacts_update trigger archives this change. Keep the general
    // timestamp so old names/phones are not made newer than their Exchange copy.
    conn.execute(
        "UPDATE contacts SET birthday=?1 WHERE id=?2 AND birthday='' AND deleted_at IS NULL",
        rusqlite::params![date, id],
    )
    .map_err(|e| e.to_string())
}

// Reimports can fill a local date without putting the whole contact in the
// regular upsert queue. Send just that field through its established link.
// This also covers contacts whose migration pre-dates the recovery checkpoint.
pub(super) async fn sync_linked(
    app: &AppHandle,
    identity: &(String, String),
    token: &str,
    locals: &[crate::Contact],
    sources: &[Microsoft365SyncSource],
    remote: &HashMap<String, Vec<Value>>,
    links: &HashMap<String, HashMap<i64, String>>,
) -> Result<usize, String> {
    let by_id = locals
        .iter()
        .filter_map(|contact| contact.id.map(|id| (id, contact)))
        .collect::<HashMap<_, _>>();
    let mut updated = 0;
    for source in sources.iter().filter(|source| !source.shared) {
        let Some(source_links) = links.get(&source.id) else {
            continue;
        };
        let remote_by_id = remote
            .get(&source.id)
            .into_iter()
            .flatten()
            .map(|value| (value_text(value, "id"), value))
            .collect::<HashMap<_, _>>();
        for (local_id, remote_id) in source_links {
            if updated >= 100 {
                return Ok(updated);
            }
            let Some(local) = by_id
                .get(local_id)
                .filter(|local| local.deleted_at.is_none())
            else {
                continue;
            };
            let Some(birthday) = birthdays::graph_value(&local.birthday) else {
                continue;
            };
            let Some(remote) = remote_by_id.get(remote_id.as_str()) else {
                continue;
            };
            if !value_text(remote, "birthday").is_empty() {
                continue;
            }
            if &outlook_profile_identity(app)? != identity {
                return Err(
                    "Microsoft-365-Konto wurde während der Geburtstagsübertragung gewechselt."
                        .into(),
                );
            }
            let url = format!(
                "{}/{}",
                source.resource_path,
                encode_graph_path_segment(remote_id)
            );
            graph_write(
                token,
                reqwest::Method::PATCH,
                &url,
                &serde_json::json!({"birthday":birthday}),
            )
            .await?;
            updated += 1;
        }
    }
    Ok(updated)
}

pub(super) async fn run(
    app: &AppHandle,
    expected_identity: &(String, String),
    token: &str,
    sources: &[Microsoft365SyncSource],
    remote: &HashMap<String, Vec<Value>>,
    links: &HashMap<String, HashMap<i64, String>>,
) -> Result<usize, String> {
    let identity = outlook_profile_identity(app)?;
    if &identity != expected_identity {
        return Err(
            "Microsoft-365-Konto wurde gewechselt; Geburtstagswiederherstellung angehalten.".into(),
        );
    }
    let Some(profile) =
        crate::outlook_exchange::birthday_recovery_profile(app, &identity.0, &identity.1)?
    else {
        return Ok(0);
    };
    let key = format!(
        "m365_contact_birthday_recovery_v1_{:x}",
        Sha256::digest(format!("{}\n{}", identity.0, profile).as_bytes())
    );
    let raw: Option<String> = crate::open_db(app)?
        .query_row(
            "SELECT value FROM app_settings WHERE key=?1",
            [&key],
            |row| row.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    let mut state: Checkpoint = raw
        .map(|raw| serde_json::from_str(&raw).map_err(|e| e.to_string()))
        .transpose()?
        .unwrap_or_else(|| Checkpoint {
            profile: profile.clone(),
            ..Default::default()
        });
    let timestamp = chrono::Utc::now().timestamp();
    // Finished scans cost only a small settings lookup. Pending work is retried
    // every 15 minutes; inaccessible old stores at most once per day.
    if state.finished {
        return Ok(0);
    }
    if timestamp.saturating_sub(state.last_attempt) < 15 * 60 {
        return Ok(0);
    }
    state.last_attempt = timestamp;
    save(app, &key, &state)?;
    if state.snapshot.is_none()
        || state.snapshot.as_ref().is_some_and(|s| {
            !s.errors.is_empty() && timestamp.saturating_sub(state.last_scan) >= 86400
        })
    {
        if state.snapshot.is_none() && timestamp.saturating_sub(state.last_scan) < 3600 {
            return Ok(0);
        }
        state.last_scan = timestamp;
        save(app, &key, &state)?;
        match crate::outlook_exchange::read_contact_birthdays(app, &profile).await {
            Ok(snapshot) => {
                state.snapshot = Some(snapshot);
                save(app, &key, &state)?;
            }
            Err(error) => {
                let message = format!("Geburtstage noch nicht wiederhergestellt: {error}");
                if state.last_report != message {
                    report(app, &identity.1, &profile, &message, true)?;
                    state.last_report = message;
                    save(app, &key, &state)?;
                }
                return Ok(0);
            }
        }
    }
    if identity != outlook_profile_identity(app)? {
        return Err(
            "Das Microsoft-365-Konto wurde während der Wiederherstellung gewechselt.".into(),
        );
    }
    let snapshot = state.snapshot.as_ref().unwrap();
    let pending = snapshot
        .contacts
        .iter()
        .filter(|source| !state.completed.contains(&source.key()))
        .cloned()
        .collect::<Vec<_>>();
    let scan_errors = snapshot.errors.clone();
    let local = local_contacts(app)?;
    let local_identities = local
        .iter()
        .map(|(_, value)| value.clone())
        .collect::<Vec<_>>();
    let local_targets = birthdays::assignments(&pending, &local_identities);
    let mut effective = pending.clone();
    let mut targets = Vec::new();
    let mut urls = Vec::new();
    for source in sources.iter().filter(|source| !source.shared) {
        for value in remote.get(&source.id).into_iter().flatten() {
            if value_text(value, "id").is_empty() {
                continue;
            }
            targets.push(remote_identity(value, &source.id));
            urls.push(format!(
                "{}/{}",
                source.resource_path,
                encode_graph_path_segment(value_text(value, "id"))
            ));
        }
    }
    let target_indexes = targets
        .iter()
        .enumerate()
        .map(|(index, target)| ((target.store_id.clone(), target.entry_id.clone()), index))
        .collect::<HashMap<_, _>>();
    for (index, local_index) in local_targets.iter().enumerate() {
        if let Some(local_index) = local_index {
            let (local_id, local_contact) = &local[*local_index];
            let saved_date = birthdays::normalize(&local_contact.birthday);
            if !saved_date.is_empty() {
                effective[index].birthday = saved_date;
            }
            let linked = links
                .iter()
                .filter_map(|(source_id, by_local)| {
                    by_local.get(local_id).and_then(|remote_id| {
                        target_indexes.get(&(source_id.clone(), remote_id.clone()))
                    })
                })
                .collect::<Vec<_>>();
            if linked.len() == 1 {
                effective[index].entry_id = targets[*linked[0]].entry_id.clone();
                effective[index].store_id = targets[*linked[0]].store_id.clone();
            }
        }
    }
    let choices = birthdays::assignments(&effective, &targets);
    let conn = crate::open_db(app)?;
    for (source, local_index) in pending.iter().zip(&local_targets) {
        if let Some(index) = local_index {
            fill_local(&conn, local[*index].0, &source.birthday)?;
        }
    }
    drop(conn);
    let mut updated = 0;
    let mut processed = 0;
    let mut failures = Vec::new();
    for (index, target) in choices.into_iter().enumerate() {
        let Some(target) = target else {
            continue;
        };
        if processed >= 100 {
            break;
        }
        processed += 1;
        if identity != outlook_profile_identity(app)? {
            return Err(
                "Microsoft-365-Konto wurde gewechselt; Geburtstagswiederherstellung angehalten."
                    .into(),
            );
        }
        let body = serde_json::json!({"birthday":birthdays::graph_value(&effective[index].birthday).ok_or("Ungültiger Geburtstag.")?});
        match graph_write(token, reqwest::Method::PATCH, &urls[target], &body).await {
            Ok(_) => {
                state.completed.insert(pending[index].key());
                updated += 1;
                // A crash before the checkpoint can safely repeat this operation.
            }
            Err(error) => failures.push(error),
        }
    }
    let unresolved = state
        .snapshot
        .as_ref()
        .unwrap()
        .contacts
        .iter()
        .filter(|source| !state.completed.contains(&source.key()))
        .count();
    let message=format!("Geburtstage: {} von {} bestehenden Kontakten abgeglichen; {} offen (fehlende/mehrdeutige Zuordnung oder erneut zu versuchen). Quelle unverändert. {} {}",
        state.completed.len(),state.snapshot.as_ref().unwrap().contacts.len(),unresolved,scan_errors.join(" · "),failures.into_iter().take(3).collect::<Vec<_>>().join(" · "));
    if state.last_report != message {
        report(
            app,
            &identity.1,
            &profile,
            &message,
            unresolved > 0 || !scan_errors.is_empty(),
        )?;
        state.last_report = message;
    }
    state.finished = unresolved == 0 && scan_errors.is_empty();
    if state.finished {
        // No reason to keep a second address book or parse it on every sync.
        state.snapshot = None;
        state.completed.clear();
    }
    save(app, &key, &state)?;
    Ok(updated)
}

pub(super) fn report_error(app: &AppHandle, error: &str) {
    let identity = outlook_profile_identity(app).ok();
    let message = format!("Geburtstagswiederherstellung noch offen: {error}");
    let key = "m365_contact_birthday_recovery_last_error";
    if let Ok(conn) = crate::open_db(app) {
        let previous: Option<String> = conn
            .query_row(
                "SELECT value FROM app_settings WHERE key=?1",
                [key],
                |row| row.get(0),
            )
            .optional()
            .ok()
            .flatten();
        if previous.as_deref() == Some(&message) {
            return;
        }
        if report(
            app,
            identity.as_ref().map(|v| v.1.as_str()).unwrap_or(""),
            "",
            &message,
            true,
        )
        .is_ok()
        {
            let _=conn.execute("INSERT INTO app_settings(key,value,updated_at) VALUES(?1,?2,?3) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at",rusqlite::params![key,message,crate::now()]);
        }
        return;
    }
    let _ = report(
        app,
        identity.as_ref().map(|v| v.1.as_str()).unwrap_or(""),
        "",
        &message,
        true,
    );
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn recovery_checkpoint_survives_restart_with_real_settings_schema() {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        conn.execute_batch("CREATE TABLE app_settings(key TEXT PRIMARY KEY,value TEXT NOT NULL,updated_at TEXT NOT NULL);").unwrap();
        let mut state = Checkpoint {
            profile: "Profile IMAP".into(),
            last_attempt: 123,
            last_scan: 120,
            ..Default::default()
        };
        state.completed.insert("existing-contact".into());
        save_checkpoint(&conn, "recovery-test", &state).unwrap();
        let raw: String = conn
            .query_row(
                "SELECT value FROM app_settings WHERE key='recovery-test'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        let mut restored: Checkpoint = serde_json::from_str(&raw).unwrap();
        assert!(restored.completed.contains("existing-contact"));
        assert_eq!(restored.last_attempt, 123);
        restored.finished = true;
        save_checkpoint(&conn, "recovery-test", &restored).unwrap();
        assert_eq!(
            conn.query_row("SELECT COUNT(*) FROM app_settings", [], |r| r
                .get::<_, i64>(0))
                .unwrap(),
            1
        );
        assert!(!conn
            .query_row("SELECT updated_at FROM app_settings", [], |r| r
                .get::<_, String>(0))
            .unwrap()
            .is_empty());
    }
    #[test]
    fn local_recovery_never_inserts_overwrites_or_revives_deleted_contacts() {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        conn.execute_batch("CREATE TABLE contacts(id INTEGER PRIMARY KEY,birthday TEXT NOT NULL DEFAULT '',deleted_at TEXT);
            INSERT INTO contacts VALUES(1,'',NULL),(2,'1980-03-04',NULL),(3,'','2026-01-01');").unwrap();
        assert_eq!(fill_local(&conn, 1, "1970-02-28").unwrap(), 1);
        assert_eq!(fill_local(&conn, 1, "1999-01-01").unwrap(), 0);
        assert_eq!(fill_local(&conn, 2, "1999-01-01").unwrap(), 0);
        assert_eq!(fill_local(&conn, 3, "1999-01-01").unwrap(), 0);
        assert_eq!(fill_local(&conn, 4, "1999-01-01").unwrap(), 0);
        assert_eq!(
            conn.query_row("SELECT COUNT(*) FROM contacts", [], |r| r.get::<_, i64>(0))
                .unwrap(),
            3
        );
        assert_eq!(
            conn.query_row("SELECT birthday FROM contacts WHERE id=2", [], |r| r
                .get::<_, String>(0))
                .unwrap(),
            "1980-03-04"
        );
    }
}
