import { useEffect, useState } from "react";
import { FolderOpen, Settings2 } from "lucide-react";
import { getOutlookAccountConfiguration, openOutlookDefaultProfile } from "../services/db";
import { OutlookProfileManager } from "./OutlookProfileManager";
import type { OutlookAccountConfiguration } from "../types/outlookExchange";

export function OutlookAccountSummary({ email }: { email: string }) {
  const [configuration, setConfiguration] = useState<OutlookAccountConfiguration | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [showProfiles, setShowProfiles] = useState(false);
  const [opening, setOpening] = useState(false);
  const [actionMessage, setActionMessage] = useState("");

  const openOutlook = async () => {
    setOpening(true);
    setActionMessage("");
    try {
      const result = await openOutlookDefaultProfile();
      setActionMessage(result.message);
      setRefresh((value) => value + 1);
    } catch (cause) { setActionMessage(`Outlook konnte nicht geöffnet werden: ${String(cause)}`); }
    finally { setOpening(false); }
  };

  useEffect(() => {
    let cancelled = false;
    let pending = false;
    const load = async () => {
      if (pending) return;
      pending = true;
      setLoading(true);
      try {
        const next = await getOutlookAccountConfiguration();
        if (next.email.toLowerCase() !== email.toLowerCase()) throw new Error("Account changed");
        if (!cancelled) {
          setConfiguration(next);
          setError(false);
        }
      } catch {
        if (!cancelled) {
          setConfiguration(null);
          setError(true);
        }
      } finally {
        pending = false;
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    const onFocus = () => void load();
    const timer = window.setInterval(onFocus, 15_000);
    window.addEventListener("focus", onFocus);
    window.addEventListener("dmh:outlook-profile-changed", onFocus);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("dmh:outlook-profile-changed", onFocus);
    };
  }, [email, refresh]);

  const defaultProfile = configuration?.defaultProfile ?? (configuration?.source === "default" ? configuration.profile : "");
  const activeProfile = configuration?.activeProfile ?? (configuration?.source === "active" ? configuration.profile : "");
  return (
    <section className="m365-outlook-summary" aria-label="Outlook-Konfiguration" aria-busy={loading}>
      <div className="m365-outlook-summary-heading">
        <div className="m365-outlook-identity">
          <strong>Outlook</strong>
          <span className="m365-outlook-default">Standardprofil: <strong>{configuration ? defaultProfile || "Nicht festgelegt" : loading ? "Wird geprüft …" : "Nicht verfügbar"}</strong></span>
        </div>
        <div className="m365-outlook-actions">
          {!showProfiles && <button type="button" disabled={opening || !defaultProfile} onClick={() => void openOutlook()}><FolderOpen size={14} />{opening ? "Wird geöffnet …" : "Outlook öffnen"}</button>}
          <button type="button" aria-expanded={showProfiles} onClick={() => setShowProfiles((value) => !value)}><Settings2 size={14} />{showProfiles ? "Schließen" : "Profile verwalten"}</button>
        </div>
      </div>
      {error && <span>Konfiguration nicht lesbar. Bitte erneut prüfen.</span>}
      {configuration && !showProfiles && <div className="m365-outlook-summary-meta">
        {activeProfile && activeProfile !== defaultProfile && <span>Geöffnet: <strong>{activeProfile}</strong></span>}
        {configuration.accounts.map((account, index) => (
          <span key={`${account.accountType}:${account.server}:${index}`}>
            <strong className={`m365-outlook-type ${account.accountType === "Exchange" ? "exchange" : ""}`}>{account.accountType === "Other" ? "Anderer Kontotyp" : account.accountType}</strong>
            {account.server && <> · {account.server}</>}
          </span>
        ))}
        {configuration.promptForProfile && <span>Profilauswahl beim Outlook-Start aktiv</span>}
      </div>}
      {actionMessage && <span role="status">{actionMessage}</span>}
      {showProfiles && <OutlookProfileManager onDefaultChanged={(profile) => {
        setConfiguration((current) => current ? { ...current, defaultProfile: profile } : current);
        setRefresh((value) => value + 1);
      }} />}
    </section>
  );
}
