//! Outlook Classic profile administration. This module never logs on, receives a
//! password, rewrites registry profiles, or changes an existing message service.
//! Authentication and connection verification happen in Outlook before activate.
//!
//! SMTP bootstrap follows Microsoft's Outlook 2016+ MAPI example:
//! https://learn.microsoft.com/office/client-developer/outlook/mapi/how-to-programmatically-create-a-profile-in-outlook

use crate::{AppResult, ComApartment};
use outlook_mapi::{sys, Initialize, PropValueData, RowSet, SizedSPropTagArray};
use serde::Serialize;
use std::{ffi::CString, ptr, sync::Arc};
use windows::Win32::Globalization::{
    GetACP, MultiByteToWideChar, WideCharToMultiByte, CP_ACP, MB_ERR_INVALID_CHARS,
    WC_NO_BEST_FIT_CHARS,
};
use windows_core::{BOOL, PCSTR, PWSTR};

const PR_PROFILE_USER_SMTP_EMAIL_ADDRESS_W: u32 = 0x6641_001f;
const PR_EMSMDB_SECTION_UID: u32 = 0x3d15_0102;
const MAPI_FORCE_ACCESS: u32 = 0x0008_0000;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Profile {
    name: String,
    is_default: bool,
}

struct ProfileAdmin {
    // COM interfaces must be released before MAPIUninitialize/CoUninitialize.
    admin: sys::IProfAdmin,
    _initialized: Arc<Initialize>,
    _com: ComApartment,
}

fn mapi_error(operation: &str, error: windows_core::Error) -> String {
    // HRESULT only: provider descriptions can contain private server details.
    format!("{operation} (0x{:08X}).", error.code().0 as u32)
}

fn validate_profile_name(name: &str) -> AppResult<()> {
    if name.is_empty()
        || name.trim() != name
        || name.chars().count() > 64
        || name
            .chars()
            .any(|c| c.is_control() || matches!(c, '\\' | '/' | '"'))
    {
        return Err("Ungültiger Outlook-Profilname.".into());
    }
    Ok(())
}

fn validate_email(email: &str) -> AppResult<()> {
    let mut parts = email.split('@');
    let local = parts.next().unwrap_or_default();
    let domain = parts.next().unwrap_or_default();
    if email.len() > 254
        || local.is_empty()
        || domain.is_empty()
        || parts.next().is_some()
        || email.chars().any(|c| c.is_control() || c.is_whitespace())
        || email.contains(['\\', '/', '"', '<', '>'])
    {
        return Err("Ungültige Microsoft-365-E-Mail-Adresse.".into());
    }
    Ok(())
}

fn exists(profiles: &[Profile], name: &str) -> bool {
    profiles
        .iter()
        .any(|profile| profile.name.eq_ignore_ascii_case(name))
}

// CreateProfile and RenameProfile use ANSI profile names. Do not silently turn
// an existing accented name into a different profile through lossy conversion.
fn ansi_name(name: &str) -> AppResult<Vec<u8>> {
    validate_profile_name(name)?;
    if name.is_ascii() {
        return Ok(name.bytes().chain(Some(0)).collect());
    }
    if unsafe { GetACP() } == 65001 {
        return Ok(name.bytes().chain(Some(0)).collect());
    }
    let wide: Vec<u16> = name.encode_utf16().collect();
    let mut used_default = BOOL(0);
    let needed = unsafe {
        WideCharToMultiByte(
            CP_ACP,
            WC_NO_BEST_FIT_CHARS,
            &wide,
            None,
            PCSTR::null(),
            Some(&mut used_default),
        )
    };
    if needed == 0 || used_default.as_bool() {
        return Err("Der bestehende Profilname kann nicht verlustfrei umbenannt werden.".into());
    }
    let mut bytes = vec![0; needed as usize + 1];
    let written = unsafe {
        WideCharToMultiByte(
            CP_ACP,
            WC_NO_BEST_FIT_CHARS,
            &wide,
            Some(&mut bytes[..needed as usize]),
            PCSTR::null(),
            Some(&mut used_default),
        )
    };
    if written != needed || used_default.as_bool() {
        return Err("Der bestehende Profilname kann nicht verlustfrei umbenannt werden.".into());
    }
    Ok(bytes)
}

