import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { Download, Eye, FileImage, FileText, LoaderCircle, Paperclip, X } from "lucide-react";
import { save } from "@tauri-apps/plugin-dialog";
import { invokeWithDiagnostics as invoke } from "../utils/notificationPolicy";
import type { EmailAttachment, EmailAttachmentData } from "../types/emailArchive";
import "./EmailAttachments.css";

const LocalPdfPreview = lazy(() => import("./LocalPdfPreview"));
export function attachmentBytes(base64: string): Uint8Array {
  const raw = atob(base64); return Uint8Array.from(raw, character => character.charCodeAt(0));
}
function sizeLabel(size: number) { return size < 1024 ? `${size} B` : size < 1024 * 1024 ? `${Math.round(size / 1024)} KB` : `${(size / (1024 * 1024)).toFixed(1)} MB`; }

export function EmailAttachments({ messageId }: { messageId: string }) {
  const [attachments, setAttachments] = useState<EmailAttachment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState<number | null>(null);
  const [preview, setPreview] = useState<{ attachment: EmailAttachment; bytes: Uint8Array } | null>(null);
  const [imageUrl, setImageUrl] = useState("");
  const [imageError, setImageError] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const request = useRef(0);
  useEffect(() => {
    let active = true; ++request.current; setLoading(true); setBusy(null); setError(""); setNotice(""); setPreview(null); setAttachments([]);
    void invoke<EmailAttachment[]>("list_email_archive_attachments", { id: messageId })
      .then(items => { if (!Array.isArray(items)) throw new Error("Invalid attachment metadata"); if (active) setAttachments(items); })
      .catch(() => { if (active) setError("Anhänge konnten nicht geöffnet werden. Bitte die lokale Kopie prüfen oder die EDV informieren."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; ++request.current; };
  }, [messageId]);
  useEffect(() => {
    if (!preview) { dialog.current?.close(); return; }
    setImageError(false);
    dialog.current?.showModal();
    if (preview.attachment.preview !== "image") return;
    const url = URL.createObjectURL(new Blob([preview.bytes.slice().buffer], { type: preview.attachment.mimeType }));
    setImageUrl(url); return () => { URL.revokeObjectURL(url); setImageUrl(""); };
  }, [preview]);
  const view = async (attachment: EmailAttachment) => {
    const current = ++request.current; setBusy(attachment.index); setError("");
    try {
      const data = await invoke<EmailAttachmentData>("read_email_archive_attachment", { id: messageId, index: attachment.index });
      if (current !== request.current) return;
      setPreview({ attachment: data.attachment, bytes: attachmentBytes(data.base64) });
    } catch { if (current === request.current) setError("Dieser Anhang konnte nicht angezeigt werden. Bitte „Speichern unter“ verwenden oder die EDV informieren."); }
    finally { if (current === request.current) setBusy(null); }
  };
  const saveCopy = async (attachment: EmailAttachment) => {
    const current = ++request.current; setBusy(attachment.index); setError(""); setNotice("");
    try {
      const path = await save({ title: "Anhang speichern", defaultPath: attachment.name });
      if (!path || current !== request.current) return;
      await invoke("save_email_archive_attachment", { id: messageId, index: attachment.index, path });
      if (current === request.current) setNotice(`„${attachment.name}“ wurde als Kopie gespeichert.`);
    } catch { if (current === request.current) setError("Der Anhang konnte nicht gespeichert werden. Bitte einen freien Dateinamen und einen beschreibbaren Speicherort wählen."); }
    finally { if (current === request.current) setBusy(null); }
  };
  if (loading) return <p className="email-attachments-loading" role="status">Anhänge werden gelesen …</p>;
  if (!attachments.length && !error) return null;
  return <section className="email-attachment-panel" aria-label="E-Mail-Anhänge">
    <h4><Paperclip size={16} /> Anhänge ({attachments.length})</h4>
    <div className="email-attachment-list">{attachments.map(attachment => <div className="email-attachment-item" key={attachment.index}>
      {attachment.preview === "image" ? <FileImage size={19} /> : <FileText size={19} />}<div><strong>{attachment.name}</strong><small>{sizeLabel(attachment.size)}{attachment.preview === "none" ? " · Ohne Vorschau" : ""}{!attachment.available ? " · In MSG-Kopie enthalten" : ""}</small></div>
      {attachment.preview !== "none" && <button type="button" disabled={busy !== null} onClick={() => void view(attachment)} aria-label={`${attachment.name} anzeigen`}><Eye size={15} /> Anzeigen</button>}
      <button type="button" disabled={busy !== null || !attachment.available} onClick={() => void saveCopy(attachment)} aria-label={`${attachment.name} speichern`}><Download size={15} /> Speichern unter</button>
      {busy === attachment.index && <LoaderCircle size={16} className="spin" />}
    </div>)}</div>
    {error && <p role="alert" className="field-error">{error}</p>}{notice && <p role="status">{notice}</p>}
    <dialog ref={dialog} className="email-attachment-dialog" aria-label={preview ? `Anhang: ${preview.attachment.name}` : "Anhang"} onCancel={() => setPreview(null)} onClose={() => setPreview(null)}>
      {preview && <><header><strong>{preview.attachment.name}</strong><button type="button" disabled={busy !== null} onClick={() => void saveCopy(preview.attachment)}><Download size={16} /> Speichern unter</button><button className="email-small-icon" type="button" aria-label="Anhang schließen" onClick={() => setPreview(null)}><X size={20} /></button></header>
      <div className="email-attachment-preview">{preview.attachment.preview === "pdf" ? <Suspense fallback={<p role="status">PDF-Vorschau wird geladen …</p>}><LocalPdfPreview bytes={preview.bytes} messageId={messageId} name={preview.attachment.name} /></Suspense> : imageError ? <p role="alert">Das Bild konnte nicht angezeigt werden. Bitte „Speichern unter“ verwenden.</p> : <img src={imageUrl || undefined} alt={preview.attachment.name} onError={() => setImageError(true)} />}</div>
      {error && <p role="alert" className="field-error">{error}</p>}{notice && <p role="status">{notice}</p>}</>}
    </dialog>
  </section>;
}
