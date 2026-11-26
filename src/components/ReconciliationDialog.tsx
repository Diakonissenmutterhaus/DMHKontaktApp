import { useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle2, LoaderCircle, RefreshCw, ShieldCheck, X } from "lucide-react";
import { applyReconciliation, previewReconciliation } from "../services/reconciliation";
import type { ReconciliationKind, ReconciliationPlatform, ReconciliationPreview, ReconciliationResult, ReconciliationStatus } from "../types/reconciliation";
import "./reconciliation.css";

const statuses: Record<ReconciliationStatus, string> = {
  new: "Neu", update: "Aktualisieren", same: "Identisch", kept: "Aktuelle Version behalten", deleted: "Gelöscht lassen", review: "Prüfen"
};
const fieldNames: Record<string, string> = {
  firstName: "Vorname", lastName: "Nachname", displayName: "Name", email: "E-Mail", privateEmail: "Private E-Mail",
  secondPrivateEmail: "Weitere E-Mail", phone: "Telefon", mobilePhone: "Mobil", privatePhone: "Privates Telefon",
  secondPrivatePhone: "Weiteres Telefon", company: "Organisation", street: "Straße", postalCode: "PLZ", city: "Ort",
  country: "Land", shortInfo: "Kurzinfo", notes: "Notizen", birthday: "Geburtstag", title: "Titel", startsAt: "Beginn",
  endsAt: "Ende", isAllDay: "Ganztägig", location: "Ort", description: "Beschreibung", color: "Farbe", category: "Kategorie",
  recurrence: "Wiederholung", excludedDates: "Ausnahmen", recurrenceMasterId: "Terminserie", recurrenceId: "Serientermin", meeting: "Besprechung"
};
function display(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "Ja" : "Nein";
  return typeof value === "string" ? value : JSON.stringify(value);
}
interface Props { open: boolean; kind: ReconciliationKind; onClose: () => void; onChanged: (message: string) => void | Promise<void> }

