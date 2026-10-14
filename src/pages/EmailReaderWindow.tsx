import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { invokeWithDiagnostics as invoke } from "../utils/notificationPolicy";
import { EmailArchiveReader } from "../components/EmailArchiveReader";
import type { ArchivedEmail, EmailArchiveFolder } from "../types/emailArchive";
import "./EmailSavePage.css";

export function EmailReaderWindow({ id }: { id:string }) {
  const [email,setEmail] = useState<ArchivedEmail | null>(null), [folders,setFolders] = useState<EmailArchiveFolder[]>([]);
  const [reading,setReading] = useState(true), [error,setError] = useState("");
  useEffect(() => {
    let active=true, request=0, dispose:(()=>void) | undefined;
    const load = async () => {
      const current=++request; setReading(true); setError("");
      try { const [message,items]=await Promise.all([invoke<ArchivedEmail>("read_email_archive_message",{ id }),invoke<EmailArchiveFolder[]>("list_email_archive_folders")]); if (active && current===request) { setEmail(message); setFolders(items); document.title=`${message.subject || "E-Mail"} · E-Mail-Archiv`; } }
      catch { if (active && current===request) { setEmail(null); setError("Diese lokale Nachricht konnte nicht geöffnet werden. Bitte die Archivansicht prüfen und erneut öffnen."); } }
      finally { if (active && current===request) setReading(false); }
    };
    void load(); void listen<string>("email-archive-message-changed",event => { if (event.payload===id) void load(); }).then(unlisten => { if (active) dispose=unlisten; else unlisten(); }).catch(() => undefined);
    return () => { active=false; dispose?.(); };
  },[id]);
  return <main className="email-save-page email-popout-page"><header className="email-popout-heading">E-Mail-Archiv · Lokale Kopie</header>{error && <p role="alert" className="field-error">{error}</p>}<EmailArchiveReader email={email} reading={reading} folders={folders} /></main>;
}
