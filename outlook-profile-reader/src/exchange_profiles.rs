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
use windows::Win32::System::Registry::{
    RegCloseKey, RegEnumKeyExW, RegGetValueW, RegOpenKeyExW, RegSetKeyValueW, HKEY,
    HKEY_CURRENT_USER, KEY_READ, REG_SZ, RRF_RT_REG_SZ,
};
use windows_core::{BOOL, PCSTR, PCWSTR, PWSTR};

fn persist_registered_default(profile: &str) -> AppResult<()> {
    // Click-to-Run can expose a stale MAPI profile table. Persist only Outlook's
    // documented startup selection, never profile contents or credentials.
    for version in ["16.0", "15.0"] {
        let root = format!("Software\\Microsoft\\Office\\{version}\\Outlook");
        let selected: Vec<u16> = format!("{root}\\Profiles\\{profile}")
            .encode_utf16()
            .chain(Some(0))
            .collect();
        let mut key = HKEY::default();
        let result = unsafe {
            RegOpenKeyExW(
                HKEY_CURRENT_USER,
                PCWSTR(selected.as_ptr()),
                None,
                KEY_READ,
                &mut key,
            )
        };
        if matches!(result.0, 2 | 3) {
            continue;
        }
        if result.0 != 0 {
            return Err("Das Exchange-Profil ist nicht lesbar.".into());
        }
        drop(RegistryKey(key));
        let root: Vec<u16> = root.encode_utf16().chain(Some(0)).collect();
        let value: Vec<u16> = profile.encode_utf16().chain(Some(0)).collect();
        let result = unsafe {
            RegSetKeyValueW(
                HKEY_CURRENT_USER,
                PCWSTR(root.as_ptr()),
                windows_core::w!("DefaultProfile"),
                REG_SZ.0,
                Some(value.as_ptr().cast()),
                (value.len() * 2) as u32,
            )
        };
        if result.0 != 0 {
            return Err(
                "Die Outlook-Standardprofilauswahl konnte nicht gespeichert werden.".into(),
            );
        }
        return Ok(());
    }
    Err("Das Standardprofil ist nicht als verwendbares Outlook-Profil registriert.".into())
}

struct RegistryKey(HKEY);
impl Drop for RegistryKey {
    fn drop(&mut self) {
        unsafe {
            let _ = RegCloseKey(self.0);
        }
    }
}

fn registered_profiles() -> AppResult<Option<(Vec<String>, Option<String>)>> {
    for version in ["16.0", "15.0"] {
        let root = format!("Software\\Microsoft\\Office\\{version}\\Outlook");
        let path: Vec<u16> = format!("{root}\\Profiles")
            .encode_utf16()
            .chain(Some(0))
            .collect();
        let mut key = HKEY::default();
        let opened = unsafe {
            RegOpenKeyExW(
                HKEY_CURRENT_USER,
                PCWSTR(path.as_ptr()),
                None,
                KEY_READ,
                &mut key,
            )
        };
        if matches!(opened.0, 2 | 3) {
            continue;
        }
        if opened.0 != 0 {
            return Err("Die registrierten Outlook-Profilnamen sind nicht lesbar.".into());
        }
        let key = RegistryKey(key);
        let mut names = Vec::new();
        for index in 0..1025 {
            let mut name = [0u16; 256];
            let mut len = name.len() as u32;
            let result = unsafe {
                RegEnumKeyExW(
                    key.0,
                    index,
                    Some(PWSTR(name.as_mut_ptr())),
                    &mut len,
                    None,
                    None,
                    None,
                    None,
                )
            };
            if result.0 == 259 {
                break;
            }
            if result.0 != 0 || index == 1024 {
                return Err("Die registrierte Outlook-Profilliste ist ungueltig.".into());
            }
            let name = String::from_utf16(&name[..len as usize])
                .map_err(|_| "Outlook-Profilname ist ungueltig.")?;
            let deleted: Vec<u16> = format!("{root}\\Deleted Profiles\\{name}")
                .encode_utf16()
                .chain(Some(0))
                .collect();
            let mut deleted_key = HKEY::default();
            let found = unsafe {
                RegOpenKeyExW(
                    HKEY_CURRENT_USER,
                    PCWSTR(deleted.as_ptr()),
                    None,
                    KEY_READ,
                    &mut deleted_key,
                )
            };
            if found.0 == 0 {
                drop(RegistryKey(deleted_key));
                continue;
            }
            if !matches!(found.0, 2 | 3) {
                return Err("Der Outlook-Profilstatus ist nicht lesbar.".into());
            }
            names.push(name);
        }
        let root: Vec<u16> = root.encode_utf16().chain(Some(0)).collect();
        let mut value = [0u16; 256];
        let mut size = std::mem::size_of_val(&value) as u32;
        let result = unsafe {
            RegGetValueW(
                HKEY_CURRENT_USER,
                PCWSTR(root.as_ptr()),
                windows_core::w!("DefaultProfile"),
                RRF_RT_REG_SZ,
                None,
                Some(value.as_mut_ptr().cast()),
                Some(&mut size),
            )
        };
        let default = if result.0 == 0 {
            let len = value.iter().position(|c| *c == 0).unwrap_or(value.len());
            Some(
                String::from_utf16(&value[..len])
                    .map_err(|_| "Outlook-Standardprofil ist ungueltig.")?,
            )
        } else if matches!(result.0, 2 | 3) {
            None
        } else {
            return Err("Das registrierte Outlook-Standardprofil ist nicht lesbar.".into());
        };
        let default =
            default.filter(|name| names.iter().any(|entry| entry.eq_ignore_ascii_case(name)));
        return Ok(Some((names, default)));
    }
    Ok(None)
}

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
    // Drop after MAPIUninitialize: affected C2R providers flush stale default
    // selections on shutdown. Preserve the observed/explicitly selected value.
    startup_default: StartupDefaultGuard,
}

