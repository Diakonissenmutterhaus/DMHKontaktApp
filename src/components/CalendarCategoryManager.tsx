import { useState } from "react";
import { Palette, Pencil, Plus, RefreshCw, Search, Trash2, X } from "lucide-react";
import type { CalendarCategoryDefinition } from "../utils/calendar";
import { calendarColorOptions, defaultCalendarColor } from "../utils/calendar";
import type { CalendarCategoryOperation } from "../types/m365";
import "./CalendarCategoryManager.css";

interface Props {
  categories: CalendarCategoryDefinition[];
  exchangeNames: string[];
  counts: Record<string, number>;
  connected: boolean;
  loading: boolean;
  busy: boolean;
  readOnly: boolean;
  repairing: boolean;
  loadError: string;
  pending: CalendarCategoryOperation | null;
  onRefresh(): Promise<void>;
  onCreate(category: CalendarCategoryDefinition): Promise<string>;
  onColor(category: CalendarCategoryDefinition, color: string): Promise<string>;
  onChange(operation: CalendarCategoryOperation): Promise<string>;
  onRepair(): Promise<void>;
  onClose(): void;
}

export function CalendarCategoryManager(props: Props) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [name, setName] = useState("");
  const [color, setColor] = useState(defaultCalendarColor);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [deleting, setDeleting] = useState<string[] | null>(null);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const disabled = props.busy || props.loading || props.repairing || props.readOnly || Boolean(props.pending) || Boolean(props.loadError);
  const filtered = props.categories.filter((category) => category.name.toLocaleLowerCase("de").includes(query.trim().toLocaleLowerCase("de")));
  const chosen = selected.filter((name) => props.categories.some((category) => category.name === name));
  const allSelected = filtered.length > 0 && filtered.every((category) => chosen.includes(category.name));
  const exchange = new Set(props.exchangeNames.map((name) => name.toLowerCase()));
  async function run(action: () => Promise<string>, success?: () => void) {
    setError(""); setNotice("");
    try { setNotice(await action()); success?.(); }
    catch (error) { setError(String(error)); }
  }
  return <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="calendar-category-manager-title">
    <div className="modal-card calendar-category-dialog category-manager-v2">
      <section className="form-panel calendar-category-manager">
        <div className="panel-heading">
          <div><h3 id="calendar-category-manager-title">Kategorien verwalten</h3><p>Kategorien und Farben für Ihren Kalender, Outlook und Teams.</p></div>
          <button type="button" className="icon-only" aria-label="Schließen" disabled={props.busy} onClick={props.onClose}><X size={22} /></button>
        </div>
        <div className="category-manager-summary"><span className="category-manager-connection">{props.loading ? "Exchange wird geladen …" : props.connected ? "Mit Exchange verbunden" : "Lokale Kategorien"}</span><span>{props.categories.length} Kategorien</span><span><i className="calendar-category-swatch" style={{ background: "#2563eb" }} />Ohne Kategorie: Blau</span></div>
        {props.readOnly && <p role="status">Microsoft-365-Testmodus: nur lesen. Farben können hier angezeigt, aber nicht in Exchange geändert werden.</p>}
        {(error || props.loadError) && <p className="category-manager-error" role="alert">{error || props.loadError}</p>}
        {notice && <p className="category-manager-notice" role="status">{notice}</p>}
        {props.busy && <p role="status">Kategorien und zugehörige Termine werden aktualisiert. Bei vielen Terminen kann dies etwas dauern …</p>}
        {props.pending && <div className="category-manager-confirm"><strong>Offene Kategorienänderung</strong><p>{props.pending.replacement ? `„${props.pending.names[0]}“ → „${props.pending.replacement.name}“` : `Löschen: ${props.pending.names.join(", ")}`}. Die Kalendersynchronisierung wartet bis zum Abschluss.</p><button className="primary" type="button" disabled={props.busy || props.readOnly} onClick={() => void run(() => props.onChange(props.pending!))}>Änderung fortsetzen</button></div>}
        <form className="category-manager-create" onSubmit={(event) => { event.preventDefault(); void run(() => props.onCreate({ name, color }), () => { setName(""); setColor(defaultCalendarColor); }); }}>
          <h4>Neue Kategorie</h4><div className="category-manager-create-fields"><label className="field"><span>Name</span><input value={name} onChange={(event) => setName(event.target.value)} maxLength={255} placeholder="z. B. Sitzung" required disabled={disabled} /></label><label className="field"><span>Farbe</span><select value={color} onChange={(event) => setColor(event.target.value)} disabled={disabled}>{calendarColorOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label><button type="submit" className="primary" disabled={disabled}><Plus size={18} />Kategorie anlegen</button></div>
        </form>
        <section className="calendar-category-manager-card">
          <div className="calendar-category-card-heading"><h4>Alle Kategorien</h4><button type="button" className="icon-only" aria-label="Exchange-Kategorien neu laden" disabled={props.busy || props.loading} onClick={() => void props.onRefresh()}><RefreshCw size={18} className={props.loading ? "is-spinning" : ""} /></button></div>
          <label className="category-manager-search"><Search size={18} /><span className="sr-only">Kategorien suchen</span><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Kategorien suchen …" /></label>
          <div className="category-manager-selection"><label><input type="checkbox" aria-label="Alle angezeigten Kategorien auswählen" checked={allSelected} disabled={disabled || filtered.length === 0} onChange={() => setSelected(allSelected ? chosen.filter((name) => !filtered.some((category) => category.name === name)) : Array.from(new Set([...chosen, ...filtered.map((category) => category.name)])))} />{chosen.length ? `${chosen.length} ausgewählt` : `${filtered.length} angezeigt`}</label><div><button type="button" disabled={disabled || !chosen.length} onClick={() => setDeleting(chosen)}><Trash2 size={16} />Auswahl löschen</button><button type="button" disabled={disabled || !props.categories.length} onClick={() => setDeleting(props.categories.map((category) => category.name))}>Alle löschen</button></div></div>
          {deleting && <div className="category-manager-confirm"><h4>{deleting.length} {deleting.length === 1 ? "Kategorie löschen?" : "Kategorien löschen?"}</h4><p>{deleting.join(", ")}</p><p>Die Kategorien werden aus allen zugehörigen Terminen {props.connected ? "in der App und Exchange" : "in der App"} entfernt. Die Termine bleiben erhalten. Ohne Kategorie gilt Blau. Andere Kategorien eines Exchange-Termins bleiben erhalten.</p><p>Die Kategorienliste in Exchange gilt auch für E-Mails, Kontakte und Aufgaben. Deren vorhandene Zuordnungen werden nicht bearbeitet.</p><div className="button-row"><button type="button" disabled={disabled} onClick={() => setDeleting(null)}>Abbrechen</button><button type="button" className="danger" disabled={disabled} onClick={() => void run(() => props.onChange({ names: deleting, replacement: null, exchange: props.connected }), () => { setDeleting(null); setSelected([]); })}>Endgültig löschen</button></div></div>}
          {!filtered.length ? <p className="calendar-category-empty">{query ? "Keine passenden Kategorien." : "Keine Kategorien. Termine ohne Kategorie verwenden Blau."}</p> : <ul className="calendar-category-list category-manager-list">{filtered.map((category) => {
            const option = calendarColorOptions.find((option) => option.value === category.color);
            return <li key={category.name}>
              <input type="checkbox" aria-label={`${category.name} auswählen`} checked={chosen.includes(category.name)} disabled={disabled} onChange={() => setSelected(chosen.includes(category.name) ? chosen.filter((name) => name !== category.name) : [...chosen, category.name])} />
              <span className="calendar-category-swatch" style={{ background: option?.border ?? "#737373" }} />
              <div className="category-manager-name">{editing === category.name ? <form onSubmit={(event) => { event.preventDefault(); void run(() => props.onChange({ names: [category.name], replacement: { name: draft, color: category.color }, exchange: props.connected }), () => setEditing(null)); }}><input aria-label={`Neuer Name für ${category.name}`} value={draft} onChange={(event) => setDraft(event.target.value)} maxLength={255} required disabled={disabled} autoFocus /><button type="submit" disabled={disabled}>Speichern</button><button type="button" disabled={disabled} onClick={() => setEditing(null)}>Abbrechen</button></form> : <><strong>{category.name}</strong><small>{exchange.has(category.name.toLowerCase()) ? "Exchange" : "Lokal"} · {props.counts[category.name.toLowerCase()] ?? 0} Termine in der App</small></>}</div>
              <label><span className="sr-only">Farbe für {category.name}</span><select value={category.color} disabled={disabled} onChange={(event) => void run(() => props.onColor(category, event.target.value))}>{category.color === "gray" && <option value="gray" disabled>Ohne sichtbare Exchange-Farbe</option>}{calendarColorOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
              <button type="button" className="icon-only" aria-label={`${category.name} umbenennen`} disabled={disabled} onClick={() => { setEditing(category.name); setDraft(category.name); }}><Pencil size={16} /></button>
              <button type="button" className="icon-only" aria-label={`${category.name} löschen`} disabled={disabled} onClick={() => setDeleting([category.name])}><Trash2 size={16} /></button>
            </li>;
          })}</ul>}
        </section>
        <details className="category-manager-tools" open><summary>Exchange-Farben prüfen und reparieren</summary><div className="calendar-category-repair"><p>Prüft und repariert Kategorien bereits verknüpfter Termine.</p><button type="button" className="primary" disabled={disabled} onClick={() => void props.onRepair()}><Palette size={18} />{props.repairing ? "Farben werden geprüft …" : "Farben prüfen und reparieren"}</button></div></details>
        <div className="button-row"><button type="button" disabled={props.busy} onClick={props.onClose}>Schließen</button></div>
      </section>
    </div>
  </div>;
}
