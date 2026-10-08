use super::*;

const PENDING_KEY: &str = "m365_calendar_category_operation_v1";
const RULES_KEY: &str = "m365_calendar_category_rules_v1";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CategoryOperation {
    pub names: Vec<String>,
    pub replacement: Option<Microsoft365CalendarCategory>,
    pub exchange: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CategoryOperationResult {
    pub local_events: usize,
    pub exchange_events: usize,
    pub category: Option<Microsoft365CalendarCategory>,
}

pub fn ensure_no_pending_operation(app: &AppHandle) -> Result<(), String> {
    if get_setting(app, PENDING_KEY)?.is_some_and(|value| !value.is_empty()) {
        return Err("Eine Kategorienänderung ist noch offen. Öffnen Sie „Kategorien verwalten“ und setzen Sie sie fort; die Kalendersynchronisierung wartet bis zum Abschluss.".into());
    }
    Ok(())
}

#[tauri::command]
pub fn get_calendar_category_operation(
    app: AppHandle,
) -> Result<Option<CategoryOperation>, String> {
    get_setting(&app, PENDING_KEY)?
        .filter(|value| !value.is_empty())
        .map(|value| serde_json::from_str(&value).map_err(|error| error.to_string()))
        .transpose()
}

#[tauri::command]
pub fn get_calendar_category_rules(app: AppHandle) -> Result<Vec<CategoryOperation>, String> {
    serde_json::from_str(&get_setting(&app, RULES_KEY)?.unwrap_or_else(|| "[]".into()))
        .map_err(|error| error.to_string())
}

pub fn allow_category_name(app: &AppHandle, name: &str) -> Result<(), String> {
    let mut rules = get_calendar_category_rules(app.clone())?;
    for rule in &mut rules {
        rule.names.retain(|old| !old.eq_ignore_ascii_case(name));
    }
    rules.retain(|rule| !rule.names.is_empty());
    set_setting(
        app,
        RULES_KEY,
        &serde_json::to_string(&rules).map_err(|error| error.to_string())?,
    )
}

pub fn reconcile_recreated_categories(
    app: &AppHandle,
    categories: &[Microsoft365CalendarCategory],
) -> Result<(), String> {
    if get_calendar_category_operation(app.clone())?.is_some() {
        return Ok(());
    }
    let rules = get_calendar_category_rules(app.clone())?;
    for category in categories {
        if rules.iter().any(|rule| {
            rule.names
                .iter()
                .any(|name| name.eq_ignore_ascii_case(&category.name))
        }) {
            // A name present in the confirmed catalogue after our deletion was
            // deliberately recreated in Outlook/Teams. Honour that new choice.
            allow_category_name(app, &category.name)?;
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn save_local_calendar_category(
    app: AppHandle,
    category: Microsoft365CalendarCategory,
) -> Result<(), String> {
    if m365_read_only_test_mode() {
        return Err("Der sichere M365-Testmodus sperrt Änderungen.".into());
    }
    let state = app.state::<crate::AppState>();
    let _guard = state.m365.calendar_sync_gate.lock().await;
    ensure_no_pending_operation(&app)?;
    if category.name.trim().is_empty() || category.name.chars().count() > 255 {
        return Err("Ungültiger Kategoriename.".into());
    }
    allow_category_name(&app, &category.name)?;
    Ok(())
}

fn transformed_categories(categories: &[Value], operation: &CategoryOperation) -> Vec<Value> {
    let mut result = Vec::new();
    for category in categories {
        let Some(name) = category.as_str() else {
            continue;
        };
        let matched = operation
            .names
            .iter()
            .any(|old| old.eq_ignore_ascii_case(name.trim()));
        let next = if matched {
            operation
                .replacement
                .as_ref()
                .map(|replacement| replacement.name.as_str())
        } else {
            Some(name)
        };
        if let Some(next) = next {
            if !result.iter().any(|value: &Value| {
                value
                    .as_str()
                    .is_some_and(|name| name.eq_ignore_ascii_case(next))
            }) {
                result.push(json!(next));
            }
        }
    }
    result
}

fn transform_remote(value: &mut Value, operation: &CategoryOperation) -> bool {
    let Some(categories) = value.get("categories").and_then(Value::as_array) else {
        return false;
    };
    let next = transformed_categories(categories, operation);
    if &next == categories {
        return false;
    }
    value["categories"] = json!(next);
    true
}

pub fn apply_category_rules(app: &AppHandle, values: &mut [Value]) -> Result<(), String> {
    let rules: Vec<CategoryOperation> =
        serde_json::from_str(&get_setting(app, RULES_KEY)?.unwrap_or_else(|| "[]".into()))
            .map_err(|error| error.to_string())?;
    for value in values {
        for rule in &rules {
            transform_remote(value, rule);
        }
    }
    Ok(())
}

fn update_local_categories(
    conn: &rusqlite::Connection,
    operation: &CategoryOperation,
    remote_categories: &HashMap<String, (String, String)>,
) -> Result<usize, String> {
    let tx = conn
        .unchecked_transaction()
        .map_err(|error| error.to_string())?;
    crate::set_audit_source(&tx, "user")?;
    let mut count = 0;
    // Include trash, so restoring an appointment cannot recreate a deleted category.
    for event in crate::read_calendar_events(&tx, false)?
        .into_iter()
        .chain(crate::read_calendar_events(&tx, true)?)
    {
        let selected = operation
            .names
            .iter()
            .any(|name| name.eq_ignore_ascii_case(event.category.trim()));
        let uncategorized = operation.replacement.is_none()
            && event.category.trim().is_empty()
            && event.color != "blue";
        if !selected && !uncategorized {
            continue;
        }
        let fallback = operation
            .replacement
            .as_ref()
            .map(|category| (category.name.as_str(), category.color.as_str()))
            .unwrap_or(("", "blue"));
        let (name, color) = remote_categories
            .get(&event.id)
            .map(|(name, color)| (name.as_str(), color.as_str()))
            .unwrap_or(fallback);
        tx.execute("UPDATE calendar_events SET event_json = json_set(event_json, '$.category', ?1, '$.color', ?2) WHERE id = ?3",
            params![name, color, event.id]).map_err(|error| error.to_string())?;
        count += usize::from(event.deleted_at.is_none());
        // Preserve pending full edits/deletions. Unlinked events will be exported normally.
        if operation.exchange && event.id.starts_with("m365:") {
            // The remote category PATCH is already confirmed. Do not replace its
            // remaining categories with the app's single display category.
            tx.execute(
                "DELETE FROM calendar_sync_outbox WHERE event_id = ?1 AND action = 'category'",
                [&event.id],
            )
            .map_err(|error| error.to_string())?;
        } else if event.deleted_at.is_none() {
            tx.execute("INSERT INTO calendar_sync_outbox(event_id, action, queued_at, attempts, last_error)
                        VALUES (?1, 'category', ?2, 0, NULL) ON CONFLICT(event_id) DO NOTHING",
                params![event.id, Utc::now().to_rfc3339()]).map_err(|error| error.to_string())?;
        }
    }
    let buffered = {
        let mut stmt = tx.prepare("SELECT source_id, remote_id, payload_json FROM m365_calendar_delta_changes WHERE payload_json IS NOT NULL")
            .map_err(|error| error.to_string())?;
        let rows = stmt
            .query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                ))
            })
            .map_err(|error| error.to_string())?;
        rows.collect::<rusqlite::Result<Vec<_>>>()
            .map_err(|error| error.to_string())?
    };
    for (source, id, payload) in buffered {
        let mut value: Value = serde_json::from_str(&payload).map_err(|error| error.to_string())?;
        if transform_remote(&mut value, operation) {
            tx.execute("UPDATE m365_calendar_delta_changes SET payload_json = ?1 WHERE source_id = ?2 AND remote_id = ?3",
                params![value.to_string(), source, id]).map_err(|error| error.to_string())?;
        }
    }
    let rules: Option<String> = tx
        .query_row(
            "SELECT value FROM app_settings WHERE key = ?1",
            [RULES_KEY],
            |row| row.get(0),
        )
        .optional()
        .map_err(|error| error.to_string())?;
    let mut rules: Vec<CategoryOperation> =
        serde_json::from_str(&rules.unwrap_or_else(|| "[]".into()))
            .map_err(|error| error.to_string())?;
    rules.push(operation.clone());
    tx.execute("INSERT INTO app_settings(key, value, updated_at) VALUES (?1, ?2, ?3)
                ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
        params![RULES_KEY, serde_json::to_string(&rules).map_err(|error| error.to_string())?, Utc::now().to_rfc3339()]).map_err(|error| error.to_string())?;
    tx.execute("DELETE FROM app_settings WHERE key = ?1", [PENDING_KEY])
        .map_err(|error| error.to_string())?;
    tx.commit().map_err(|error| error.to_string())?;
    Ok(count)
}

