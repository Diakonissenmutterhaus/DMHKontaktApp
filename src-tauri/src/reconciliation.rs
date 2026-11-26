//! Explicit, transactional re-import. Source reads never write contacts/calendar.
//! An old export without a baseline is not evidence that a missing item is new.
use rusqlite::{params, params_from_iter, Connection, OptionalExtension, TransactionBehavior};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, HashMap, HashSet};
use tauri::AppHandle;

const CONTACT_FIELDS: &[(&str, &str)] = &[
    ("firstName", "first_name"),
    ("lastName", "last_name"),
    ("displayName", "display_name"),
    ("email", "email"),
    ("privateEmail", "private_email"),
    ("secondPrivateEmail", "second_private_email"),
    ("phone", "phone"),
    ("mobilePhone", "mobile_phone"),
    ("privatePhone", "private_phone"),
    ("secondPrivatePhone", "second_private_phone"),
    ("company", "company"),
    ("street", "street"),
    ("postalCode", "postal_code"),
    ("city", "city"),
    ("country", "country"),
    ("shortInfo", "short_info"),
    ("notes", "notes"),
    ("birthday", "birthday"),
];
const CALENDAR_FIELDS: &[&str] = &[
    "title",
    "startsAt",
    "endsAt",
    "isAllDay",
    "location",
    "description",
    "color",
    "category",
    "recurrence",
    "excludedDates",
    "recurrenceMasterId",
    "recurrenceId",
    "meeting",
];

