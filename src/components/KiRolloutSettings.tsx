import { ExternalLink, RefreshCw } from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useState } from "react";
import { isKiRolloutActive, type KiRolloutStatus } from "../hooks/useKiRollout";

export function KiRolloutSettings({ status, refreshing, onRefresh }: { status: KiRolloutStatus; refreshing: boolean; onRefresh: () => Promise<void> }) {
  const [error, setError] = useState("");
  const active = isKiRolloutActive(status.policy);
  const scheduled = status.policy?.enabled && status.policy.activateAt && !active;
  const date = (value: string) => new Date(value).toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short", timeZone: "Europe/Berlin" });
  const manage = async () => {
    setError("");
    try { await openUrl("https://github.com/Diakonissenmutterhaus/DMHKontaktApp/actions/workflows/ki-rollout.yml"); }
    catch { setError("GitHub konnte nicht geöffnet werden."); }
  };
  return <section className="form-panel" aria-label="Zentrale KI-Freigabe">
    <div className="panel-heading"><div><h3>Zentrale KI-Freigabe</h3><p>Für alle PCs · über GitHub verwalten</p></div><button type="button" disabled={refreshing} onClick={() => void onRefresh()}><RefreshCw size={15} />Prüfen</button></div>
    <dl className="ki-properties"><dt>Status</dt><dd>{active ? "Zentral freigegeben" : scheduled ? "Geplant" : "Nicht zentral freigegeben"}</dd>{scheduled && status.policy?.activateAt && <><dt>Freigabe ab</dt><dd>{date(status.policy.activateAt)} · Europe/Berlin</dd></>}{status.lastSuccessAt && <><dt>Zuletzt geladen</dt><dd>{date(status.lastSuccessAt)}</dd></>}</dl>
    {(status.error || error) && <p className="ki-local-note" role="status">{error || status.error}</p>}
    <button type="button" className="primary" onClick={() => void manage()}><ExternalLink size={15} />Freigabe in GitHub verwalten</button>
    <p className="ki-local-note">Jetzt oder zu einem festen Zeitpunkt freigeben. Die App prüft ungefähr jede Minute; offline gilt die zuletzt geladene Konfiguration.</p>
  </section>;
}
