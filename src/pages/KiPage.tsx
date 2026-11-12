import { useEffect, useState, type FormEvent } from "react";
import { BookOpen, CheckCircle2, FileCheck2, FileText, Play, RefreshCw, Save, Info, Download, UserRound, PenLine, ChevronLeft, ChevronRight, ClipboardList, KeyRound } from "lucide-react";
import { save } from "@tauri-apps/plugin-dialog";
import { writeFile, writeTextFile } from "@tauri-apps/plugin-fs";
import { createTypedSignature, KiSignature } from "../components/KiSignature";
import { KiPdfDocument } from "../components/KiPdfDocument";
import { KiWindow } from "../components/KiWindow";
import { KiAccessRequestForm } from "../components/KiAccessRequestForm";
import { KiNewsFeed } from "../components/KiNewsFeed";
import { KiTrainingPane } from "../components/KiTrainingPane";
import { KiMyReceipts } from "../components/KiMyReceipts";
import { getKiConfig, getKiPdf, submitKiAcknowledgement, type KiConfig, type KiReceipt, type KiSubmission } from "../services/ki";
import "./KiPage.css";

export async function exportKiReceipt(receipt: KiReceipt) {
  const path = await save({ defaultPath: `KI-Bestaetigung-${receipt.id}.json`, filters: [{ name: "KI-Bestätigung", extensions: ["json"] }] });
  if (path) {
    const documentPdfBase64 = receipt.policy.pdfSha256 ? await getKiPdf(receipt.policy.pdfSha256) : undefined;
    await writeTextFile(path, JSON.stringify({ ...receipt, documentPdfBase64 }, null, 2));
  }
}

const emptyForm: Omit<KiSubmission, "revision"> = { fullName: "", email: "", department: "", readConfirmed: false, trainingConfirmed: false, trainingMode: "onsite", trainingDate: "", signatureMethod: "typed", signaturePng: "" };