async fn migrate_exchange_event(
    token: &str,
    base: &str,
    event: &mut Value,
    operation: &CategoryOperation,
) -> Result<usize, String> {
    let mut changed = event.clone();
    if !transform_remote(&mut changed, operation) {
        return Ok(0);
    }
    let id = value_text(&event, "id");
    if id.is_empty() {
        return Err("Exchange hat einen Termin ohne Kennung geliefert.".into());
    }
    let url = format!("{base}/events/{}", encode_graph_path_segment(id));
    // Preserve other categories added since the catalogue scan.
    *event = graph_json(token, &format!("{url}?$select=id,categories")).await?;
    if !transform_remote(event, operation) {
        return Ok(0);
    }
    graph_write(
        token,
        reqwest::Method::PATCH,
        &url,
        &json!({"categories": event["categories"]}),
    )
    .await?;
    let confirmed = graph_json(token, &format!("{url}?$select=id,categories")).await?;
    if confirmed["categories"] != event["categories"] {
        return Err(
            "Exchange hat die geänderten Terminkategorien noch nicht bestätigt. Bitte fortsetzen."
                .into(),
        );
    }
    Ok(1)
}

fn remember_remote_category(
    categories: &mut HashMap<String, (String, String)>,
    source: &Microsoft365SyncSource,
    event: &Value,
    colours: &HashMap<String, String>,
) {
    let name = event
        .get("categories")
        .and_then(Value::as_array)
        .and_then(|values| values.first())
        .and_then(Value::as_str)
        .unwrap_or("");
    let color = if name.is_empty() {
        "blue"
    } else {
        colours
            .get(&name.to_lowercase())
            .map(String::as_str)
            .unwrap_or("gray")
    };
    categories.insert(
        format!("m365:{}:{}", source.id, value_text(event, "id")),
        (name.to_string(), color.to_string()),
    );
}

