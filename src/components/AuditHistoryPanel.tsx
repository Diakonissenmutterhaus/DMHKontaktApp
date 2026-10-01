import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { History, RefreshCw, Search, SlidersHorizontal, X } from "lucide-react";
import { listAuditLog } from "../services/db";
import type { AuditLogEntry, AuditLogFilter } from "../types/audit";

const pageSize = 50;
const actionNames: Record<string, string> = {
  created: "Erstellt",
  updated: "Geändert",
  changed: "Geändert",
  deleted: "Papierkorb",
  restored: "Wiederhergestellt",
  purged: "Endgültig gelöscht",
  imported: "Importiert"
};
const areaNames: Record<string, string> = {
  contact: "Kontakt",
  contacts: "Kontaktimport",
  group: "Gruppe",
  calendar: "Kalender",
  setting: "Einstellung"
};

function localDateStart(value: string): string | undefined {
  return value ? new Date(`${value}T00:00:00`).toISOString() : undefined;
}

function localDateEnd(value: string): string | undefined {
  if (!value) return undefined;
  const nextDay = new Date(`${value}T00:00:00`);
  nextDay.setDate(nextDay.getDate() + 1);
  return nextDay.toISOString();
}

export function AuditHistoryPanel() {
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [action, setAction] = useState("");
  const [area, setArea] = useState("");
  const [source, setSource] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [entries, setEntries] = useState<AuditLogEntry[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const requestId = useRef(0);

  useEffect(() => {
    const timer = window.setTimeout(() => setSearch(searchInput.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  const filter = useMemo<AuditLogFilter>(() => ({
    search,
    action,
    entityKind: area,
    source,
    fromAt: localDateStart(fromDate),
    beforeAt: localDateEnd(toDate),
    limit: pageSize
  }), [search, action, area, source, fromDate, toDate]);

  const loadPage = useCallback(async (beforeId?: number) => {
    const currentRequest = ++requestId.current;
    if (beforeId !== undefined) {
      setLoadingMore(true);
    } else {
      setLoading(true);
      setEntries([]);
      setHasMore(false);
    }
    setError("");
    try {
      const result = await listAuditLog({ ...filter, beforeId });
      if (currentRequest !== requestId.current) return;
      setEntries((current) => beforeId === undefined ? result.entries : [...current, ...result.entries]);
      setHasMore(result.hasMore);
    } catch (cause) {
      if (currentRequest === requestId.current) setError(`Die Historie konnte nicht geladen werden: ${cause}`);
    } finally {
      if (currentRequest === requestId.current) {
        setLoading(false);
        setLoadingMore(false);
      }
    }
  }, [filter]);

  useEffect(() => {
    void loadPage();
    return () => { requestId.current += 1; };
  }, [loadPage]);

  const activeFilters = Boolean(searchInput || action || area || source || fromDate || toDate);
  const clearFilters = () => {
    setSearchInput("");
    setSearch("");
    setAction("");
    setArea("");
    setSource("");
    setFromDate("");
    setToDate("");
  };

  return (
    <section className="form-panel audit-log-panel" aria-labelledby="audit-log-title">
      <div className="panel-heading audit-history-heading">
        <div>
          <h3 id="audit-log-title"><History size={23} aria-hidden="true" /> Historie</h3>
          <p>Änderungen nach Person, Name, Vorgang oder Zeitraum finden.</p>
        </div>
        <button type="button" onClick={() => void loadPage()} disabled={loading || loadingMore}>
          <RefreshCw size={18} className={loading ? "spin" : ""} aria-hidden="true" /> Aktualisieren
        </button>
      </div>

      <div className="audit-history-search">
        <Search size={20} aria-hidden="true" />
        <input
          type="search"
          aria-label="Historie durchsuchen"
          placeholder="Name, Windows-Benutzer oder Vorgang suchen …"
          value={searchInput}
          onChange={(event) => setSearchInput(event.target.value)}
        />
      </div>

      <div className="audit-history-filters" role="group" aria-label="Historie filtern">
        <span className="audit-history-filter-title"><SlidersHorizontal size={18} aria-hidden="true" /> Filter</span>
        <label>Aktion
          <select value={action} onChange={(event) => setAction(event.target.value)}>
            <option value="">Alle Aktionen</option>
            <option value="created">Erstellt</option>
            <option value="modified">Geändert</option>
            <option value="deleted">In Papierkorb</option>
            <option value="restored">Wiederhergestellt</option>
            <option value="purged">Endgültig gelöscht</option>
            <option value="imported">Importiert</option>
          </select>
        </label>
        <label>Bereich
          <select value={area} onChange={(event) => setArea(event.target.value)}>
            <option value="">Alle Bereiche</option>
            <option value="contact">Kontakte</option>
            <option value="contacts">Kontaktimporte</option>
            <option value="group">Gruppen</option>
            <option value="calendar">Kalender</option>
            <option value="setting">Einstellungen</option>
          </select>
        </label>
        <label>Herkunft
          <select value={source} onChange={(event) => setSource(event.target.value)}>
            <option value="">Alle Herkünfte</option>
            <option value="user">In der App</option>
            <option value="m365">Microsoft 365</option>
          </select>
        </label>
        <label>Von
          <input type="date" value={fromDate} max={toDate || undefined} onChange={(event) => setFromDate(event.target.value)} />
        </label>
        <label>Bis
          <input type="date" value={toDate} min={fromDate || undefined} onChange={(event) => setToDate(event.target.value)} />
        </label>
        {activeFilters && <button className="audit-history-clear" type="button" onClick={clearFilters}><X size={16} aria-hidden="true" /> Zurücksetzen</button>}
      </div>

      <div className="audit-history-results" aria-live="polite">
        <span>{loading ? "Suche läuft …" : `${entries.length} ${entries.length === 1 ? "Eintrag" : "Einträge"}${hasMore ? " · weitere vorhanden" : ""}`}</span>
        {activeFilters && !loading && <small>Filter aktiv</small>}
      </div>
      {error && <p className="audit-history-error" role="alert">{error}</p>}
      {!loading && !error && entries.length === 0 ? (
        <div className="audit-log-empty">
          <History size={34} aria-hidden="true" />
          <strong>{activeFilters ? "Keine passenden Einträge" : "Noch keine protokollierten Änderungen"}</strong>
          <p>{activeFilters ? "Versuchen Sie einen anderen Suchbegriff oder setzen Sie die Filter zurück." : "Neue Änderungen erscheinen hier automatisch."}</p>
          {activeFilters && <button type="button" onClick={clearFilters}>Filter zurücksetzen</button>}
        </div>
      ) : (
        <div className="audit-log-list" aria-busy={loading}>
          {entries.map((entry) => (
            <article className="audit-log-entry" key={entry.id}>
              <time dateTime={entry.occurredAt}>{new Date(entry.occurredAt).toLocaleString("de-DE", { dateStyle: "medium", timeStyle: "short" })}</time>
              <div className="audit-history-entry-content">
                <div className="audit-history-entry-labels">
                  <span className={`audit-history-action audit-history-action-${entry.action}`}>{actionNames[entry.action] ?? entry.action}</span>
                  <span>{areaNames[entry.entityKind] ?? entry.entityKind}</span>
                </div>
                <strong>{entry.summary}</strong>
                <small>{entry.source === "m365" ? "Microsoft 365" : "In der App"} · {entry.actor}</small>
              </div>
            </article>
          ))}
        </div>
      )}
      {hasMore && !loading && <button className="audit-history-more" type="button" disabled={loadingMore} onClick={() => void loadPage(entries[entries.length - 1]?.id)}>
        {loadingMore ? "Weitere Einträge werden geladen …" : "Weitere Einträge laden"}
      </button>}
      <p className="audit-log-note">Das Protokoll liegt lokal auf diesem Computer. Ältere Einträge bleiben über Suche und Filter erreichbar.</p>
    </section>
  );
}
