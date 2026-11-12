import { useEffect, useState } from "react";
import { ChevronRight, ExternalLink, RefreshCw } from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { listKiNews, type KiNews } from "../services/ki";
import { KiWindow } from "./KiWindow";

export const kiNewsDate = (date: string) => new Date(`${date}T12:00:00`).toLocaleDateString("de-DE");

export function KiNewsFeed({ onGuidelines }: { onGuidelines: () => void }) {
  const [news, setNews] = useState<KiNews[]>([]);
  const [selected, setSelected] = useState<KiNews | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const load = async () => {
    setLoading(true); setError("");
    try { setNews(await listKiNews() ?? []); }
    catch { setError("Aktuelles konnte nicht geladen werden."); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []);
  return <section className="ki-news-feed" aria-label="Aktuelles zur KI" aria-busy={loading}>
    <header><div><span className="ki-news-eyebrow">INFORMATIONEN DER EDV</span><h3>Aktuelles zur KI</h3></div><button type="button" aria-label="KI-Nachrichten aktualisieren" title="Aktualisieren" disabled={loading} onClick={() => void load()}><RefreshCw size={15} /></button></header>
    {error && <p className="ki-error" role="alert">{error}</p>}
    {loading && <p className="ki-news-empty" role="status">Aktuelles wird geladen …</p>}
    {!loading && !error && !news.length && <p className="ki-news-empty">Noch keine Meldungen veröffentlicht.</p>}
    {!loading && news.map((article) => <article className="ki-news-entry" key={article.id}>
      <time dateTime={article.date}>{kiNewsDate(article.date)}</time>
      <div><div className="ki-news-entry-heading"><h4><button type="button" onClick={() => setSelected(article)}>{article.title}<ChevronRight size={14} aria-hidden="true" /></button></h4><span className="ki-news-category">{article.category} · EDV</span></div><p>{article.summary}</p></div>
    </article>)}
    {selected && <KiWindow title={selected.title} onClose={() => setSelected(null)} footer={<>{selected.category === "Richtlinie" && <button type="button" onClick={() => { setSelected(null); onGuidelines(); }}>Richtlinien öffnen</button>}{selected.sourceUrl && <button type="button" onClick={() => void openUrl(selected.sourceUrl).catch(() => setError("Die Quelle konnte nicht geöffnet werden."))}><ExternalLink size={15} />Quelle öffnen</button>}</>}>
      <p className="ki-news-meta">{kiNewsDate(selected.date)} · {selected.category} · EDV</p><div className="ki-news-body">{selected.body}</div>{error && <p className="ki-error" role="alert">{error}</p>}
    </KiWindow>}
  </section>;
}