struct StartupDefaultGuard(Option<String>);
impl Drop for StartupDefaultGuard {
    fn drop(&mut self) {
        if let Some(profile) = self.0.as_deref() {
            let unchanged = registered_profiles()
                .ok()
                .flatten()
                .and_then(|(_, default)| default)
                .is_some_and(|current| current.eq_ignore_ascii_case(profile));
            if !unchanged {
                let _ = persist_registered_default(profile);
            }
        }
    }
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
        let startup_default =
            StartupDefaultGuard(registered_profiles()?.and_then(|(_, default)| default));
        let com = ComApartment::initialize()?;
        let initialized = Initialize::new(Default::default())
            .map_err(|error| mapi_error("Outlook MAPI ist nicht verfügbar", error))?;
        let admin = unsafe { sys::MAPIAdminProfiles(0) }
            .map_err(|error| mapi_error("Outlook-Profile konnten nicht geöffnet werden", error))?;
        Ok(Self {
            admin,
            _initialized: initialized,
            _com: com,
            startup_default,
        })
    }

    fn profiles(&self) -> AppResult<Vec<Profile>> {
        // Registry leftovers, including Deleted Profiles, are not launchable
        // profiles. Never manufacture a successful MAPI/default result from them.
        self.native_profiles()
    }

    fn native_profiles(&self) -> AppResult<Vec<Profile>> {
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

pub fn native_list() -> AppResult<serde_json::Value> {
    let admin = ProfileAdmin::open()?;
    Ok(serde_json::json!({ "profiles": admin.native_profiles()? }))
}

pub fn create_empty(profile: &str) -> AppResult<serde_json::Value> {
    validate_profile_name(profile)?;
    let admin = ProfileAdmin::open()?;
    if exists(&admin.profiles()?, profile) {
        return Err("Dieser Outlook-Profilname ist bereits vergeben.".into());
    }
    let mut name = ansi_name(profile)?;
    unsafe {
        admin
            .admin
            .CreateProfile(name.as_mut_ptr().cast(), ptr::null_mut(), 0, 0)
    }
    .map_err(|error| mapi_error("Outlook-Profil konnte nicht erstellt werden", error))?;
    Ok(serde_json::json!({"ok": true}))
}

fn outlook_running() -> AppResult<bool> {
    use windows::Win32::{
        Foundation::CloseHandle,
        System::Diagnostics::ToolHelp::{
            CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W,
            TH32CS_SNAPPROCESS,
        },
    };
    let handle = unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) }
        .map_err(|_| "Outlook-Prozesse konnten nicht geprueft werden.")?;
    let mut entry = PROCESSENTRY32W {
        dwSize: std::mem::size_of::<PROCESSENTRY32W>() as u32,
        ..Default::default()
    };
    let mut found = false;
    let mut result = unsafe { Process32FirstW(handle, &mut entry) };
    while result.is_ok() {
        let len = entry
            .szExeFile
            .iter()
            .position(|c| *c == 0)
            .unwrap_or(entry.szExeFile.len());
        if String::from_utf16_lossy(&entry.szExeFile[..len]).eq_ignore_ascii_case("OUTLOOK.EXE") {
            found = true;
            break;
        }
        result = unsafe { Process32NextW(handle, &mut entry) };
    }
    unsafe {
        let _ = CloseHandle(handle);
    }
    if !found && result.is_err_and(|error| error.code().0 as u32 != 0x80070012) {
        return Err("Outlook-Prozesse konnten nicht vollstaendig geprueft werden.".into());
    }
    Ok(found)
}

