import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CalendarDays, CheckSquare, ChevronLeft, ChevronRight, RefreshCw, Search, Trash2, Users, X } from "lucide-react";
import { ConfirmDialog } from "./ConfirmDialog";
import { listEdvBulkItems, previewEdvBulkRemoval, executeEdvBulkRemoval } from "../services/db";
import type { BulkFilter, BulkKind, BulkPage, BulkPreview, BulkSelection } from "../types/bulkRemoval";
import { calendarChangedEventName, calendarStorageUpdatedEventName, contactChangedEventName, m365DataUpdatedEventName } from "../utils/automaticCalendarSync";
import { useDiagnosticMessage } from "../hooks/useDiagnosticMessage";
import "./BulkRemovalPanel.css";

const emptyPage: BulkPage = { items: [], total: 0, sources: [], categories: [], companies: [], groups: [] };
const formatDate = (value: string) => value ? new Date(value).toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short" }) : "—";

export function BulkRemovalPanel() {
  const [kind, setKind] = useState<BulkKind>("calendar");
  return <section className="form-panel bulk-removal" aria-labelledby="bulk-removal-title">
    <div className="panel-heading"><div><h3 id="bulk-removal-title"><Trash2 size={23} /> Massenlöschung</h3><p>Einträge suchen, nach Bedingungen filtern und gemeinsam entfernen.</p></div></div>
    <nav className="bulk-tabs" aria-label="Bereich für Massenlöschung">
      <button type="button" aria-pressed={kind === "calendar"} onClick={() => setKind("calendar")}><CalendarDays size={18} /> Kalender</button>
      <button type="button" aria-pressed={kind === "contacts"} onClick={() => setKind("contacts")}><Users size={18} /> Kontakte</button>
    </nav>
    <BulkList key={kind} kind={kind} />
  </section>;
}