fn decode_ansi_name(bytes: &[u8]) -> AppResult<String> {
    if bytes.is_empty() || bytes.len() > 1024 || bytes.contains(&0) {
        return Err("Outlook-Profilname ist ungültig.".into());
    }
    let needed = unsafe { MultiByteToWideChar(CP_ACP, MB_ERR_INVALID_CHARS, bytes, None) };
    if needed == 0 {
        return Err("Outlook-Profilname konnte nicht verlustfrei gelesen werden.".into());
    }
    let mut wide = vec![0; needed as usize];
    let written =
        unsafe { MultiByteToWideChar(CP_ACP, MB_ERR_INVALID_CHARS, bytes, Some(&mut wide)) };
    if written != needed {
        return Err("Outlook-Profilname konnte nicht verlustfrei gelesen werden.".into());
    }
    let name =
        String::from_utf16(&wide).map_err(|_| "Outlook-Profilname ist ungültig.".to_string())?;
    let encoded = ansi_name(&name)?;
    if encoded.strip_suffix(&[0]) != Some(bytes) {
        return Err("Outlook-Profilname konnte nicht verlustfrei gelesen werden.".into());
    }
    Ok(name)
}

impl ProfileAdmin {
    fn open() -> AppResult<Self> {
        let com = ComApartment::initialize()?;
        let initialized = Initialize::new(Default::default())
            .map_err(|error| mapi_error("Outlook MAPI ist nicht verfügbar", error))?;
        let admin = unsafe { sys::MAPIAdminProfiles(0) }
            .map_err(|error| mapi_error("Outlook-Profile konnten nicht geöffnet werden", error))?;
        Ok(Self {
            admin,
            _initialized: initialized,
            _com: com,
        })
    }

    fn profiles(&self) -> AppResult<Vec<Profile>> {
        let table = unsafe { self.admin.GetProfileTable(0) }
            .map_err(|error| mapi_error("Outlook-Profile konnten nicht gelesen werden", error))?;
        SizedSPropTagArray! { Columns[2] }
        let mut columns = Columns {
            // Outlook's profile table is an ANSI MAPI table. Requesting the W
            // variant can return PT_ERROR even though the profile is valid.
            // Decode the documented A column with this PC's Windows code page.
            aulPropTag: [sys::PR_DISPLAY_NAME_A, sys::PR_DEFAULT_PROFILE],
            ..Default::default()
        };
        unsafe { table.SetColumns(columns.as_mut_ptr(), 0) }.map_err(|error| {
            mapi_error("Outlook-Profilspalten konnten nicht gelesen werden", error)
        })?;
        let mut profiles = Vec::new();
        loop {
            let mut rows = RowSet::default();
            unsafe { table.QueryRows(64, 0, rows.as_mut_ptr()) }.map_err(|error| {
                mapi_error("Outlook-Profilliste konnte nicht gelesen werden", error)
            })?;
            if rows.is_empty() {
                break;
            }
            for row in rows {
                let mut name = None;
                let mut is_default = false;
                for property in row.iter() {
                    match (property.tag.0, property.value) {
                        (sys::PR_DISPLAY_NAME_A, PropValueData::AnsiString(value)) => {
                            if !value.is_null() {
                                name = Some(decode_ansi_name(unsafe { value.as_bytes() })?);
                            }
                        }
                        (sys::PR_DISPLAY_NAME_W, PropValueData::Unicode(value)) => {
                            let value = value.strip_suffix(&[0]).unwrap_or(&value);
                            name = Some(
                                String::from_utf16(value)
                                    .map_err(|_| "Outlook-Profilname ist ungültig.".to_string())?,
                            );
                        }
                        (sys::PR_DEFAULT_PROFILE, PropValueData::Boolean(value)) => {
                            is_default = value != 0
                        }
                        _ => {}
                    }
                }
                if let Some(name) = name {
                    profiles.push(Profile { name, is_default });
                } else {
                    return Err("Outlook hat einen unlesbaren Profilnamen geliefert.".into());
                }
            }
            if profiles.len() > 1024 {
                return Err("Zu viele Outlook-Profile gefunden.".into());
            }
        }
        Ok(profiles)
    }