fn validate_removal(
    profiles: &[Profile],
    profile: &str,
    replacement: &str,
    running: bool,
) -> AppResult<bool> {
    validate_profile_name(profile)?;
    if running {
        return Err(
            "Bitte Outlook vor dem Entfernen eines Profils vollstaendig schliessen.".into(),
        );
    }
    let target = profiles
        .iter()
        .find(|entry| entry.name.eq_ignore_ascii_case(profile))
        .ok_or("Das Outlook-Profil ist nicht mehr vorhanden.")?;
    if target.is_default {
        if profiles.len() > 1 && replacement.is_empty() {
            return Err("Bitte zuerst ein neues Standardprofil auswaehlen.".into());
        }
        if !replacement.is_empty() {
            validate_profile_name(replacement)?;
            if replacement.eq_ignore_ascii_case(profile) || !exists(profiles, replacement) {
                return Err("Das neue Standardprofil ist ungueltig.".into());
            }
        }
    } else if !replacement.is_empty() {
        return Err("Ein Ersatzprofil ist nur beim Entfernen des Standards erforderlich.".into());
    }
    Ok(target.is_default)
}

fn clear_registered_default() -> AppResult<()> {
    for version in ["16.0", "15.0"] {
        let path: Vec<u16> = format!("Software\\Microsoft\\Office\\{version}\\Outlook")
            .encode_utf16()
            .chain(Some(0))
            .collect();
        let result = unsafe {
            windows::Win32::System::Registry::RegDeleteKeyValueW(
                HKEY_CURRENT_USER,
                PCWSTR(path.as_ptr()),
                windows_core::w!("DefaultProfile"),
            )
        };
        if !matches!(result.0, 0 | 2 | 3) {
            return Err("Die bisherige Standardprofilauswahl konnte nicht entfernt werden.".into());
        }
        if result.0 == 0 {
            break;
        }
    }
    Ok(())
}

pub fn remove(profile: &str, replacement: &str) -> AppResult<serde_json::Value> {
    let mut admin = ProfileAdmin::open()?;
    let profiles = admin.profiles()?;
    let was_default = validate_removal(&profiles, profile, replacement, outlook_running()?)?;
    let previous_default = admin.startup_default.0.clone();
    if was_default {
        let mut name = if replacement.is_empty() {
            None
        } else {
            Some(ansi_name(replacement)?)
        };
        let pointer = name
            .as_mut()
            .map_or(ptr::null_mut(), |name| name.as_mut_ptr().cast());
        unsafe { admin.admin.SetDefaultProfile(pointer, 0) }
            .map_err(|error| mapi_error("Standardprofil konnte nicht umgestellt werden", error))?;
        admin.startup_default.0 = (!replacement.is_empty()).then(|| replacement.to_string());
    }
    if !matches!(outlook_running(), Ok(false)) {
        admin.startup_default.0 = previous_default;
        return Err(
            "Outlook wurde inzwischen geoeffnet. Bitte schliessen und erneut versuchen.".into(),
        );
    }
    let mut name = ansi_name(profile)?;
    if let Err(error) = unsafe { admin.admin.DeleteProfile(name.as_mut_ptr().cast(), 0) } {
        admin.startup_default.0 = previous_default;
        return Err(mapi_error(
            "Outlook-Profil konnte nicht entfernt werden",
            error,
        ));
    }
    drop(admin);
    if was_default {
        if replacement.is_empty() {
            clear_registered_default()?;
        } else {
            persist_registered_default(replacement)?;
        }
    }
    if registered_profiles()?
        .is_some_and(|(names, _)| names.iter().any(|name| name.eq_ignore_ascii_case(profile)))
    {
        return Err("Outlook hat die Entfernung noch nicht bestaetigt. Bitte alle Outlook-Fenster schliessen und aktualisieren.".into());
    }
    Ok(serde_json::json!({"ok": true}))
}

