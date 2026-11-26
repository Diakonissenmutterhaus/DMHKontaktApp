//! Read-only recovery from the retained Outlook profile. No Outlook automation,
//! profile activation, credential prompts, writes, or calendar creation.
use crate::{AppResult, ComApartment};
use outlook_mapi::{
    sys::*, Initialize, MAPIOutParam, PropValue, PropValueData, RowSet, SizedSPropTagArray,
};
use serde::Serialize;
use std::{collections::HashSet, ptr};
use windows::Win32::{
    Foundation::{FILETIME, SYSTEMTIME},
    System::Time::FileTimeToSystemTime,
};
use windows_core::{Interface, GUID};

const ADDRESS_SET: GUID = GUID::from_u128(0x00062004_0000_0000_c000_000000000046);
const MAX_FOLDERS: usize = 4096;
const MAX_CONTACTS: usize = 50000;

#[derive(Default, Serialize)]
#[serde(rename_all = "camelCase")]
struct BirthdayContact {
    entry_id: String,
    store_id: String,
    display_name: String,
    emails: Vec<String>,
    phones: Vec<String>,
    birthday: String,
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02X}")).collect()
}
fn text(value: PropValueData<'_>) -> String {
    match value {
        PropValueData::Unicode(value) => String::from_utf16_lossy(&value)
            .trim_end_matches('\0')
            .trim()
            .into(),
        _ => String::new(),
    }
}

fn date(value: FILETIME, local_property: bool) -> String {
    let mut system = SYSTEMTIME::default();
    if unsafe { FileTimeToSystemTime(&value, &mut system) }.is_err()
        || system.wYear < 1601
        || system.wYear >= 4501
    {
        return String::new();
    }
    // BirthdayLocal is a wall date. Modern PR_BIRTHDAY is 11:59 UTC. Older
    // PR_BIRTHDAY values have ambiguous time-zone semantics: don't guess a day.
    if !local_property && (system.wHour != 11 || system.wMinute != 59) {
        return String::new();
    }
    format!(
        "{:04}-{:02}-{:02}",
        system.wYear, system.wMonth, system.wDay
    )
}

unsafe fn named_tag(store: &IMsgStore, id: i32, kind: u32) -> AppResult<u32> {
    let mut name = MAPINAMEID {
        lpguid: &ADDRESS_SET as *const _ as *mut _,
        ulKind: MNID_ID,
        Kind: MAPINAMEID_0 { lID: id },
    };
    let mut name_ptr = &mut name as *mut _;
    let mut output: MAPIOutParam<SPropTagArray> = Default::default();
    // No MAPI_CREATE: this lookup must never change the source store.
    if store
        .GetIDsFromNames(1, &mut name_ptr, 0, output.as_mut_ptr())
        .is_err()
    {
        return Ok(PR_NULL);
    }
    let Some(output) = output.as_mut() else {
        return Ok(PR_NULL);
    };
    let tag = output.aulPropTag[0];
    Ok(if tag & 0xffff == PT_ERROR {
        PR_NULL
    } else {
        (tag & 0xffff0000) | kind
    })
}

unsafe fn folder(store: &IMsgStore, id: &[u8]) -> AppResult<IMAPIFolder> {
    let mut object = None;
    let mut object_type = 0;
    store
        .OpenEntry(
            id.len() as u32,
            if id.is_empty() {
                ptr::null_mut()
            } else {
                id.as_ptr() as *mut _
            },
            &IMAPIFolder::IID as *const _ as *mut _,
            0,
            &mut object_type,
            &mut object,
        )
        .map_err(|e| format!("Kontaktordner kann nicht gelesen werden: {e}"))?;
    object
        .ok_or("Kontaktordner fehlt.")?
        .cast()
        .map_err(|e| e.to_string())
}

unsafe fn deleted_folder(store: &IMsgStore) -> AppResult<Vec<u8>> {
    SizedSPropTagArray! { Tags[1] }
    let mut tags = Tags {
        aulPropTag: [PR_IPM_WASTEBASKET_ENTRYID],
        ..Default::default()
    };
    let mut count = 0;
    let mut values: MAPIOutParam<SPropValue> = Default::default();
    store
        .GetProps(tags.as_mut_ptr(), 0, &mut count, values.as_mut_ptr())
        .map_err(|e| e.to_string())?;
    if let Some(value) = values.as_mut() {
        if let PropValueData::Binary(id) = PropValue::from(&*value).value {
            return Ok(id.to_vec());
        }
    }
    // Without this boundary a deleted contact could be mistaken for a live one.
    Err("Papierkorb-Grenze des Kontaktstores ist nicht lesbar.".into())
}