    fn services(&self, name: &str) -> AppResult<sys::IMsgServiceAdmin> {
        let mut wide: Vec<u16> = name.encode_utf16().chain(Some(0)).collect();
        let mut services = None;
        unsafe {
            self.admin.AdminServices(
                wide.as_mut_ptr().cast(),
                ptr::null_mut(),
                0,
                sys::MAPI_UNICODE,
                &mut services,
            )
        }
        .map_err(|error| mapi_error("Outlook-Profil konnte nicht konfiguriert werden", error))?;
        services.ok_or_else(|| "Outlook hat keinen Profildienst geliefert.".into())
    }
}

fn open_section(
    services: &sys::IMsgServiceAdmin,
    mut uid: sys::MAPIUID,
) -> AppResult<sys::IProfSect> {
    let mut section = None;
    unsafe {
        services.OpenProfileSection(
            &mut uid,
            ptr::null_mut(),
            MAPI_FORCE_ACCESS | sys::MAPI_MODIFY,
            &mut section,
        )
    }
    .map_err(|error| {
        mapi_error(
            "Exchange-Profilabschnitt konnte nicht geöffnet werden",
            error,
        )
    })?;
    section.ok_or_else(|| "Exchange-Profilabschnitt fehlt.".into())
}

fn binary_property(section: &sys::IProfSect, tag: u32) -> AppResult<Vec<u8>> {
    let mut tags = sys::SPropTagArray {
        cValues: 1,
        aulPropTag: [tag],
    };
    let mut count = 0;
    let mut values: *mut sys::SPropValue = ptr::null_mut();
    let result = unsafe { section.GetProps(&mut tags, 0, &mut count, &mut values) };
    let bytes = if result.is_ok() && count == 1 && !values.is_null() {
        let property = unsafe { &*values };
        if property.ulPropTag == tag {
            let binary = unsafe { property.Value.bin };
            if binary.cb > 0 && binary.cb <= 64 * 1024 && !binary.lpb.is_null() {
                Some(unsafe { std::slice::from_raw_parts(binary.lpb, binary.cb as usize) }.to_vec())
            } else {
                None
            }
        } else {
            None
        }
    } else {
        None
    };
    if !values.is_null() {
        unsafe { sys::MAPIFreeBuffer(values.cast()) };
    }
    bytes.ok_or_else(|| format!("Exchange-Profilinformation 0x{tag:08X} fehlt."))
}

fn uid_from_bytes(bytes: &[u8]) -> AppResult<sys::MAPIUID> {
    let ab: [u8; 16] = bytes
        .try_into()
        .map_err(|_| "Exchange-Profilkennung ist ungültig.".to_string())?;
    Ok(sys::MAPIUID { ab })
}

fn set_identity(section: &sys::IProfSect, email: &str) -> AppResult<()> {
    let mut smtp: Vec<u16> = format!("=SMTP:{email}")
        .encode_utf16()
        .chain(Some(0))
        .collect();
    let mut display: Vec<u16> = email.encode_utf16().chain(Some(0)).collect();
    let mut properties = [sys::SPropValue::default(), sys::SPropValue::default()];
    properties[0].ulPropTag = PR_PROFILE_USER_SMTP_EMAIL_ADDRESS_W;
    properties[0].Value.lpszW = PWSTR(smtp.as_mut_ptr());
    properties[1].ulPropTag = sys::PR_DISPLAY_NAME_W;
    properties[1].Value.lpszW = PWSTR(display.as_mut_ptr());
    let mut problems: *mut sys::SPropProblemArray = ptr::null_mut();
    let result = unsafe {
        section.SetProps(
            properties.len() as u32,
            properties.as_mut_ptr(),
            &mut problems,
        )
    };
    let failed_properties = !problems.is_null() && unsafe { (*problems).cProblem > 0 };
    if !problems.is_null() {
        unsafe { sys::MAPIFreeBuffer(problems.cast()) };
    }
    result.map_err(|error| {
        mapi_error(
            "Exchange-E-Mail-Adresse konnte nicht hinterlegt werden",
            error,
        )
    })?;
    if failed_properties {
        return Err("Exchange-E-Mail-Adresse wurde nicht vollständig übernommen.".into());
    }
    unsafe { section.SaveChanges(sys::KEEP_OPEN_READWRITE) }
        .map_err(|error| mapi_error("Exchange-Profil konnte nicht gespeichert werden", error))
}