pub fn create(profile: &str, email: &str, windows_sso: bool) -> AppResult<serde_json::Value> {
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
    .map_err(|error| {
        // CreateProfile specifically documents MAPI_E_NO_ACCESS for an occupied
        // name, including incomplete profiles missing from GetProfileTable.
        if error.code().0 as u32 == 0x80070005 {
            "Der Outlook-Profilname ist bereits belegt (0x80070005). Bestehende Profile bleiben erhalten. Bitte erneut versuchen.".to_string()
        } else {
            mapi_error("Neues Outlook-Profil konnte nicht erstellt werden", error)
        }
    })?;
    // ZeroConfigExchange must let Outlook configure the new profile itself.
    // A pre-seeded MSEMS service bypasses that profile-creation path.
    if windows_sso {
        return Ok(serde_json::json!({ "ok": true }));
    }
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
    if outlook_running()? {
        return Err(
            "Bitte Outlook vor dem Abschluss der Profileinrichtung vollstaendig schliessen.".into(),
        );
    }
    let mut admin = ProfileAdmin::open()?;
    let profiles = admin.native_profiles()?;
    validate_activation(&profiles, exchange, old, imap)?;
    // Some Outlook MAPI builds reject MAPI_UNICODE here with
    // MAPI_E_BAD_CHARWIDTH (0x80040103). Use the same checked ANSI encoding as
    // CreateProfile/RenameProfile, with no character replacement.
    let mut exchange_name = ansi_name(exchange)?;
    unsafe {
        admin
            .admin
            .SetDefaultProfile(exchange_name.as_mut_ptr().cast(), 0)
    }
    .map_err(|error| {
        mapi_error(
            "Exchange-Profil konnte nicht als Standard festgelegt werden",
            error,
        )
    })?;
    admin.startup_default.0 = Some(exchange.to_string());
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
    drop(admin);
    persist_registered_default(exchange)?;
    if !registered_profiles()?
        .is_some_and(|(_, default)| default.is_some_and(|name| name.eq_ignore_ascii_case(exchange)))
    {
        return Err("Outlook hat das Standardprofil nicht dauerhaft gespeichert.".into());
    }
    Ok(
        serde_json::json!({ "ok": true, "renamed": renamed, "previousProfile": previous_profile, "warning": warning }),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn removing_default_requires_an_existing_different_replacement() {
        let mut entries = profiles(&["Outlook", "Exchange"]);
        entries[0].is_default = true;
        for replacement in ["", "Outlook", "Missing"] {
            assert!(validate_removal(&entries, "Outlook", replacement, false).is_err());
        }
        assert_eq!(
            validate_removal(&entries, "Outlook", "Exchange", false).unwrap(),
            true
        );
    }

    #[test]
    fn removal_rejects_running_outlook_missing_profiles_and_unneeded_replacements() {
        let entries = profiles(&["Outlook", "Exchange"]);
        assert!(validate_removal(&entries, "Outlook", "", true).is_err());
        assert!(validate_removal(&entries, "Missing", "", false).is_err());
        assert!(validate_removal(&entries, "Outlook", "Exchange", false).is_err());
        assert_eq!(
            validate_removal(&entries, "Outlook", "", false).unwrap(),
            false
        );
    }

    #[test]
    fn last_default_can_be_removed_without_a_replacement() {
        let mut entries = profiles(&["Outlook"]);
        entries[0].is_default = true;
        assert_eq!(
            validate_removal(&entries, "Outlook", "", false).unwrap(),
            true
        );
    }

    #[test]
    fn registry_only_exchange_is_never_accepted_for_activation() {
        let native = profiles(&["Profile IMAP"]);
        assert!(validate_activation(
            &native,
            "Profile Exchange 2",
            "Profile IMAP",
            "Profile IMAP"
        )
        .is_err());
    }

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
