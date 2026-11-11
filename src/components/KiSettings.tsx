import { useEffect, useState, type FormEvent } from "react";
import { getKiConfig, saveKiConfig, listKiAcknowledgements, listKiAccessRequests, importKiPdf, type KiConfig, type KiReceipt, type KiAccessRequest } from "../services/ki";
import { KiPdfDocument } from "./KiPdfDocument";
import { KiWindow } from "./KiWindow";
import { KiNewsEditor } from "./KiNewsEditor";
import { exportKiReceipt } from "../pages/KiPage";
import "../pages/KiPage.css";

export function KiSettings() {
  const [config, setConfig] = useState<KiConfig | null>(null);
  const [receipts, setReceipts] = useState<KiReceipt[]>([]);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<"document" | "receipts" | "requests" | "news">("document");
  const [requests, setRequests] = useState<KiAccessRequest[]>([]);
  const [selectedRequest, setSelectedRequest] = useState<KiAccessRequest | null>(null);
  const [selected, setSelected] = useState<KiReceipt | null>(null);
  const [properties, setProperties] = useState(false);
  const [document, setDocument] = useState<KiConfig | null>(null);
  const load = async () => {
    setError("");
    try { const [content, records, access] = await Promise.all([getKiConfig(), listKiAcknowledgements(), listKiAccessRequests()]); setConfig(content); setReceipts(records); setRequests(access ?? []); }
    catch { setError("KI-Einstellungen konnten nicht geladen werden. EDV-Zugang prüfen und erneut versuchen."); }
  };
  useEffect(() => { void load(); }, []);
  const importPdf = async (file?: File) => {
    if (!file || !config || busy) return;
    setError(""); setMessage("");
    if (file.size > 10 * 1024 * 1024 || !file.name.toLowerCase().endsWith(".pdf")) { setError("Bitte ein PDF bis 10 MB auswählen."); return; }
    setBusy(true);
    try {
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader(); reader.onerror = reject;
        reader.onload = () => resolve(String(reader.result).split(",")[1]); reader.readAsDataURL(file);
      });
      const document = await importKiPdf(file.name, base64);
      setConfig({ ...config, pdfSha256: document.sha256, pdfName: document.name, version: "", published: false, body: "Maßgeblich ist das vollständige Original-PDF." });
      setMessage("Neues PDF importiert. Dokumentversion eintragen, prüfen und anschließend veröffentlichen. Frühere Nachweise bleiben erhalten.");
    } catch (cause) { setError(String(cause)); }
    finally { setBusy(false); }
  };
  const update = <K extends keyof KiConfig>(key: K, value: KiConfig[K]) => setConfig((current) => current && ({ ...current, [key]: value }));
  const submit = async (event: FormEvent) => {
    event.preventDefault(); if (!config || busy) return;
    setBusy(true); setError(""); setMessage("");
    try { setConfig(await saveKiConfig(config)); setMessage(config.published ? "Richtlinien veröffentlicht. Neue Bestätigungen beziehen sich auf diesen Stand." : "Entwurf gespeichert. Die Bestätigung ist für Benutzer gesperrt."); }
    catch (cause) { setError(String(cause)); }
    finally { setBusy(false); }
  };
  return <div className="ki-page ki-settings">
    <nav className="ki-section-tabs" aria-label="KI-Verwaltung"><button className={tab === "document" ? "active" : ""} type="button" onClick={() => setTab("document")}>Richtlinien & Schulung</button><button className={tab === "receipts" ? "active" : ""} type="button" onClick={() => setTab("receipts")}>Nachweise ({receipts.length})</button><button className={tab === "requests" ? "active" : ""} type="button" onClick={() => setTab("requests")}>Zugangsanträge ({requests.length})</button><button className={tab === "news" ? "active" : ""} type="button" onClick={() => setTab("news")}>Nachrichten</button></nav>

    {tab === "news" && <KiNewsEditor />}
    {error && <p className="ki-error" role="alert">{error}</p>}{message && <p className="ki-local-note" role="status">{message}</p>}
    {tab === "document" && (!config ? <button type="button" onClick={() => void load()}>Erneut laden</button> : <form className="ki-workspace ki-form ki-settings-form" onSubmit={(event) => void submit(event)}>
      <div className="ki-commandbar"><strong>Richtlinien & Schulung</strong><button className="ki-command-refresh" type="button" disabled={busy} onClick={() => void load()}>Aktualisieren</button></div>
      <fieldset disabled={busy}><legend>Dokument</legend>
        <div className="ki-fields"><label>Titel<input maxLength={200} required={config.published} value={config.title} onChange={(event) => update("title", event.target.value)} /></label><label>Dokumentversion<input maxLength={80} required={config.published} placeholder="z. B. 1.0" value={config.version} onChange={(event) => update("version", event.target.value)} /></label></div>
        <label>PDF hinzufügen / durch neue Fassung ersetzen<input type="file" accept="application/pdf,.pdf" onChange={(event) => void importPdf(event.target.files?.[0])} /></label>
        {config.pdfSha256 && <div className="ki-document-reference"><span>{config.pdfName}</span><button type="button" onClick={() => setDocument(config)}>Original-PDF lesen</button></div>}
        <label>{config.pdfSha256 ? "Hinweis zum Originaldokument" : "Offizieller Richtlinientext"}<textarea rows={config.pdfSha256 ? 2 : 7} maxLength={200000} required={config.published} value={config.body} onChange={(event) => update("body", event.target.value)} /></label>
      </fieldset>
      <fieldset disabled={busy}><legend>Schulung & Freigabe</legend><label>Online-Schulung · HTTPS-Link (optional)<input type="url" maxLength={2048} value={config.trainingUrl} onChange={(event) => update("trainingUrl", event.target.value)} /></label><label className="ki-check"><input type="checkbox" checked={config.published} onChange={(event) => update("published", event.target.checked)} />Offizielle Richtlinien veröffentlichen und Bestätigungen erlauben</label></fieldset>
      <footer className="ki-statusbar"><small>Frühere Nachweise behalten ihren Dokumentstand.</small><button className="primary" type="submit" disabled={busy}>{busy ? "Wird gespeichert …" : "Speichern"}</button></footer>
    </form>)}
    {tab === "receipts" && <section className="ki-workspace" aria-label="Lokale Bestätigungen">
      <div className="ki-commandbar"><button type="button" disabled={!selected} onClick={() => setProperties(true)}>Eigenschaften</button><button type="button" disabled={!selected} onClick={() => { if (selected) void exportKiReceipt(selected).catch(() => setError("Export fehlgeschlagen.")); }}>Bestätigung exportieren</button><button className="ki-command-refresh" type="button" disabled={busy} onClick={() => void load()}>Aktualisieren</button></div>
      <div className="ki-list-scroll"><table className="ki-list" aria-label="KI-Nachweise"><thead><tr><th>Name</th><th>E-Mail</th><th>Dokumentstand</th><th>Bestätigt am</th></tr></thead><tbody>{receipts.map((receipt) => <tr key={receipt.id} className={selected?.id === receipt.id ? "selected" : ""} onClick={() => setSelected(receipt)} onDoubleClick={() => { setSelected(receipt); setProperties(true); }}><td><button type="button" onClick={() => { setSelected(receipt); setProperties(true); }}>{receipt.fullName}</button></td><td>{receipt.email}</td><td>{receipt.policy.version}</td><td>{new Date(receipt.submittedAt).toLocaleString("de-DE")}</td></tr>)}</tbody></table>{!receipts.length && <p className="ki-empty">Auf diesem PC liegen noch keine Bestätigungen vor.</p>}</div>
      <footer className="ki-statusbar"><span>{receipts.length} Nachweise</span><span>Auf diesem PC gespeichert</span></footer>
    </section>}
    {properties && selected && <KiWindow title={`Eigenschaften · ${selected.fullName}`} onClose={() => setProperties(false)} footer={<button type="button" onClick={() => void exportKiReceipt(selected).catch(() => setError("Export fehlgeschlagen."))}>Bestätigung exportieren</button>}>
      <dl className="ki-properties"><dt>Name</dt><dd>{selected.fullName}</dd><dt>E-Mail</dt><dd>{selected.email}</dd><dt>Bereich</dt><dd>{selected.department || "—"}</dd><dt>Dokument</dt><dd>{selected.policy.title}</dd><dt>Stand</dt><dd>{selected.policy.version}</dd><dt>IT-Schulung</dt><dd>{selected.trainingDate} · {selected.trainingMode === "onsite" ? "Vor Ort" : "Online"}</dd><dt>Bestätigt am</dt><dd>{new Date(selected.submittedAt).toLocaleString("de-DE")}</dd></dl>
      <img className="ki-signature-preview" src={selected.signaturePng} alt={`Unterschrift von ${selected.fullName}`} />
      {selected.policy.pdfSha256 ? <button type="button" onClick={() => setDocument(selected.policy)}>Original-PDF lesen</button> : <details className="ki-record"><summary>Dokumenttext</summary><pre className="ki-policy">{selected.policy.body}</pre></details>}
      <details className="ki-record"><summary>Weitere Angaben</summary><dl className="ki-properties"><dt>Nachweis-ID</dt><dd>{selected.id}</dd><dt>Dokument-Prüfsumme</dt><dd>{selected.policySha256}</dd></dl></details>
    </KiWindow>}
    {document && <KiWindow title={document.pdfName || document.title} wide onClose={() => setDocument(null)}><KiPdfDocument sha256={document.pdfSha256!} name={document.pdfName || "KI-Leitlinie.pdf"} initiallyOpen /></KiWindow>}
    {tab === "requests" && <section className="ki-workspace" aria-label="Lokale Zugangsanträge"><div className="ki-commandbar"><strong>KI-Zugangsanträge</strong><button className="ki-command-refresh" type="button" disabled={busy} onClick={() => void load()}>Aktualisieren</button></div><div className="ki-list-scroll"><table className="ki-list" aria-label="KI-Zugangsanträge"><thead><tr><th>Name</th><th>Anwendung</th><th>Erstellt am</th><th>Status</th></tr></thead><tbody>{requests.map((request) => <tr key={request.id}><td><button type="button" onClick={() => setSelectedRequest(request)}>{request.fullName}</button></td><td>{request.tool}</td><td>{new Date(request.createdAt).toLocaleString("de-DE")}</td><td>Vorbereitet</td></tr>)}</tbody></table>{!requests.length && <p className="ki-empty">Keine lokalen Zugangsanträge.</p>}</div><footer className="ki-statusbar"><span>{requests.length} Anträge</span><span>Lokal gespeichert · Versand nicht geprüft</span></footer></section>}
    {selectedRequest && <KiWindow title={`KI-Antrag · ${selectedRequest.fullName}`} onClose={() => setSelectedRequest(null)}><dl className="ki-properties"><dt>Name</dt><dd>{selectedRequest.fullName}</dd><dt>E-Mail</dt><dd>{selectedRequest.email}</dd><dt>Bereich</dt><dd>{selectedRequest.department || "—"}</dd><dt>Anwendung</dt><dd>{selectedRequest.tool}</dd><dt>Erstellt</dt><dd>{new Date(selectedRequest.createdAt).toLocaleString("de-DE")}</dd></dl><strong>Einsatzzweck</strong><p className="ki-policy">{selectedRequest.purpose}</p><p className="ki-request-delivery">Lokal vorbereitet. Der Versand an die EDV ist nicht bestätigt.</p></KiWindow>}
  </div>;
}