fn configure_new_exchange(admin: &ProfileAdmin, profile: &str, email: &str) -> AppResult<()> {
    let services = admin.services(profile)?;
    let service_name = CString::new("MSEMS").unwrap();
    unsafe { services.CreateMsgService(service_name.as_ptr().cast_mut(), ptr::null_mut(), 0, 0) }
        .map_err(|error| mapi_error("Exchange-Dienst konnte nicht erstellt werden", error))?;
    let table = unsafe { services.GetMsgServiceTable(0) }
        .map_err(|error| mapi_error("Exchange-Dienst konnte nicht gelesen werden", error))?;
    SizedSPropTagArray! { Columns[2] }
    let mut columns = Columns {
        aulPropTag: [sys::PR_SERVICE_NAME_A, sys::PR_SERVICE_UID],
        ..Default::default()
    };
    unsafe { table.SetColumns(columns.as_mut_ptr(), 0) }
        .map_err(|error| mapi_error("Exchange-Dienst konnte nicht gelesen werden", error))?;
    let mut rows = RowSet::default();
    unsafe { table.QueryRows(64, 0, rows.as_mut_ptr()) }
        .map_err(|error| mapi_error("Exchange-Dienst konnte nicht gelesen werden", error))?;
    let mut exchange_uid = None;
    for row in rows {
        let mut is_exchange = false;
        let mut uid = None;
        for property in row.iter() {
            match (property.tag.0, property.value) {
                (sys::PR_SERVICE_NAME_A, PropValueData::AnsiString(value)) => {
                    is_exchange = !value.is_null() && unsafe { value.as_bytes() } == b"MSEMS";
                }
                (sys::PR_SERVICE_UID, PropValueData::Binary(bytes)) => {
                    uid = Some(uid_from_bytes(bytes)?)
                }
                _ => {}
            }
        }
        if is_exchange {
            exchange_uid = uid;
            break;
        }
    }
    let service = open_section(
        &services,
        exchange_uid.ok_or_else(|| "Exchange-Dienstkennung fehlt.".to_string())?,
    )?;
    let emsuid = uid_from_bytes(&binary_property(&service, PR_EMSMDB_SECTION_UID)?)?;
    let global = open_section(&services, emsuid)?;
    set_identity(&global, email)?;
    // PR_STORE_PROVIDERS is a packed array of MAPIUIDs. Configure every store
    // section rather than assuming that it contains only the primary store.
    let store_ids = binary_property(&global, sys::PR_STORE_PROVIDERS)?;
    if store_ids.len() % 16 != 0 {
        return Err("Exchange-Storekennungen sind ungültig.".into());
    }
    for bytes in store_ids.chunks_exact(16) {
        let store = open_section(&services, uid_from_bytes(bytes)?)?;
        set_identity(&store, email)?;
    }
    Ok(())
}

pub fn list() -> AppResult<serde_json::Value> {
    let admin = ProfileAdmin::open()?;
    Ok(serde_json::json!({ "profiles": admin.profiles()? }))
}

