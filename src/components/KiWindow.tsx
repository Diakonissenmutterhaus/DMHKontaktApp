import { useEffect, useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

export function KiWindow({ title, children, footer, onClose, busy = false, wide = false }: {
  title: string; children: ReactNode; footer?: ReactNode; onClose: () => void; busy?: boolean; wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const previous = document.activeElement;
    if (ref.current?.showModal) ref.current.showModal(); else ref.current?.setAttribute("open", "");
    return () => { if (previous instanceof HTMLElement && previous.isConnected) previous.focus(); };
  }, []);
  return createPortal(<dialog ref={ref} className={`ki-window${wide ? " ki-window-wide" : ""}`} aria-labelledby={titleId} aria-modal="true" onCancel={(event) => { event.preventDefault(); if (!busy) onClose(); }}>
    <header><h3 id={titleId}>{title}</h3><button type="button" aria-label="Fenster schließen" disabled={busy} onClick={onClose}><X size={17} /></button></header>
    <div className="ki-window-content">{children}</div>
    <footer>{footer}<button type="button" disabled={busy} onClick={onClose}>Schließen</button></footer>
  </dialog>, document.body);
}
