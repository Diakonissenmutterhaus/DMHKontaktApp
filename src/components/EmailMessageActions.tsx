import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ExternalLink, FolderInput, Tag, Trash2, Undo2 } from "lucide-react";
import { invokeWithDiagnostics as invoke } from "../utils/notificationPolicy";
import { EmailFolderTree } from "./EmailFolderTree";
import { buildEmailFolderTree } from "../utils/emailFolderTree";
import { emailDateLabel } from "../utils/emailContent";
import type { ArchivedEmail, EmailArchiveFolder, EmailArchiveCategory, EmailMessageEdit, EmailFolderPreferences } from "../types/emailArchive";

export interface EmailMessageContext { email:ArchivedEmail; x:number; y:number; trigger:HTMLElement }
const colors = [["Blau","#0078d4"],["Grün","#008a45"],["Rot","#c42b1c"],["Orange","#ca5010"],["Violett","#8764b8"],["Bordeaux","#8e103b"],["Grau","#707070"]];
export function EmailMessageActions({ context, onClose, folders, preferences, disabled, onEdited, onError }: { context:EmailMessageContext | null; onClose:()=>void; folders:EmailArchiveFolder[]; preferences:EmailFolderPreferences; disabled:boolean; onEdited:(edit:EmailMessageEdit)=>void; onError:(message:string)=>void }) {
  const menu=useRef<HTMLDivElement>(null), dialog=useRef<HTMLDialogElement>(null);
  const [operation,setOperation]=useState<{ email:ArchivedEmail; action:"move" | "trash" | "category" } | null>(null);
  const [target,setTarget]=useState(""), [name,setName]=useState(""), [color,setColor]=useState("#0078d4"), [busy,setBusy]=useState(false), [error,setError]=useState("");
  const [categories,setCategories]=useState<EmailArchiveCategory[]>([]);
  const tree=useMemo(() => buildEmailFolderTree(folders,preferences),[folders,preferences]);
  useLayoutEffect(() => {
    if (!context || !menu.current) return;
    const rect=menu.current.getBoundingClientRect(); menu.current.style.left=`${Math.max(8,Math.min(context.x,window.innerWidth-rect.width-8))}px`; menu.current.style.top=`${Math.max(8,Math.min(context.y,window.innerHeight-rect.height-8))}px`;
    menu.current.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
  },[context]);
  useEffect(() => {
    if (!context) return;
    const outside=(event:Event) => { if (!menu.current?.contains(event.target as Node)) onClose(); };
    document.addEventListener("pointerdown",outside); window.addEventListener("scroll",outside,true); window.addEventListener("resize",outside);
    return () => { document.removeEventListener("pointerdown",outside); window.removeEventListener("scroll",outside,true); window.removeEventListener("resize",outside); };
  },[context,onClose]);
  useEffect(() => { if (operation && dialog.current && !dialog.current.open) dialog.current.showModal(); },[operation]);
  useEffect(() => {
    if (operation?.action!=="category") return;
    let active=true; void invoke<EmailArchiveCategory[]>("list_email_archive_categories").then(items => { if (active) setCategories(Array.isArray(items) ? items : []); }).catch(() => undefined);
    return () => { active=false; };
  },[operation]);
  const start=(action:"move" | "trash" | "category") => {
    if (!context) return; const email=context.email;
    context.trigger.focus(); onClose(); setTarget(""); setName(email.category || ""); setColor(email.categoryColor || "#0078d4"); setError(""); setOperation({ email,action });
  };
  const edit=async (value:EmailMessageEdit) => {
    if (busy || disabled) return;
    setBusy(true); setError("");
    try { const message=operation?.email ?? context?.email; await invoke("update_email_archive_message",{ edit:{ ...value,title:message?.subject,startsAt:message?.date } }); onEdited(value); setOperation(null); }
    catch { const message="Die lokale Änderung konnte nicht gespeichert werden. Bitte eine laufende Kopie abwarten und erneut versuchen. Ihre Original-E-Mails bleiben erhalten."; if (operation) setError(message); else onError(message); }
    finally { setBusy(false); }
  };
  const openWindow=async () => {
    if (!context) return; const id=context.email.id; context.trigger.focus(); onClose();
    try { await invoke("open_email_archive_window",{ id }); } catch { onError("Das separate Lesefenster konnte nicht geöffnet werden. Bitte erneut versuchen; die Nachricht bleibt im Archiv lesbar."); }
  };
  return <>
    {context && createPortal(<div ref={menu} className="email-folder-context-menu" role="menu" aria-label="Aktionen für E-Mail" style={{ left:context.x,top:context.y }} onContextMenu={event => event.preventDefault()} onKeyDown={event => {
      if (["Escape","Tab"].includes(event.key)) { if (event.key==="Escape") event.preventDefault(); context.trigger.focus(); onClose(); return; }
      if (!["ArrowUp","ArrowDown","Home","End"].includes(event.key)) return;
      event.preventDefault(); const items=Array.from(menu.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? []); const index=items.indexOf(document.activeElement as HTMLButtonElement);
      items[event.key==="Home" ? 0 : event.key==="End" ? items.length-1 : (index+(event.key==="ArrowDown" ? 1 : -1)+items.length)%items.length]?.focus();
    }}>
      <button type="button" role="menuitem" onClick={() => void openWindow()}><ExternalLink size={16} /> In separatem Fenster öffnen</button>
      {context.email.deleted ? <button type="button" role="menuitem" disabled={busy || disabled} onClick={() => { const id=context.email.id; onClose(); void edit({ id,action:"restore" }); }}><Undo2 size={16} /> Aus Archiv-Papierkorb wiederherstellen</button> : <>
        <button type="button" role="menuitem" disabled={disabled || busy} onClick={() => start("move")}><FolderInput size={16} /> In anderen Archivordner verschieben …</button>
        <button type="button" role="menuitem" disabled={disabled || busy} onClick={() => start("category")}><Tag size={16} /> Kategorisieren …</button>
        <div role="separator" /><button type="button" role="menuitem" className="danger" disabled={disabled || busy} onClick={() => start("trash")}><Trash2 size={16} /> Aus Backup löschen …</button>
      </>}
    </div>,document.body)}
    {operation && createPortal(<dialog ref={dialog} className="email-save-page email-message-dialog" aria-labelledby="email-message-action-title" onCancel={event => { if (busy) event.preventDefault(); else setOperation(null); }}>
      <h3 id="email-message-action-title">{operation.action==="move" ? "E-Mail verschieben" : operation.action==="category" ? "E-Mail kategorisieren" : "E-Mail aus Backup löschen?"}</h3>
      <p className="email-action-subject"><strong>{operation.email.subject || "(Ohne Betreff)"}</strong><br />{operation.email.sender} · {emailDateLabel(operation.email.date)}</p>
      {operation.action==="move" ? <><p>Wählen Sie einen Zielordner im lokalen Archiv.</p><div className="email-move-tree"><EmailFolderTree nodes={tree} label="Zielordner im Archiv" selectedId={target} onSelect={setTarget} /></div><small>{folders.find(folder => folder.id===target)?.path || "Noch kein Zielordner ausgewählt."}</small></> : operation.action==="category" ? <>
        <label className="email-category-name">Kategorie <input maxLength={100} list="email-category-suggestions" aria-label="E-Mail-Kategorie" value={name} onChange={event => { setName(event.target.value); const found=categories.find(category => category.name===event.target.value); if (found) setColor(found.color); }} placeholder="z. B. Arbeit, Wichtig …" /></label>
        <datalist id="email-category-suggestions">{categories.map(category => <option key={category.name} value={category.name} />)}</datalist>
        <fieldset className="email-category-colors"><legend>Farbe</legend>{colors.map(([label,value]) => <label key={value}><input type="radio" name="email-category-color" aria-label={label} value={value} checked={color===value} onChange={() => setColor(value)} /><i style={{ backgroundColor:value }} />{label}</label>)}</fieldset>
        <button type="button" className="email-details-toggle" onClick={() => setName("")} disabled={busy}>Keine Kategorie</button>
      </> : <p>Die lokale Archivnachricht wird in den Archiv-Papierkorb verschoben und kann dort wiederhergestellt werden. Die Original-E-Mail in Outlook, Thunderbird und Microsoft 365 bleibt erhalten.</p>}
      {operation.action!=="trash" && <p className="email-action-scope">Nur die lokale Archivkopie wird geändert. Die Original-E-Mail bleibt erhalten.</p>}
      {error && <p role="alert" className="field-error">{error}</p>}
      <div className="button-row"><button type="button" disabled={busy} onClick={() => setOperation(null)}>Abbrechen</button><button type="button" className={operation.action==="trash" ? "danger-button" : "primary"} disabled={busy || disabled || (operation.action==="move" && (!target || target===operation.email.folderId))} onClick={() => void edit({ id:operation.email.id,action:operation.action,folderId:target,category:name,color })}>{busy ? "Wird gespeichert …" : operation.action==="trash" ? "In Archiv-Papierkorb verschieben" : "Speichern"}</button></div>
    </dialog>,document.body)}
  </>;
}