pub fn create(profile: &str, email: &str) -> AppResult<serde_json::Value> {
    validate_profile_name(profile)?;
    validate_email(email)?;
    let mut name = ansi_name(profile)?;
    let admin = ProfileAdmin::open()?;
    if exists(&admin.profiles()?, profile) {
        return Err("Der Exchange-Profilname wird bereits verwendet. Das vorhandene Profil bleibt unverändert.".into());
    }
    unsafe {
        admin
            .admin
            .CreateProfile(name.as_mut_ptr().cast(), ptr::null_mut(), 0, 0)
    }
    .map_err(|error| mapi_error("Neues Outlook-Profil konnte nicht erstellt werden", error))?;
    // Only this invocation's successful CreateProfile grants ownership. Never
    // delete an existing profile or roll back profiles based solely on a name.
    if let Err(error) = configure_new_exchange(&admin, profile, email) {
        let cleanup = unsafe { admin.admin.DeleteProfile(name.as_mut_ptr().cast(), 0) };
        return Err(if cleanup.is_ok() {
            error
        } else {
            format!("{error} Das unvollständige neue Profil ist weiterhin vorhanden; die EDV muss es prüfen.")
        });
    }
    Ok(serde_json::json!({ "ok": true }))
}

fn validate_activation(
    profiles: &[Profile],
    exchange: &str,
    old: &str,
    imap: &str,
) -> AppResult<()> {
    validate_profile_name(exchange)?;
    if !exists(profiles, exchange) {
        return Err("Das vorbereitete Exchange-Profil wurde nicht gefunden.".into());
    }
    if old.is_empty() {
        if !imap.is_empty() {
            return Err("Das ursprüngliche Outlook-Profil fehlt.".into());
        }
        return Ok(());
    }
    validate_profile_name(old)?;
    validate_profile_name(imap)?;
    if exchange.eq_ignore_ascii_case(old) || exchange.eq_ignore_ascii_case(imap) {
        return Err("Exchange- und IMAP-Profil müssen verschieden sein.".into());
    }
    if !exists(profiles, old) {
        return Err("Das ursprüngliche Outlook-Profil wurde nicht gefunden.".into());
    }
    if !old.eq_ignore_ascii_case(imap) && exists(profiles, imap) {
        return Err(
            "Der IMAP-Profilname wird bereits verwendet. Die Profile bleiben unverändert.".into(),
        );
    }
    Ok(())
}

