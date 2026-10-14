import { useEffect, useState } from "react";
import { Expand, Mail, Minimize2 } from "lucide-react";
import { EmailAttachments } from "./EmailAttachments";
import { emailDateLabel, emailHtmlAsText } from "../utils/emailContent";
import type { ArchivedEmail, EmailArchiveFolder } from "../types/emailArchive";

export function EmailArchiveReader({ email, reading, folders, expanded, onToggleExpand }: { email:ArchivedEmail | null; reading:boolean; folders:EmailArchiveFolder[]; expanded?:boolean; onToggleExpand?:()=>void }) {
  const [details, setDetails] = useState(false);
  useEffect(() => setDetails(false), [email?.id]);
  return <article className="email-archive-reader" aria-label="E-Mail lesen">{reading ? <p role="status">Lokale Nachricht wird geöffnet …</p> : email ? <>
    <header><div className="email-reader-subject"><h3>{email.subject || "(Ohne Betreff)"}</h3>{onToggleExpand && <button className="email-small-icon" type="button" aria-label={expanded ? "Lesebereich wiederherstellen" : "Lesebereich erweitern"} onClick={onToggleExpand}>{expanded ? <Minimize2 size={17} /> : <Expand size={17} />}</button>}</div>
      <div className="email-reader-sender"><strong>{email.sender}</strong><time>{emailDateLabel(email.date)}</time></div><p className="email-reader-recipient" title={email.recipient}>An: {email.recipient || "—"}</p>
      {email.category && <span className="email-category-badge" style={{ borderColor:email.categoryColor || "#0078d4" }}><i style={{ backgroundColor:email.categoryColor || "#0078d4" }} />{email.category}</span>}
      {email.deleted && <p className="email-trash-notice">Im Archiv-Papierkorb · Die Nachricht kann wiederhergestellt werden.</p>}
      <button className="email-details-toggle" type="button" aria-expanded={details} onClick={() => setDetails(current => !current)}>{details ? "Details ausblenden" : "Details einblenden"}</button>
      {details && <dl><dt>Von</dt><dd>{email.sender}</dd><dt>An</dt><dd>{email.recipient}</dd>{email.cc && <><dt>Cc</dt><dd>{email.cc}</dd></>}<dt>Datum</dt><dd>{emailDateLabel(email.date)}</dd><dt>Ordner</dt><dd>{folders.find(folder => folder.id === email.folderId)?.path || "—"}</dd></dl>}
    </header>
    <EmailAttachments key={email.id} messageId={email.id} />
    {email.large && <p>Diese sehr große Nachricht wird gekürzt angezeigt. Die vollständige Originaldatei bleibt in der lokalen Kopie erhalten.</p>}
    <div className="email-archive-body">{email.body || emailHtmlAsText(email.html) || "Kein lesbarer Nachrichtentext vorhanden."}</div>
  </> : <div className="email-archive-reader-empty"><Mail size={36} /><p>Eine archivierte Nachricht zum Lesen auswählen.</p></div>}</article>;
}
