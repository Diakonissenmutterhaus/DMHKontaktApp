import { useEffect, useId, useRef, useState } from "react";
import { ClipboardList, ExternalLink, PanelLeftClose, PanelLeftOpen, Play } from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { KiConfig } from "../services/ki";
import "./KiTrainingPane.css";

export function KiTrainingPane({ config, loading, onForms }: { config: KiConfig | null; loading: boolean; onForms: () => void }) {
  const listId = useId();
  const panes = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; width: number } | null>(null);
  const [listVisible, setListVisible] = useState(true);
  const [listWidth, setListWidth] = useState(260);
  const [availableWidth, setAvailableWidth] = useState(0);
  const [selected, setSelected] = useState(false);
  const [watching, setWatching] = useState(false);
  const [error, setError] = useState("");
  const maxWidth = availableWidth ? Math.max(150, Math.min(420, availableWidth - 286)) : 420;
  const width = Math.min(maxWidth, Math.max(150, listWidth));
  const clampWidth = (value: number) => Math.min(maxWidth, Math.max(150, value));
  let url: URL | null = null;
  try { if (config?.trainingUrl) url = new URL(config.trainingUrl); } catch { /* Invalid configuration stays unavailable. */ }
  const available = Boolean(!loading && config?.published && config.body.trim() && url?.protocol === "https:" && !url.username && !url.password);
  const video = Boolean(url && /\.(mp4|webm|ogv)$/i.test(url.pathname));
  const onlineStatus = loading ? "Wird geladen …" : available ? "Online verfügbar" : "Online folgt";

  useEffect(() => {
    if (!panes.current) return;
    const observer = new ResizeObserver(([entry]) => setAvailableWidth(entry.contentRect.width));
    observer.observe(panes.current);
    return () => observer.disconnect();
  }, []);

  const openBrowser = async () => {
    if (!available || !url) return;
    setError("");
    try { await openUrl(url.href); }
    catch { setError("Die Schulung konnte nicht im Browser geöffnet werden."); }
  };

  return <section className="ki-workspace ki-training-workspace" aria-label="IT-Schulung">
    <div className="ki-commandbar">
      <button type="button" aria-label={listVisible ? "Schulungsliste ausblenden" : "Schulungsliste einblenden"} title={listVisible ? "Liste ausblenden" : "Liste einblenden"} aria-controls={listId} aria-expanded={listVisible} onClick={() => setListVisible((current) => !current)}>
        {listVisible ? <PanelLeftClose size={16} /> : <PanelLeftOpen size={16} />}
      </button>
      <span className="ki-command-separator" aria-hidden="true" />
      <button className="primary" type="button" onClick={onForms}><ClipboardList size={14} />Zu den Formularen</button>
    </div>
    <div ref={panes} className={`ki-training-panes${listVisible ? "" : " is-list-collapsed"}`} style={{ gridTemplateColumns: listVisible ? `${width}px 6px minmax(0, 1fr)` : "minmax(0, 1fr)" }}>
      {listVisible && <aside id={listId} className="ki-training-list" aria-label="Schulungsliste">
        <div className="ki-training-list-heading"><strong>Schulungen</strong><span>1</span></div>
        <div className="ki-training-list-scroll">
          <button className={`ki-training-item${selected ? " selected" : ""}`} type="button" aria-pressed={selected} onClick={() => setSelected(true)}>
            <Play size={17} aria-hidden="true" /><span><strong>IT-Schulung</strong><small>{onlineStatus}</small></span>
          </button>
        </div>
      </aside>}
      {listVisible && <div className="ki-training-divider" role="separator" aria-label="Breite der Schulungsliste" aria-orientation="vertical" aria-valuemin={150} aria-valuemax={maxWidth} aria-valuenow={Math.round(width)} tabIndex={0}
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          event.preventDefault();
          event.currentTarget.focus();
          event.currentTarget.setPointerCapture(event.pointerId);
          drag.current = { x: event.clientX, width };
        }}
        onPointerMove={(event) => { if (drag.current) setListWidth(clampWidth(drag.current.width + event.clientX - drag.current.x)); }}
        onPointerUp={(event) => { drag.current = null; if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }}
        onLostPointerCapture={() => { drag.current = null; }}
        onDoubleClick={() => setListWidth(260)}
        onKeyDown={(event) => {
          if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
          event.preventDefault();
          setListWidth(event.key === "Home" ? 150 : event.key === "End" ? maxWidth : clampWidth(width + (event.key === "ArrowRight" ? 16 : -16)));
        }} />}
      <section className="ki-training-reading" aria-label="Schulungsinhalt">
        {!selected ? <div className="ki-training-empty"><Play size={24} aria-hidden="true" /><strong>Schulung auswählen</strong><span>{listVisible ? "Wählen Sie links eine Schulung aus." : "Blenden Sie die Schulungsliste ein, um eine Schulung auszuwählen."}</span></div> : <>
          <header className="ki-training-reading-heading">
            <div><h3>IT-Schulung</h3><small>{onlineStatus}{config?.version ? ` · Richtlinie ${config.version}` : ""}</small></div>
            <div className="ki-training-reading-actions">
              {!watching && <button className="primary" type="button" disabled={!available} aria-label="Schulung ansehen" onClick={() => { setError(""); setWatching(true); }}><Play size={14} />Ansehen</button>}
              {available && <button type="button" onClick={() => void openBrowser()}><ExternalLink size={14} />Im Browser öffnen</button>}
            </div>
          </header>
          {error && <p className="ki-error" role="alert">{error}</p>}
          <div className="ki-training-reader-scroll">
            {available && watching && url ? <div className="ki-training-player">
              {video ? <video controls preload="metadata" src={url.href} aria-label="IT-Schulung" onError={() => setError("Das Video konnte nicht geladen werden. Bitte „Im Browser öffnen“ wählen.")} />
                : <iframe title="IT-Schulung – Inhalt" src={url.href} sandbox="allow-scripts allow-same-origin allow-forms allow-presentation" referrerPolicy="no-referrer" allow="fullscreen" allowFullScreen />}
            </div> : <div className="ki-training-empty"><Play size={24} aria-hidden="true" /><strong>{available ? "Online-Schulung" : "Schulung wird vorbereitet"}</strong><span>{available ? "Mit „Ansehen“ starten Sie die Schulung hier im Lesebereich." : "Die EDV stellt den Schulungslink hier bereit."}</span></div>}
          </div>
        </>}
      </section>
    </div>
    <footer className="ki-statusbar"><span>1 Schulung</span><span>{selected ? "IT-Schulung" : "Keine Auswahl"}</span></footer>
  </section>;
}