export function KiPage() {
  const [config, setConfig] = useState<KiConfig | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [receipt, setReceipt] = useState<KiReceipt | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [pdfReady, setPdfReady] = useState(false);
  const [activeWindow, setActiveWindow] = useState<"document" | "form" | "receipt" | "details" | "access" | "read-first" | null>(null);
  const [view, setView] = useState<"home" | "document" | "training" | "forms" | "receipts">("home");
  const [formStep, setFormStep] = useState<"person" | "training" | "signature">("person");
  const load = async () => {
    setLoading(true); setError(""); setPdfReady(false);
    try {
      setConfig(await getKiConfig());
      setForm((current) => ({ ...current, readConfirmed: false, trainingConfirmed: false, signaturePng: "" }));
    } catch { setError("KI-Inhalte konnten nicht geladen werden. Bitte erneut versuchen."); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []);
  const published = config?.published && Boolean(config.body.trim());
  const ready = published && (!config?.pdfSha256 || pdfReady);
  const signed = form.signatureMethod === "typed" ? form.fullName.trim().length >= 3 : Boolean(form.signaturePng);
  const personReady = form.fullName.trim().length >= 3 && /^[^\s@]+@[^\s@]+$/.test(form.email) && form.readConfirmed;
  const trainingReady = Boolean(form.trainingDate) && form.trainingDate <= new Date().toLocaleDateString("en-CA") && form.trainingConfirmed;
  const openForm = (step: typeof formStep = "person") => { setError(""); setFormStep(step); setActiveWindow("form"); };
  const downloadPdf = async () => {
    if (!config?.pdfSha256) return;
    try {
      const encoded = await getKiPdf(config.pdfSha256);
      const path = await save({ defaultPath: config.pdfName || "KI-Leitlinie.pdf", filters: [{ name: "PDF", extensions: ["pdf"] }] });
      if (path) await writeFile(path, Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0)));
    } catch { setError("Das PDF konnte nicht gespeichert werden."); }
  };
  const update = <K extends keyof typeof form>(key: K, value: typeof form[K]) => setForm((current) => ({ ...current, [key]: value }));
  const submit = async (event: FormEvent) => {
    event.preventDefault(); if (formStep !== "signature" || !config || !ready || !signed || !personReady || !trainingReady || busy) return;
    setBusy(true); setError("");
    try {
      const signaturePng = form.signatureMethod === "typed" ? createTypedSignature(form.fullName) : form.signaturePng;
      setReceipt(await submitKiAcknowledgement({ ...form, revision: config.revision, signaturePng }));
      setForm(emptyForm); setActiveWindow("receipt");
    } catch (cause) { setError(String(cause)); }
    finally { setBusy(false); }
  };
  return <div className="page ki-page">
    <header className="page-header"><div><h2>KI</h2></div></header>
    {view === "home" ? <>
      <p className="ki-introduction">Informationen zum Einsatz von KI im Mutterhaus. Richtlinien, Schulungen und aktuelle Mitteilungen der EDV.</p>
      <div className="ki-home-navigation"><div className="ki-home-actions" role="group" aria-label="KI-Bereiche"><button className="primary" type="button" onClick={() => setView("document")}>Richtlinien</button><button className="primary" type="button" onClick={() => setView("training")}>Schulungen</button><button className="primary" type="button" onClick={() => setView("forms")}>Formulare</button></div><button type="button" onClick={() => setView("receipts")}><FileCheck2 size={16} />Meine Nachweise</button></div>
      <KiNewsFeed onGuidelines={() => setView("document")} />
    </> : <nav className="ki-breadcrumb" aria-label="KI-Pfad"><button className="ki-back-button" type="button" aria-label="Zurück zur KI-Übersicht" onClick={() => setView("home")}><ChevronLeft size={16} aria-hidden="true" />Zurück</button><ChevronRight size={15} aria-hidden="true" /><strong>{view === "document" ? "Richtlinien" : view === "training" ? "Schulungen" : view === "receipts" ? "Meine Nachweise" : "Formulare"}</strong><button className="ki-command-refresh" type="button" disabled={loading} aria-label="KI aktualisieren" title="Aktualisieren" onClick={() => void load()}><RefreshCw size={16} /></button></nav>}
    {view === "receipts" && <KiMyReceipts onExport={exportKiReceipt} />}
    {error && !activeWindow && <p className="ki-error" role="alert">{error}</p>}
    {loading && <p role="status">Wird geladen …</p>}
    {view === "document" && <section className="ki-workspace" aria-label="KI-Richtlinie">
      <div className="ki-commandbar" role="group" aria-label="Dokumentaktionen">
        <button type="button" disabled={loading || !published} aria-label="Original-PDF lesen" onClick={() => setActiveWindow("document")}><BookOpen size={14} />Lesen</button>
        <button type="button" disabled={!published || !config?.pdfSha256} onClick={() => void downloadPdf()}><Download size={14} />Speichern</button>
        <button type="button" disabled={!config} onClick={() => setActiveWindow("details")}><Info size={14} />Details</button>
        <span className="ki-command-separator" aria-hidden="true" />
        <button className="primary" type="button" onClick={() => setView("forms")}><ClipboardList size={14} />Zu den Formularen</button>
      </div>
      <div className="ki-explorer-scroll">
        <table className="ki-explorer-list ki-document-list" aria-label="KI-Richtlinien">
          <thead><tr><th scope="col">Name</th><th scope="col">Typ</th><th scope="col">Version</th><th scope="col">Status</th></tr></thead>
          <tbody><tr>
            <td><div className="ki-explorer-name"><FileText size={18} aria-hidden="true" /><span><strong title={config?.title}>{config?.title.split(" · ")[0] || "KI-Leitlinie"}</strong>{config?.pdfName && <small>{config.pdfName}</small>}</span></div></td>
            <td>{config?.pdfSha256 ? "PDF-Dokument" : "Richtlinie"}</td>
            <td>{config?.version || "—"}</td>
            <td>{loading ? "Wird geladen …" : published ? "Veröffentlicht" : "Noch nicht veröffentlicht"}</td>
          </tr></tbody>
        </table>
      </div>
      <footer className="ki-statusbar"><span>{config ? "1 Dokument" : "Kein Dokument"}</span>{published && <span>Aktuelle Fassung</span>}</footer>
    </section>}
    {view === "training" && <KiTrainingPane key={config?.revision} config={config} loading={loading} onForms={() => setView("forms")} />}
    {view === "forms" && <section className="ki-workspace ki-forms-explorer" aria-label="KI-Formulare">
      <div className="ki-commandbar"><button type="button" onClick={() => setView("receipts")}><FileCheck2 size={14} />Meine Nachweise</button></div>
      <div className="ki-explorer-scroll">
        <table className="ki-explorer-list" aria-label="Verfügbare KI-Formulare">
          <thead><tr><th scope="col">Name</th><th scope="col">Typ</th><th scope="col">Status</th><th scope="col">Aktion</th></tr></thead>
          <tbody>
            <tr>
              <td><div className="ki-explorer-name"><FileText size={18} aria-hidden="true" /><span><strong>Kenntnisnahme & Teilnahme</strong><small>Richtlinie gelesen · Schulung besucht</small></span></div></td>
              <td>Bestätigung</td>
              <td>{receipt?.revision === config?.revision && receipt ? "Bestätigt" : published ? "Verfügbar" : "Nicht veröffentlicht"}</td>
              <td><div className="ki-explorer-actions">{receipt && <button type="button" onClick={() => setActiveWindow("receipt")}><Info size={14} />Nachweis anzeigen</button>}<button className="primary" type="button" disabled={!published || loading} aria-label="Bestätigung ausfüllen" onClick={() => { if (ready) openForm(); else setActiveWindow("read-first"); }}><PenLine size={14} />Ausfüllen</button></div></td>
            </tr>
            <tr>
              <td><div className="ki-explorer-name"><KeyRound size={18} aria-hidden="true" /><span><strong>KI-Zugang beantragen</strong><small>Kostenpflichtige KI-Anwendung</small></span></div></td>
              <td>Zugangsantrag</td>
              <td>Verfügbar</td>
              <td><div className="ki-explorer-actions"><button className="primary" type="button" aria-label="Kostenpflichtigen KI-Zugang beantragen" onClick={() => setActiveWindow("access")}><KeyRound size={14} />Beantragen</button></div></td>
            </tr>
          </tbody>
        </table>
      </div>
      <footer className="ki-statusbar"><span>2 Formulare</span>{published && <span>Richtlinie: {config?.version}</span>}</footer>
    </section>}
    {activeWindow === "read-first" && <KiWindow title="Richtlinie lesen" onClose={() => setActiveWindow(null)} footer={<button className="primary" type="button" onClick={() => setActiveWindow("document")}><BookOpen size={16} />Richtlinie öffnen</button>}><p>Bitte zuerst die aktuelle Richtlinie öffnen und lesen.</p></KiWindow>}
    {activeWindow === "access" && <KiAccessRequestForm onClose={() => setActiveWindow(null)} initialName={form.fullName || receipt?.fullName} initialEmail={form.email || receipt?.email} />}
    {activeWindow === "document" && config && <KiWindow title={config.pdfName || config.title} wide onClose={() => setActiveWindow(null)}>{config.pdfSha256 ? <KiPdfDocument key={config.pdfSha256} sha256={config.pdfSha256} name={config.pdfName || "KI-Leitlinie.pdf"} onReady={setPdfReady} initiallyOpen /> : <article className="ki-policy">{config.body}</article>}</KiWindow>}
    {activeWindow === "details" && config && <KiWindow title="Dokumentdetails" onClose={() => setActiveWindow(null)}><dl className="ki-properties"><dt>Titel</dt><dd>{config.title}</dd><dt>Stand</dt><dd>{config.version}</dd><dt>Datei</dt><dd>{config.pdfName || "—"}</dd><dt>Status</dt><dd>{published ? "Veröffentlicht" : "Entwurf"}</dd></dl><p className="ki-local-note">{config.body}</p></KiWindow>}
    {activeWindow === "form" && config && <KiWindow title="Bestätigung" busy={busy} onClose={() => setActiveWindow(null)} footer={<>
      {formStep !== "person" && <button type="button" disabled={busy} onClick={() => setFormStep(formStep === "signature" ? "training" : "person")}><ChevronLeft size={16} />Zurück</button>}
      {formStep === "signature" ? <button key="confirm" className="primary" type="submit" form="ki-acknowledgement" disabled={!ready || busy || !signed || !personReady || !trainingReady}><Save size={16} />{busy ? "Wird gespeichert …" : "Verbindlich bestätigen"}</button> : <button key="next" className="primary" type="button" disabled={busy || (formStep === "person" ? !personReady : !trainingReady)} onClick={(event) => { event.preventDefault(); setFormStep(formStep === "person" ? "training" : "signature"); }}>Weiter<ChevronRight size={16} /></button>}
    </>}>
      <div className="ki-form-document">{config.title.split(" · ")[0]} · {config.version}</div>
      <nav className="ki-section-tabs ki-form-tabs" aria-label="Bestätigungsschritte"><button className={formStep === "person" ? "active" : ""} type="button" disabled={busy} onClick={() => setFormStep("person")}><UserRound size={16} />Person</button><button className={formStep === "training" ? "active" : ""} type="button" disabled={busy} onClick={() => setFormStep("training")}><Play size={16} />Schulung</button><button className={formStep === "signature" ? "active" : ""} type="button" disabled={busy} onClick={() => setFormStep("signature")}><PenLine size={16} />Unterschrift</button></nav>
      <form id="ki-acknowledgement" className="ki-form ki-step-form" onSubmit={(event) => void submit(event)}>
        {error && <p className="ki-error" role="alert">{error}</p>}
        {formStep === "person" && <fieldset disabled={!ready || busy}><legend>Person</legend><div className="ki-fields"><label>Vor- und Nachname<input required maxLength={200} minLength={3} autoComplete="name" value={form.fullName} onChange={(event) => update("fullName", event.target.value)} /></label><label>E-Mail<input required type="email" maxLength={254} autoComplete="email" value={form.email} onChange={(event) => update("email", event.target.value)} /></label><label>Abteilung / Bereich (optional)<input maxLength={200} value={form.department} onChange={(event) => update("department", event.target.value)} /></label></div><label className="ki-check"><input type="checkbox" required checked={form.readConfirmed} onChange={(event) => update("readConfirmed", event.target.checked)} />Richtlinie gelesen und verstanden</label></fieldset>}
        {formStep === "training" && <fieldset disabled={!ready || busy}><legend>Schulung</legend><div className="ki-choice-buttons" role="group" aria-label="Teilnahme"><button className={form.trainingMode === "onsite" ? "active" : ""} type="button" aria-pressed={form.trainingMode === "onsite"} onClick={() => update("trainingMode", "onsite")}>Vor Ort</button><button className={form.trainingMode === "online" ? "active" : ""} type="button" aria-pressed={form.trainingMode === "online"} onClick={() => update("trainingMode", "online")}>Online</button></div><label>Datum der Schulung<input required type="date" max={new Date().toLocaleDateString("en-CA")} value={form.trainingDate} onChange={(event) => update("trainingDate", event.target.value)} /></label><label className="ki-check"><input type="checkbox" required checked={form.trainingConfirmed} onChange={(event) => update("trainingConfirmed", event.target.checked)} />Schulung vollständig besucht</label></fieldset>}
        {formStep === "signature" && <KiSignature name={form.fullName} method={form.signatureMethod} onMethodChange={(value) => update("signatureMethod", value)} value={form.signaturePng} onChange={(value) => update("signaturePng", value)} disabled={!ready || busy} />}
      </form>
    </KiWindow>}
    {activeWindow === "receipt" && receipt && <KiWindow title="Bestätigung gespeichert" onClose={() => setActiveWindow(null)} footer={<><button type="button" onClick={() => { setActiveWindow(null); setView("receipts"); }}><FileCheck2 size={16} />Meine Nachweise</button><button type="button" onClick={() => void exportKiReceipt(receipt).catch(() => setError("Die Bestätigung konnte nicht exportiert werden."))}><Download size={16} />Exportieren</button><button type="button" onClick={() => { setReceipt(null); openForm(); }}>Weitere Bestätigung</button></>}>
      {error && <p className="ki-error" role="alert">{error}</p>}
      <dl className="ki-properties"><dt>Name</dt><dd>{receipt.fullName}</dd><dt>E-Mail</dt><dd>{receipt.email}</dd><dt>Stand</dt><dd>{receipt.policy.version}</dd><dt>Schulung</dt><dd>{receipt.trainingDate} · {receipt.trainingMode === "onsite" ? "Vor Ort" : "Online"}</dd></dl>
    </KiWindow>}
  </div>;
}
