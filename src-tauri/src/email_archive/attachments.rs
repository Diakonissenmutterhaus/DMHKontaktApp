//! Attachments are decoded from our MIME/MSG snapshots, never from a live mail
//! client. File names and MIME headers cannot authorize paths or active content.
use super::{db, root, slice, MAX_PARSE_BYTES};
use base64::{engine::general_purpose::STANDARD, Engine};
use mailparse::{MailHeaderMap, ParsedMail};
use rusqlite::OptionalExtension;
use serde::Serialize;
use std::{
    fs,
    io::Read,
    path::{Path, PathBuf},
};
use tauri::AppHandle;

const MAX_PREVIEW_BYTES: u64 = 32 * 1024 * 1024;
const MAX_ATTACHMENT_BYTES: u64 = 64 * 1024 * 1024;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Attachment {
    pub index: usize,
    pub name: String,
    pub size: u64,
    pub mime_type: String,
    pub preview: String,
    pub available: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AttachmentData {
    attachment: Attachment,
    base64: String,
}

struct Location {
    path: PathBuf,
    offset: u64,
    length: u64,
    format: String,
}
fn location(archive: &Path, id: &str) -> Result<Location, String> {
    let conn = db(archive)?;
    let record: Option<(String, u64, u64, String)> = conn
        .query_row(
            "SELECT raw_path,byte_offset,byte_length,format FROM messages WHERE id=?1",
            [id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    let (path, offset, length, format) =
        record.ok_or("Die Nachricht ist nicht im lokalen Archiv vorhanden.")?;
    let path = fs::canonicalize(path)
        .map_err(|_| "Die lokale Kopie fehlt. Bitte die Quelle erneut kopieren.")?;
    let copies = fs::canonicalize(archive.join("copies")).map_err(|_| "Die lokale Kopie fehlt.")?;
    if !path.starts_with(copies) || !path.is_file() {
        return Err("Die Nachricht liegt außerhalb des lokalen Archivs.".into());
    }
    Ok(Location {
        path,
        offset,
        length,
        format,
    })
}

fn safe_name(value: &str, index: usize) -> String {
    let name: String = value
        .chars()
        .take(180)
        .map(|c| {
            if c.is_control() || "\\/:*?\"<>|".contains(c) {
                '_'
            } else {
                c
            }
        })
        .collect();
    let name = name.trim().trim_end_matches(['.', ' ']);
    if name.is_empty() {
        return format!("Anhang-{}", index + 1);
    }
    let stem = name.split('.').next().unwrap_or("").to_ascii_uppercase();
    if matches!(
        stem.as_str(),
        "CON"
            | "PRN"
            | "AUX"
            | "NUL"
            | "COM1"
            | "COM2"
            | "COM3"
            | "COM4"
            | "COM5"
            | "COM6"
            | "COM7"
            | "COM8"
            | "COM9"
            | "LPT1"
            | "LPT2"
            | "LPT3"
            | "LPT4"
            | "LPT5"
            | "LPT6"
            | "LPT7"
            | "LPT8"
            | "LPT9"
    ) {
        format!("_{name}")
    } else {
        name.into()
    }
}

fn media_type(bytes: &[u8]) -> (&'static str, &'static str) {
    if bytes.starts_with(b"%PDF-") {
        ("application/pdf", "pdf")
    } else if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        ("image/png", "image")
    } else if bytes.starts_with(b"\xff\xd8\xff") {
        ("image/jpeg", "image")
    } else if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") {
        ("image/gif", "image")
    } else if bytes.starts_with(b"RIFF") && bytes.get(8..12) == Some(b"WEBP") {
        ("image/webp", "image")
    } else if bytes.starts_with(b"BM") {
        ("image/bmp", "image")
    } else {
        ("application/octet-stream", "none")
    }
}

fn info(index: usize, name: &str, size: u64, prefix: &[u8], available: bool) -> Attachment {
    let (mime, preview) = media_type(prefix);
    Attachment {
        index,
        name: safe_name(name, index),
        size,
        mime_type: mime.into(),
        preview: if size <= MAX_PREVIEW_BYTES && available {
            preview.into()
        } else {
            "none".into()
        },
        available,
    }
}

fn mime_candidates<'m, 'b>(mail: &'m ParsedMail<'b>, result: &mut Vec<&'m ParsedMail<'b>>) {
    let disposition = mail.get_content_disposition();
    if disposition.params.contains_key("filename")
        || mail.ctype.params.contains_key("name")
        || matches!(
            disposition.disposition,
            mailparse::DispositionType::Attachment
        )
        || (mail.subparts.is_empty() && mail.ctype.mimetype.starts_with("image/"))
    {
        result.push(mail);
    } else {
        for part in &mail.subparts {
            mime_candidates(part, result);
        }
    }
}
fn mime_name(part: &ParsedMail<'_>, index: usize) -> String {
    part.get_content_disposition()
        .params
        .get("filename")
        .or_else(|| part.ctype.params.get("name"))
        .cloned()
        .or_else(|| {
            part.headers
                .get_first_value("Content-ID")
                .map(|cid| format!("Bild-{}-{}", index + 1, cid.trim_matches(['<', '>'])))
        })
        .unwrap_or_else(|| format!("Anhang-{}", index + 1))
}
fn mime_attachments(
    record: &Location,
    selected: Option<usize>,
) -> Result<(Vec<Attachment>, Option<Vec<u8>>), String> {
    if record.length > MAX_PARSE_BYTES {
        return Err("Diese sehr große Nachricht kann nicht vollständig geöffnet werden. Die vollständige Rohkopie bleibt im Archiv erhalten; bitte die EDV um Hilfe bitten.".into());
    }
    let raw = slice(&record.path, record.offset, record.length)?;
    let mail = mailparse::parse_mail(&raw)
        .map_err(|_| "Die archivierte Nachricht konnte nicht gelesen werden.")?;
    let mut parts = Vec::new();
    mime_candidates(&mail, &mut parts);
    let mut attachments = Vec::new();
    let mut bytes = None;
    for (index, part) in parts.iter().enumerate() {
        let data = part
            .get_body_raw()
            .map_err(|_| "Der Anhang konnte nicht aus der lokalen Kopie gelesen werden.")?;
        attachments.push(info(
            index,
            &mime_name(part, index),
            data.len() as u64,
            &data,
            true,
        ));
        if selected == Some(index) {
            bytes = Some(data);
        }
    }
    Ok((attachments, bytes))
}

fn msg_string(
    compound: &mut cfb::CompoundFile<fs::File>,
    directory: &Path,
    property: &str,
) -> Option<String> {
    for (suffix, unicode) in [("001F", true), ("001E", false)] {
        if let Ok(mut stream) =
            compound.open_stream(directory.join(format!("__substg1.0_{property}{suffix}")))
        {
            let mut bytes = Vec::new();
            stream.by_ref().take(8192).read_to_end(&mut bytes).ok()?;
            return Some(
                if unicode {
                    String::from_utf16_lossy(
                        &bytes
                            .chunks_exact(2)
                            .map(|pair| u16::from_le_bytes([pair[0], pair[1]]))
                            .collect::<Vec<_>>(),
                    )
                } else {
                    encoding_rs::WINDOWS_1252.decode(&bytes).0.into_owned()
                }
                .trim_end_matches('\0')
                .into(),
            );
        }
    }
    None
}
fn msg_attachments(
    record: &Location,
    selected: Option<usize>,
) -> Result<(Vec<Attachment>, Option<Vec<u8>>), String> {
    // cfb::open uses File::open (read-only), not open_rw. No Outlook dependency.
    let mut compound = cfb::open(&record.path)
        .map_err(|_| "Die lokale Outlook-Nachricht konnte nicht gelesen werden.")?;
    let mut directories = compound
        .read_storage("/")
        .map_err(|e| e.to_string())?
        .filter(|entry| entry.is_storage() && entry.name().starts_with("__attach_version1.0_#"))
        .map(|entry| entry.path().to_owned())
        .collect::<Vec<_>>();
    directories.sort();
    let mut attachments = Vec::new();
    let mut bytes = None;
    for (index, directory) in directories.iter().enumerate() {
        let name = msg_string(&mut compound, directory, "3707")
            .or_else(|| msg_string(&mut compound, directory, "3704"))
            .or_else(|| msg_string(&mut compound, directory, "3001"))
            .unwrap_or_else(|| format!("Anhang-{}", index + 1));
        let path = directory.join("__substg1.0_37010102");
        let available = compound.entry(&path).is_ok_and(|entry| entry.is_stream());
        let size = compound.entry(&path).map(|entry| entry.len()).unwrap_or(0);
        let mut prefix = Vec::new();
        if available {
            let mut stream = compound.open_stream(&path).map_err(|e| e.to_string())?;
            stream
                .by_ref()
                .take(16)
                .read_to_end(&mut prefix)
                .map_err(|e| e.to_string())?;
        }
        attachments.push(info(index, &name, size, &prefix, available));
        if selected == Some(index) {
            if !available {
                return Err("Dieser eingebettete Outlook-Anhang kann noch nicht separat geöffnet werden. Er bleibt in der MSG-Kopie erhalten.".into());
            }
            if size > MAX_ATTACHMENT_BYTES {
                return Err("Dieser Anhang ist zu groß zum separaten Öffnen. Er bleibt vollständig in der MSG-Kopie erhalten.".into());
            }
            let mut data = Vec::new();
            compound
                .open_stream(&path)
                .map_err(|e| e.to_string())?
                .take(MAX_ATTACHMENT_BYTES + 1)
                .read_to_end(&mut data)
                .map_err(|e| e.to_string())?;
            if data.len() as u64 > MAX_ATTACHMENT_BYTES {
                return Err("Der Anhang ist zu groß.".into());
            }
            bytes = Some(data);
        }
    }
    Ok((attachments, bytes))
}
fn extract(
    archive: &Path,
    id: &str,
    index: Option<usize>,
) -> Result<(Vec<Attachment>, Option<Vec<u8>>), String> {
    let record = location(archive, id)?;
    if record.format == "mime" {
        mime_attachments(&record, index)
    } else if record.format == "outlook" {
        msg_attachments(&record, index)
    } else {
        Err("Dieses Nachrichtenformat wird noch nicht unterstützt.".into())
    }
}

#[tauri::command]
pub async fn list_email_archive_attachments(
    app: AppHandle,
    id: String,
) -> Result<Vec<Attachment>, String> {
    let archive = root(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        extract(&archive, &id, None).map(|result| result.0)
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn read_email_archive_attachment(
    app: AppHandle,
    id: String,
    index: usize,
) -> Result<AttachmentData, String> {
    let archive = root(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        let (attachments, bytes) = extract(&archive, &id, Some(index))?;
        let attachment = attachments
            .into_iter()
            .find(|item| item.index == index)
            .ok_or("Der Anhang wurde nicht gefunden.")?;
        if attachment.preview == "none" {
            return Err(
                "Dieser Anhang hat keine Vorschau im App. Bitte „Speichern unter“ verwenden."
                    .into(),
            );
        }
        let bytes = bytes.ok_or("Der Anhang konnte nicht gelesen werden.")?;
        Ok(AttachmentData {
            attachment,
            base64: STANDARD.encode(bytes),
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

fn save_attachment(
    archive: &Path,
    id: &str,
    index: usize,
    destination: &Path,
) -> Result<(), String> {
    if !destination.is_absolute() {
        return Err("Bitte einen vollständigen Speicherort wählen.".into());
    }
    let parent = destination
        .parent()
        .and_then(|parent| fs::canonicalize(parent).ok())
        .ok_or("Der gewählte Speicherort ist nicht verfügbar.")?;
    let name = destination
        .file_name()
        .ok_or("Bitte einen Dateinamen wählen.")?;
    if name
        .to_str()
        .is_none_or(|value| safe_name(value, 0) != value)
    {
        return Err("Bitte einen gültigen Dateinamen wählen.".into());
    }
    let target = parent.join(name);
    let archive = fs::canonicalize(archive).map_err(|e| e.to_string())?;
    if target.starts_with(&archive)
        || fs::canonicalize(&target).is_ok_and(|path| path.starts_with(&archive))
    {
        return Err("Die Archivdateien dürfen nicht überschrieben werden. Bitte einen anderen Speicherort wählen.".into());
    }
    // Never overwrite an existing file, including hard links to a snapshot.
    let (_, bytes) = extract(&archive, id, Some(index))?;
    let bytes = bytes.ok_or("Der Anhang wurde nicht gefunden.")?;
    let mut file = fs::OpenOptions::new().write(true).create_new(true).open(target)
        .map_err(|_| "Die Datei konnte nicht gespeichert werden. Bitte einen freien Dateinamen und einen beschreibbaren Speicherort wählen.")?;
    use std::io::Write;
    file.write_all(&bytes)
        .and_then(|_| file.sync_all())
        .map_err(|_| {
            "Die Kopie konnte nicht vollständig gespeichert werden. Bitte freien Speicher prüfen."
                .to_string()
        })
}
#[tauri::command]
pub async fn save_email_archive_attachment(
    app: AppHandle,
    id: String,
    index: usize,
    path: String,
) -> Result<(), String> {
    let archive = root(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        save_attachment(&archive, &id, index, Path::new(&path))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    fn fixture() -> PathBuf {
        let path = std::env::temp_dir().join(format!("dmh-attachment-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(path.join("copies")).unwrap();
        path
    }
    fn index(archive: &Path, path: &Path, format: &str) {
        let conn = db(archive).unwrap();
        conn.execute(
            "INSERT INTO messages VALUES('mail','folder','','','','','',?1,0,?2,?3,'{}','')",
            rusqlite::params![
                path.to_string_lossy(),
                path.metadata().unwrap().len(),
                format
            ],
        )
        .unwrap();
    }
    #[test]
    fn mime_duplicate_names_and_inline_images_keep_their_own_bytes() {
        let archive = fixture();
        let path = archive.join("copies/mail.eml");
        let data = "Content-Type: multipart/mixed; boundary=x\r\n\r\n--x\r\nContent-Type: application/pdf\r\nContent-Disposition: attachment; filename=doc.pdf\r\n\r\n%PDF-first\r\n--x\r\nContent-Type: application/pdf\r\nContent-Disposition: attachment; filename=doc.pdf\r\n\r\n%PDF-second\r\n--x\r\nContent-Type: image/png\r\nContent-Transfer-Encoding: base64\r\n\r\niVBORw0KGgo=\r\n--x--\r\n";
        fs::write(&path, data).unwrap();
        index(&archive, &path, "mime");
        let (items, bytes) = extract(&archive, "mail", Some(1)).unwrap();
        assert_eq!(items.len(), 3);
        assert_eq!(items[0].name, items[1].name);
        assert!(bytes.unwrap().starts_with(b"%PDF-second"));
        assert_eq!(items[2].preview, "image");
        assert_eq!(fs::read_to_string(path).unwrap(), data);
        fs::remove_dir_all(archive).unwrap();
    }
    #[test]
    fn msg_attachments_are_read_without_outlook_and_unicode_names_survive() {
        let archive = fixture();
        let path = archive.join("copies/mail.msg");
        let mut compound = cfb::create(&path).unwrap();
        let directory = "/__attach_version1.0_#00000000";
        compound.create_storage(directory).unwrap();
        let name: Vec<u8> = "Foto ä.png\0"
            .encode_utf16()
            .flat_map(u16::to_le_bytes)
            .collect();
        compound
            .create_stream(format!("{directory}/__substg1.0_3707001F"))
            .unwrap()
            .write_all(&name)
            .unwrap();
        compound
            .create_stream(format!("{directory}/__substg1.0_37010102"))
            .unwrap()
            .write_all(b"\x89PNG\r\n\x1a\nfixture")
            .unwrap();
        drop(compound);
        let original = fs::read(&path).unwrap();
        index(&archive, &path, "outlook");
        let (items, bytes) = extract(&archive, "mail", Some(0)).unwrap();
        assert_eq!(items[0].name, "Foto ä.png");
        assert_eq!(items[0].preview, "image");
        assert!(bytes.unwrap().starts_with(b"\x89PNG"));
        assert_eq!(fs::read(path).unwrap(), original);
        fs::remove_dir_all(archive).unwrap();
    }
    #[test]
    fn extensions_and_html_cannot_authorize_an_active_preview() {
        assert_eq!(
            info(0, "photo.png", 100, b"<svg onload=evil()>", true).preview,
            "none"
        );
        assert_eq!(
            info(0, "doc.pdf", MAX_PREVIEW_BYTES + 1, b"%PDF-1.7", true).preview,
            "none"
        );
        assert!(!safe_name("../../CON.txt", 0).contains('/'));
        assert_eq!(safe_name("CON.txt", 0), "_CON.txt");
    }
    #[test]
    fn exporting_does_not_overwrite_snapshots_or_existing_files() {
        let archive = fixture();
        let path = archive.join("copies/mail.eml");
        fs::write(&path,"Content-Type: application/pdf\r\nContent-Disposition: attachment; filename=doc.pdf\r\n\r\n%PDF-test").unwrap();
        index(&archive, &path, "mime");
        assert!(save_attachment(&archive, "mail", 0, &path).is_err());
        let output = archive
            .parent()
            .unwrap()
            .join(format!("dmh-export-{}.pdf", uuid::Uuid::new_v4()));
        save_attachment(&archive, "mail", 0, &output).unwrap();
        let copied = fs::read(&output).unwrap();
        assert!(copied.starts_with(b"%PDF-"));
        assert!(save_attachment(&archive, "mail", 0, &output).is_err());
        assert_eq!(fs::read(&output).unwrap(), copied);
        fs::remove_file(output).unwrap();
        fs::remove_dir_all(archive).unwrap();
    }
}
