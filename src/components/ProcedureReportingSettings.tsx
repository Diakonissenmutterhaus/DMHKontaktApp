import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";

type Status = { pending: number; error: string | null; lastDeliveryAt?: string | null };

export function ProcedureReportingSettings() {
  const [status, setStatus] = useState<Status | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => invoke<Status>("get_procedure_reporting_status")
    .then(setStatus).catch(() => undefined), []);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 10000);
    return () => window.clearInterval(timer);
  }, [load]);

  const send = async () => {
    setBusy(true);
    setMessage("");
    try { await invoke("flush_procedure_reports"); }
    catch { setMessage("Berichte bleiben gespeichert. Der Versand wird automatisch erneut versucht."); }
    finally { await load(); setBusy(false); }
  };

  return <section className="form-panel" aria-label="Verfahrensberichte">
    <h3>Verfahrensberichte</h3>
    <p>Automatischer Versand an die EDV · {status?.pending ?? 0} ausstehend</p>
    <div className="button-row">
      <button type="button" onClick={() => void openUrl("https://migration.dmh-aidlingen.de/login")
        .catch(() => setMessage("Berichtsseite konnte nicht geöffnet werden."))}>EDV-Berichte öffnen</button>
      <button type="button" disabled={busy} onClick={() => void send()}>{busy ? "Wird gesendet…" : "Jetzt senden"}</button>
    </div>
    <p className="ki-local-note">Dieser PC registriert sich automatisch. Gespeicherte Versuche werden nachgesendet. Ohne Internet bleiben Berichte auf diesem PC.</p>
    {status?.lastDeliveryAt && <p>Zuletzt bestätigt: {new Date(status.lastDeliveryAt).toLocaleString("de-DE")}</p>}
    {(message || status?.error) && <p role="status">{message || status?.error}</p>}
  </section>;
}
