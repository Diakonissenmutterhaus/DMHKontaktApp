import { CheckCircle2, LoaderCircle, Mail, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { completeOutlookExchangeProfile, getOutlookExchangeSetupStatus, prepareOutlookExchangeProfile } from "../services/db";
import type { OutlookExchangeSetupStatus } from "../types/outlookExchange";
import "./OutlookExchangeProfileSetup.css";

interface OutlookExchangeProfileSetupProps {
  email: string;
  disabled?: boolean;
  compact?: boolean;
  leadingAction?: ReactNode;
}

const pollIntervalMs = 4_000;
const pollingLimitMs = 4 * 60_000;

function SetupLoadingDialog() {
  const messageId = useId();
  const dialog = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previousFocus = document.activeElement;
    const root = document.getElementById("root");
    const previousInert = root?.getAttribute("inert");
    root?.setAttribute("inert", "");
    dialog.current?.focus();
    return () => {
      if (previousInert == null) root?.removeAttribute("inert");
      else root?.setAttribute("inert", previousInert);
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
    };
  }, []);
  return createPortal(
    <div className="modal-backdrop outlook-setup-loading-backdrop">
      <div ref={dialog} className="modal-card outlook-setup-loading-dialog" role="dialog" aria-modal="true" aria-labelledby={messageId} aria-busy="true" tabIndex={-1} onKeyDown={(event) => {
        if (event.key === "Tab" || event.key === "Escape") { event.preventDefault(); event.stopPropagation(); }
      }}>
        <LoaderCircle className="spin" size={22} aria-hidden="true" />
        <p id={messageId} role="status">Wird eingerichtet. Bitte warten und die Anwendung nicht schließen.</p>
      </div>
    </div>, document.body
  );
}

export function OutlookExchangeProfileSetup({ email, disabled = false, compact = false, leadingAction }: OutlookExchangeProfileSetupProps) {
  const [status, setStatus] = useState<OutlookExchangeSetupStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [connectedPending, setConnectedPending] = useState(false);
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

  useEffect(() => {
    let cancelled = false;
    const id = requestId.current;
    // Restore an already completed view without creating/activating any profile.
    void getOutlookExchangeSetupStatus().then((next) => {
      if (!cancelled && currentRequest(id) && next.stage === "complete" && next.email.toLowerCase() === email.toLowerCase()) setStatus(next);
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [currentRequest, email]);

  const acceptStatus = useCallback(async (next: OutlookExchangeSetupStatus, id: number) => {
    if (!currentRequest(id)) return null;
    if (next.email && next.email.toLowerCase() !== email.toLowerCase()) {
      throw new Error("Das Microsoft-365-Konto wurde geändert. Bitte die Einrichtung für das aktuelle Konto neu öffnen.");
    }
    let accepted = next;
    if ((next.stage === "connected" || next.stage === "awaiting_close")) {
      // This command is permitted only in a sequence started by the user's click.
      // Reading the mounted component never starts or completes a migration.
      setBusy(true);
      setFinishing(true);
      setConnectedPending(true);
      try {
        accepted = await completeOutlookExchangeProfile();
      } finally {
        if (currentRequest(id)) { setFinishing(false); setBusy(false); }
      }
      if (!currentRequest(id)) return null;
      if (accepted.email && accepted.email.toLowerCase() !== email.toLowerCase()) {
        throw new Error("Das Microsoft-365-Konto wurde geändert. Bitte die Einrichtung für das aktuelle Konto neu öffnen.");
      }
      setConnectedPending(accepted.stage === "connected");
    }
    setStatus(accepted);
    if (accepted.stage !== "awaiting_login" && accepted.stage !== "awaiting_close") setPolling(false);
    if (accepted.stage === "complete") window.dispatchEvent(new Event("dmh:outlook-profile-changed"));
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
      if (currentRequest(id) && (accepted?.stage === "awaiting_login" || accepted?.stage === "awaiting_close")) setPolling(true);
    } catch (cause) {
      if (currentRequest(id)) setError(String(cause));
    } finally {
      if (currentRequest(id)) setBusy(false);
    }
  };

  useEffect(() => {
    if (!polling || (status?.stage !== "awaiting_login" && status?.stage !== "awaiting_close")) return;
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
        if (!cancelled && currentRequest(id) && (accepted?.stage === "awaiting_login" || accepted?.stage === "awaiting_close")) {
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

  const waiting = status?.stage === "awaiting_login" || status?.stage === "awaiting_close" || status?.stage === "connected";
  const blocked = disabled || busy || polling;
  const configuring = !error && !timedOut && (busy || polling);

  return (
    <section className={`outlook-exchange-setup${compact ? " outlook-exchange-setup-compact" : ""}`} aria-label="Outlook auf Exchange umstellen" aria-busy={configuring}>
      {configuring ? <SetupLoadingDialog /> : status && !error && !timedOut && <div className={`outlook-exchange-setup-status${complete ? " complete" : ""}`} role="status" aria-live="polite">{complete && <CheckCircle2 size={19} aria-hidden="true" />}<span>{status.message}</span></div>}
      {timedOut && <p role="status">Die automatische Prüfung wurde nach vier Minuten angehalten. Sie können die Anmeldung fertigstellen und die Verbindung erneut prüfen.</p>}
      {error && <p className="outlook-exchange-setup-error" role="alert">{error}</p>}
      {!configuring && (!complete || leadingAction) && <div className="button-row">
        {leadingAction}
        {!complete && (waiting ? <>
          <button type="button" onClick={() => void runAction("check")} disabled={blocked}>
            {busy || polling ? <LoaderCircle className="spin" size={17} aria-hidden="true" /> : <RefreshCw size={17} aria-hidden="true" />}
            {finishing ? "Profil wird abgeschlossen …" : connectedPending ? "Einrichtung abschließen" : polling ? "Verbindung wird geprüft …" : "Exchange-Verbindung prüfen"}
          </button>
          {!polling && <button type="button" onClick={() => void runAction("prepare")} disabled={blocked}>Einrichtung fortsetzen</button>}
        </> : <button className="primary" type="button" onClick={() => void runAction("prepare")} disabled={blocked}>
          {busy ? <LoaderCircle className="spin" size={17} aria-hidden="true" /> : <Mail size={17} aria-hidden="true" />}
          {busy ? "Outlook wird vorbereitet …" : status || error ? "Erneut versuchen" : "Zu Exchange wechseln"}
        </button>)}
      </div>}
    </section>
  );
}
