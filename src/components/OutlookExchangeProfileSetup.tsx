import { CheckCircle2, LoaderCircle, Mail, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { completeOutlookExchangeProfile, getOutlookExchangeSetupStatus, prepareOutlookExchangeProfile } from "../services/db";
import type { OutlookExchangeSetupStatus } from "../types/outlookExchange";
import "./OutlookExchangeProfileSetup.css";

interface OutlookExchangeProfileSetupProps {
  email: string;
  disabled?: boolean;
}

const pollIntervalMs = 4_000;
const pollingLimitMs = 4 * 60_000;

export function OutlookExchangeProfileSetup({ email, disabled = false }: OutlookExchangeProfileSetupProps) {
  const [status, setStatus] = useState<OutlookExchangeSetupStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [polling, setPolling] = useState(false);
  const [timedOut, setTimedOut] = useState(false);
  const [error, setError] = useState("");
  const requestId = useRef(0);
  const mounted = useRef(true);
  const deadline = useRef(0);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      requestId.current += 1;
    };
  }, []);

  const currentRequest = useCallback((id: number) => mounted.current && requestId.current === id, []);

  const acceptStatus = useCallback(async (next: OutlookExchangeSetupStatus, id: number) => {
    if (!currentRequest(id)) return null;
    if (next.email && next.email.toLowerCase() !== email.toLowerCase()) {
      throw new Error("Das Microsoft-365-Konto wurde geändert. Bitte die Einrichtung für das aktuelle Konto neu öffnen.");
    }
    let accepted = next;
    if (next.stage === "connected") {
      // This command is permitted only in a sequence started by the user's click.
      // Reading the mounted component never starts or completes a migration.
      setBusy(true);
      accepted = await completeOutlookExchangeProfile();
      if (!currentRequest(id)) return null;
      if (accepted.email && accepted.email.toLowerCase() !== email.toLowerCase()) {
        throw new Error("Das Microsoft-365-Konto wurde geändert. Bitte die Einrichtung für das aktuelle Konto neu öffnen.");
      }
      setBusy(false);
    }
    setStatus(accepted);
    if (accepted.stage !== "awaiting_login") setPolling(false);
    return accepted;
  }, [currentRequest, email]);

  const runAction = async (action: "prepare" | "check") => {
    const id = ++requestId.current;
    setBusy(true);
    setPolling(false);
    setTimedOut(false);
    setError("");
    deadline.current = Date.now() + pollingLimitMs;
    try {
      const next = await (action === "prepare" ? prepareOutlookExchangeProfile() : getOutlookExchangeSetupStatus());
      const accepted = await acceptStatus(next, id);
      if (currentRequest(id) && accepted?.stage === "awaiting_login") setPolling(true);
    } catch (cause) {
      if (currentRequest(id)) setError(String(cause));
    } finally {
      if (currentRequest(id)) setBusy(false);
    }
  };

  useEffect(() => {
    if (!polling || status?.stage !== "awaiting_login") return;
    const id = requestId.current;
    let cancelled = false;
    let timer: number | undefined;
    const poll = async () => {
      if (cancelled || !currentRequest(id)) return;
      if (Date.now() >= deadline.current) {
        setPolling(false);
        setTimedOut(true);
        return;
      }
      try {
        const next = await getOutlookExchangeSetupStatus();
        if (cancelled || !currentRequest(id)) return;
        const accepted = await acceptStatus(next, id);
        if (!cancelled && currentRequest(id) && accepted?.stage === "awaiting_login") {
          timer = window.setTimeout(() => void poll(), pollIntervalMs);
        }
      } catch (cause) {
        if (!cancelled && currentRequest(id)) {
          setPolling(false);
          setError(String(cause));
        }
      } finally {
        if (!cancelled && currentRequest(id)) setBusy(false);
      }
    };
    timer = window.setTimeout(() => void poll(), pollIntervalMs);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [acceptStatus, currentRequest, polling, status?.stage]);

  const complete = status?.stage === "complete";
  const waiting = status?.stage === "awaiting_login" || status?.stage === "connected";
  const blocked = disabled || busy || polling;

  return (
    <section className="outlook-exchange-setup" aria-label="Outlook auf Exchange umstellen" aria-busy={busy}>
      <div className="outlook-exchange-setup-heading">
        <Mail size={21} aria-hidden="true" />
        <div>
          <h3>Outlook auf Exchange umstellen</h3>
          <p>Outlook Classic mit <strong>{email}</strong> im neuen Profil „Profile Exchange“ einrichten.</p>
        </div>
      </div>
      {!complete && <p>Das bisherige Profil bleibt erhalten. Nach bestätigter Verbindung wird das neue Profil als Standard eingerichtet. Das zugehörige IMAP-Profil wird nach Möglichkeit „Profile IMAP“ genannt.</p>}
      {status && <p>Neues Profil: <strong>{status.exchangeProfile}</strong>{status.previousProfile && <> · Bisheriges Profil: <strong>{complete ? status.imapProfile ?? status.previousProfile : status.previousProfile}</strong></>}</p>}
      {status && <div className={`outlook-exchange-setup-status${complete ? " complete" : ""}`} role="status" aria-live="polite">
        {complete ? <CheckCircle2 size={19} aria-hidden="true" /> : waiting ? <LoaderCircle className={polling || busy ? "spin" : ""} size={19} aria-hidden="true" /> : null}
        <span>{status.message}</span>
      </div>}
      {waiting && !complete && <p>Bitte die Einrichtung im geöffneten Outlook abschließen. Falls Microsoft danach fragt, die Anmeldung oder MFA bestätigen. Anschließend wird die Verbindung geprüft.</p>}
      {status?.stage === "outlook_open" && <p>Bitte offene Nachrichten speichern und Outlook vollständig schließen. Danach erneut versuchen.</p>}
      {timedOut && <p role="status">Die automatische Prüfung wurde nach vier Minuten angehalten. Sie können die Anmeldung fertigstellen und die Verbindung erneut prüfen.</p>}
      {error && <p className="outlook-exchange-setup-error" role="alert">{error}</p>}
      {!complete && <div className="button-row">
        {waiting ? <>
          <button type="button" onClick={() => void runAction("check")} disabled={blocked}>
            {busy || polling ? <LoaderCircle className="spin" size={17} aria-hidden="true" /> : <RefreshCw size={17} aria-hidden="true" />}
            {polling ? "Verbindung wird geprüft …" : "Exchange-Verbindung prüfen"}
          </button>
          {!polling && <button type="button" onClick={() => void runAction("prepare")} disabled={blocked}>Einrichtung fortsetzen</button>}
        </> : <button className="primary" type="button" onClick={() => void runAction("prepare")} disabled={blocked}>
          {busy ? <LoaderCircle className="spin" size={17} aria-hidden="true" /> : <Mail size={17} aria-hidden="true" />}
          {busy ? "Outlook wird vorbereitet …" : status || error ? "Erneut versuchen" : "Zu Exchange wechseln"}
        </button>}
      </div>}
    </section>
  );
}
