import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Copy, Download, FileText, LoaderCircle, X } from "lucide-react";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { save } from "@tauri-apps/plugin-dialog";
import { writeTextFile } from "@tauri-apps/plugin-fs";
import { getSupportDiagnostic, supportDiagnosticEvent } from "../services/supportDiagnostics";
import "./SupportDiagnosticDialog.css";

export function SupportDiagnosticDialog() {
  const [state, setState] = useState(getSupportDiagnostic);
  const [open, setOpen] = useState(false);
  const [notice, setNotice] = useState("");
  const [exporting, setExporting] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const update = () => { setState(getSupportDiagnostic()); setOpen(true); setNotice(""); };
    window.addEventListener(supportDiagnosticEvent, update);
    if (getSupportDiagnostic()) update();
    return () => window.removeEventListener(supportDiagnosticEvent, update);
  }, []);
  useEffect(() => {
    const element = dialog.current;
    if (open && element && !element.open) element.showModal();
    else if (!open && element?.open) element.close();
  }, [open]);
  if (!state) return null;
  const text = state.report?.text ?? `DMH Diagnose (unvollständig)\nVersuch: ${state.request.attemptId}\nVorgang: ${state.request.procedure}\nSchritt: ${state.request.stage}\nFehler: ${state.request.message}\nDiagnose: ${state.collectionError ?? "wird erstellt"}`;
  const copy = async () => {
    try { await writeText(text); setNotice("Diagnose kopiert."); }
    catch { setNotice("Kopieren nicht möglich. Bitte den Text markieren und kopieren oder die Datei speichern."); }
  };
  const download = async () => {
    setExporting(true);
    try {
      const path = await save({ defaultPath: state.report?.fileName ?? `DMH-Diagnose-${state.request.attemptId}.log`, filters: [{ name: "Diagnose", extensions: ["log"] }] });
      if (path) { await writeTextFile(path, text); setNotice("Diagnose gespeichert."); }
    } catch { setNotice("Datei konnte nicht gespeichert werden. Bitte die Diagnose kopieren."); }
    finally { setExporting(false); }
  };
  return <>
    {!open && <button type="button" className="support-diagnostic-reopen" onClick={() => setOpen(true)}><FileText size={16} /> Letzte Diagnose</button>}
    {createPortal(<dialog ref={dialog} className="support-diagnostic-dialog" aria-labelledby="support-diagnostic-title" onCancel={() => setOpen(false)} onClose={() => setOpen(false)}>
      <header><h3 id="support-diagnostic-title">Diagnose für die EDV</h3><button type="button" aria-label="Schließen" onClick={() => setOpen(false)}><X size={20} /></button></header>
      <div className="support-diagnostic-body">
        {state.loading ? <p role="status"><LoaderCircle className="spin" size={18} /> Diagnose wird erstellt …</p> : <>
          <p><strong>Fehlercode: {state.report?.code ?? "DMH-DIAGNOSE-UNVOLLSTÄNDIG"}</strong></p>
          <p>Bitte die Diagnose kopieren oder als Datei an die EDV weitergeben.</p>
          <textarea aria-label="Diagnoseprotokoll" value={text} readOnly spellCheck={false} />
          {state.report?.localPath && <p className="support-diagnostic-path">Lokal gespeichert: {state.report.localPath}</p>}
          {(state.collectionError || state.report?.saveError) && <p role="status">Die Diagnose ist teilweise unvollständig. Die ursprüngliche Fehlermeldung bleibt im Text erhalten.</p>}
        </>}
        <small>Enthält PC-/Benutzernamen, Kontoadressen und Pfade. Keine Kennwörter oder Tokens. Kein automatischer Versand.</small>
        {notice && <p role="status">{notice}</p>}
      </div>
      <footer>
        <button type="button" onClick={() => setOpen(false)}>Schließen</button>
        <button type="button" disabled={state.loading || exporting} onClick={() => void download()}><Download size={16} /> .log speichern</button>
        <button type="button" className="primary" disabled={state.loading} onClick={() => void copy()}><Copy size={16} /> Diagnose kopieren</button>
      </footer>
    </dialog>, document.body)}
  </>;
}