pub fn activate(exchange: &str, old: &str, imap: &str) -> AppResult<serde_json::Value> {
    let admin = ProfileAdmin::open()?;
    let profiles = admin.profiles()?;
    validate_activation(&profiles, exchange, old, imap)?;
    let mut exchange_wide: Vec<u16> = exchange.encode_utf16().chain(Some(0)).collect();
    unsafe {
        admin
            .admin
            .SetDefaultProfile(exchange_wide.as_mut_ptr().cast(), sys::MAPI_UNICODE)
    }
    .map_err(|error| {
        mapi_error(
            "Exchange-Profil konnte nicht als Standard festgelegt werden",
            error,
        )
    })?;
    if !admin
        .profiles()?
        .iter()
        .any(|profile| profile.name.eq_ignore_ascii_case(exchange) && profile.is_default)
    {
        return Err("Outlook hat das Exchange-Profil noch nicht als Standard bestätigt.".into());
    }
    let mut renamed = false;
    let mut warning = None;
    let mut previous_profile = (!old.is_empty()).then(|| old.to_string());
    if !old.is_empty() && !old.eq_ignore_ascii_case(imap) {
        let rename = (|| -> AppResult<()> {
            let mut old_name = ansi_name(old)?;
            let mut imap_name = ansi_name(imap)?;
            unsafe {
                admin.admin.RenameProfile(
                    old_name.as_mut_ptr().cast(),
                    ptr::null_mut(),
                    imap_name.as_mut_ptr().cast(),
                    0,
                    0,
                )
            }
            .map_err(|error| mapi_error("Das alte Profil konnte nicht umbenannt werden", error))?;
            let after = admin.profiles()?;
            if !exists(&after, imap) || exists(&after, old) {
                return Err("Outlook hat die Umbenennung noch nicht bestätigt; das alte Profil bleibt erhalten.".into());
            }
            Ok(())
        })();
        match rename {
            Ok(()) => {
                renamed = true;
                previous_profile = Some(imap.to_string());
            }
            Err(error) => warning = Some(error),
        }
    }
    Ok(
        serde_json::json!({ "ok": true, "renamed": renamed, "previousProfile": previous_profile, "warning": warning }),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn profiles(names: &[&str]) -> Vec<Profile> {
        names
            .iter()
            .map(|name| Profile {
                name: name.to_string(),
                is_default: false,
            })
            .collect()
    }

    #[test]
    fn activation_rejects_existing_imap_name_before_any_mutation() {
        assert!(validate_activation(
            &profiles(&["Outlook", "Profile IMAP", "Profile Exchange"]),
            "Profile Exchange",
            "Outlook",
            "Profile IMAP"
        )
        .is_err());
    }

    #[test]
    fn activation_requires_both_target_and_original_to_exist() {
        assert!(validate_activation(
            &profiles(&["Outlook"]),
            "Profile Exchange",
            "Outlook",
            "Profile IMAP"
        )
        .is_err());
        assert!(validate_activation(
            &profiles(&["Profile Exchange"]),
            "Profile Exchange",
            "Outlook",
            "Profile IMAP"
        )
        .is_err());
    }

    #[test]
    fn activation_never_renames_exchange_itself() {
        assert!(validate_activation(
            &profiles(&["Profile Exchange"]),
            "Profile Exchange",
            "Profile Exchange",
            "Profile IMAP"
        )
        .is_err());
        assert!(validate_activation(
            &profiles(&["Outlook", "Profile Exchange"]),
            "Profile Exchange",
            "Outlook",
            "Profile Exchange"
        )
        .is_err());
    }

    #[test]
    fn activation_can_preserve_an_already_named_imap_profile() {
        assert!(validate_activation(
            &profiles(&["Profile IMAP", "Profile Exchange"]),
            "Profile Exchange",
            "Profile IMAP",
            "Profile IMAP"
        )
        .is_ok());
    }

    #[test]
    fn activation_without_old_profile_requires_no_rename_target() {
        let profiles = profiles(&["Profile Exchange"]);
        assert!(validate_activation(&profiles, "Profile Exchange", "", "").is_ok());
        assert!(validate_activation(&profiles, "Profile Exchange", "", "Profile IMAP").is_err());
    }

    #[test]
    fn invalid_names_and_email_arguments_are_rejected() {
        for name in [
            "",
            " leading",
            "trailing ",
            "bad\0name",
            "bad\\name",
            "bad\nname",
        ] {
            assert!(validate_profile_name(name).is_err());
        }
        assert!(validate_profile_name(&"p".repeat(65)).is_err());
        for email in [
            "",
            "missing-domain@",
            "@missing-local",
            "two@@example.test",
            "a@b\n",
            "a b@example.test",
        ] {
            assert!(validate_email(email).is_err());
        }
        assert!(validate_email("anna@example.test").is_ok());
    }

    #[test]
    fn uid_requires_exactly_sixteen_bytes() {
        assert!(uid_from_bytes(&[0; 15]).is_err());
        assert!(uid_from_bytes(&[0; 17]).is_err());
        assert_eq!(uid_from_bytes(&[42; 16]).unwrap().ab, [42; 16]);
    }

    #[test]
    fn ansi_profile_table_names_round_trip_without_nul_or_replacement() {
        assert_eq!(decode_ansi_name(b"Outlook").unwrap(), "Outlook");
        for name in ["Profile Exchange", "Büro", "Müller"] {
            // Some Windows locales cannot represent the accented examples.
            // Whenever the name is representable, decoding must be exact.
            if let Ok(encoded) = ansi_name(name) {
                assert_eq!(
                    decode_ansi_name(&encoded[..encoded.len() - 1]).unwrap(),
                    name
                );
            }
        }
    }

    #[test]
    fn ansi_profile_names_reject_embedded_nuls_and_empty_values() {
        assert!(decode_ansi_name(b"").is_err());
        assert!(decode_ansi_name(b"Outlook\0other").is_err());
    }
}
