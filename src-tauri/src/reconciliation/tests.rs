use super::*;

fn contact(key: &str, name: &str) -> SourceItem {
    let mut data = Value::Object(
        CONTACT_FIELDS
            .iter()
            .map(|(k, _)| (k.to_string(), json!("")))
            .collect(),
    );
    data["displayName"] = json!(name);
    data["email"] = json!(format!("{}@example.test", name.to_lowercase()));
    data["phone"] = json!("123456789");
    SourceItem {
        key: key.into(),
        data,
    }
}
fn calendar(key: &str) -> SourceItem {
    let raw = json!({"id":key,"title":"Besuch","startsAt":"2026-12-01T09:00:00",
        "endsAt":"2026-12-01T10:00:00","isAllDay":false,"location":"Büro","description":"Alt",
        "color":"blue","category":"Arbeit","source":"Outlook","recurrence":null,"excludedDates":[],
        "recurrenceMasterId":null,"recurrenceId":null,"meeting":{},"deletedAt":null,"updatedAt":"2026-10-01"});
    SourceItem {
        key: key.into(),
        data: serde_json::to_value(serde_json::from_value::<crate::CalendarEvent>(raw).unwrap())
            .unwrap(),
    }
}
fn local(source: &SourceItem) -> LocalItem {
    LocalItem {
        id: "1".into(),
        origin: source.key.clone(),
        data: source.data.clone(),
        deleted: false,
        remote: false,
        pending: false,
    }
}
fn base(kind: &str, source: &SourceItem, local: &LocalItem) -> Baselines {
    BTreeMap::from([(
        source.key.clone(),
        Baseline {
            source: content(kind, &source.data),
            local: Some(content(kind, &local.data)),
            local_id: Some(local.id.clone()),
        },
    )])
}
fn database() -> Connection {
    let conn = Connection::open_in_memory().unwrap();
    conn.execute_batch(&format!("CREATE TABLE contacts(id INTEGER PRIMARY KEY AUTOINCREMENT, {},
        outlook_entry_id TEXT, outlook_store_id TEXT, created_at TEXT, updated_at TEXT, deleted_at TEXT);
        CREATE TABLE m365_contact_links(local_contact_id INTEGER, source_id TEXT, remote_id TEXT);
        CREATE TABLE contact_sync_outbox(local_contact_id INTEGER PRIMARY KEY, action TEXT, queued_at TEXT, attempts INTEGER, last_error TEXT);
        CREATE TABLE calendar_events(id TEXT PRIMARY KEY, starts_at TEXT, duplicate_key TEXT, event_json TEXT, updated_at TEXT, deleted_at TEXT);
        CREATE TABLE calendar_sync_outbox(event_id TEXT PRIMARY KEY, action TEXT, queued_at TEXT, attempts INTEGER, last_error TEXT);",
        CONTACT_FIELDS.iter().map(|(_, col)| format!("{col} TEXT NOT NULL DEFAULT ''")).collect::<Vec<_>>().join(","))).unwrap();
    init(&conn).unwrap();
    conn
}
fn seed_contact(conn: &mut Connection, source: &SourceItem) {
    let tx = conn.transaction().unwrap();
    write_contact(&tx, None, &source.data).unwrap();
    tx.commit().unwrap();
    conn.execute("DELETE FROM contact_sync_outbox", []).unwrap();
}
fn remember(conn: &mut Connection, kind: &str, source: &[SourceItem]) {
    let preview = prepare(conn, kind, kind, source.to_vec(), vec![]).unwrap();
    apply(conn, &preview.token, &[]).unwrap();
}
fn current(conn: &Connection) -> Value {
    load_local(conn, "contacts").unwrap()[0].data.clone()
}

