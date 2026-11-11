import { useEffect, useState, type FormEvent } from "react";
import { Plus, RefreshCw, Save } from "lucide-react";
import { listKiNews, saveKiNews, type KiNews } from "../services/ki";
import { KiWindow } from "./KiWindow";
import { kiNewsDate } from "./KiNewsFeed";

export function KiNewsEditor() {
  const [entries, setEntries] = useState<KiNews[]>([]);
  const [editing, setEditing] = useState<KiNews | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const load = async () => {
    setBusy(true); setError("");
    try { setEntries(await listKiNews(true) ?? []); }
    catch { setError("Beiträge konnten nicht geladen werden. EDV-Zugang prüfen."); }
    finally { setBusy(false); }
  };
  useEffect(() => { void load(); }, []);
  const update = <K extends keyof KiNews>(key: K, value: KiNews[K]) => setEditing((current) => current && ({ ...current, [key]: value }));
  const submit = async (event: FormEvent) => {
    event.preventDefault(); if (!editing || busy) return;
    setBusy(true); setError("");
    try { await saveKiNews(editing); setEditing(null); await load(); }
    catch (cause) { setError(String(cause)); }
    finally { setBusy(false); }
  };
  return <section className="ki-workspace" aria-label="KI-Nachrichten verwalten">
    <div className="ki-commandbar"><button type="button" disabled={busy} onClick={() => { setError(""); setEditing({ id: "", title: "", summary: "", body: "", date: new Date().toLocaleDateString("en-CA"), category: "Mitteilung", published: false, sourceUrl: "", updatedAt: "" }); }}><Plus size={15} />Neuer Beitrag</button><button className="ki-command-refresh" type="button" disabled={busy} onClick={() => void load()}><RefreshCw size={15} />Aktualisieren</button></div>
    {error && !editing && <p className="ki-error" role="alert">{error}</p>}
    <div className="ki-list-scroll"><table className="ki-list" aria-label="KI-Nachrichten"><thead><tr><th>Titel</th><th>Datum</th><th>Kategorie</th><th>Status</th></tr></thead><tbody>{entries.map((article) => <tr key={article.id}><td><button type="button" onClick={() => { setError(""); setEditing(article); }}>{article.title}</button></td><td>{kiNewsDate(article.date)}</td><td>{article.category}</td><td>{article.published ? "Veröffentlicht" : "Entwurf"}</td></tr>)}</tbody></table></div>
    <footer className="ki-statusbar"><span>{entries.length} Beiträge</span><span>Veröffentlichung auf diesem PC</span></footer>
    {editing && <KiWindow title={editing.id ? "Beitrag bearbeiten" : "Neuer KI-Beitrag"} busy={busy} onClose={() => setEditing(null)} footer={<button className="primary" type="submit" form="ki-news-editor" disabled={busy}><Save size={15} />Speichern</button>}>
      <form id="ki-news-editor" className="ki-form" onSubmit={(event) => void submit(event)}>{error && <p className="ki-error" role="alert">{error}</p>}<fieldset disabled={busy}><legend>Beitrag</legend><label>Titel<input required maxLength={200} value={editing.title} onChange={(event) => update("title", event.target.value)} /></label><div className="ki-fields"><label>Datum<input type="date" required value={editing.date} onChange={(event) => update("date", event.target.value)} /></label><label>Kategorie<select value={editing.category} onChange={(event) => update("category", event.target.value as KiNews["category"])}><option>Mitteilung</option><option>Richtlinie</option><option>Schulung</option><option>KI-Neuigkeit</option></select></label></div><label>Kurzbeschreibung<input maxLength={300} value={editing.summary} onChange={(event) => update("summary", event.target.value)} /></label><label>Nachricht<textarea required rows={7} maxLength={12000} value={editing.body} onChange={(event) => update("body", event.target.value)} /></label><label>Quelle · HTTPS-Link (optional)<input type="url" maxLength={2048} value={editing.sourceUrl} onChange={(event) => update("sourceUrl", event.target.value)} /></label><label className="ki-check"><input type="checkbox" checked={editing.published} onChange={(event) => update("published", event.target.checked)} />Auf der KI-Startseite veröffentlichen</label></fieldset></form>
    </KiWindow>}
  </section>;
}