unsafe fn contacts(
    store: &IMsgStore,
    folder: &IMAPIFolder,
    store_id: &str,
    output: &mut Vec<BirthdayContact>,
    uncertain_dates: &mut usize,
) -> AppResult<()> {
    let birthday_tag = named_tag(store, 0x80de, PT_SYSTIME)?;
    let mail_tags = [
        named_tag(store, 0x8083, PT_UNICODE)?,
        named_tag(store, 0x8093, PT_UNICODE)?,
        named_tag(store, 0x80a3, PT_UNICODE)?,
    ];
    let type_tags = [
        named_tag(store, 0x8082, PT_UNICODE)?,
        named_tag(store, 0x8092, PT_UNICODE)?,
        named_tag(store, 0x80a2, PT_UNICODE)?,
    ];
    SizedSPropTagArray! { Tags[15] }
    let mut tags = Tags {
        aulPropTag: [
            PR_ENTRYID,
            PR_DISPLAY_NAME_W,
            PR_MESSAGE_CLASS_W,
            birthday_tag,
            PR_BIRTHDAY,
            mail_tags[0],
            mail_tags[1],
            mail_tags[2],
            type_tags[0],
            type_tags[1],
            type_tags[2],
            PR_BUSINESS_TELEPHONE_NUMBER_W,
            PR_HOME_TELEPHONE_NUMBER_W,
            PR_MOBILE_TELEPHONE_NUMBER_W,
            PR_HOME2_TELEPHONE_NUMBER_W,
        ],
        ..Default::default()
    };
    let table = folder.GetContentsTable(0).map_err(|e| e.to_string())?;
    table
        .SetColumns(tags.as_mut_ptr(), 0)
        .map_err(|e| e.to_string())?;
    let mut seen = 0;
    loop {
        let mut rows = RowSet::default();
        table
            .QueryRows(128, 0, rows.as_mut_ptr())
            .map_err(|e| e.to_string())?;
        if rows.is_empty() {
            break;
        }
        seen += rows.len();
        if seen > MAX_CONTACTS || output.len() > MAX_CONTACTS {
            return Err("Zu viele Kontakte für einen sicheren Wiederherstellungslauf.".into());
        }
        for row in rows {
            let mut contact = BirthdayContact {
                store_id: store_id.into(),
                ..Default::default()
            };
            let mut class = String::new();
            let mut legacy = String::new();
            let mut ambiguous_legacy = false;
            let mut emails = [String::new(), String::new(), String::new()];
            let mut types = [String::new(), String::new(), String::new()];
            for (index, prop) in row.iter().enumerate() {
                match index {
                    0 => {
                        if let PropValueData::Binary(id) = prop.value {
                            contact.entry_id = hex(id);
                        }
                    }
                    1 => contact.display_name = text(prop.value),
                    2 => class = text(prop.value),
                    3 => {
                        if let PropValueData::FileTime(v) = prop.value {
                            contact.birthday = date(v, true);
                        }
                    }
                    4 => {
                        if let PropValueData::FileTime(v) = prop.value {
                            legacy = date(v, false);
                            ambiguous_legacy = legacy.is_empty() && !date(v, true).is_empty();
                        }
                    }
                    5..=7 => emails[index - 5] = text(prop.value),
                    8..=10 => types[index - 8] = text(prop.value),
                    _ => {
                        let phone = text(prop.value);
                        if !phone.is_empty() {
                            contact.phones.push(phone);
                        }
                    }
                }
            }
            if contact.birthday.is_empty() {
                contact.birthday = legacy;
            }
            if class.eq_ignore_ascii_case("IPM.Contact")
                && contact.birthday.is_empty()
                && ambiguous_legacy
            {
                *uncertain_dates += 1;
            }
            if !class.eq_ignore_ascii_case("IPM.Contact") || contact.birthday.is_empty() {
                continue;
            }
            for (email, kind) in emails.into_iter().zip(types) {
                if kind.eq_ignore_ascii_case("SMTP") && email.contains('@') {
                    contact.emails.push(email.to_lowercase());
                }
            }
            output.push(contact);
        }
    }
    Ok(())
}

unsafe fn read_store(
    store: &IMsgStore,
    store_id: &str,
    output: &mut Vec<BirthdayContact>,
    uncertain_dates: &mut usize,
) -> AppResult<()> {
    let deleted = deleted_folder(store)?;
    let mut pending = vec![Vec::new()];
    let mut visited = HashSet::new();
    while let Some(id) = pending.pop() {
        if id == deleted || !visited.insert(id.clone()) {
            continue;
        }
        if visited.len() > MAX_FOLDERS {
            return Err(
                "Zu viele Outlook-Ordner für einen sicheren Wiederherstellungslauf.".into(),
            );
        }
        let parent = folder(store, &id)?;
        SizedSPropTagArray! { Tags[2] }
        let mut tags = Tags {
            aulPropTag: [PR_ENTRYID, PR_CONTAINER_CLASS_W],
            ..Default::default()
        };
        let table = parent.GetHierarchyTable(0).map_err(|e| e.to_string())?;
        table
            .SetColumns(tags.as_mut_ptr(), 0)
            .map_err(|e| e.to_string())?;
        loop {
            let mut rows = RowSet::default();
            table
                .QueryRows(64, 0, rows.as_mut_ptr())
                .map_err(|e| e.to_string())?;
            if rows.is_empty() {
                break;
            }
            for row in rows {
                let mut child = Vec::new();
                let mut class = String::new();
                for (index, value) in row.iter().enumerate() {
                    if index == 0 {
                        if let PropValueData::Binary(value) = value.value {
                            child = value.to_vec();
                        }
                    } else {
                        class = text(value.value);
                    }
                }
                if child.is_empty() || child == deleted {
                    continue;
                }
                if class.eq_ignore_ascii_case("IPF.Contact") {
                    contacts(
                        store,
                        &folder(store, &child)?,
                        store_id,
                        output,
                        uncertain_dates,
                    )?;
                }
                pending.push(child);
            }
        }
    }
    Ok(())
}