#[test]
fn old_import_without_history_does_not_restore_or_overwrite() {
    let original = contact("source", "Anna");
    let mut destination = local(&original);
    destination.data["phone"] = json!("");
    let unknown = contact("missing", "Bea");
    let preview = build_preview(
        "contacts",
        &[original, unknown],
        &[destination],
        &Baselines::new(),
    );
    assert!(preview
        .iter()
        .all(|i| !i.selectable && i.status == "review"));
}
#[test]
fn deleted_and_purged_contacts_stay_deleted_even_if_source_id_changes() {
    let mut conn = database();
    let mut source = contact("old", "Anna");
    seed_contact(&mut conn, &source);
    conn.execute("UPDATE contacts SET deleted_at='today'", [])
        .unwrap();
    assert_eq!(
        build_preview(
            "contacts",
            &[source.clone()],
            &load_local(&conn, "contacts").unwrap(),
            &Baselines::new()
        )[0]
        .status,
        "deleted"
    );
    conn.execute("DELETE FROM contacts", []).unwrap();
    source.key = "new-id".into();
    let p = prepare(&conn, "contacts", "contacts", vec![source], vec![]).unwrap();
    assert_eq!(p.items[0].status, "deleted");
    apply(&mut conn, &p.token, &[]).unwrap();
    assert_eq!(
        conn.query_row("SELECT COUNT(*) FROM contacts", [], |r| r.get::<_, i64>(0))
            .unwrap(),
        0
    );
}
#[test]
fn baseline_missing_target_is_never_recreated() {
    let source = contact("source", "Anna");
    let original = local(&source);
    assert_eq!(
        build_preview(
            "contacts",
            &[source.clone()],
            &[],
            &base("contacts", &source, &original)
        )[0]
        .status,
        "deleted"
    );
}
#[test]
fn three_way_updates_only_source_changes_and_preserves_local_edits_and_clears() {
    let source = contact("source", "Anna");
    let mut current = local(&source);
    let baseline = base("contacts", &source, &current);
    current.data["phone"] = json!("");
    current.data["notes"] = json!("Neue lokale Notiz");
    let mut incoming = source;
    incoming.data["city"] = json!("Aidlingen");
    let p = build_preview("contacts", &[incoming], &[current], &baseline);
    assert_eq!(p[0].status, "update");
    let next = p[0].next.as_ref().unwrap();
    assert_eq!(next["phone"], "");
    assert_eq!(next["notes"], "Neue lokale Notiz");
    assert_eq!(next["city"], "Aidlingen");
}
#[test]
fn conflicting_changes_never_overwrite_local() {
    let mut source = contact("source", "Anna");
    let mut current = local(&source);
    let baseline = base("contacts", &source, &current);
    current.data["phone"] = json!("new-local");
    source.data["phone"] = json!("new-source");
    let p = build_preview("contacts", &[source], &[current], &baseline);
    assert_eq!(p[0].status, "review");
    assert!(!p[0].selectable);
}
#[test]
fn unmodified_old_source_keeps_recent_local_changes() {
    let source = contact("source", "Anna");
    let mut current = local(&source);
    let baseline = base("contacts", &source, &current);
    current.data["phone"] = json!("");
    assert_eq!(
        build_preview("contacts", &[source], &[current], &baseline)[0].status,
        "kept"
    );
}
#[test]
fn birthday_never_overwrites_an_existing_date() {
    let mut source = contact("source", "Anna");
    source.data["birthday"] = json!("1970-02-03");
    let current = local(&source);
    let baseline = base("contacts", &source, &current);
    source.data["birthday"] = json!("1971-02-03");
    assert_eq!(
        build_preview("contacts", &[source], &[current], &baseline)[0].status,
        "review"
    );
}
#[test]
fn linked_or_pending_contacts_require_live_exchange_review() {
    for pending in [true, false] {
        let mut source = contact("source", "Anna");
        let mut current = local(&source);
        let baseline = base("contacts", &source, &current);
        current.pending = pending;
        current.remote = !pending;
        source.data["city"] = json!("Neu");
        assert!(!build_preview("contacts", &[source], &[current], &baseline)[0].selectable);
    }
}
#[test]
fn same_title_and_time_do_not_hide_changed_calendar_contents() {
    let mut source = calendar("event");
    let current = local(&source);
    let baseline = base("calendar", &source, &current);
    source.data["description"] = json!("Neue Beschreibung");
    assert_eq!(
        build_preview("calendar", &[source], &[current], &baseline)[0].status,
        "update"
    );
}
#[test]
fn calendar_schedule_changes_are_not_combined_into_invalid_times() {
    let mut source = calendar("event");
    let mut current = local(&source);
    let baseline = base("calendar", &source, &current);
    current.data["startsAt"] = json!("2026-12-02T09:00:00");
    source.data["endsAt"] = json!("2026-12-01T11:00:00");
    assert_eq!(
        build_preview("calendar", &[source], &[current], &baseline)[0].status,
        "review"
    );
}
#[test]
fn calendar_exceptions_and_recent_edits_are_preserved() {
    let mut source = calendar("series");
    let mut current = local(&source);
    let baseline = base("calendar", &source, &current);
    current.data["excludedDates"] = json!(["2026-12-08"]);
    source.data["location"] = json!("Neuer Raum");
    let p = build_preview("calendar", &[source], &[current], &baseline);
    assert_eq!(
        p[0].next.as_ref().unwrap()["excludedDates"],
        json!(["2026-12-08"])
    );
}
#[test]
fn uncertain_changed_ids_and_names_do_not_create_duplicates() {
    let original = calendar("old");
    let current = local(&original);
    let baseline = base("calendar", &original, &current);
    let mut source = original;
    source.key = "new".into();
    source.data["startsAt"] = json!("2027-01-01");
    let p = build_preview("calendar", &[source], &[current], &baseline);
    assert_eq!(p[0].status, "review");
}
#[test]
fn two_sources_for_one_target_cannot_choose_an_arbitrary_update() {
    let original = contact("a", "Anna");
    let current = local(&original);
    let baseline = base("contacts", &original, &current);
    let mut a = original.clone();
    a.data["city"] = json!("X");
    let mut b = a.clone();
    b.key = "b".into();
    b.data["city"] = json!("Y");
    assert!(build_preview("contacts", &[a, b], &[current], &baseline)
        .iter()
        .all(|v| !v.selectable));
}
#[test]
fn duplicate_incoming_ids_and_new_identities_are_blocked() {
    let old = contact("book:a", "Anna");
    let current = local(&old);
    let baseline = base("contacts", &old, &current);
    let mut b = contact("book:b", "Bea");
    b.data["phone"] = json!("");
    let mut c = b.clone();
    c.key = "book:c".into();
    assert!(build_preview(
        "contacts",
        &[b.clone(), b.clone()],
        &[current.clone()],
        &baseline
    )
    .iter()
    .all(|v| !v.selectable));
    assert!(build_preview("contacts", &[b, c], &[current], &baseline)
        .iter()
        .all(|v| !v.selectable));
}
#[test]
fn preview_is_read_only_and_apply_is_once_with_audited_before_and_after() {
    let mut conn = database();
    let mut source = contact("a", "Anna");
    seed_contact(&mut conn, &source);
    remember(&mut conn, "contacts", &[source.clone()]);
    source.data["city"] = json!("Aidlingen");
    let p = prepare(&conn, "contacts", "contacts", vec![source], vec![]).unwrap();
    assert_eq!(current(&conn)["city"], "");
    assert!(p.items[0].selectable);
    assert!(p.items[0].next.is_none());
    let result = apply(&mut conn, &p.token, &["a".into()]).unwrap();
    assert_eq!(result.updated, 1);
    assert_eq!(current(&conn)["city"], "Aidlingen");
    assert!(apply(&mut conn, &p.token, &["a".into()]).is_err());
    let history: String = conn
        .query_row(
            "SELECT changes_json FROM reconciliation_runs WHERE id=?",
            [p.token],
            |r| r.get(0),
        )
        .unwrap();
    let changes: Value = serde_json::from_str(&history).unwrap();
    assert_eq!(changes[0]["before"]["city"], "");
    assert_eq!(changes[0]["after"]["city"], "Aidlingen");
}
#[test]
fn changed_destination_invalidates_whole_preview() {
    let mut conn = database();
    let source = contact("a", "Anna");
    seed_contact(&mut conn, &source);
    let p = prepare(&conn, "contacts", "contacts", vec![source], vec![]).unwrap();
    conn.execute("UPDATE contacts SET notes='neu'", []).unwrap();
    assert!(apply(&mut conn, &p.token, &[])
        .unwrap_err()
        .contains("seit der Vorschau"));
    assert_eq!(current(&conn)["notes"], "neu");
}
#[test]
fn newly_linked_destination_invalidates_preview() {
    let mut conn = database();
    let source = contact("a", "Anna");
    seed_contact(&mut conn, &source);
    let p = prepare(&conn, "contacts", "contacts", vec![source], vec![]).unwrap();
    conn.execute("INSERT INTO m365_contact_links VALUES (1,'s','r')", [])
        .unwrap();
    assert!(apply(&mut conn, &p.token, &[]).is_err());
}
#[test]
fn failed_write_rolls_back_changes_history_outbox_and_token_consumption() {
    let mut conn = database();
    let mut source = contact("a", "Anna");
    seed_contact(&mut conn, &source);
    remember(&mut conn, "contacts", &[source.clone()]);
    source.data["city"] = json!("X");
    let p = prepare(&conn, "contacts", "contacts", vec![source], vec![]).unwrap();
    conn.execute_batch("CREATE TRIGGER reject_outbox BEFORE INSERT ON contact_sync_outbox BEGIN SELECT RAISE(ABORT,'fixture failure'); END;").unwrap();
    assert!(apply(&mut conn, &p.token, &["a".into()]).is_err());
    assert_eq!(current(&conn)["city"], "");
    conn.execute_batch("DROP TRIGGER reject_outbox").unwrap();
    assert_eq!(
        apply(&mut conn, &p.token, &["a".into()]).unwrap().updated,
        1
    );
}
#[test]
fn skipped_old_conflict_is_not_accepted_as_baseline_on_next_attempt() {
    let mut conn = database();
    let mut source = contact("a", "Anna");
    seed_contact(&mut conn, &source);
    source.data["phone"] = json!("changed");
    remember(&mut conn, "contacts", &[source.clone()]);
    source.data["city"] = json!("X");
    let p = prepare(&conn, "contacts", "contacts", vec![source], vec![]).unwrap();
    assert_eq!(p.items[0].status, "review");
}
#[test]
fn new_source_item_can_be_added_explicitly_once_after_baseline() {
    let mut conn = database();
    let original = contact("book:a", "Anna");
    seed_contact(&mut conn, &original);
    remember(&mut conn, "contacts", &[original.clone()]);
    let mut new = contact("book:b", "Bea");
    new.data["phone"] = json!("");
    let p = prepare(
        &conn,
        "contacts",
        "contacts",
        vec![original.clone(), new.clone()],
        vec![],
    )
    .unwrap();
    assert_eq!(p.items[1].status, "new");
    assert_eq!(
        apply(&mut conn, &p.token, &["book:b".into()])
            .unwrap()
            .added,
        1
    );
    let p = prepare(&conn, "contacts", "contacts", vec![original, new], vec![]).unwrap();
    assert!(p.items.iter().all(|i| !i.selectable));
}
#[test]
fn missing_source_rows_never_delete_local_entries_or_forget_mapping() {
    let mut conn = database();
    let original = contact("a", "Anna");
    seed_contact(&mut conn, &original);
    remember(&mut conn, "contacts", &[original.clone()]);
    remember(&mut conn, "contacts", &[]);
    assert_eq!(current(&conn)["displayName"], "Anna");
    assert!(load_baseline(&conn, "contacts").unwrap().contains_key("a"));
}
#[test]
fn tampered_or_expired_selections_are_rejected() {
    let mut conn = database();
    let source = contact("a", "Anna");
    seed_contact(&mut conn, &source);
    let p = prepare(&conn, "contacts", "contacts", vec![source], vec![]).unwrap();
    assert!(apply(&mut conn, &p.token, &["a".into()]).is_err());
    conn.execute("UPDATE reconciliation_plans SET expires_at=0", [])
        .unwrap();
    assert!(apply(&mut conn, &p.token, &[]).is_err());
}
#[test]
fn partial_source_is_not_writable() {
    let mut conn = database();
    let mut source = contact("a", "Anna");
    seed_contact(&mut conn, &source);
    remember(&mut conn, "contacts", &[source.clone()]);
    source.data["city"] = json!("X");
    let p = prepare(
        &conn,
        "contacts",
        "contacts",
        vec![source],
        vec!["Lesefehler".into()],
    )
    .unwrap();
    assert!(!p.items[0].selectable);
}
#[test]
fn calendar_preview_apply_keeps_id_and_untouched_events() {
    let mut conn = database();
    let source = calendar("event");
    let tx = conn.transaction().unwrap();
    let event: crate::CalendarEvent = serde_json::from_value(source.data.clone()).unwrap();
    crate::write_calendar_events_in_transaction(&tx, &[event], false).unwrap();
    tx.commit().unwrap();
    remember(&mut conn, "calendar", &[source.clone()]);
    let mut incoming = source;
    incoming.data["description"] = json!("Neu");
    let p = prepare(&conn, "calendar", "calendar", vec![incoming], vec![]).unwrap();
    assert_eq!(
        apply(&mut conn, &p.token, &["event".into()])
            .unwrap()
            .updated,
        1
    );
    let values = load_local(&conn, "calendar").unwrap();
    assert_eq!(values.len(), 1);
    assert_eq!(values[0].id, "event");
    assert_eq!(values[0].data["description"], "Neu");
}
#[test]
fn deleted_calendar_survives_purge_and_new_source_id() {
    let mut conn = database();
    let mut source = calendar("event");
    let tx = conn.transaction().unwrap();
    crate::write_calendar_events_in_transaction(
        &tx,
        &[serde_json::from_value(source.data.clone()).unwrap()],
        false,
    )
    .unwrap();
    tx.commit().unwrap();
    conn.execute("DELETE FROM calendar_events", []).unwrap();
    source.key = "different".into();
    let p = prepare(&conn, "calendar", "calendar", vec![source], vec![]).unwrap();
    assert_eq!(p.items[0].status, "deleted");
}
#[test]
fn source_fingerprint_ignores_enumeration_order_and_scan_timestamps_not_real_changes() {
    let a = calendar("a");
    let mut b = calendar("b");
    let hash = source_fingerprint("calendar", &[a.clone(), b.clone()]);
    b.data["updatedAt"] = json!("scan-now");
    assert_eq!(
        hash,
        source_fingerprint("calendar", &[b.clone(), a.clone()])
    );
    b.data["description"] = json!("Edited");
    assert_ne!(hash, source_fingerprint("calendar", &[a, b]));
}

