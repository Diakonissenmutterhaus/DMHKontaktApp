import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
export function ProcedureReportingSettings() {
  const [status, setStatus] = useState<{configured:boolean;pending:number;error:string|null}|null>(null);
  const [message,setMessage] = useState("");
  const file = useRef<HTMLInputElement>(null);
  const load = () => invoke<typeof status>("get_procedure_reporting_status").then(setStatus).catch(() => undefined);
  useEffect(() => { void load(); }, []);
  const importFile = async (selected?:File) => {
    if(!selected)return;
    try {
      if(selected.size>6000)throw new Error("Datei zu groß.");
      const config=JSON.parse(await selected.text());
      await invoke("configure_procedure_reporting",{config});
      await invoke("flush_procedure_reports");
      await load();setMessage("PC-Zugang gespeichert. Neue Verfahrensberichte werden automatisch gesendet.");
    } catch { setMessage("PC-Zugang konnte nicht importiert werden. Bitte die Konfigurationsdatei der EDV verwenden."); }
    if(file.current)file.current.value="";
  };
  return <section className="form-panel" aria-label="Verfahrensberichte"><h3>Verfahrensberichte</h3><p>{status?.configured?`Für diesen PC aktiv · ${status.pending} Berichte ausstehend`:"Für diesen PC noch nicht eingerichtet."}</p><div className="button-row"><button type="button" onClick={()=>file.current?.click()}>PC-Zugang importieren</button><button type="button" onClick={()=>void openUrl("https://migration.dmh-aidlingen.de/login").catch(()=>setMessage("Berichtsseite konnte nicht geöffnet werden."))}>EDV-Berichte öffnen</button><button type="button" onClick={()=>void invoke("flush_procedure_reports").then(load).catch(()=>setMessage("Versand noch nicht möglich."))}>Jetzt senden</button></div><input ref={file} type="file" accept="application/json,.json" hidden onChange={event=>void importFile(event.target.files?.[0])}/><p className="ki-local-note">Zugang im EDV-Webportal pro PC erstellen. Berichte enthalten Benutzer, Konto, Computer und Ergebnis. Fehlende Internetverbindungen verzögern den Versand.</p>{(message||status?.error)&&<p role="status">{message||status?.error}</p>}</section>;
}
