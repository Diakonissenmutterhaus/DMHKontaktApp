import { createContext, useCallback, useContext, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { LoaderCircle } from "lucide-react";
import "./M365Loading.css";

interface Job { message: string; value?: number; label?: string; priority?: number }
const LoadingContext = createContext<((id: string, job: Job | null) => void) | null>(null);

function LoadingWindow({ message, value, label }: Job) {
  const id = useId();
  const panel = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const previousFocus = document.activeElement;
    const root = document.getElementById("root");
    const previousInert = root?.getAttribute("inert");
    root?.setAttribute("inert", "");
    if (panel.current?.showModal) panel.current.showModal(); else panel.current?.setAttribute("open", "");
    panel.current?.focus();
    return () => {
      if (previousInert == null) root?.removeAttribute("inert"); else root?.setAttribute("inert", previousInert);
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
    };
  }, []);
  return createPortal(<dialog ref={panel} className="m365-loading-window" aria-modal="true" aria-labelledby={id} aria-describedby={`${id}-duration`} aria-busy="true" tabIndex={-1} onCancel={(event) => event.preventDefault()} onKeyDown={(event) => {
    if (event.key === "Tab" || event.key === "Escape") { event.preventDefault(); event.stopPropagation(); }
  }}><div className="m365-loading-heading"><LoaderCircle className="spin" size={22} aria-hidden="true" /><p id={id} role="status">{message}</p></div><small id={`${id}-duration`}>Die automatische Einrichtung kann 1–3 Minuten dauern.</small><progress aria-label="Fortschritt" max={6} value={value} aria-valuetext={label} />{label && <small>{label}</small>}</dialog>, document.body);
}

export function M365LoadingScope({ children }: { children: ReactNode }) {
  const [jobs, setJobs] = useState<Map<string, Job>>(new Map());
  const update = useCallback((id: string, job: Job | null) => setJobs((current) => {
    if (!job && !current.has(id)) return current;
    const next = new Map(current); if (job) next.set(id, job); else next.delete(id); return next;
  }), []);
  const active = [...jobs.values()].sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0))[0];
  return <LoadingContext.Provider value={update}>{children}{active && <LoadingWindow {...active} />}</LoadingContext.Provider>;
}

export function M365Loading({ active, message = "Informationen werden geladen. Bitte warten …", value, label, priority = 0 }: Job & { active: boolean }) {
  const update = useContext(LoadingContext);
  const id = useId();
  // Register child queries before paint so the account-to-Outlook handoff never
  // briefly exposes the page or destroys/reopens the shared loading window.
  useLayoutEffect(() => {
    update?.(id, active ? { message, value, label, priority } : null);
  }, [active, id, label, message, priority, update, value]);
  useLayoutEffect(() => () => update?.(id, null), [id, update]);
  return !update && active ? <LoadingWindow message={message} value={value} label={label} /> : null;
}

// Give React and the browser a paint before any Outlook lifecycle operation.
export const showM365LoadingFrame = () => new Promise<void>((resolve) => window.setTimeout(resolve, 40));
