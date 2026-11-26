//! Birthdays are dates, not instants. Missing/invalid input never clears a saved date.
use chrono::{Datelike, NaiveDate};
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SourceContact {
    pub entry_id: String,
    pub store_id: String,
    pub display_name: String,
    pub emails: Vec<String>,
    pub phones: Vec<String>,
    pub birthday: String,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub(crate) struct SourceSnapshot {
    pub contacts: Vec<SourceContact>,
    pub errors: Vec<String>,
    pub stores: usize,
}

impl SourceContact {
    pub fn key(&self) -> String {
        serde_json::to_string(&(
            self.store_id.to_lowercase(),
            self.entry_id.to_lowercase(),
            &self.birthday,
        ))
        .unwrap()
    }

    fn entry_key(&self) -> (String, String) {
        // Outlook MAPI entry IDs are hex, Graph IDs are case-sensitive base64.
        if !self.store_id.is_empty() && self.store_id.bytes().all(|byte| byte.is_ascii_hexdigit()) {
            (self.store_id.to_uppercase(), self.entry_id.to_uppercase())
        } else {
            (self.store_id.clone(), self.entry_id.clone())
        }
    }
}

fn same_email(left: &SourceContact, right: &SourceContact) -> bool {
    left.emails
        .iter()
        .filter(|email| !email.trim().is_empty())
        .any(|a| {
            right
                .emails
                .iter()
                .any(|b| a.trim().eq_ignore_ascii_case(b.trim()))
        })
}

fn same_name_phone(left: &SourceContact, right: &SourceContact) -> bool {
    if !left.emails.is_empty() && !right.emails.is_empty() && !same_email(left, right) {
        return false;
    }
    !left.display_name.trim().is_empty()
        && left
            .display_name
            .trim()
            .eq_ignore_ascii_case(right.display_name.trim())
        && left
            .phones
            .iter()
            .map(|value| crate::normalize_phone_for_match(value))
            .filter(|value| !value.is_empty())
            .any(|a| {
                right
                    .phones
                    .iter()
                    .any(|b| a == crate::normalize_phone_for_match(b))
            })
}

#[derive(Default)]
struct IdentityIndex {
    entries: std::collections::HashMap<(String, String), Vec<usize>>,
    emails: std::collections::HashMap<String, Vec<usize>>,
    names: std::collections::HashMap<String, Vec<usize>>,
}

impl IdentityIndex {
    fn new(targets: &[SourceContact]) -> Self {
        let mut result = Self::default();
        for (index, target) in targets.iter().enumerate() {
            if !target.entry_id.is_empty() && !target.store_id.is_empty() {
                result
                    .entries
                    .entry(target.entry_key())
                    .or_default()
                    .push(index);
            }
            for email in target
                .emails
                .iter()
                .filter(|email| !email.trim().is_empty())
            {
                result
                    .emails
                    .entry(email.trim().to_lowercase())
                    .or_default()
                    .push(index);
            }
            if !target.display_name.trim().is_empty() {
                result
                    .names
                    .entry(target.display_name.trim().to_lowercase())
                    .or_default()
                    .push(index);
            }
        }
        result
    }

    // A name by itself never proves identity. Indexes keep the backfill linear
    // for ordinary address books, instead of comparing every pair of contacts.
    fn matches(&self, source: &SourceContact, targets: &[SourceContact]) -> Vec<usize> {
        if let Some(direct) = self.entries.get(&source.entry_key()) {
            return direct.clone();
        }
        let mut emails = source
            .emails
            .iter()
            .flat_map(|email| {
                self.emails
                    .get(&email.trim().to_lowercase())
                    .into_iter()
                    .flatten()
            })
            .copied()
            .collect::<Vec<_>>();
        emails.sort_unstable();
        emails.dedup();
        if !emails.is_empty() {
            return emails;
        }
        self.names
            .get(&source.display_name.trim().to_lowercase())
            .into_iter()
            .flatten()
            .copied()
            .filter(|index| same_name_phone(source, &targets[*index]))
            .collect()
    }
}

/// Conflicting source dates must not race to fill the same empty destination.
pub(crate) fn assignments(
    sources: &[SourceContact],
    targets: &[SourceContact],
) -> Vec<Option<usize>> {
    let index = IdentityIndex::new(targets);
    let mut choices = sources
        .iter()
        .map(|source| {
            let found = index.matches(source, targets);
            if !normalize(&source.birthday).is_empty() && found.len() == 1 {
                Some(found[0])
            } else {
                None
            }
        })
        .collect::<Vec<_>>();
    let mut dates = std::collections::HashMap::<usize, std::collections::HashSet<String>>::new();
    for (source, target) in sources.iter().zip(&choices) {
        if let Some(target) = target {
            dates
                .entry(*target)
                .or_default()
                .insert(normalize(&source.birthday));
        }
    }
    for choice in &mut choices {
        if choice.is_some_and(|target| dates[&target].len() > 1) {
            *choice = None;
        }
    }
    choices
}

pub(crate) fn normalize(value: &str) -> String {
    let value = value.trim();
    let date = if value.len() == 10 {
        NaiveDate::parse_from_str(value, "%Y-%m-%d")
            .ok()
            .or_else(|| NaiveDate::parse_from_str(value, "%d.%m.%Y").ok())
    } else if value.len() == 8 && value.bytes().all(|c| c.is_ascii_digit()) {
        NaiveDate::parse_from_str(value, "%Y%m%d").ok()
    } else {
        chrono::DateTime::parse_from_rfc3339(value)
            .ok()
            .map(|date| date.date_naive())
    };
    date.filter(|date| date.year() > 0 && date.year() < 4501)
        .map(|date| date.format("%Y-%m-%d").to_string())
        .unwrap_or_default()
}

pub(crate) fn fill_missing(target: &mut String, source: &str) {
    if target.trim().is_empty() {
        *target = normalize(source);
    }
}

pub(crate) fn graph_value(value: &str) -> Option<String> {
    let date = normalize(value);
    (!date.is_empty()).then(|| format!("{date}T00:00:00Z"))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn dates_never_shift_with_timezone_and_outlook_empty_sentinel_is_ignored() {
        assert_eq!(normalize("1980-02-29T23:00:00-07:00"), "1980-02-29");
        assert_eq!(normalize("1604-02-29"), "1604-02-29");
        for value in ["", "4501-01-01", "2025-02-29", "not a date"] {
            assert_eq!(normalize(value), "");
        }
    }
    #[test]
    fn recovery_is_fill_only_and_idempotent() {
        let mut date = String::new();
        fill_missing(&mut date, "1975-06-12");
        fill_missing(&mut date, "");
        fill_missing(&mut date, "1980-01-02");
        assert_eq!(date, "1975-06-12");
        assert_eq!(graph_value(&date).as_deref(), Some("1975-06-12T00:00:00Z"));
        assert_eq!(graph_value(""), None);
    }

    fn person(email: &str, birthday: &str) -> SourceContact {
        SourceContact {
            display_name: "Alex Example".into(),
            emails: if email.is_empty() {
                vec![]
            } else {
                vec![email.into()]
            },
            phones: vec!["07157 123456".into()],
            birthday: birthday.into(),
            ..Default::default()
        }
    }

    #[test]
    fn recovery_requires_unique_identity_and_does_not_guess_from_a_name() {
        let source = person("A@example.test", "1970-02-28");
        let target = person("a@example.test", "");
        assert_eq!(
            assignments(&[source.clone()], &[target.clone()]),
            vec![Some(0)]
        );
        assert_eq!(
            assignments(&[source.clone()], &[target.clone(), target]),
            vec![None]
        );
        assert_eq!(
            assignments(&[source.clone()], &[person("different@example.test", "")]),
            vec![None]
        );
        let mut name_only = person("", "");
        name_only.phones.clear();
        assert_eq!(assignments(&[source.clone()], &[name_only]), vec![None]);
        assert_eq!(assignments(&[source], &[]), vec![None]);
        assert_eq!(
            assignments(&[person("", "1970-02-28")], &[person("", "")]),
            vec![Some(0)]
        );
    }

    #[test]
    fn conflicting_source_dates_are_not_chosen_arbitrarily() {
        let source = person("a@example.test", "1970-02-28");
        let mut conflicting = source.clone();
        conflicting.birthday = "1980-02-28".into();
        assert_eq!(
            assignments(
                &[source.clone(), conflicting],
                &[person("a@example.test", "")]
            ),
            vec![None, None]
        );
        assert_eq!(
            assignments(&[source.clone(), source], &[person("a@example.test", "")]),
            vec![Some(0), Some(0)]
        );
    }

    #[test]
    fn retained_outlook_entry_ids_disambiguate_duplicate_names_and_emails() {
        let mut source = person("a@example.test", "1970-02-28");
        source.entry_id = "aabb".into();
        source.store_id = "ccdd".into();
        let mut target = source.clone();
        target.entry_id = "AABB".into();
        target.store_id = "CCDD".into();
        target.birthday.clear();
        assert_eq!(
            assignments(&[source], &[person("a@example.test", ""), target]),
            vec![Some(1)]
        );
    }

    #[test]
    fn graph_contact_ids_remain_case_sensitive() {
        let mut source = person("a@example.test", "1970-02-28");
        source.entry_id = "AbC".into();
        source.store_id = "me:contacts".into();
        let mut different = source.clone();
        different.entry_id = "abc".into();
        assert_eq!(
            assignments(&[source.clone()], &[different, source]),
            vec![Some(1)]
        );
    }
}