#[tauri::command]
pub async fn change_calendar_categories(
    app: AppHandle,
    mut operation: CategoryOperation,
) -> Result<CategoryOperationResult, String> {
    if m365_read_only_test_mode() {
        return Err("Der sichere M365-Testmodus sperrt Änderungen.".into());
    }
    operation.names = operation
        .names
        .into_iter()
        .map(|name| name.trim().to_string())
        .filter(|name| !name.is_empty())
        .collect();
    if operation.names.is_empty() {
        return Err("Bitte wählen Sie eine Kategorie aus.".into());
    }
    if let Some(category) = &mut operation.replacement {
        category.name = category.name.trim().to_string();
        if operation.names.len() != 1
            || category.name.is_empty()
            || category.name.chars().count() > 255
        {
            return Err(
                "Bitte geben Sie einen gültigen neuen Kategorienamen an (höchstens 255 Zeichen)."
                    .into(),
            );
        }
        if operation.names[0].eq_ignore_ascii_case(&category.name) {
            return Err("Bitte wählen Sie einen anderen Kategorienamen.".into());
        }
    }
    let state = app.state::<crate::AppState>();
    let _guard = state.m365.calendar_sync_gate.lock().await;
    if let Some(pending) = get_calendar_category_operation(app.clone())? {
        if pending != operation {
            return Err("Bitte zuerst die offene Kategorienänderung fortsetzen.".into());
        }
    }
    {
        let conn = open_db(&app)?;
        crate::checkpoint_before_destructive_change(&app, &conn)?;
    }
    let mut token = if operation.exchange {
        refreshed_access_token(&app).await?
    } else {
        String::new()
    };
    let result = async {
        let mut remote_count = 0;
        let mut remote_categories = HashMap::new();
        if operation.exchange {
            let existing = graph_collection(&token, "https://graph.microsoft.com/v1.0/me/outlook/masterCategories?$select=id,displayName,color").await?;
            if let Some(replacement) = &operation.replacement {
                let matching = existing.iter().find(|category| value_text(category, "displayName").eq_ignore_ascii_case(&replacement.name));
                // A retry may find the category created by its own previous attempt.
                if matching.is_some() && get_calendar_category_operation(app.clone())?.is_none() {
                    return Err("Eine Kategorie mit diesem Namen existiert bereits.".into());
                }
            }
            // This durable checkpoint pauses calendar writes after a partial failure.
            set_setting(&app, PENDING_KEY, &serde_json::to_string(&operation).map_err(|error| error.to_string())?)?;
            if let Some(replacement) = &operation.replacement {
                allow_category_name(&app, &replacement.name)?;
                if !existing.iter().any(|category| value_text(category, "displayName").eq_ignore_ascii_case(&replacement.name)) {
                    let original = existing.iter().find(|category| value_text(category, "displayName").eq_ignore_ascii_case(&operation.names[0]));
                    let preset = original.filter(|category| outlook_category_color(value_text(category, "color")) == replacement.color)
                        .map(|category| value_text(category, "color")).unwrap_or_else(|| dmh_category_for_calendar_color(&replacement.color).1);
                    graph_write(&token, reqwest::Method::POST, "https://graph.microsoft.com/v1.0/me/outlook/masterCategories", &json!({"displayName": replacement.name, "color": preset})).await?;
                }
            }
            let confirmed_categories = m365_master_categories(&token).await?;
            let colours = confirmed_categories.iter().map(|category| (category.name.to_lowercase(), category.color.clone())).collect::<HashMap<_, _>>();
            if let Some(replacement) = &operation.replacement {
                if !confirmed_categories.iter().any(|category| category.name == replacement.name && category.color == replacement.color) { return Err("Exchange hat die neue Kategorie noch nicht bestätigt.".into()); }
            }
            let sources = list_m365_sync_sources_filtered(app.clone(), Some(Vec::new()), false, true).await?;
            for source in sources.calendars.iter().filter(|source| !source.shared) {
                let events = graph_collection(&token, &format!("{}/events?$select=id,categories,type&$top=100", source.resource_path)).await?;
                let affected = events.iter().any(|event| event.get("categories").and_then(Value::as_array).is_some_and(|categories| transformed_categories(categories, &operation) != *categories));
                if !source.editable {
                    if affected { return Err(format!("Der Kalender „{}“ enthält die Kategorie, ist aber schreibgeschützt. Die Änderung ist noch offen.", source.name)); }
                    continue;
                }
                ensure_calendar_default_blue(&token, source).await?;
                for mut event in events {
                    if value_text(&event, "type") == "seriesMaster" {
                        let series = graph_json(&token, &format!("{}/events/{}?$select=id,categories,exceptionOccurrences&$expand=exceptionOccurrences", source.resource_path, encode_graph_path_segment(value_text(&event, "id")))).await?;
                        for exception in series.get("exceptionOccurrences").and_then(Value::as_array).into_iter().flatten() {
                            let mut exception = exception.clone();
                            remote_count += migrate_exchange_event(&token, &source.resource_path, &mut exception, &operation).await?;
                            remember_remote_category(&mut remote_categories, source, &exception, &colours);
                        }
                    }
                    remote_count += migrate_exchange_event(&token, &source.resource_path, &mut event, &operation).await?;
                    remember_remote_category(&mut remote_categories, source, &event, &colours);
                }
            }
            // Remove the old catalogue entries only after every appointment succeeded.
            for category in existing.iter().filter(|category| operation.names.iter().any(|name| name.eq_ignore_ascii_case(value_text(category, "displayName")))) {
                graph_write(&token, reqwest::Method::DELETE, &format!("https://graph.microsoft.com/v1.0/me/outlook/masterCategories/{}", encode_graph_path_segment(value_text(category, "id"))), &Value::Null).await?;
            }
            let remaining = m365_master_categories(&token).await?;
            if remaining.iter().any(|category| operation.names.iter().any(|name| name.eq_ignore_ascii_case(&category.name))) {
                return Err("Exchange hat die Löschung noch nicht bestätigt. Bitte fortsetzen.".into());
            }
        }
        let local_count = update_local_categories(&open_db(&app)?, &operation, &remote_categories)?;
        Ok(CategoryOperationResult { local_events: local_count, exchange_events: remote_count, category: operation.replacement.clone() })
    }.await;
    token.zeroize();
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    fn database() -> rusqlite::Connection {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        conn.execute_batch("CREATE TABLE calendar_events(id TEXT PRIMARY KEY, starts_at TEXT, deleted_at TEXT, event_json TEXT);
            CREATE TABLE audit_context(id INTEGER PRIMARY KEY, source TEXT); INSERT INTO audit_context VALUES(1, 'user');
            CREATE TABLE calendar_sync_outbox(event_id TEXT PRIMARY KEY, action TEXT, queued_at TEXT, attempts INTEGER, last_error TEXT);
            CREATE TABLE m365_calendar_delta_changes(source_id TEXT, remote_id TEXT, payload_json TEXT);
            CREATE TABLE app_settings(key TEXT PRIMARY KEY, value TEXT, updated_at TEXT);").unwrap();
        for (id, category, deleted) in [
            ("future", "Vortrag", None),
            ("past", "vOrTrAg", None),
            ("trash", "Vortrag", Some("deleted")),
            ("other", "Andere", None),
            ("empty", "", None),
        ] {
            let event = json!({"id":id,"title":"Titel erhalten","startsAt":"2035-01-01T10:00:00","endsAt":"2035-01-01T11:00:00","location":"Ort","description":"Inhalt","source":"Test","category":category,"color":"green","updatedAt":"unchanged","deletedAt":deleted});
            conn.execute(
                "INSERT INTO calendar_events VALUES(?1, '2035', ?2, ?3)",
                params![id, deleted, event.to_string()],
            )
            .unwrap();
        }
        conn.execute(
            "INSERT INTO calendar_sync_outbox VALUES('past', 'upsert', 'old', 2, 'retry')",
            [],
        )
        .unwrap();
        conn.execute("INSERT INTO m365_calendar_delta_changes VALUES('calendar', 'remote', ?1)", [json!({"id":"remote", "categories":["Vortrag", "Andere"], "subject":"Inhalt behalten"}).to_string()]).unwrap();
        conn.execute(
            "INSERT INTO app_settings VALUES(?1, 'pending', 'now')",
            [PENDING_KEY],
        )
        .unwrap();
        conn
    }

    fn deletion() -> CategoryOperation {
        CategoryOperation {
            names: vec!["Vortrag".into()],
            replacement: None,
            exchange: false,
        }
    }

    #[test]
    fn deletion_updates_every_period_and_trash_preserving_content_and_pending_edits() {
        let conn = database();
        assert_eq!(
            update_local_categories(&conn, &deletion(), &HashMap::new()).unwrap(),
            3
        );
        for id in ["future", "past", "trash", "empty"] {
            let event: Value = serde_json::from_str(
                &conn
                    .query_row(
                        "SELECT event_json FROM calendar_events WHERE id = ?1",
                        [id],
                        |row| row.get::<_, String>(0),
                    )
                    .unwrap(),
            )
            .unwrap();
            assert_eq!(event["category"], "");
            assert_eq!(event["color"], "blue");
            assert_eq!(event["title"], "Titel erhalten");
            assert_eq!(event["updatedAt"], "unchanged");
            assert_eq!(event["startsAt"], "2035-01-01T10:00:00");
        }
        assert_eq!(
            conn.query_row(
                "SELECT action FROM calendar_sync_outbox WHERE event_id='past'",
                [],
                |row| row.get::<_, String>(0)
            )
            .unwrap(),
            "upsert"
        );
        assert_eq!(
            conn.query_row(
                "SELECT count(*) FROM calendar_sync_outbox WHERE event_id='trash'",
                [],
                |row| row.get::<_, usize>(0)
            )
            .unwrap(),
            0
        );
        let buffered: Value = serde_json::from_str(
            &conn
                .query_row(
                    "SELECT payload_json FROM m365_calendar_delta_changes",
                    [],
                    |row| row.get::<_, String>(0),
                )
                .unwrap(),
        )
        .unwrap();
        assert_eq!(buffered["categories"], json!(["Andere"]));
        assert_eq!(buffered["subject"], "Inhalt behalten");
        assert_eq!(
            conn.query_row(
                "SELECT count(*) FROM app_settings WHERE key=?1",
                [PENDING_KEY],
                |row| row.get::<_, usize>(0)
            )
            .unwrap(),
            0
        );
    }

    #[test]
    fn rename_preserves_other_categories_and_is_idempotent() {
        let operation = CategoryOperation {
            replacement: Some(Microsoft365CalendarCategory {
                name: "Sitzung".into(),
                color: "green".into(),
            }),
            ..deletion()
        };
        let before = json!(["Vortrag", "Andere", "Sitzung"]);
        let once = transformed_categories(before.as_array().unwrap(), &operation);
        assert_eq!(once, vec![json!("Sitzung"), json!("Andere")]);
        assert_eq!(transformed_categories(&once, &operation), once);
        let conn = database();
        assert_eq!(
            update_local_categories(&conn, &operation, &HashMap::new()).unwrap(),
            2
        );
        assert_eq!(
            crate::read_calendar_events(&conn, false)
                .unwrap()
                .iter()
                .find(|event| event.id == "future")
                .unwrap()
                .category,
            "Sitzung"
        );
    }

    #[test]
    fn failure_rolls_back_local_changes_and_retains_pending_operation() {
        let conn = database();
        conn.execute(
            "UPDATE m365_calendar_delta_changes SET payload_json='broken'",
            [],
        )
        .unwrap();
        assert!(update_local_categories(&conn, &deletion(), &HashMap::new()).is_err());
        assert_eq!(
            crate::read_calendar_events(&conn, false)
                .unwrap()
                .iter()
                .find(|event| event.id == "future")
                .unwrap()
                .category,
            "Vortrag"
        );
        assert_eq!(
            conn.query_row(
                "SELECT value FROM app_settings WHERE key=?1",
                [PENDING_KEY],
                |row| row.get::<_, String>(0)
            )
            .unwrap(),
            "pending"
        );
    }

    #[test]
    fn deleting_primary_category_keeps_remaining_exchange_category_in_app() {
        let conn = database();
        conn.execute("UPDATE calendar_events SET id='m365:calendar:remote', event_json=json_set(event_json,'$.id','m365:calendar:remote') WHERE id='future'", []).unwrap();
        conn.execute("INSERT INTO calendar_sync_outbox VALUES('m365:calendar:remote', 'category', 'old', 0, NULL)", []).unwrap();
        let operation = CategoryOperation {
            exchange: true,
            ..deletion()
        };
        update_local_categories(
            &conn,
            &operation,
            &HashMap::from([(
                "m365:calendar:remote".into(),
                ("Andere".into(), "purple".into()),
            )]),
        )
        .unwrap();
        let event = crate::read_calendar_events(&conn, false)
            .unwrap()
            .into_iter()
            .find(|event| event.id == "m365:calendar:remote")
            .unwrap();
        assert_eq!(
            (event.category.as_str(), event.color.as_str()),
            ("Andere", "purple")
        );
        assert_eq!(
            conn.query_row(
                "SELECT count(*) FROM calendar_sync_outbox WHERE event_id='m365:calendar:remote'",
                [],
                |row| row.get::<_, usize>(0)
            )
            .unwrap(),
            0
        );
    }
}
