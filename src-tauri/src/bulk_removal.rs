use crate::*;

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct Filter {
    pub kind: String,
    pub search: String,
    pub exact: bool,
    pub source: String,
    pub category: String,
    pub from_date: String,
    pub to_date: String,
    pub company: String,
    pub group: String,
    pub sort: String,
    pub descending: bool,
    pub offset: usize,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Selection {
    filter: Filter,
    all_matching: bool,
    ids: Vec<String>,
    excluded_ids: Vec<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Item {
    id: String,
    title: String,
    start: String,
    end: String,
    source: String,
    category: String,
    email: String,
    company: String,
    groups: String,
    series: bool,
}

#[derive(Serialize)]
pub struct PageResult {
    items: Vec<Item>,
    total: usize,
    sources: Vec<String>,
    categories: Vec<String>,
    companies: Vec<String>,
    groups: Vec<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Preview {
    selected: usize,
    affected: usize,
    series: usize,
    revision: String,
}

fn is_calendar(filter: &Filter) -> Result<bool, String> {
    match filter.kind.as_str() {
        "calendar" => Ok(true),
        "contacts" => Ok(false),
        _ => Err("Bitte Kalender oder Kontakte wählen.".into()),
    }
}

// Values are bound parameters. A typed % or _ is literal text, never a wildcard.
fn predicate(filter: &Filter) -> Result<(String, Vec<rusqlite::types::Value>), String> {
    let calendar = is_calendar(filter)?;
    let mut terms = vec!["deleted_at IS NULL".to_string()];
    let mut args = Vec::new();
    let mut add = |expression: &str, value: &str, exact: bool| {
        if value.trim().is_empty() {
            return;
        }
        if exact {
            terms.push(format!("COALESCE({expression},'') = ? COLLATE NOCASE"));
            args.push(value.trim().to_string().into());
        } else {
            terms.push(format!(
                "COALESCE({expression},'') LIKE ? ESCAPE '\\' COLLATE NOCASE"
            ));
            args.push(
                format!(
                    "%{}%",
                    value
                        .trim()
                        .replace('\\', "\\\\")
                        .replace('%', "\\%")
                        .replace('_', "\\_")
                )
                .into(),
            );
        }
    };
    if calendar {
        add(
            "json_extract(event_json,'$.title')",
            &filter.search,
            filter.exact,
        );
        add("json_extract(event_json,'$.source')", &filter.source, true);
        add(
            "json_extract(event_json,'$.category')",
            &filter.category,
            true,
        );
    } else {
        let search = if filter.exact {
            "display_name"
        } else {
            "display_name || ' ' || first_name || ' ' || last_name || ' ' || email || ' ' || company || ' ' || city || ' ' || phone || ' ' || mobile_phone"
        };
        add(search, &filter.search, filter.exact);
        add("company", &filter.company, true);
        if !filter.group.is_empty() {
            terms.push("EXISTS(SELECT 1 FROM contact_groups cg JOIN groups g ON g.id=cg.group_id WHERE cg.contact_id=contacts.id AND g.deleted_at IS NULL AND g.name=? COLLATE NOCASE)".into());
            args.push(filter.group.clone().into());
        }
    }
    if calendar {
        for (date, operator) in [(&filter.from_date, ">="), (&filter.to_date, "<=")] {
            if !date.is_empty() {
                chrono::NaiveDate::parse_from_str(date, "%Y-%m-%d")
                    .map_err(|_| "Bitte ein gültiges Datum wählen.".to_string())?;
                terms.push(format!("substr(starts_at,1,10) {operator} ?"));
                args.push(date.clone().into());
            }
        }
        if !filter.from_date.is_empty()
            && !filter.to_date.is_empty()
            && filter.from_date > filter.to_date
        {
            return Err("Das Enddatum muss nach dem Anfangsdatum liegen.".into());
        }
    }
    Ok((terms.join(" AND "), args))
}

fn distinct(conn: &Connection, table: &str, field: &str) -> Result<Vec<String>, String> {
    let sql = format!("SELECT DISTINCT COALESCE({field},'') FROM {table} WHERE deleted_at IS NULL ORDER BY 1 COLLATE NOCASE");
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let values = stmt
        .query_map([], |r| r.get::<_, String>(0))
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(values
        .into_iter()
        .filter(|value| !value.trim().is_empty())
        .collect())
}

fn query_page(conn: &Connection, filter: &Filter) -> Result<PageResult, String> {
    let calendar = is_calendar(filter)?;
    let table = if calendar {
        "calendar_events"
    } else {
        "contacts"
    };
    let (where_sql, args) = predicate(filter)?;
    let total = conn
        .query_row(
            &format!("SELECT count(*) FROM {table} WHERE {where_sql}"),
            params_from_iter(args.iter()),
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;
    let sort = match (calendar, filter.sort.as_str()) {
        (true, "start") => "starts_at",
        (true, "source") => "json_extract(event_json,'$.source')",
        (true, "category") => "json_extract(event_json,'$.category')",
        (true, _) => "json_extract(event_json,'$.title')",
        (false, "email") => "email",
        (false, "company") => "company",
        (false, _) => "display_name",
    };
    let columns = if calendar {
        "id, COALESCE(json_extract(event_json,'$.title'),''), starts_at, COALESCE(json_extract(event_json,'$.endsAt'),''), COALESCE(json_extract(event_json,'$.source'),''), COALESCE(json_extract(event_json,'$.category'),''), '', '', '', json_extract(event_json,'$.recurrence') IS NOT NULL AND json_extract(event_json,'$.recurrence') != 'null'"
    } else {
        "CAST(id AS TEXT), display_name, '', '', '', '', email, company, COALESCE((SELECT group_concat(g.name, ', ') FROM contact_groups cg JOIN groups g ON g.id=cg.group_id WHERE cg.contact_id=contacts.id AND g.deleted_at IS NULL),''), 0"
    };
    let sql = format!("SELECT {columns} FROM {table} WHERE {where_sql} ORDER BY {sort} COLLATE NOCASE {},id LIMIT 100 OFFSET {}", if filter.descending {"DESC"} else {"ASC"}, filter.offset);
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let items = stmt
        .query_map(params_from_iter(args.iter()), |r| {
            Ok(Item {
                id: r.get(0)?,
                title: r.get(1)?,
                start: r.get(2)?,
                end: r.get(3)?,
                source: r.get(4)?,
                category: r.get(5)?,
                email: r.get(6)?,
                company: r.get(7)?,
                groups: r.get(8)?,
                series: r.get(9)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(PageResult {
        items,
        total,
        sources: if calendar {
            distinct(conn, table, "json_extract(event_json,'$.source')")?
        } else {
            vec![]
        },
        categories: if calendar {
            distinct(conn, table, "json_extract(event_json,'$.category')")?
        } else {
            vec![]
        },
        companies: if !calendar {
            distinct(conn, table, "company")?
        } else {
            vec![]
        },
        groups: if !calendar {
            distinct(conn, "groups", "name")?
        } else {
            vec![]
        },
    })
}

struct Plan {
    roots: Vec<String>,
    affected: BTreeMap<String, String>,
    series: usize,
}
fn plan(conn: &Connection, selection: &Selection) -> Result<Plan, String> {
    let calendar = is_calendar(&selection.filter)?;
    let table = if calendar {
        "calendar_events"
    } else {
        "contacts"
    };
    let (where_sql, args) = if selection.all_matching {
        predicate(&selection.filter)?
    } else {
        ("deleted_at IS NULL".into(), vec![])
    };
    let selected: HashSet<_> = selection.ids.iter().collect();
    let excluded: HashSet<_> = selection.excluded_ids.iter().collect();
    let mut stmt = conn
        .prepare(&format!(
            "SELECT CAST(id AS TEXT), {} FROM {table} WHERE {where_sql}",
            if calendar {
                "event_json || updated_at"
            } else {
                "updated_at"
            }
        ))
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params_from_iter(args.iter()), |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
        })
        .map_err(|e| e.to_string())?;
    let mut affected = BTreeMap::new();
    for row in rows {
        let (id, version) = row.map_err(|e| e.to_string())?;
        if (selection.all_matching && !excluded.contains(&id))
            || (!selection.all_matching && selected.contains(&id))
        {
            affected.insert(id, version);
        }
    }
    let mut roots = affected.keys().cloned().collect::<Vec<_>>();
    let mut masters = HashSet::new();
    let mut series = 0;
    if calendar {
        let mut descendants = conn.prepare("WITH RECURSIVE children(id) AS (SELECT id FROM calendar_events WHERE deleted_at IS NULL AND json_extract(event_json,'$.recurrenceMasterId')=?1 UNION SELECT e.id FROM calendar_events e JOIN children c ON json_extract(e.event_json,'$.recurrenceMasterId')=c.id WHERE e.deleted_at IS NULL) SELECT e.id,e.event_json || e.updated_at FROM calendar_events e JOIN children c ON e.id=c.id").map_err(|e|e.to_string())?;
        for id in &roots {
            let recurring: bool = conn.query_row("SELECT json_extract(event_json,'$.recurrence') IS NOT NULL AND json_extract(event_json,'$.recurrence')!='null' FROM calendar_events WHERE id=?", [id], |r|r.get(0)).map_err(|e|e.to_string())?;
            if recurring {
                series += 1;
                masters.insert(id.clone());
                for row in descendants
                    .query_map([id], |r| {
                        Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
                    })
                    .map_err(|e| e.to_string())?
                {
                    let (id, version) = row.map_err(|e| e.to_string())?;
                    affected.insert(id, version);
                }
            }
        }
    }
    // Masters first: the existing deletion helper clears exception outboxes,
    // so selecting both a series and its exception does not enqueue two deletes.
    roots.sort_by_key(|id| !masters.contains(id));
    Ok(Plan {
        roots,
        affected,
        series,
    })
}

fn revision(plan: &Plan) -> String {
    let mut hash = Sha256::new();
    for (id, version) in &plan.affected {
        hash.update((id.len() as u64).to_le_bytes());
        hash.update(id.as_bytes());
        hash.update((version.len() as u64).to_le_bytes());
        hash.update(version.as_bytes());
    }
    format!("{:x}", hash.finalize())
}

#[tauri::command]
pub fn list_edv_bulk_items(app: AppHandle, filter: Filter) -> Result<PageResult, String> {
    diagnostics::require_edv(&app)?;
    query_page(&open_db(&app)?, &filter)
}

#[tauri::command]
pub fn preview_edv_bulk_removal(app: AppHandle, selection: Selection) -> Result<Preview, String> {
    diagnostics::require_edv(&app)?;
    let plan = plan(&open_db(&app)?, &selection)?;
    Ok(Preview {
        selected: plan.roots.len(),
        affected: plan.affected.len(),
        series: plan.series,
        revision: revision(&plan),
    })
}

fn execute_in_db(
    conn: &Connection,
    selection: &Selection,
    expected_revision: &str,
) -> Result<usize, String> {
    let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
    let plan = plan(&tx, selection)?;
    if revision(&plan) != expected_revision {
        return Err("Die Auswahl wurde inzwischen geändert. Bitte die Liste aktualisieren und die Löschung erneut prüfen.".into());
    }
    set_audit_source(&tx, "user")?;
    let removed = if is_calendar(&selection.filter)? {
        // Reuse series/exception handling and the durable Exchange deletion queue.
        move_calendar_events_to_trash_in_transaction(&tx, &plan.roots, true)?
    } else {
        let timestamp = now();
        let mut changed = 0;
        for id in &plan.roots {
            let id: i64 = id.parse().map_err(|_| "Ungültiger Kontakt.".to_string())?;
            changed += tx.execute("UPDATE contacts SET deleted_at=?1, updated_at=?1 WHERE id=?2 AND deleted_at IS NULL",params![timestamp,id]).map_err(|e|e.to_string())?;
            queue_contact_sync_in_transaction(&tx, id, "delete")?;
        }
        changed
    };
    tx.commit().map_err(|e| e.to_string())?;
    Ok(removed)
}

#[tauri::command]
pub async fn execute_edv_bulk_removal(
    app: AppHandle,
    selection: Selection,
    expected_revision: String,
) -> Result<usize, String> {
    diagnostics::require_edv(&app)?;
    if m365::get_m365_read_only_test_mode() {
        return Err("Im Nur-Lesen-Testmodus ist die Löschung gesperrt.".into());
    }
    let calendar = is_calendar(&selection.filter)?;
    let state = app.state::<AppState>();
    let _gate = if calendar {
        state.m365.calendar_sync_gate.lock().await
    } else {
        state.m365.contact_sync_gate.lock().await
    };
    diagnostics::require_edv(&app)?;
    let worker_app = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        diagnostics::require_edv(&worker_app)?;
        let conn = open_db(&worker_app)?;
        checkpoint_before_destructive_change(&worker_app, &conn)?;
        diagnostics::require_edv(&worker_app)?;
        execute_in_db(&conn, &selection, &expected_revision)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    fn database() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("CREATE TABLE audit_context(id INTEGER PRIMARY KEY,actor TEXT,source TEXT); INSERT INTO audit_context VALUES(1,'EDV','user');
            CREATE TABLE calendar_events(id TEXT PRIMARY KEY,starts_at TEXT NOT NULL,duplicate_key TEXT NOT NULL,event_json TEXT NOT NULL,updated_at TEXT NOT NULL,deleted_at TEXT);
            CREATE TABLE calendar_sync_outbox(event_id TEXT PRIMARY KEY,action TEXT,queued_at TEXT,attempts INTEGER,last_error TEXT);
            CREATE TABLE contacts(id INTEGER PRIMARY KEY,display_name TEXT,first_name TEXT,last_name TEXT,email TEXT,company TEXT,city TEXT,phone TEXT,mobile_phone TEXT,updated_at TEXT NOT NULL,deleted_at TEXT);
            CREATE TABLE contact_sync_outbox(local_contact_id INTEGER PRIMARY KEY,action TEXT,queued_at TEXT,attempts INTEGER,last_error TEXT);
            CREATE TABLE groups(id INTEGER PRIMARY KEY,name TEXT,deleted_at TEXT); CREATE TABLE contact_groups(contact_id INTEGER,group_id INTEGER);").unwrap();
        conn
    }
    fn event(conn: &Connection, id: &str, title: &str) {
        let value = serde_json::json!({"id":id,"title":title,"startsAt":"2026-10-12T12:00","endsAt":"2026-10-12T13:00","source":"Microsoft 365","category":"Work","location":"","description":""});
        conn.execute(
            "INSERT INTO calendar_events VALUES(?1,'2026-10-12T12:00','key',?2,'v1',NULL)",
            params![id, value.to_string()],
        )
        .unwrap();
    }
    fn selection(kind: &str, search: &str) -> Selection {
        Selection {
            filter: Filter {
                kind: kind.into(),
                search: search.into(),
                exact: true,
                ..Default::default()
            },
            all_matching: true,
            ids: vec![],
            excluded_ids: vec![],
        }
    }
    #[test]
    fn selects_all_matching_across_pages_and_respects_exclusions_and_date() {
        let conn = database();
        for index in 0..105 {
            event(&conn, &index.to_string(), "Mittagspause");
        }
        event(&conn, "other", "Mittagspause mit Team");
        let mut selection = selection("calendar", "mittagspause");
        selection.filter.from_date = "2026-10-12".into();
        selection.filter.to_date = "2026-10-12".into();
        let page = query_page(&conn, &selection.filter).unwrap();
        assert_eq!(page.total, 105);
        assert_eq!(page.items.len(), 100);
        selection.filter.offset = 100;
        assert_eq!(query_page(&conn, &selection.filter).unwrap().items.len(), 5);
        selection.excluded_ids = vec!["1".into(), "2".into()];
        let plan = plan(&conn, &selection).unwrap();
        assert_eq!(plan.roots.len(), 103);
        assert_eq!(
            execute_in_db(&conn, &selection, &revision(&plan)).unwrap(),
            103
        );
        assert_eq!(
            conn.query_row(
                "SELECT count(*) FROM calendar_sync_outbox WHERE action='delete'",
                [],
                |r| r.get::<_, usize>(0)
            )
            .unwrap(),
            103
        );
        assert_eq!(
            conn.query_row(
                "SELECT count(*) FROM calendar_events WHERE deleted_at IS NULL",
                [],
                |r| r.get::<_, usize>(0)
            )
            .unwrap(),
            3
        );
    }
    #[test]
    fn literal_search_does_not_treat_wildcards_as_select_all() {
        let conn = database();
        event(&conn, "one", "100% Mittagspause");
        event(&conn, "two", "Other");
        let mut filter = selection("calendar", "%").filter;
        filter.exact = false;
        assert_eq!(query_page(&conn, &filter).unwrap().total, 1);
        filter.search = "' OR 1=1 --".into();
        assert_eq!(query_page(&conn, &filter).unwrap().total, 0);
        filter.kind = "passwords".into();
        assert!(query_page(&conn, &filter).is_err());
    }
    #[test]
    fn changed_or_new_matching_records_require_a_new_confirmation() {
        let conn = database();
        event(&conn, "one", "Mittagspause");
        let selection = selection("calendar", "Mittagspause");
        let original = revision(&plan(&conn, &selection).unwrap());
        event(&conn, "new", "Mittagspause");
        assert!(execute_in_db(&conn, &selection, &original)
            .unwrap_err()
            .contains("inzwischen"));
        assert_eq!(
            conn.query_row("SELECT count(*) FROM calendar_sync_outbox", [], |r| r
                .get::<_, usize>(0))
                .unwrap(),
            0
        );
        let current = revision(&plan(&conn, &selection).unwrap());
        conn.execute(
            "UPDATE calendar_events SET updated_at='v2' WHERE id='one'",
            [],
        )
        .unwrap();
        assert!(execute_in_db(&conn, &selection, &current).is_err());
        assert_eq!(
            conn.query_row(
                "SELECT count(*) FROM calendar_events WHERE deleted_at IS NULL",
                [],
                |r| r.get::<_, usize>(0)
            )
            .unwrap(),
            2
        );
    }
    #[test]
    fn master_and_exception_selection_queues_only_master_and_reports_affected_items() {
        let conn = database();
        event(&conn, "z-master", "Mittagspause");
        event(&conn, "a-child", "Mittagspause");
        conn.execute("UPDATE calendar_events SET event_json=json_set(event_json,'$.recurrence',json('{\"frequency\":\"weekly\",\"interval\":1}')) WHERE id='z-master'",[]).unwrap();
        conn.execute("UPDATE calendar_events SET event_json=json_set(event_json,'$.recurrenceMasterId','z-master') WHERE id='a-child'",[]).unwrap();
        let mut selection = selection("calendar", "Mittagspause");
        selection.excluded_ids = vec!["a-child".into()];
        let preview = plan(&conn, &selection).unwrap();
        assert_eq!(preview.roots.len(), 1);
        assert_eq!(preview.affected.len(), 2);
        assert_eq!(preview.series, 1);
        // Even a selected parent must precede its separately selected exception.
        selection.excluded_ids.clear();
        let preview = plan(&conn, &selection).unwrap();
        assert_eq!(
            execute_in_db(&conn, &selection, &revision(&preview)).unwrap(),
            2
        );
        assert_eq!(
            conn.query_row("SELECT event_id FROM calendar_sync_outbox", [], |r| r
                .get::<_, String>(0))
                .unwrap(),
            "z-master"
        );
        assert_eq!(
            conn.query_row("SELECT count(*) FROM calendar_sync_outbox", [], |r| r
                .get::<_, usize>(0))
                .unwrap(),
            1
        );
    }
    #[test]
    fn contact_group_company_filter_and_transaction_rollback_keep_unselected_contacts() {
        let conn = database();
        conn.execute_batch("INSERT INTO contacts VALUES(1,'Anna','Anna','A','a@test','DMH','Aidlingen','','','v1',NULL),(2,'Bea','Bea','B','b@test','DMH','Aidlingen','','','v1',NULL),(3,'Other','Other','','x@test','Other','','','','v1',NULL); INSERT INTO groups VALUES(1,'Team',NULL); INSERT INTO contact_groups VALUES(1,1),(2,1);").unwrap();
        let mut selection = selection("contacts", "");
        selection.filter.company = "DMH".into();
        selection.filter.group = "Team".into();
        assert_eq!(query_page(&conn, &selection.filter).unwrap().total, 2);
        let preview = plan(&conn, &selection).unwrap();
        conn.execute_batch("CREATE TRIGGER fail_queue BEFORE INSERT ON contact_sync_outbox WHEN NEW.local_contact_id=2 BEGIN SELECT RAISE(ABORT,'queue failed'); END;").unwrap();
        assert!(execute_in_db(&conn, &selection, &revision(&preview)).is_err());
        assert_eq!(
            conn.query_row(
                "SELECT count(*) FROM contacts WHERE deleted_at IS NULL",
                [],
                |r| r.get::<_, usize>(0)
            )
            .unwrap(),
            3
        );
        assert_eq!(
            conn.query_row("SELECT count(*) FROM contact_sync_outbox", [], |r| r
                .get::<_, usize>(0))
                .unwrap(),
            0
        );
        conn.execute_batch("DROP TRIGGER fail_queue;").unwrap();
        assert_eq!(
            execute_in_db(&conn, &selection, &revision(&preview)).unwrap(),
            2
        );
        assert_eq!(
            conn.query_row(
                "SELECT count(*) FROM contact_sync_outbox WHERE action='delete'",
                [],
                |r| r.get::<_, usize>(0)
            )
            .unwrap(),
            2
        );
    }
}
