import { useState, type FormEvent } from "react";
import { Copy, Mail, Save } from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { KiWindow } from "./KiWindow";
import { saveKiAccessRequest, type KiAccessRequest } from "../services/ki";

export function kiAccessRequestText(request: KiAccessRequest) {
  return `Antrag auf kostenpflichtigen KI-Zugang\n\nName: ${request.fullName}\nDienstliche E-Mail: ${request.email}\nBereich: ${request.department || "—"}\nKI-Anwendung: ${request.tool}\n\nEinsatzzweck:\n${request.purpose}\n\nAntragsnummer: ${request.id}\nErstellt: ${request.createdAt}`;
}

export function KiAccessRequestForm({ onClose, initialName = "", initialEmail = "" }: { onClose: () => void; initialName?: string; initialEmail?: string }) {
  const [fullName, setFullName] = useState(initialName);
  const [email, setEmail] = useState(initialEmail);
  const [department, setDepartment] = useState("");
  const [application, setApplication] = useState("");
  const [otherApplication, setOtherApplication] = useState("");
  const [purpose, setPurpose] = useState("");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<KiAccessRequest | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const tool = application === "other" ? otherApplication.trim() : application;
  const complete = fullName.trim().length >= 3 && /^[^\s@]+@[^\s@]+$/.test(email) && tool && purpose.trim().length >= 10;
  const submit = async (event: FormEvent) => {
    event.preventDefault(); if (!complete || busy) return;
    setBusy(true); setError("");
    try { setSaved(await saveKiAccessRequest({ fullName: fullName.trim(), email: email.trim(), department: department.trim(), tool, purpose: purpose.trim() })); }
    catch { setError("Der Antrag konnte nicht gespeichert werden. Bitte Angaben prüfen und erneut versuchen."); }
    finally { setBusy(false); }
  };
  const prepareEmail = async () => {
    if (!saved || busy) return;
    setBusy(true); setError(""); setMessage("");
    try {
      await openUrl(`mailto:edv@dmh-aidlingen.de?subject=${encodeURIComponent(`KI-Zugangsantrag · ${saved.tool}`)}&body=${encodeURIComponent(kiAccessRequestText(saved))}`);
      setMessage("E-Mail-Entwurf geöffnet. Bitte im E-Mail-Programm selbst absenden.");
    } catch { setError("Das E-Mail-Programm konnte nicht geöffnet werden. Bitte den Antrag kopieren und an edv@dmh-aidlingen.de senden."); }
    finally { setBusy(false); }
  };
  const copyRequest = async () => {
    if (!saved) return;
    try { await writeText(kiAccessRequestText(saved)); setMessage("Antrag kopiert."); setError(""); }
    catch { setError("Der Antrag konnte nicht kopiert werden."); }
  };
  return <KiWindow title={saved ? "KI-Antrag vorbereitet" : "Kostenpflichtigen KI-Zugang beantragen"} onClose={onClose} busy={busy} footer={saved ? <><button type="button" disabled={busy} onClick={() => void copyRequest()}><Copy size={16} />Kopieren</button><button className="primary" type="button" disabled={busy} onClick={() => void prepareEmail()}><Mail size={16} />E-Mail an EDV</button></> : <button className="primary" form="ki-access-request" type="submit" disabled={!complete || busy}><Save size={16} />{busy ? "Wird gespeichert …" : "Antrag vorbereiten"}</button>}>
    {error && <p className="ki-error" role="alert">{error}</p>}
    {saved ? <><dl className="ki-properties"><dt>Name</dt><dd>{saved.fullName}</dd><dt>E-Mail</dt><dd>{saved.email}</dd><dt>KI-Anwendung</dt><dd>{saved.tool}</dd></dl><p className="ki-request-delivery">Lokal gespeichert · noch nicht an die EDV gesendet.</p><p className="ki-local-note">Die EDV prüft Freigabe und Bereitstellung.</p>{message && <p role="status" className="ki-local-note">{message}</p>}</> : <form id="ki-access-request" className="ki-form" onSubmit={(event) => void submit(event)}><fieldset disabled={busy}><legend>Antragsteller</legend><div className="ki-fields"><label>Vor- und Nachname<input required minLength={3} maxLength={200} autoComplete="name" value={fullName} onChange={(event) => setFullName(event.target.value)} /></label><label>Dienstliche E-Mail<input required type="email" maxLength={254} autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} /></label><label>Abteilung / Bereich (optional)<input maxLength={200} value={department} onChange={(event) => setDepartment(event.target.value)} /></label></div></fieldset><fieldset disabled={busy}><legend>Gewünschter Zugang</legend><label>KI-Anwendung<select required value={application} onChange={(event) => setApplication(event.target.value)}><option value="">Bitte auswählen …</option><option>ChatGPT Business</option><option>Microsoft 365 Copilot</option><option value="other">Andere Anwendung</option></select></label>{application === "other" && <label>Name der Anwendung<input required maxLength={200} value={otherApplication} onChange={(event) => setOtherApplication(event.target.value)} /></label>}<label>Einsatzzweck<textarea required minLength={10} maxLength={2000} rows={4} placeholder="Für welche dienstlichen Aufgaben wird der Zugang benötigt?" value={purpose} onChange={(event) => setPurpose(event.target.value)} /></label></fieldset></form>}
  </KiWindow>;
}