function BulkList({ kind }: { kind: BulkKind }) {
  const calendar = kind === "calendar";
  const [filter, setFilter] = useState<BulkFilter>(() => ({ kind, search: "", exact: false, source: "", category: "", fromDate: "", toDate: "", company: "", group: "", sort: calendar ? "start" : "title", descending: false, offset: 0 }));
  const [search, setSearch] = useState("");
  const [page, setPage] = useState<BulkPage>(emptyPage);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [allMatching, setAllMatching] = useState(false);
  const [excluded, setExcluded] = useState<Set<string>>(() => new Set());
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<{ selection: BulkSelection; result: BulkPreview } | null>(null);
  const [error, setError] = useDiagnosticMessage("BulkRemovalPanel:error", "inline");
  const [result, setResult] = useState("");
  const request = useRef(0);
  const lastChecked = useRef<string | null>(null);
  const clearSelection = () => { setSelected(new Set()); setExcluded(new Set()); setAllMatching(false); lastChecked.current = null; };
  const changeFilter = (changes: Partial<BulkFilter>) => {
    if (allMatching) clearSelection();
    setFilter(current => ({ ...current, ...changes, offset: 0 }));
    setResult("");
  };
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setAllMatching(false); setExcluded(new Set());
      setFilter(current => ({ ...current, search: search.trim(), offset: 0 }));
    }, 250);
    return () => window.clearTimeout(timer);
  }, [search]);
  const load = useCallback(async () => {
    const id = ++request.current;
    setLoading(true); setError("");
    try {
      const next = await listEdvBulkItems(filter);
      if (id !== request.current) return;
      if (filter.offset >= next.total && filter.offset > 0) { setFilter(current => ({ ...current, offset: 0 })); return; }
      setPage(next);
    } catch (cause) { if (id === request.current) { setPage(emptyPage); setError(`Die Liste konnte nicht geladen werden: ${cause}`); } }
    finally { if (id === request.current) setLoading(false); }
  }, [filter]);
  useEffect(() => { void load(); return () => { request.current += 1; }; }, [load]);
  const selection = useMemo<BulkSelection>(() => ({ filter, allMatching, ids: [...selected], excludedIds: [...excluded] }), [filter, allMatching, selected, excluded]);
  const selectedCount = allMatching ? Math.max(0, page.total - excluded.size) : selected.size;
  const searchPending = search.trim() !== filter.search;
  const isSelected = (id: string) => allMatching ? !excluded.has(id) : selected.has(id);
  const toggle = (id: string, checked: boolean, shift: boolean) => {
    const currentIndex = page.items.findIndex(item => item.id === id);
    const previousIndex = page.items.findIndex(item => item.id === lastChecked.current);
    const ids = shift && previousIndex >= 0 ? page.items.slice(Math.min(previousIndex, currentIndex), Math.max(previousIndex, currentIndex) + 1).map(item => item.id) : [id];
    if (allMatching) setExcluded(current => { const next = new Set(current); ids.forEach(item => checked ? next.delete(item) : next.add(item)); return next; });
    else setSelected(current => { const next = new Set(current); ids.forEach(item => checked ? next.add(item) : next.delete(item)); return next; });
    lastChecked.current = id;
  };
  const selectPage = (checked: boolean) => {
    const ids = page.items.map(item => item.id);
    if (allMatching) setExcluded(current => { const next = new Set(current); ids.forEach(id => checked ? next.delete(id) : next.add(id)); return next; });
    else setSelected(current => { const next = new Set(current); ids.forEach(id => checked ? next.add(id) : next.delete(id)); return next; });
  };
  const beginRemoval = async () => {
    setBusy(true); setError("");
    try {
      const next = await previewEdvBulkRemoval(selection);
      if (!next.selected) { setError("Die ausgewählten Einträge sind nicht mehr vorhanden. Bitte die Liste aktualisieren."); return; }
      setPreview({ selection, result: next });
    } catch (cause) { setError(`Die Auswahl konnte nicht geprüft werden: ${cause}`); }
    finally { setBusy(false); }
  };
  const remove = async () => {
    if (!preview) return;
    setBusy(true); setError("");
    try {
      const count = await executeEdvBulkRemoval(preview.selection, preview.result.revision);
      setPreview(null); clearSelection();
      setResult(`${count} ${calendar ? "Kalendereinträge" : "Kontakte"} wurden in den Papierkorb verschoben. Die Löschung wird gemäß Exchange-Synchronisierung übertragen.`);
      window.dispatchEvent(new Event(calendar ? calendarStorageUpdatedEventName : m365DataUpdatedEventName));
      window.dispatchEvent(new Event(calendar ? calendarChangedEventName : contactChangedEventName));
      await load();
    } catch (cause) { setPreview(null); setError(`Die Löschung konnte nicht abgeschlossen werden: ${cause}`); }
    finally { setBusy(false); }
  };
  const sort = (name: string) => setFilter(current => ({ ...current, offset: 0, sort: name, descending: current.sort === name ? !current.descending : false }));
  const heading = (name: string, label: string) => <button type="button" onClick={() => sort(name)} disabled={busy}>{label}{filter.sort === name ? filter.descending ? " ↓" : " ↑" : ""}</button>;
  const disabled = busy || preview !== null;
  return <>
    <fieldset className="bulk-controls" disabled={disabled}>
      <label className="bulk-search"><span><Search size={17} /> {calendar ? "Termine suchen" : "Kontakte suchen"}</span><input type="search" value={search} onChange={e => setSearch(e.target.value)} placeholder={calendar ? "z. B. Mittagspause" : "Name, E-Mail, Firma oder Telefonnummer"} /></label>
      <label className="bulk-exact"><input type="checkbox" checked={filter.exact} onChange={e => changeFilter({ exact: e.target.checked })} /> {calendar ? "Titel stimmt genau überein" : "Name stimmt genau überein"}</label>
      {calendar ? <>
        <label>Kalender<select value={filter.source} onChange={e => changeFilter({ source: e.target.value })}><option value="">Alle Kalender</option>{page.sources.map(value => <option key={value}>{value}</option>)}</select></label>
        <label>Kategorie<select value={filter.category} onChange={e => changeFilter({ category: e.target.value })}><option value="">Alle Kategorien</option>{page.categories.map(value => <option key={value}>{value}</option>)}</select></label>
        <label>Beginn ab<input type="date" value={filter.fromDate} onChange={e => changeFilter({ fromDate: e.target.value })} /></label>
        <label>Beginn bis<input type="date" value={filter.toDate} onChange={e => changeFilter({ toDate: e.target.value })} /></label>
      </> : <>
        <label>Firma<select value={filter.company} onChange={e => changeFilter({ company: e.target.value })}><option value="">Alle Firmen</option>{page.companies.map(value => <option key={value}>{value}</option>)}</select></label>
        <label>Gruppe<select value={filter.group} onChange={e => changeFilter({ group: e.target.value })}><option value="">Alle Gruppen</option>{page.groups.map(value => <option key={value}>{value}</option>)}</select></label>
      </>}
      <button type="button" onClick={() => { setSearch(""); changeFilter({ search: "", exact: false, source: "", category: "", fromDate: "", toDate: "", company: "", group: "" }); }}>Filter zurücksetzen</button>
    </fieldset>
    <div className="bulk-actions">
      <button type="button" disabled={disabled || loading || searchPending || !page.total} onClick={() => { setAllMatching(true); setExcluded(new Set()); setSelected(new Set()); }}><CheckSquare size={17} /> Alle {page.total} Treffer auswählen</button>
      <button type="button" disabled={disabled || !selectedCount} onClick={clearSelection}><X size={17} /> Auswahl aufheben</button>
      <button type="button" disabled={disabled || loading} onClick={() => void load()} aria-label="Liste aktualisieren"><RefreshCw size={17} /></button>
      <button className="danger-button" type="button" disabled={disabled || loading || searchPending || !selectedCount} onClick={() => void beginRemoval()}><Trash2 size={17} /> {selectedCount} ausgewählte löschen</button>
    </div>
    <p className="bulk-count" aria-live="polite">{loading ? "Liste wird geladen …" : `${page.total} Treffer · ${selectedCount} ausgewählt`}{!allMatching && selectedCount > 0 ? " · Auswahl bleibt beim Suchen und Blättern erhalten." : ""}</p>
    {error && <p role="alert" className="bulk-error">{error}</p>}
    {result && <p role="status" className="bulk-result">{result}</p>}
    <div className="bulk-table-wrap" aria-busy={loading}>
      <table className="bulk-table" aria-label={calendar ? "Kalendereinträge für Massenlöschung" : "Kontakte für Massenlöschung"}>
        <thead><tr><th className="bulk-check"><input aria-label="Alle auf dieser Seite auswählen" type="checkbox" checked={page.items.length > 0 && page.items.every(item => isSelected(item.id))} ref={node => { if (node) node.indeterminate = page.items.some(item => isSelected(item.id)) && !page.items.every(item => isSelected(item.id)); }} disabled={disabled || loading} onChange={e => selectPage(e.target.checked)} /></th>
          <th aria-sort={filter.sort === "title" ? filter.descending ? "descending" : "ascending" : "none"}>{heading("title", calendar ? "Titel" : "Name")}</th>
          {calendar ? <><th aria-sort={filter.sort === "start" ? filter.descending ? "descending" : "ascending" : "none"}>{heading("start", "Beginn")}</th><th>Ende</th><th>{heading("source", "Kalender")}</th><th>{heading("category", "Kategorie")}</th></> : <><th>{heading("email", "E-Mail")}</th><th>{heading("company", "Firma")}</th><th>Gruppen</th></>}
        </tr></thead>
        <tbody>{page.items.map(item => <tr key={item.id} className={isSelected(item.id) ? "selected" : ""}>
          <td className="bulk-check"><input type="checkbox" aria-label={`${item.title || "Ohne Titel"}${calendar ? `, ${formatDate(item.start)}` : `, ${item.email || item.id}`}`} checked={isSelected(item.id)} disabled={disabled || loading} onChange={e => toggle(item.id, e.target.checked, (e.nativeEvent as MouseEvent).shiftKey)} /></td>
          <td title={item.title}>{calendar ? <CalendarDays size={15} /> : <Users size={15} />} {item.title || "Ohne Titel"}{item.series && <span className="bulk-series">Serie</span>}</td>
          {calendar ? <><td>{formatDate(item.start)}</td><td>{formatDate(item.end)}</td><td title={item.source}>{item.source || "—"}</td><td>{item.category || "—"}</td></> : <><td>{item.email || "—"}</td><td>{item.company || "—"}</td><td>{item.groups || "—"}</td></>}
        </tr>)}{!loading && !page.items.length && <tr><td colSpan={calendar ? 6 : 5}>Keine passenden Einträge gefunden.</td></tr>}</tbody>
      </table>
    </div>
    <div className="bulk-pagination"><span>{page.total ? `${filter.offset + 1}–${Math.min(filter.offset + 100, page.total)} von ${page.total}` : "0 Einträge"}</span><button type="button" aria-label="Vorherige Seite" disabled={disabled || loading || !filter.offset} onClick={() => setFilter(current => ({ ...current, offset: Math.max(0, current.offset - 100) }))}><ChevronLeft size={17} /></button><button type="button" aria-label="Nächste Seite" disabled={disabled || loading || filter.offset + 100 >= page.total} onClick={() => setFilter(current => ({ ...current, offset: current.offset + 100 }))}><ChevronRight size={17} /></button></div>
    {calendar && <p className="bulk-note">Bei Serien gilt der Zeitraum für den Serienbeginn. Eine ausgewählte Serie wird vollständig einschließlich ihrer Ausnahmen entfernt.</p>}
    <ConfirmDialog open={preview !== null} title="Massenlöschung bestätigen" message={`${preview?.result.selected ?? 0} ausgewählte Einträge entfernen?${preview?.result.series ? ` Enthält ${preview.result.series} Serien; insgesamt ${preview.result.affected} gespeicherte Einträge einschließlich Ausnahmen.` : ""} Die Löschung wird auch an die verbundenen Exchange-Kalender bzw. Kontaktordner übertragen, soweit diese für die ausgehende Synchronisierung aktiviert sind.`} notice="Die Einträge bleiben im Papierkorb der App wiederherstellbar. Vorher wird eine lokale Sicherung erstellt." confirmLabel="Auswahl in den Papierkorb verschieben" busy={busy} onCancel={() => setPreview(null)} onConfirm={() => void remove()} />
  </>;
}