export function ReconciliationDialog({ open, kind, onClose, onChanged }: Props) {
  const [platform, setPlatform] = useState<ReconciliationPlatform | null>(null);
  const [preview, setPreview] = useState<ReconciliationPreview | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const generation = useRef(0);
  const [error, setError] = useState("");
  const [result, setResult] = useState<ReconciliationResult | null>(null);
  const [filter, setFilter] = useState<ReconciliationStatus | "all">("all");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  useEffect(() => {
    generation.current += 1;
    setPlatform(null); setPreview(null); setSelected(new Set()); setError(""); setResult(null);
    setBusy(false); inFlight.current = false; setFilter("all"); setSearch(""); setPage(0);
    return () => { generation.current += 1; };
  }, [open, kind]);
  const items = useMemo(() => preview?.items.filter(item =>
    (filter === "all" || item.status === filter) && `${item.label} ${item.reason}`.toLocaleLowerCase("de").includes(search.trim().toLocaleLowerCase("de"))) ?? [], [preview, filter, search]);
  const pages = Math.max(1, Math.ceil(items.length / 50));
  useEffect(() => { setPage(0); }, [filter, search, preview]);
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape" && !inFlight.current) onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;

  const scan = async (source: ReconciliationPlatform) => {
    if (inFlight.current) return;
    inFlight.current = true;
    const current = generation.current;
    setPlatform(source); setBusy(true); setError(""); setPreview(null); setSelected(new Set());
    try {
      const next = await previewReconciliation(kind, source);
      if (current !== generation.current) return;
      setPreview(next);
      setSelected(new Set(next.items.filter(item => item.selectable && item.status === "update").map(item => item.key)));
    } catch (cause) { if (current === generation.current) setError(String(cause)); }
    finally { if (current === generation.current) { setBusy(false); inFlight.current = false; } }
  };
  const apply = async () => {
    if (!preview || inFlight.current) return;
    inFlight.current = true; setBusy(true); setError("");
    const current = generation.current;
    try {
      const completed = await applyReconciliation(preview.token, [...selected]);
      if (current !== generation.current) return;
      setResult(completed);
      try { await onChanged(`${completed.added} neu · ${completed.updated} aktualisiert · ${completed.review} zu prüfen`); }
      catch { setError("Gespeichert. Die Ansicht konnte nicht aktualisiert werden; bitte neu öffnen."); }
    } catch (cause) { if (current === generation.current) setError(String(cause)); }
    finally { if (current === generation.current) { setBusy(false); inFlight.current = false; } }
  };
  const toggle = (key: string) => setSelected(current => {
    const next = new Set(current); if (next.has(key)) next.delete(key); else next.add(key); return next;
  });
  return <div className="modal-backdrop reconciliation-backdrop">
    <section className="modal-card reconciliation-dialog safe-reconciliation" role="dialog" aria-modal="true" aria-labelledby="safe-reconciliation-title" aria-busy={busy}>
      <header className="reconciliation-heading">
        <RefreshCw size={24} /><div><h2 id="safe-reconciliation-title">{kind === "contacts" ? "Kontakte" : "Kalender"} prüfen und aktualisieren</h2><p>{platform === "outlook" ? "Outlook Classic" : platform === "thunderbird" ? "Thunderbird" : "Quelle auswählen"}</p></div>
        <button type="button" className="icon-only" aria-label="Schließen" onClick={onClose} disabled={busy}><X size={22} /></button>
      </header>
      {!preview && !result && <div className="reconciliation-platforms">
        {(["outlook", "thunderbird"] as const).map(source => <button key={source} type="button" onClick={() => void scan(source)} disabled={busy}>
          <img src={`/brands/${source}.svg`} width="32" height="32" alt="" /><strong>{source === "outlook" ? "Outlook Classic" : "Thunderbird"}</strong>
          {busy && platform === source && <LoaderCircle className="spin" size={20} />}
        </button>)}
      </div>}
      {!result && <p className="reconciliation-safe-line"><ShieldCheck size={18} /> Gelöschte Einträge und ungeklärte Unterschiede bleiben unverändert. Erst die Bestätigung speichert Änderungen.</p>}
      {preview && !result && <>
        <div className="safe-reconciliation-filters">
          <label>Status<select value={filter} disabled={busy} onChange={e => setFilter(e.target.value as typeof filter)}>
            <option value="all">Alle ({preview.items.length})</option>
            {Object.entries(statuses).map(([key, label]) => <option key={key} value={key}>{label} ({preview.counts[key as ReconciliationStatus] ?? 0})</option>)}
          </select></label>
          <label>Suchen<input value={search} onChange={e => setSearch(e.target.value)} placeholder="Name, Termin oder Hinweis" /></label>
          <span>{selected.size} ausgewählt</span>
        </div>
        {preview.warnings.map((warning, i) => <p className="reconciliation-warning" key={i}>{warning}</p>)}
        <div className="safe-reconciliation-table"><table>
          <thead><tr><th>Übernehmen</th><th>{kind === "contacts" ? "Kontakt" : "Termin"}</th><th>Status</th><th>Vergleich</th></tr></thead>
          <tbody>{items.slice(page * 50, (page + 1) * 50).map((item, i) => <tr key={`${item.key}-${i}`}>
            <td>{item.selectable ? <input type="checkbox" disabled={busy} checked={selected.has(item.key)} onChange={() => toggle(item.key)} aria-label={`${item.label} übernehmen`} /> : "—"}</td>
            <td>{item.label}</td><td>{statuses[item.status]}</td><td>{item.reason}
              {item.differences.length > 0 && <details><summary>{item.differences.length} Unterschiede</summary>
                <dl>{item.differences.map(diff => <div key={diff.field}><dt>{fieldNames[diff.field] ?? diff.field}</dt><dd><strong>Aktuell:</strong> {display(diff.current)}<br /><strong>Quelle:</strong> {display(diff.incoming)}</dd></div>)}</dl>
              </details>}
            </td>
          </tr>)}</tbody>
        </table>{items.length === 0 && <p>Keine Einträge für diese Auswahl.</p>}</div>
        <div className="safe-reconciliation-pagination">
          <button type="button" disabled={page === 0} onClick={() => setPage(p => p - 1)}>Zurück</button>
          <span>Seite {page + 1} / {pages}</span><button type="button" disabled={page + 1 >= pages} onClick={() => setPage(p => p + 1)}>Weiter</button>
        </div>
        <div className="button-row reconciliation-actions">
          <button type="button" disabled={busy} onClick={() => platform && void scan(platform)}>Erneut prüfen</button>
          <button type="button" className="primary" disabled={busy} onClick={() => void apply()}>{busy ? "Wird gespeichert …" : selected.size ? `Auswahl übernehmen (${selected.size})` : "Prüfung abschließen"}</button>
        </div>
      </>}
      {result && <div className="reconciliation-finished" role="status"><CheckCircle2 size={36} /><h3>Prüfung abgeschlossen</h3>
        <p>{result.added} neu · {result.updated} aktualisiert · {result.unchanged} unverändert</p>
        {result.review > 0 && <p>{result.review} Einträge benötigen eine Prüfung durch die EDV. Diese wurden nicht geändert.</p>}
        <button type="button" className="primary" onClick={onClose} disabled={busy}>Fertig</button>
      </div>}
      {error && <div className="reconciliation-error" role="alert">{error}</div>}
    </section>
  </div>;
}
