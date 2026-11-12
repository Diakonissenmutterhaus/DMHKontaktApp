import { useEffect, useState } from "react";
import { BookOpen, Download, FileCheck2, RefreshCw } from "lucide-react";
import { listMyKiAcknowledgements, type KiReceipt } from "../services/ki";
import { KiWindow } from "./KiWindow";
import { KiPdfDocument } from "./KiPdfDocument";

export function KiMyReceipts({ onExport }: { onExport: (receipt: KiReceipt) => Promise<void> }) {
  const [records, setRecords] = useState<KiReceipt[]>([]);
  const [selected, setSelected] = useState<KiReceipt | null>(null);
  const [documentOpen, setDocumentOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [error, setError] = useState("");
  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError("");
    void listMyKiAcknowledgements().then((next) => { if (!cancelled) setRecords(next ?? []); })
      .catch(() => { if (!cancelled) setError("Ihre Nachweise konnten nicht geladen werden. Bitte erneut aktualisieren."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [refresh]);
  const exportRecord = async () => {
    if (!selected || exporting) return;
    setExporting(true); setError("");
    try { await onExport(selected); }
    catch { setError("Der Nachweis konnte nicht exportiert werden."); }
    finally { setExporting(false); }
  };
  const timestamp = (date: string) => new Date(date).toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short" });
  return <>
    <section className="ki-workspace" aria-label="Meine Nachweise">
      <div className="ki-commandbar"><FileCheck2 size={16} aria-hidden="true" /><strong>Meine Nachweise</strong><button className="ki-command-refresh" type="button" disabled={loading} aria-label="Meine Nachweise aktualisieren" onClick={() => setRefresh((value) => value + 1)}><RefreshCw size={14} />Aktualisieren</button></div>
      {error && !selected && <p className="ki-error" role="alert">{error}</p>}
      {loading ? <p className="ki-empty" role="status">Nachweise werden geladen …</p> : <div className="ki-explorer-scroll">
        <table className="ki-explorer-list" aria-label="Meine unterschriebenen Dokumente">
          <thead><tr><th scope="col">Dokument</th><th scope="col">Version</th><th scope="col">Unterschrieben am</th><th scope="col">Aktion</th></tr></thead>
          <tbody>{records.map((record) => <tr key={record.id}>
            <td><div className="ki-explorer-name"><FileCheck2 size={18} aria-hidden="true" /><span><strong>{record.policy.title.split(" · ")[0]}</strong><small>{record.fullName}</small></span></div></td>
            <td>{record.policy.version}</td><td><time dateTime={record.submittedAt}>{timestamp(record.submittedAt)}</time></td>
            <td><button type="button" onClick={() => { setSelected(record); setDocumentOpen(false); setError(""); }}><BookOpen size={14} />Öffnen</button></td>
          </tr>)}</tbody>
        </table>
        {!error && !records.length && <p className="ki-empty">Noch keine eigenen Nachweise verfügbar.</p>}
      </div>}
      <footer className="ki-statusbar"><span>{records.length} Nachweise</span><span>Auf diesem PC gespeichert</span></footer>
    </section>
    {selected && <KiWindow title={documentOpen ? selected.policy.pdfName || selected.policy.title : "Unterschriebener Nachweis"} wide={documentOpen} busy={exporting} onClose={() => { setSelected(null); setError(""); }} footer={<>
      {documentOpen ? <button type="button" onClick={() => setDocumentOpen(false)}>Zurück zum Nachweis</button> : <button type="button" onClick={() => setDocumentOpen(true)}><BookOpen size={14} />Originaldokument</button>}
      <button type="button" disabled={exporting} onClick={() => void exportRecord()}><Download size={14} />Nachweis exportieren (JSON)</button>
    </>}>
      {error && <p className="ki-error" role="alert">{error}</p>}
      {documentOpen ? selected.policy.pdfSha256 ? <KiPdfDocument sha256={selected.policy.pdfSha256} name={selected.policy.pdfName || "KI-Leitlinie.pdf"} initiallyOpen /> : <pre className="ki-policy">{selected.policy.body}</pre> : <>
        <dl className="ki-properties"><dt>Dokument</dt><dd>{selected.policy.title}</dd><dt>Version</dt><dd>{selected.policy.version}</dd><dt>Unterschrieben am</dt><dd>{timestamp(selected.submittedAt)}</dd><dt>Name</dt><dd>{selected.fullName}</dd><dt>E-Mail</dt><dd>{selected.email}</dd><dt>Schulung</dt><dd>{selected.trainingDate} · {selected.trainingMode === "onsite" ? "Vor Ort" : "Online"}</dd></dl>
        <img className="ki-signature-preview" src={selected.signaturePng} alt={`Unterschrift von ${selected.fullName}`} />
      </>}
    </KiWindow>}
  </>;
}
