import { AlertCircle, CheckCircle2, Info, X } from "lucide-react";
import { useEffect, useState } from "react";
import { recordActivity } from "../utils/activityLog";

export type ActionResultTone = "success" | "info" | "error";

export interface ActionResult {
  title: string;
  summary: string;
  details?: string[];
  /** Affected entries for batch actions. Kept behind a disclosure so the result stays easy to read. */
  items?: Array<{ label: string; detail?: string }>;
  itemsLabel?: string;
  tone?: ActionResultTone;
  /** Stable key for an optional, per-action preference to hide this success dialog in the future. */
  dismissalKey?: string;
  dismissalLabel?: string;
}

interface ActionResultDialogProps {
  result: ActionResult | null;
  onClose: () => void;
}

export function ActionResultDialog({ result, onClose }: ActionResultDialogProps) {
  const [visibleItemCount, setVisibleItemCount] = useState(100);
  const [dismissFutureResults, setDismissFutureResults] = useState(false);

  const preferenceStorageKey = result?.dismissalKey ? `agendakontakte.dismissedActionResult.${result.dismissalKey}` : undefined;
  const isDismissed = preferenceStorageKey ? localStorage.getItem(preferenceStorageKey) === "true" : false;

  const close = () => {
    if (dismissFutureResults && preferenceStorageKey) localStorage.setItem(preferenceStorageKey, "true");
    onClose();
  };

  useEffect(() => {
    setVisibleItemCount(100);
    setDismissFutureResults(false);
  }, [result]);

  useEffect(() => {
    if (result && isDismissed) onClose();
  }, [isDismissed, onClose, result]);

  useEffect(() => {
    if (!result) return;
    recordActivity({
      title: result.title,
      summary: result.summary,
      tone: result.tone ?? "info",
      details: result.details,
      items: result.items
    });
  }, [result]);

  useEffect(() => {
    if (!result) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [close, result]);

  if (!result || isDismissed) return null;

  const tone = result.tone ?? "info";
  const Icon = tone === "success" ? CheckCircle2 : tone === "error" ? AlertCircle : Info;

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="action-result-title">
      <section className={`form-panel modal-card action-result-dialog ${tone}`}>
        <div className="action-result-heading">
          <span className="action-result-icon" aria-hidden="true"><Icon size={28} /></span>
          <div>
            <p className="action-result-kicker">Ergebnis</p>
            <h3 id="action-result-title">{result.title}</h3>
          </div>
          <button className="icon-only" type="button" aria-label="Schließen" onClick={close} autoFocus>
            <X size={22} />
          </button>
        </div>

        <p className="action-result-summary">{result.summary}</p>
        {result.details && result.details.length > 0 && (
          <ul className="action-result-details">
            {result.details.map((detail, index) => <li key={`${detail}-${index}`}>{detail}</li>)}
          </ul>
        )}
        {result.items && result.items.length > 0 && (
          <details className="action-result-items">
            <summary>{result.itemsLabel ?? `${result.items.length} betroffene Einträge anzeigen`}</summary>
            <ul>
              {result.items.slice(0, visibleItemCount).map((item, index) => (
                <li key={`${item.label}-${index}`}>
                  <strong>{item.label}</strong>
                  {item.detail && <span>{item.detail}</span>}
                </li>
              ))}
            </ul>
            {visibleItemCount < result.items.length && (
              <button className="action-result-load-more" type="button" onClick={() => setVisibleItemCount((current) => Math.min(result.items!.length, current + 100))}>
                Weitere Einträge anzeigen ({Math.min(visibleItemCount, result.items.length)} von {result.items.length})
              </button>
            )}
          </details>
        )}
        {result.dismissalKey && (
          <label className="action-result-dismiss-option">
            <input type="checkbox" checked={dismissFutureResults} onChange={(event) => setDismissFutureResults(event.target.checked)} />
            <span>{result.dismissalLabel ?? "Diesen Hinweis nicht mehr anzeigen"}</span>
          </label>
        )}
        <div className="button-row action-result-actions">
          <button className="primary" type="button" onClick={close}>Verstanden</button>
        </div>
      </section>
    </div>
  );
}