#[derive(Clone, Debug, Serialize, Deserialize)]
pub(crate) struct SourceItem {
    pub key: String,
    pub data: Value,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
struct LocalItem {
    id: String,
    origin: String,
    data: Value,
    deleted: bool,
    remote: bool,
    pending: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
struct Baseline {
    source: Value,
    local: Option<Value>,
    local_id: Option<String>,
}
type Baselines = BTreeMap<String, Baseline>;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Difference {
    field: String,
    current: Value,
    incoming: Value,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PreviewItem {
    key: String,
    label: String,
    status: String,
    reason: String,
    differences: Vec<Difference>,
    selectable: bool,
    // Never accepted from the frontend: these are stored in the native plan.
    #[serde(default)]
    local_id: Option<String>,
    #[serde(default)]
    next: Option<Value>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Preview {
    token: String,
    items: Vec<PreviewItem>,
    counts: BTreeMap<String, usize>,
    warnings: Vec<String>,
}

#[derive(Serialize, Deserialize)]
struct Plan {
    kind: String,
    namespace: String,
    fingerprint: String,
    incoming: Vec<SourceItem>,
    preview: Preview,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Applied {
    added: usize,
    updated: usize,
    unchanged: usize,
    review: usize,
}

fn err(error: impl std::fmt::Display) -> String {
    error.to_string()
}
fn normalized(value: &Value) -> String {
    value
        .as_str()
        .unwrap_or("")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_lowercase()
}
fn content(kind: &str, value: &Value) -> Value {
    let fields: Vec<&str> = if kind == "contacts" {
        CONTACT_FIELDS.iter().map(|(key, _)| *key).collect()
    } else {
        CALENDAR_FIELDS.to_vec()
    };
    Value::Object(
        fields
            .into_iter()
            .map(|key| (key.to_string(), value[key].clone()))
            .collect(),
    )
}
fn contact_json(prefix: &str) -> String {
    format!(
        "json_object({})",
        CONTACT_FIELDS
            .iter()
            .map(|(key, column)| format!("'{key}', {prefix}{column}"))
            .collect::<Vec<_>>()
            .join(",")
    )
}

pub(crate) fn init(conn: &Connection) -> Result<(), String> {
    conn.execute_batch("CREATE TABLE IF NOT EXISTS reconciliation_baselines (
        namespace TEXT PRIMARY KEY, payload TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS reconciliation_plans (
        token TEXT PRIMARY KEY, expires_at INTEGER NOT NULL, payload TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS reconciliation_runs (
        id TEXT PRIMARY KEY, created_at TEXT NOT NULL, kind TEXT NOT NULL, changes_json TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS reconciliation_deleted (
        kind TEXT NOT NULL, id TEXT NOT NULL, origin TEXT NOT NULL, data TEXT NOT NULL,
        PRIMARY KEY(kind, id));").map_err(err)?;
    // Retain identities even after the trash is emptied. This does not resurrect data.
    conn.execute_batch(&format!("CREATE TRIGGER IF NOT EXISTS reconciliation_contact_deleted
        BEFORE DELETE ON contacts BEGIN
        INSERT OR REPLACE INTO reconciliation_deleted VALUES('contacts', CAST(OLD.id AS TEXT),
            COALESCE(OLD.outlook_store_id,'') || ':' || COALESCE(OLD.outlook_entry_id,''), {});
        END;
        CREATE TRIGGER IF NOT EXISTS reconciliation_calendar_deleted BEFORE DELETE ON calendar_events BEGIN
        INSERT OR REPLACE INTO reconciliation_deleted VALUES('calendar', OLD.id, OLD.id, OLD.event_json);
        END;", contact_json("OLD."))).map_err(err)
}

fn load_local(conn: &Connection, kind: &str) -> Result<Vec<LocalItem>, String> {
    let sql = if kind == "contacts" {
        format!("SELECT CAST(c.id AS TEXT), COALESCE(c.outlook_store_id,'') || ':' || COALESCE(c.outlook_entry_id,''), {},
        c.deleted_at IS NOT NULL, EXISTS(SELECT 1 FROM m365_contact_links l WHERE l.local_contact_id=c.id),
        EXISTS(SELECT 1 FROM contact_sync_outbox o WHERE o.local_contact_id=c.id)
        FROM contacts c ORDER BY c.id", contact_json("c."))
    } else {
        "SELECT id, id, event_json, deleted_at IS NOT NULL, 0,
        EXISTS(SELECT 1 FROM calendar_sync_outbox o WHERE o.event_id=c.id) FROM calendar_events c ORDER BY id".into()
    };
    let mut stmt = conn.prepare(&sql).map_err(err)?;
    let rows = stmt
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, bool>(3)?,
                row.get::<_, bool>(4)?,
                row.get::<_, bool>(5)?,
            ))
        })
        .map_err(err)?;
    let mut result = Vec::new();
    for row in rows {
        let (id, origin, raw, deleted, remote, pending) = row.map_err(err)?;
        let data: Value = serde_json::from_str(&raw).map_err(err)?;
        let remote = remote
            || id.starts_with("m365:")
            || data["calendarSourceId"]
                .as_str()
                .is_some_and(|id| !id.is_empty());
        result.push(LocalItem {
            id,
            origin,
            data,
            deleted,
            remote,
            pending,
        });
    }
    let current_ids: HashSet<String> = result.iter().map(|item| item.id.clone()).collect();
    let mut stmt = conn
        .prepare("SELECT id, origin, data FROM reconciliation_deleted WHERE kind=? ORDER BY id")
        .map_err(err)?;
    let rows = stmt
        .query_map([kind], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
            ))
        })
        .map_err(err)?;
    for row in rows {
        let (id, origin, data) = row.map_err(err)?;
        // A deliberately restored current row wins over its old purge record.
        if current_ids.contains(&id) {
            continue;
        }
        result.push(LocalItem {
            id,
            origin,
            data: serde_json::from_str(&data).map_err(err)?,
            deleted: true,
            remote: false,
            pending: false,
        });
    }
    Ok(result)
}

fn load_baseline(conn: &Connection, namespace: &str) -> Result<Baselines, String> {
    let raw: Option<String> = conn
        .query_row(
            "SELECT payload FROM reconciliation_baselines WHERE namespace=?",
            [namespace],
            |r| r.get(0),
        )
        .optional()
        .map_err(err)?;
    raw.map(|raw| serde_json::from_str(&raw).map_err(err))
        .unwrap_or_else(|| Ok(Baselines::new()))
}
fn fingerprint(local: &[LocalItem], baseline: &Baselines) -> String {
    format!(
        "{:x}",
        Sha256::digest(serde_json::to_vec(&(local, baseline)).expect("serializable snapshot"))
    )
}

fn identity_keys(kind: &str, value: &Value) -> Vec<String> {
    let mut keys = Vec::new();
    if kind == "contacts" {
        for key in ["email", "privateEmail", "secondPrivateEmail"] {
            let email = normalized(&value[key]);
            if !email.is_empty() {
                keys.push(format!("email:{email}"));
            }
        }
        let mut name = normalized(&value["displayName"]);
        if name.is_empty() {
            name = format!(
                "{} {}",
                normalized(&value["firstName"]),
                normalized(&value["lastName"])
            )
            .trim()
            .into();
        }
        if !name.is_empty() {
            keys.push(format!("name:{name}"));
        }
        for field in ["phone", "mobilePhone", "privatePhone", "secondPrivatePhone"] {
            let phone: String = normalized(&value[field])
                .chars()
                .filter(char::is_ascii_digit)
                .collect();
            if phone.len() >= 6 {
                keys.push(format!("phone:{phone}"));
            }
        }
    } else {
        // Similar events are review candidates, never grounds to add another copy.
        let title = normalized(&value["title"]);
        if !title.is_empty() {
            keys.push(format!("title:{title}"));
        }
        keys.push(format!("time:{}", normalized(&value["startsAt"])));
    }
    keys
}

fn build_preview(
    kind: &str,
    incoming: &[SourceItem],
    local: &[LocalItem],
    base: &Baselines,
) -> Vec<PreviewItem> {
    let by_id: HashMap<&str, usize> = local
        .iter()
        .enumerate()
        .map(|(i, v)| (v.id.as_str(), i))
        .collect();
    let has_remote = local.iter().any(|v| v.remote);
    let mut index: HashMap<String, HashSet<usize>> = HashMap::new();
    let mut origins: HashMap<&str, Vec<usize>> = HashMap::new();
    for (i, item) in local.iter().enumerate() {
        for key in identity_keys(kind, &item.data) {
            index.entry(key).or_default().insert(i);
        }
        origins.entry(&item.origin).or_default().push(i);
    }
    let mut incoming_counts = HashMap::new();
    for item in incoming {
        *incoming_counts.entry(&item.key).or_insert(0usize) += 1;
    }
    let mut claimed = HashSet::new();
    let mut preview = Vec::new();
    for item in incoming {
        let source = content(kind, &item.data);
        let label = if kind == "contacts" {
            item.data["displayName"]
                .as_str()
                .filter(|s| !s.is_empty())
                .or(item.data["email"].as_str())
                .unwrap_or("Kontakt")
        } else {
            item.data["title"].as_str().unwrap_or("Termin")
        };
        let mut entry = PreviewItem {
            key: item.key.clone(),
            label: label.into(),
            status: "review".into(),
            reason: "Kein sicherer früherer Importstand. Wird nicht neu angelegt.".into(),
            differences: vec![],
            selectable: false,
            local_id: None,
            next: None,
        };
        let previous = base.get(&item.key);
        let exact_ids = origins.get(item.key.as_str()).cloned().unwrap_or_default();
        let similar: HashSet<usize> = identity_keys(kind, &item.data)
            .iter()
            .flat_map(|key| index.get(key).into_iter().flatten().copied())
            .collect();
        let candidates: Vec<usize> = if let Some(id) = previous.and_then(|p| p.local_id.as_ref()) {
            by_id.get(id.as_str()).copied().into_iter().collect()
        } else if !exact_ids.is_empty() {
            exact_ids
        } else {
            similar.iter().copied().collect()
        };
        if item.key.is_empty() || incoming_counts[&item.key] > 1 {
            entry.reason = "Quell-ID fehlt oder ist mehrfach vorhanden.".into();
        } else if previous.is_some_and(|b| b.local_id.is_some()) && candidates.is_empty() {
            entry.status = "deleted".into();
            entry.reason = "Früher vorhanden, inzwischen entfernt. Bleibt gelöscht.".into();
        } else if candidates.iter().any(|&i| local[i].deleted)
            || similar.iter().any(|&i| local[i].deleted)
        {
            entry.status = "deleted".into();
            entry.reason = "Gelöschter Eintrag bleibt gelöscht.".into();
        } else if candidates.len() > 1 {
            entry.reason = "Mehrere mögliche Zuordnungen. EDV-Prüfung erforderlich.".into();
        } else if let Some(&i) = candidates.first() {
            let current = &local[i];
            let current_content = content(kind, &current.data);
            entry.local_id = Some(current.id.clone());
            entry.differences = source
                .as_object()
                .unwrap()
                .iter()
                .filter(|(k, v)| current_content[*k] != **v)
                .map(|(field, value)| Difference {
                    field: field.clone(),
                    current: current_content[field].clone(),
                    incoming: value.clone(),
                })
                .collect();
            // Similar names alone can block a duplicate, but cannot authorize updating a person.
            let strong_match = current.origin == item.key
                || previous.is_some_and(|p| p.local_id.as_ref() == Some(&current.id))
                || source == current_content
                || (kind == "contacts"
                    && identity_keys(kind, &item.data).iter().any(|key| {
                        key.starts_with("email:")
                            && identity_keys(kind, &current.data).contains(key)
                    }));
            if !claimed.insert(current.id.clone()) {
                entry.reason =
                    "Weitere Quelle für denselben Eintrag. Keine zweite Übernahme.".into();
            } else if !strong_match {
                entry.reason = "Ähnlicher Eintrag gefunden; Zuordnung nicht sicher.".into();
            } else if source == current_content {
                entry.status = "same".into();
                entry.reason = "Bereits vorhanden.".into();
            } else if let Some(previous) = previous.filter(|p| p.local.is_some()) {
                let before = previous.local.as_ref().unwrap();
                let mut next = current.data.clone();
                let mut conflict = false;
                if kind == "calendar" {
                    // Time, all-day semantics and recurrence form one coherent value.
                    // Combining independently edited starts/ends can create invalid events.
                    let schedule = [
                        "startsAt",
                        "endsAt",
                        "isAllDay",
                        "recurrence",
                        "excludedDates",
                        "recurrenceMasterId",
                        "recurrenceId",
                    ];
                    conflict = schedule
                        .iter()
                        .any(|key| current_content[*key] != before[*key])
                        && schedule
                            .iter()
                            .any(|key| source[*key] != previous.source[*key])
                        && schedule
                            .iter()
                            .any(|key| current_content[*key] != source[*key]);
                }
                for (field, value) in source.as_object().unwrap() {
                    if *value == current_content[field] || *value == previous.source[field] {
                        continue;
                    }
                    if current_content[field] != before[field]
                        || (field == "birthday" && !normalized(&current_content[field]).is_empty())
                    {
                        conflict = true;
                    } else {
                        next[field] = value.clone();
                    }
                }
                if conflict {
                    entry.reason = "Beide Seiten geändert. Aktuelle Daten bleiben erhalten.".into();
                } else if content(kind, &next) == current_content {
                    entry.status = "kept".into();
                    entry.reason = "Neuere lokale Änderungen bleiben erhalten.".into();
                } else if current.remote || current.pending {
                    entry.reason = "Exchange-Verknüpfung oder ausstehende Synchronisierung: keine ungeprüfte Überschreibung.".into();
                } else {
                    entry.status = "update".into();
                    entry.reason = "Quelländerung; betroffene Felder lokal unverändert.".into();
                    entry.selectable = true;
                    entry.next = Some(next);
                }
            } else {
                entry.reason = "Unterschiedliche Inhalte ohne Vergleichsstand. Aktuelle Version bleibt erhalten.".into();
            }
        } else if previous.is_none()
            && similar.is_empty()
            && !has_remote
            && base.iter().any(|(key, old)| {
                if kind == "contacts" {
                    item.key
                        .rsplit_once(':')
                        .zip(key.rsplit_once(':'))
                        .is_some_and(|((scope, _), (old_scope, _))| {
                            !scope.is_empty() && scope == old_scope
                        })
                } else {
                    item.data["source"].as_str().is_some_and(|scope| {
                        !scope.is_empty() && old.source["source"].as_str() == Some(scope)
                    })
                }
            })
        {
            entry.status = "new".into();
            entry.reason =
                "Seit der letzten Prüfung neu in der Quelle. Nur nach Auswahl hinzufügen.".into();
            entry.selectable = true;
            entry.next = Some(item.data.clone());
        }
        preview.push(entry);
    }
    // Two new source rows sharing an identity must not both be inserted in one plan.
    let mut new_keys: HashMap<String, Vec<usize>> = HashMap::new();
    for (i, entry) in preview
        .iter()
        .enumerate()
        .filter(|(_, e)| e.status == "new")
    {
        for key in identity_keys(kind, entry.next.as_ref().unwrap()) {
            new_keys.entry(key).or_default().push(i);
        }
    }
    for indexes in new_keys.values().filter(|v| v.len() > 1) {
        for &i in indexes {
            preview[i].status = "review".into();
            preview[i].selectable = false;
            preview[i].reason = "Mehrere neue Quelleinträge mit ähnlicher Identität.".into();
            preview[i].next = None;
        }
    }
    let mut targets: HashMap<String, Vec<usize>> = HashMap::new();
    for (i, entry) in preview.iter().enumerate() {
        if let Some(id) = &entry.local_id {
            targets.entry(id.clone()).or_default().push(i);
        }
    }
    for indexes in targets.values().filter(|items| items.len() > 1) {
        for &i in indexes {
            if preview[i].selectable {
                preview[i].status = "review".into();
                preview[i].selectable = false;
                preview[i].next = None;
                preview[i].reason =
                    "Mehrere Quellen für denselben Eintrag. Keine automatische Auswahl.".into();
            }
        }
    }
    preview
}

fn prepare(
    conn: &Connection,
    kind: &str,
    namespace: &str,
    incoming: Vec<SourceItem>,
    warnings: Vec<String>,
) -> Result<Preview, String> {
    let tx = conn.unchecked_transaction().map_err(err)?;
    let local = load_local(&tx, kind)?;
    let base = load_baseline(&tx, namespace)?;
    let mut items = build_preview(kind, &incoming, &local, &base);
    if !warnings.is_empty() {
        for item in &mut items {
            if item.selectable {
                item.selectable = false;
                item.next = None;
                item.status = "review".into();
                item.reason =
                    "Quelle nicht vollständig lesbar. Bitte vor der Übernahme erneut prüfen."
                        .into();
            }
        }
    }
    let mut counts = BTreeMap::new();
    for item in &items {
        *counts.entry(item.status.clone()).or_insert(0) += 1;
    }
    let preview = Preview {
        token: uuid::Uuid::new_v4().to_string(),
        items,
        counts,
        warnings,
    };
    let plan = Plan {
        kind: kind.into(),
        namespace: namespace.into(),
        fingerprint: fingerprint(&local, &base),
        incoming,
        preview: preview.clone(),
    };
    tx.execute(
        "DELETE FROM reconciliation_plans WHERE expires_at < ?",
        [chrono::Utc::now().timestamp()],
    )
    .map_err(err)?;
    tx.execute(
        "INSERT INTO reconciliation_plans VALUES (?, ?, ?)",
        params![
            preview.token,
            chrono::Utc::now().timestamp() + 1800,
            serde_json::to_string(&plan).map_err(err)?
        ],
    )
    .map_err(err)?;
    tx.commit().map_err(err)?;
    // Only presentation data crosses the bridge; apply loads its own persisted plan.
    let mut public = preview;
    for item in &mut public.items {
        item.next = None;
    }
    Ok(public)
}

fn write_contact(
    tx: &rusqlite::Transaction<'_>,
    id: Option<&str>,
    data: &Value,
) -> Result<String, String> {
    let mut values: Vec<rusqlite::types::Value> = CONTACT_FIELDS
        .iter()
        .map(|(key, _)| rusqlite::types::Value::Text(data[key].as_str().unwrap_or("").into()))
        .collect();
    values.push(super::now().into());
    if let Some(id) = id {
        values.push(id.to_string().into());
        tx.execute(
            &format!(
                "UPDATE contacts SET {}, updated_at=? WHERE id=? AND deleted_at IS NULL",
                CONTACT_FIELDS
                    .iter()
                    .map(|(_, column)| format!("{column}=?"))
                    .collect::<Vec<_>>()
                    .join(",")
            ),
            params_from_iter(values),
        )
        .map_err(err)?;
        super::queue_contact_sync_in_transaction(tx, id.parse::<i64>().map_err(err)?, "upsert")?;
        Ok(id.into())
    } else {
        values.push(super::now().into());
        tx.execute(
            &format!(
                "INSERT INTO contacts ({}, updated_at, created_at) VALUES ({})",
                CONTACT_FIELDS
                    .iter()
                    .map(|(_, column)| *column)
                    .collect::<Vec<_>>()
                    .join(","),
                vec!["?"; values.len()].join(",")
            ),
            params_from_iter(values),
        )
        .map_err(err)?;
        let id = tx.last_insert_rowid();
        super::queue_contact_sync_in_transaction(tx, id, "upsert")?;
        Ok(id.to_string())
    }
}

fn apply(conn: &mut Connection, token: &str, selected: &[String]) -> Result<Applied, String> {
    let tx = conn
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(err)?;
    let raw: String = tx
        .query_row(
            "SELECT payload FROM reconciliation_plans WHERE token=? AND expires_at>=?",
            params![token, chrono::Utc::now().timestamp()],
            |r| r.get(0),
        )
        .optional()
        .map_err(err)?
        .ok_or("Vorschau abgelaufen oder bereits übernommen. Bitte erneut prüfen.")?;
    let plan: Plan = serde_json::from_str(&raw).map_err(err)?;
    let local = load_local(&tx, &plan.kind)?;
    let mut base = load_baseline(&tx, &plan.namespace)?;
    if fingerprint(&local, &base) != plan.fingerprint {
        return Err("Daten wurden seit der Vorschau geändert. Bitte erneut prüfen; es wurde nichts übernommen.".into());
    }
    let selected: HashSet<&str> = selected.iter().map(String::as_str).collect();
    if selected.iter().any(|key| {
        !plan
            .preview
            .items
            .iter()
            .any(|e| e.key == *key && e.selectable)
    }) {
        return Err("Die Auswahl enthält geschützte oder unbekannte Einträge.".into());
    }
    let mut result = Applied {
        added: 0,
        updated: 0,
        unchanged: 0,
        review: 0,
    };
    let mut changes = Vec::new();
    let by_id: HashMap<&str, &LocalItem> = local.iter().map(|v| (v.id.as_str(), v)).collect();
    for (source, entry) in plan.incoming.iter().zip(&plan.preview.items) {
        let before = entry
            .local_id
            .as_ref()
            .and_then(|id| by_id.get(id.as_str()).copied());
        if selected.contains(entry.key.as_str()) {
            let mut next = entry.next.clone().ok_or("Ungültiger Abgleichplan")?;
            let id = if plan.kind == "contacts" {
                write_contact(&tx, entry.local_id.as_deref(), &next)?
            } else {
                let id = entry.local_id.clone().unwrap_or_else(|| source.key.clone());
                next["id"] = json!(id);
                next["updatedAt"] = json!(super::now());
                next["deletedAt"] = Value::Null;
                let event: super::CalendarEvent =
                    serde_json::from_value(next.clone()).map_err(err)?;
                super::write_calendar_events_in_transaction(&tx, &[event], true)?;
                id
            };
            if before.is_some() {
                result.updated += 1;
            } else {
                result.added += 1;
            }
            changes.push(json!({"id":id, "before":before.map(|v| &v.data), "after":next}));
            base.insert(
                source.key.clone(),
                Baseline {
                    source: source.data.clone(),
                    local: Some(content(&plan.kind, &next)),
                    local_id: Some(id),
                },
            );
        } else {
            result.unchanged += 1;
            if entry.status == "review" {
                result.review += 1;
            }
            // Do not turn an unresolved difference into an accepted baseline.
            if entry.status == "same" {
                base.insert(
                    source.key.clone(),
                    Baseline {
                        source: source.data.clone(),
                        local: before.map(|v| content(&plan.kind, &v.data)),
                        local_id: entry.local_id.clone(),
                    },
                );
            } else if !base.contains_key(&source.key) {
                base.insert(
                    source.key.clone(),
                    Baseline {
                        source: source.data.clone(),
                        local: None,
                        local_id: entry.local_id.clone(),
                    },
                );
            }
        }
    }
    tx.execute("INSERT INTO reconciliation_baselines VALUES (?,?) ON CONFLICT(namespace) DO UPDATE SET payload=excluded.payload",
        params![plan.namespace, serde_json::to_string(&base).map_err(err)?]).map_err(err)?;
    tx.execute(
        "INSERT INTO reconciliation_runs VALUES (?,?,?,?)",
        params![
            token,
            super::now(),
            plan.kind,
            serde_json::to_string(&changes).map_err(err)?
        ],
    )
    .map_err(err)?;
    tx.execute("DELETE FROM reconciliation_plans WHERE token=?", [token])
        .map_err(err)?;
    tx.commit().map_err(err)?;
    Ok(result)
}

fn source_items(kind: &str, platform: &str) -> Result<(Vec<SourceItem>, Vec<String>), String> {
    match (kind, platform) {
        ("contacts", "outlook") => {
            let source = super::read_outlook_classic_contacts()?;
            let mut warnings = Vec::new();
            if source.skipped > 0 {
                warnings.push(format!(
                    "{} Quelleinträge konnten nicht gelesen werden.",
                    source.skipped
                ));
            }
            let items = source
                .contacts
                .iter()
                .filter(|record| !super::is_outlook_autocomplete_record(record))
                .map(|record| {
                    let data = super::outlook_record_to_contact(record);
                    Ok(SourceItem {
                        key: if record.entry_id.is_empty() || record.store_id.is_empty() {
                            String::new()
                        } else {
                            format!("{}:{}", record.store_id, record.entry_id)
                        },
                        data: serde_json::to_value(data).map_err(err)?,
                    })
                })
                .collect::<Result<Vec<_>, String>>()?;
            Ok((items, warnings))
        }
        ("contacts", "thunderbird") => {
            Ok((super::thunderbird::read_reconciliation_contacts()?, vec![]))
        }
        ("calendar", "outlook") => {
            let source = super::outlook_appointments_for_import(
                super::read_outlook_classic_appointments()?,
                true,
            )?;
            let warnings = if source.skipped_invalid > 0 {
                vec![format!(
                    "{} Termine konnten nicht vollständig gelesen werden.",
                    source.skipped_invalid
                )]
            } else {
                vec![]
            };
            Ok((
                source
                    .events
                    .into_iter()
                    .map(|event| {
                        Ok(SourceItem {
                            key: event.id.clone(),
                            data: serde_json::to_value(event).map_err(err)?,
                        })
                    })
                    .collect::<Result<_, String>>()?,
                warnings,
            ))
        }
        ("calendar", "thunderbird") => {
            let source = super::thunderbird::import_thunderbird_calendars_once()?;
            let warnings = if source.skipped_invalid > 0 {
                vec![format!(
                    "{} Termine konnten nicht vollständig gelesen werden.",
                    source.skipped_invalid
                )]
            } else {
                vec![]
            };
            Ok((
                source
                    .events
                    .into_iter()
                    .map(|event| {
                        let event: super::CalendarEvent =
                            serde_json::from_value(serde_json::to_value(event).map_err(err)?)
                                .map_err(err)?;
                        Ok(SourceItem {
                            key: event.id.clone(),
                            data: serde_json::to_value(event).map_err(err)?,
                        })
                    })
                    .collect::<Result<_, String>>()?,
                warnings,
            ))
        }
        _ => Err("Unbekannte Abgleichquelle.".into()),
    }
}

#[tauri::command]
pub async fn preview_reconciliation(
    app: AppHandle,
    kind: String,
    platform: String,
) -> Result<Preview, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let (incoming, warnings) = source_items(&kind, &platform)?;
        if incoming.is_empty() {
            return Err("Keine lesbaren Einträge gefunden. Es wurde nichts geändert.".into());
        }
        let conn = super::open_db(&app)?;
        prepare(
            &conn,
            &kind,
            &format!("{kind}:{platform}"),
            incoming,
            warnings,
        )
    })
    .await
    .map_err(err)?
}

#[tauri::command]
pub async fn apply_reconciliation(
    app: AppHandle,
    token: String,
    selected: Vec<String>,
) -> Result<Applied, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut conn = super::open_db(&app)?;
        let raw: String = conn.query_row("SELECT payload FROM reconciliation_plans WHERE token=?", [&token], |r| r.get(0)).map_err(err)?;
        let plan: Plan = serde_json::from_str(&raw).map_err(err)?;
        let platform = plan.namespace.split_once(':').ok_or("Ungültiger Abgleichplan")?.1;
        let (current, warnings) = source_items(&plan.kind, platform)?;
        if !warnings.is_empty() || source_fingerprint(&plan.kind, &current) != source_fingerprint(&plan.kind, &plan.incoming) {
            return Err("Die Quelle wurde seit der Vorschau geändert oder ist nicht vollständig lesbar. Bitte erneut prüfen.".into());
        }
        apply(&mut conn, &token, &selected)
    }).await.map_err(err)?
}

fn source_fingerprint(kind: &str, items: &[SourceItem]) -> String {
    let mut values = items
        .iter()
        .map(|item| (item.key.clone(), content(kind, &item.data).to_string()))
        .collect::<Vec<_>>();
    values.sort();
    format!(
        "{:x}",
        Sha256::digest(serde_json::to_vec(&values).expect("source snapshot"))
    )
}

#[cfg(test)]
mod tests;
