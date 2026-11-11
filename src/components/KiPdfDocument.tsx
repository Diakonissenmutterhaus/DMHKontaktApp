import { lazy, Suspense, useEffect, useState } from "react";
import { save } from "@tauri-apps/plugin-dialog";
import { writeFile } from "@tauri-apps/plugin-fs";
import { getKiPdf } from "../services/ki";
const Preview = lazy(() => import("./LocalPdfPreview"));

export function KiPdfDocument({ sha256, name, onReady, initiallyOpen = false }: { sha256: string; name: string; onReady?: (ready: boolean) => void; initiallyOpen?: boolean }) {
  const [bytes, setBytes] = useState<Uint8Array | null>(null);
  const [error, setError] = useState("");
  const [open, setOpen] = useState(initiallyOpen);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true; setBytes(null); setError(""); onReady?.(false);
    void getKiPdf(sha256).then((encoded) => {
      if (active) setBytes(Uint8Array.from(atob(encoded), (char) => char.charCodeAt(0)));
    }).catch(() => { if (active) setError("Das Original-PDF konnte nicht geladen werden."); });
    return () => { active = false; };
  }, [sha256, attempt, onReady]);
  const download = async () => {
    if (!bytes) return;
    try {
      const path = await save({ defaultPath: name, filters: [{ name: "PDF", extensions: ["pdf"] }] });
      if (path) await writeFile(path, bytes);
    } catch { setError("Das PDF konnte nicht gespeichert werden."); }
  };
  return <div className="ki-pdf">
    <div className="button-row">{!initiallyOpen && <button type="button" disabled={!bytes} onClick={() => setOpen((value) => !value)}>{open ? "PDF schließen" : "Original-PDF lesen"}</button>}<button type="button" disabled={!bytes} onClick={() => void download()}>PDF speichern</button>{!initiallyOpen && <small>{name}</small>}</div>
    {error && <p role="alert">{error} <button type="button" onClick={() => setAttempt((value) => value + 1)}>Erneut laden</button></p>}
    {!bytes && !error && <p role="status">PDF wird geladen …</p>}
    {open && bytes && <Suspense fallback={<p role="status">PDF-Ansicht wird geladen …</p>}><Preview bytes={bytes} messageId={`ki:${sha256}`} name={name} onDocumentReady={onReady} /></Suspense>}
  </div>;
}
