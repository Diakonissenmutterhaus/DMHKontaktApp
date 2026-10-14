import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Minus, Plus } from "lucide-react";
import { AnnotationMode, getDocument, GlobalWorkerOptions, type PDFDocumentProxy, type RenderTask } from "pdfjs-dist/legacy/build/pdf.mjs";
import workerUrl from "pdfjs-dist/legacy/build/pdf.worker.min.mjs?url";
import { reportDiagnostic } from "../utils/notificationPolicy";

GlobalWorkerOptions.workerSrc = workerUrl;

export default function LocalPdfPreview({ bytes, messageId, name }: { bytes: Uint8Array; messageId: string; name: string }) {
  const [document, setDocument] = useState<PDFDocumentProxy | null>(null);
  const [pageNumber, setPageNumber] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [width, setWidth] = useState(600);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(true);
  const [passwordNeeded, setPasswordNeeded] = useState(false);
  const [password, setPassword] = useState("");
  const passwordCallback = useRef<((password: string) => void) | null>(null);
  const stage = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const renderQueue = useRef<Promise<unknown>>(Promise.resolve());
  useEffect(() => {
    let active = true;
    const base = `${import.meta.env.BASE_URL}pdfjs/`;
    // Render canvas pixels only; XFA, scripting, forms and interactive links
    // are not enabled. Fonts and decoders are bundled with the application.
    const task = getDocument({ data: bytes.slice(), enableXfa: false, maxImageSize: 32_000_000,
      cMapUrl: `${base}cmaps/`, cMapPacked: true, standardFontDataUrl: `${base}standard_fonts/`,
      wasmUrl: `${base}wasm/`, iccUrl: `${base}iccs/` });
    task.onPassword = (updatePassword: (password: string) => void, reason: number) => {
      if (!active) return;
      passwordCallback.current = updatePassword; setPasswordNeeded(true); setBusy(false);
      setError(reason === 2 ? "Das PDF-Kennwort ist nicht korrekt. Bitte erneut eingeben." : "");
    };
    void task.promise.then(pdf => { if (active) { setDocument(pdf); setPasswordNeeded(false); } })
      .catch(error => { if (active) {
        void reportDiagnostic({ origin:"LocalPdfPreview",level:"error",entityKind:"email-attachment",entityId:messageId,title:name,operation:"open",message:error instanceof Error ? error.message : String(error) });
        setBusy(false); setError("Das PDF konnte nicht angezeigt werden. Bitte „Speichern unter“ verwenden.");
      } });
    return () => { active = false; passwordCallback.current = null; void task.destroy(); };
  }, [bytes, messageId, name]);
  useEffect(() => {
    if (!stage.current) return;
    const observer = new ResizeObserver(entries => setWidth(Math.max(150, entries[0].contentRect.width - 32)));
    observer.observe(stage.current); return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!document) return;
    let active = true; let render: RenderTask | undefined;
    setBusy(true); setError("");
    const job = renderQueue.current.catch(() => undefined).then(async () => {
      const page = await document.getPage(pageNumber);
      if (!active || !canvas.current) return;
      const base = page.getViewport({ scale: 1 });
      const scale = Math.min(width / base.width * zoom, Math.sqrt(16_000_000 / (base.width * base.height)) / Math.min(2,window.devicePixelRatio || 1));
      const viewport = page.getViewport({ scale }); const pixelRatio = Math.min(2,window.devicePixelRatio || 1);
      const target = canvas.current; target.width = Math.ceil(viewport.width * pixelRatio); target.height = Math.ceil(viewport.height * pixelRatio);
      target.style.width = `${viewport.width}px`; target.style.height = `${viewport.height}px`;
      const context = target.getContext("2d"); if (!context) throw new Error("Canvas unavailable");
      // Render pixels only: no PDF actions, links, forms or annotation DOM.
      render = page.render({ canvas: target, canvasContext: context, viewport, annotationMode: AnnotationMode.DISABLE,
        transform: pixelRatio === 1 ? undefined : [pixelRatio,0,0,pixelRatio,0,0] });
      await render.promise;
    });
    renderQueue.current = job.catch(() => undefined);
    void job.catch(error => { if (active) {
      void reportDiagnostic({ origin:"LocalPdfPreview",level:"error",entityKind:"email-attachment",entityId:messageId,title:name,operation:"render",message:error instanceof Error ? error.message : String(error) });
      setError("Diese PDF-Seite konnte nicht angezeigt werden. Bitte „Speichern unter“ verwenden.");
    } })
      .finally(() => { if (active) setBusy(false); });
    return () => { active = false; render?.cancel(); };
  }, [document, pageNumber, zoom, width, messageId, name]);
  return <div className="email-pdf-preview">
    <div className="email-pdf-toolbar">
      <button type="button" aria-label="Vorherige PDF-Seite" disabled={!document || pageNumber <= 1} onClick={() => setPageNumber(current => current - 1)}><ChevronLeft size={17} /></button>
      <span>Seite {pageNumber} von {document?.numPages ?? "…"}</span>
      <button type="button" aria-label="Nächste PDF-Seite" disabled={!document || pageNumber >= document.numPages} onClick={() => setPageNumber(current => current + 1)}><ChevronRight size={17} /></button>
      <button type="button" aria-label="PDF verkleinern" disabled={!document || zoom <= .5} onClick={() => setZoom(current => Math.max(.5,current - .25))}><Minus size={17} /></button>
      <span>{Math.round(zoom * 100)}%</span>
      <button type="button" aria-label="PDF vergrößern" disabled={!document || zoom >= 3} onClick={() => setZoom(current => Math.min(3,current + .25))}><Plus size={17} /></button>
      <button type="button" disabled={!document} onClick={() => setZoom(1)}>An Breite anpassen</button>
    </div>
    {passwordNeeded && <form className="email-pdf-password" onSubmit={event => { event.preventDefault(); passwordCallback.current?.(password); setPassword(""); setPasswordNeeded(false); setBusy(true); }}><label>PDF-Kennwort <input autoComplete="off" type="password" value={password} onChange={event => setPassword(event.target.value)} /></label><button type="submit">PDF öffnen</button></form>}
    {error && <p role="alert" className="field-error">{error}</p>}
    <div className="email-pdf-stage" ref={stage}>{busy && <span className="email-preview-loading" role="status">PDF wird geladen …</span>}<canvas ref={canvas} aria-label={`PDF-Seite ${pageNumber}`} hidden={!document || !!error || passwordNeeded} /></div>
  </div>;
}