pub(crate) fn read(profile: &str) -> AppResult<serde_json::Value> {
    let _com = ComApartment::initialize()?;
    let _initialized = Initialize::new(Default::default()).map_err(|e| e.to_string())?;
    let mut wide = profile.encode_utf16().chain(Some(0)).collect::<Vec<_>>();
    let mut session = None;
    unsafe {
        MAPILogonEx(
            0,
            wide.as_mut_ptr().cast(),
            ptr::null_mut(),
            MAPI_EXTENDED
                | MAPI_NEW_SESSION
                | MAPI_EXPLICIT_PROFILE
                | MAPI_UNICODE
                | MAPI_NO_MAIL
                | MAPI_TIMEOUT_SHORT,
            &mut session,
        )
        .map_err(|e| format!("Altes Outlook-Profil ist nicht still lesbar: {e}"))?;
    }
    let session = session.ok_or("MAPI-Sitzung fehlt.")?;
    let mut output = Vec::new();
    let mut errors = Vec::new();
    let mut stores = 0;
    let mut uncertain_dates = 0;
    unsafe {
        SizedSPropTagArray! { Tags[1] }
        let mut tags = Tags {
            aulPropTag: [PR_ENTRYID],
            ..Default::default()
        };
        let table = session.GetMsgStoresTable(0).map_err(|e| e.to_string())?;
        table
            .SetColumns(tags.as_mut_ptr(), 0)
            .map_err(|e| e.to_string())?;
        loop {
            let mut rows = RowSet::default();
            table
                .QueryRows(32, 0, rows.as_mut_ptr())
                .map_err(|e| e.to_string())?;
            if rows.is_empty() {
                break;
            }
            for row in rows {
                stores += 1;
                if stores > 128 {
                    return Err("Zu viele Outlook-Stores.".into());
                }
                let Some(PropValue {
                    value: PropValueData::Binary(id),
                    ..
                }) = row.iter().next()
                else {
                    continue;
                };
                let mut store = None;
                let opened = session.OpenMsgStore(
                    0,
                    id.len() as u32,
                    id.as_ptr() as *mut _,
                    &IMsgStore::IID as *const _ as *mut _,
                    MDB_NO_DIALOG | MDB_NO_MAIL,
                    &mut store,
                );
                let result = opened.map_err(|e| e.to_string()).and_then(|_| {
                    let store = store.ok_or("Outlook-Store fehlt.")?;
                    read_store(&store, &hex(id), &mut output, &mut uncertain_dates)
                });
                if let Err(error) = result {
                    errors.push(format!("Store {stores}: {error}"));
                }
            }
        }
    }
    // Partial results can safely fill existing contacts; errors keep the scan retryable.
    if stores == 0 {
        return Err("Das frühere Outlook-Profil enthält keine lesbaren Datenspeicher.".into());
    }
    if uncertain_dates > 0 {
        errors.push(format!("{uncertain_dates} ältere Geburtstagswerte haben keine eindeutige Datums-/Zeitzonenangabe; bitte durch EDV prüfen."));
    }
    Ok(serde_json::json!({"contacts":output,"errors":errors,"stores":stores}))
}

#[cfg(test)]
mod tests {
    use super::*;
    use windows::Win32::System::Time::SystemTimeToFileTime;
    fn filetime(year: u16, month: u16, day: u16, hour: u16, minute: u16) -> FILETIME {
        let value = SYSTEMTIME {
            wYear: year,
            wMonth: month,
            wDay: day,
            wHour: hour,
            wMinute: minute,
            ..Default::default()
        };
        let mut result = FILETIME::default();
        unsafe {
            SystemTimeToFileTime(&value, &mut result).unwrap();
        }
        result
    }
    #[test]
    fn birthday_local_never_shifts_day_and_empty_outlook_date_is_ignored() {
        assert_eq!(date(filetime(1980, 2, 29, 0, 0), true), "1980-02-29");
        assert_eq!(date(filetime(1604, 2, 29, 0, 0), true), "1604-02-29");
        assert_eq!(date(filetime(4501, 1, 1, 0, 0), true), "");
        assert_eq!(date(filetime(1975, 6, 12, 11, 59), false), "1975-06-12");
        assert_eq!(date(filetime(1975, 6, 11, 23, 0), false), ""); // Ambiguous old UTC format.
    }
}