#[test]
fn changing_the_address_book_does_not_classify_unknown_people_as_new() {
    let mut conn = database();
    let old = contact("old-book:a", "Anna");
    seed_contact(&mut conn, &old);
    remember(&mut conn, "contacts", &[old]);
    let mut other = contact("another-book:b", "Bea");
    other.data["phone"] = json!("");
    let preview = prepare(&conn, "contacts", "contacts", vec![other], vec![]).unwrap();
    assert_eq!(preview.items[0].status, "review");
}
#[test]
fn exchange_calendar_ids_are_protected_even_without_explicit_destination_metadata() {
    let mut conn = database();
    let mut source = calendar("m365:calendar:remote-id");
    let tx = conn.transaction().unwrap();
    crate::write_calendar_events_in_transaction(
        &tx,
        &[serde_json::from_value(source.data.clone()).unwrap()],
        false,
    )
    .unwrap();
    tx.commit().unwrap();
    remember(&mut conn, "calendar", &[source.clone()]);
    source.data["location"] = json!("Other room");
    let preview = prepare(&conn, "calendar", "calendar", vec![source], vec![]).unwrap();
    assert!(!preview.items[0].selectable);
    assert!(preview.items[0].reason.contains("Exchange"));
}
#[test]
fn thunderbird_calendar_defaults_match_persisted_event_representation() {
    let raw = json!({"id":"tb:one","title":"Test","startsAt":"2026-12-01T09:00","endsAt":"2026-12-01T10:00",
        "isAllDay":false,"location":"","description":"","color":"blue","category":"","source":"Thunderbird"});
    let event: crate::CalendarEvent = serde_json::from_value(raw).unwrap();
    let data = serde_json::to_value(event).unwrap();
    let source = SourceItem {
        key: "tb:one".into(),
        data,
    };
    let current = local(&source);
    assert_eq!(
        build_preview("calendar", &[source], &[current], &Baselines::new())[0].status,
        "same"
    );
}
