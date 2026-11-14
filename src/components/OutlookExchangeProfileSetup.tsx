import { CheckCircle2, LoaderCircle, Mail, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { M365Loading, showM365LoadingFrame } from "./M365Loading";
import { completeOutlookExchangeProfile, getOutlookExchangeSetupStatus, getOutlookOfficeAccountCheck, prepareOutlookExchangeProfile } from "../services/db";
import type { OutlookExchangeSetupStatus } from "../types/outlookExchange";
import "./OutlookExchangeProfileSetup.css";
import { refreshOutlookProfileViews } from "../utils/outlookProfileRefresh";
import { beginProcedureReport, finishProcedureReport } from "../services/procedureReports";

interface OutlookExchangeProfileSetupProps {
  email: string;
  disabled?: boolean;
  compact?: boolean;
  leadingAction?: ReactNode;
}

const pollIntervalMs = 4_000;
const pollingLimitMs = 4 * 60_000;
const setupTimeoutMessage = "Die automatische Einrichtung konnte nicht abgeschlossen werden. Bitte wenden Sie sich an die EDV. Ihr bisheriges Outlook-Profil bleibt erhalten.";
const setupErrorMessage = (_cause: unknown) => setupTimeoutMessage;
const stopBackgroundWatcher = () => Promise.resolve().then(() => invoke("stop_outlook_setup_background")).catch(() => undefined);

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
  const detectedOfficeEmail = useRef<string | null>(null);
  const report = useRef<Awaited<ReturnType<typeof beginProcedureReport>> | null>(null);
  const [initialLoading, setInitialLoading] = useState(true);
  const [progress, setProgress] = useState({ value: 0, label: "Informationen werden geprüft …" });
  const progressListener = useRef<Promise<(() => void) | undefined>>(Promise.resolve(undefined));

  useEffect(() => {
    const pending = listen<{ email: string; value: number; label: string }>("dmh:outlook-setup-progress", ({ payload }) => {
      if (payload.email.toLowerCase() === email.toLowerCase() && mounted.current && payload.value >= 0 && payload.value <= 6) setProgress({ value: payload.value, label: payload.label });
    }).catch(() => undefined);
    progressListener.current = pending;
    return () => { void pending.then((unlisten) => unlisten?.()); };
  }, [email]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      requestId.current += 1;
      void stopBackgroundWatcher();
    };
  }, []);

  const currentRequest = useCallback((id: number) => mounted.current && requestId.current === id, []);

  useEffect(() => {
    let cancelled = false;
    const id = requestId.current;
    // Restore an already completed view without creating/activating any profile.
    void getOutlookExchangeSetupStatus().then((next) => {
      if (!cancelled && currentRequest(id) && next.stage === "complete" && next.email.toLowerCase() === email.toLowerCase()) setStatus(next);
    }).catch(() => undefined).finally(() => { if (!cancelled && currentRequest(id)) setInitialLoading(false); });
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
        if (currentRequest(id)) setFinishing(false);
      }
      if (!currentRequest(id)) return null;
      if (accepted.email && accepted.email.toLowerCase() !== email.toLowerCase()) {
        throw new Error("Das Microsoft-365-Konto wurde geändert. Bitte die Einrichtung für das aktuelle Konto neu öffnen.");
      }
      setConnectedPending(accepted.stage === "connected");
    }
    if (accepted.stage === "complete") {
      setBusy(true);
      await refreshOutlookProfileViews();
      if (!currentRequest(id)) return null;
      await finishProcedureReport(report.current, "success", "Exchange verbunden und Standardprofil bestätigt.", email, accepted.exchangeProfile);
    }
    if (["outlook_open", "unavailable"].includes(accepted.stage)) {
      await finishProcedureReport(report.current, "error", accepted.message, email, accepted.exchangeProfile, accepted.stage);
    }
    setStatus(accepted);
    if (!["awaiting_login", "awaiting_close", "connected"].includes(accepted.stage)) await stopBackgroundWatcher();
    if (accepted.stage !== "awaiting_login" && accepted.stage !== "awaiting_close") setPolling(false);
    return accepted;
  }, [currentRequest, email]);

  const runAction = async (action: "prepare" | "check") => {
    setInitialLoading(false);
    const id = ++requestId.current;
    setBusy(true);
    setPolling(false);
    setTimedOut(false);
    setError("");
    setProgress({ value: 0, label: detectedOfficeEmail.current ? "Microsoft-Konto wird geprüft …" : "Office-Konten werden gelesen …" });
    deadline.current = Date.now() + pollingLimitMs;
    try {
      report.current = await beginProcedureReport("outlook_exchange", email);
      await showM365LoadingFrame();
      await progressListener.current;
      if (!detectedOfficeEmail.current) {
        const check = await getOutlookOfficeAccountCheck();
        if (!currentRequest(id)) return;
        if (check.dmhEmail.toLowerCase() !== email.toLowerCase()) throw new Error("Das Microsoft-365-Konto wurde geändert. Bitte die Seite erneut öffnen.");
        const aliases = check.dmhEmails.map((alias) => alias.toLowerCase());
        const windowsEmail = check.fallback?.source === "windows_work_account" && !check.accounts.length
          && !check.suggestedEmail && aliases.includes(check.fallback.email.toLowerCase()) ? check.fallback.email : "";
        if (!check.readSucceeded || (!check.accounts.length && !windowsEmail)) throw new Error("OFFICE_ACCOUNT_NOT_DETECTED: " + JSON.stringify({
          readSucceeded: check.readSucceeded, accountCount: check.accounts.length, sources: check.sources ?? [],
        }));
        if (check.accounts.some((account) => !aliases.includes(account.email.toLowerCase())) || (check.suggestedEmail && !aliases.includes(check.suggestedEmail.toLowerCase()))) {
          throw new Error("Die Office-Konten stimmen nicht eindeutig mit dem DMH-Konto überein. In DMH und Excel muss dasselbe Geschäftskonto angemeldet sein. Bitte die Konten prüfen und erneut versuchen. Es wurde kein Outlook-Profil geändert.");
        }
        detectedOfficeEmail.current = windowsEmail || check.suggestedEmail || check.accounts[0].email;
      }
      const next = await (action === "prepare" ? prepareOutlookExchangeProfile(detectedOfficeEmail.current) : getOutlookExchangeSetupStatus(true));
      const accepted = await acceptStatus(next, id);
      if (currentRequest(id) && (accepted?.stage === "awaiting_login" || accepted?.stage === "awaiting_close")) setPolling(true);
    } catch (cause) {
      await stopBackgroundWatcher();
      await finishProcedureReport(report.current, "error", String(cause), email);
      detectedOfficeEmail.current = null;
      if (currentRequest(id)) setError(setupErrorMessage(cause));
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
        await stopBackgroundWatcher();
        await finishProcedureReport(report.current, "interrupted", "Prüfung nach vier Minuten ohne bestätigten Abschluss beendet.", email);
        setPolling(false);
        setTimedOut(true);
        return;
      }
      try {
        const next = await getOutlookExchangeSetupStatus(true);
        if (cancelled || !currentRequest(id)) return;
        const accepted = await acceptStatus(next, id);
        if (!cancelled && currentRequest(id) && (accepted?.stage === "awaiting_login" || accepted?.stage === "awaiting_close")) {
          timer = window.setTimeout(() => void poll(), pollIntervalMs);
        }
      } catch (cause) {
        await stopBackgroundWatcher();
        await finishProcedureReport(report.current, "error", String(cause), email);
        if (!cancelled && currentRequest(id)) {
          setPolling(false);
          setError(setupErrorMessage(cause));
        }
      } finally {
        // Accepting completion ends the polling effect; its cleanup must not
        // leave the shared loading window active after the final refresh.
        if (currentRequest(id)) setBusy(false);
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
  const configuring = busy || polling || finishing;

  return (
    <section className={`outlook-exchange-setup${compact ? " outlook-exchange-setup-compact" : ""}`} aria-label="Outlook auf Exchange umstellen" aria-busy={configuring}>
      <M365Loading active={configuring || initialLoading} message={configuring ? "Wird eingerichtet. Bitte warten und die Anwendung nicht schließen." : "Outlook-Informationen werden geladen. Bitte warten …"} value={configuring ? progress.value : undefined} label={configuring ? progress.label : undefined} priority={10} />
      {!configuring && status && !error && !timedOut && <div className={`outlook-exchange-setup-status${complete ? " complete" : ""}`} role="status" aria-live="polite">{complete && <CheckCircle2 size={19} aria-hidden="true" />}<span>{complete ? "Outlook wurde erfolgreich auf Exchange umgestellt. Ihr Exchange-Profil ist als Standard eingerichtet." : setupTimeoutMessage}</span></div>}
      {!configuring && !initialLoading && timedOut && <p role="status">{setupTimeoutMessage}</p>}
      {!configuring && !initialLoading && error && <p role="status">{error}</p>}
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
