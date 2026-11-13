import { useDiagnosticMessage } from "../hooks/useDiagnosticMessage";
import { useEffect, useRef, useState } from "react";
import {
  CalendarDays,
  CheckCircle2,
  CircleAlert,
  Cloud,
  ContactRound,
  Copy,
  ExternalLink,
  KeyRound,
  LoaderCircle,
  LogOut,
  RefreshCw,
  ShieldCheck,
  X
} from "lucide-react";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { StatusMessage } from "../components/StatusMessage";
import { OutlookExchangeProfileSetup } from "../components/OutlookExchangeProfileSetup";
import { OutlookAccountSummary } from "../components/OutlookAccountSummary";
import { M365Loading, M365LoadingScope, showM365LoadingFrame } from "../components/M365Loading";
import {
  cancelMicrosoft365Connection,
  connectMicrosoft365Interactively,
  connectMicrosoft365WithWindowsAccount,
  disconnectMicrosoft365Account,
  getAppSetting,
  getMicrosoft365ConnectionStatus,
  openMicrosoft365SignIn,
  pollMicrosoft365Connection,
  startMicrosoft365Connection,
  testMicrosoft365Connection
} from "../services/db";
import type {
  Microsoft365ConnectionStatus,
  Microsoft365DeviceCode
} from "../types/m365";
import { defaultSyncConfig, parseSyncConfig, type SyncConfig } from "../types/sync";
import {
  calendarAutomaticSyncStatusEventName,
  calendarChangedEventName,
  emptyMicrosoft365SynchronizationRuntimeStatus,
  m365SafeImportTestMode,
  parseSynchronizationRuntimeStatus,
  synchronizationConfigKey,
  synchronizationRuntimeStatusKey,
  type CalendarAutomaticSyncStatus,
  type Microsoft365SynchronizationRuntimeStatus
} from "../utils/automaticCalendarSync";
import { enableCompleteAutomaticMicrosoft365Sync } from "../utils/microsoft365SyncConfig";
import { beginProcedureReport, finishProcedureReport, reportMicrosoft365Failure } from "../services/procedureReports";

const emptyStatus: Microsoft365ConnectionStatus = {
  configured: false,
  connected: false,
  account: null
};

function formatSyncTime(value: string | null, emptyLabel = "Noch nicht geprüft"): string {
  if (!value) return emptyLabel;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return emptyLabel;
  return date.toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short" });
}

interface Microsoft365PageProps {
  title?: string;
  synchronizeAfterConnection?: () => Promise<"success" | "error" | "skipped">;
}

export function Microsoft365Page({ title = "Microsoft 365", synchronizeAfterConnection }: Microsoft365PageProps = {}) {
  return <M365LoadingScope><Microsoft365Content title={title} synchronizeAfterConnection={synchronizeAfterConnection} /></M365LoadingScope>;
}

function Microsoft365Content({ title, synchronizeAfterConnection }: Microsoft365PageProps) {
  const [status, setStatus] = useState<Microsoft365ConnectionStatus | null>(null);
  const [deviceCode, setDeviceCode] = useState<Microsoft365DeviceCode | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [showCodeFallback, setShowCodeFallback] = useState(false);
  const [connectionError, setConnectionError] = useState("");
  const [message, setMessage] = useDiagnosticMessage("Microsoft365Page:message", "notification");
  const [messageType, setMessageType] = useState<"success" | "error" | "info">("info");
  const [syncConfig, setSyncConfig] = useState<SyncConfig>(defaultSyncConfig);
  const [syncRuntimeStatus, setSyncRuntimeStatus] = useState<Microsoft365SynchronizationRuntimeStatus>(emptyMicrosoft365SynchronizationRuntimeStatus);
  const [syncPreparing, setSyncPreparing] = useState(false);
  const [overviewLoading, setOverviewLoading] = useState(true);
  const pollingRef = useRef(false);
  const preparationFailure = useRef("");
  const loginReport = useRef<Awaited<ReturnType<typeof beginProcedureReport>> | null>(null);

  const loadSynchronizationOverview = async () => {
    const [rawConfig, rawRuntimeStatus] = await Promise.all([
      getAppSetting(synchronizationConfigKey),
      getAppSetting(synchronizationRuntimeStatusKey)
    ]);
    setSyncConfig(parseSyncConfig(rawConfig));
    setSyncRuntimeStatus(parseSynchronizationRuntimeStatus(rawRuntimeStatus));
  };

  const prepareCompleteSynchronization = async (force = false, afterConnection = false): Promise<boolean> => {
    setSyncPreparing(true);
    preparationFailure.current = "";
    try {
      const configured = await enableCompleteAutomaticMicrosoft365Sync(force);
      setSyncConfig(configured);
      setConnectionError("");
      if (afterConnection && synchronizeAfterConnection) {
        const outcome = await synchronizeAfterConnection();
        await loadSynchronizationOverview();
        if (outcome === "error" || outcome === "skipped") {
          preparationFailure.current = "Microsoft 365 verbunden, aber die anschließende Synchronisierung wurde nicht bestätigt.";
          setConnectionError("Microsoft 365 ist verbunden. Einige Informationen konnten nicht vollständig geladen werden. Bitte erneut synchronisieren oder die EDV informieren.");
          return false;
        }
      } else {
        window.dispatchEvent(new Event(calendarChangedEventName));
      }
      return true;
    } catch (error) {
      preparationFailure.current = error instanceof Error ? error.message : String(error);
      setMessageType("error");
      setMessage(`Die automatische Synchronisierung konnte nicht eingerichtet werden: ${error}`);
      return false;
    } finally {
      setSyncPreparing(false);
    }
  };

  const loadStatus = async () => {
    try {
      const nextStatus = await getMicrosoft365ConnectionStatus();
      setStatus(nextStatus);
      try {
        await loadSynchronizationOverview();
      } catch {
        // The account remains connected even if the local status card cannot be read yet.
      }
      if (nextStatus.connected) await prepareCompleteSynchronization(false);
    } catch (error) {
      await reportMicrosoft365Failure(`Verbindungsstatus konnte nicht geladen werden: ${error}`);
      setStatus(emptyStatus);
      setMessageType("error");
      setMessage(`Microsoft-365-Status konnte nicht geladen werden: ${error}`);
    } finally {
      setOverviewLoading(false);
    }
  };

  useEffect(() => {
    loadStatus();
    return () => {
      pollingRef.current = false;
    };
  }, []);

  useEffect(() => {
    const handleAutomaticSync = (event: Event) => {
      const detail = (event as CustomEvent<CalendarAutomaticSyncStatus>).detail;
      if (detail) {
        setMessageType(detail.state);
        setMessage(detail.message);
      }
      void loadSynchronizationOverview();
    };
    window.addEventListener(calendarAutomaticSyncStatusEventName, handleAutomaticSync);
    return () => window.removeEventListener(calendarAutomaticSyncStatusEventName, handleAutomaticSync);
  }, []);

  useEffect(() => {
    if (!deviceCode) return;
    pollingRef.current = true;
    let timeout: number | undefined;

    const poll = async () => {
      if (!pollingRef.current) return;
      try {
        const result = await pollMicrosoft365Connection();
        if (result.state === "connected") {
          pollingRef.current = false;
          setDeviceCode(null);
          setBusyAction("connect");
          setStatus({ configured: true, connected: true, account: result.account });
          const ready = await prepareCompleteSynchronization(true, true);
          await finishProcedureReport(loginReport.current, ready ? "success" : "error", ready ? "Microsoft-365-Anmeldung und Einrichtung bestätigt." : preparationFailure.current, result.account?.email || result.account?.userPrincipalName || "");
          if (ready) {
            setMessageType("success");
            setMessage("Microsoft 365 wurde verbunden. Kontakte und Kalender werden jetzt automatisch synchronisiert.");
          }
          setBusyAction(null);
          return;
        }
        timeout = window.setTimeout(
          poll,
          Math.max(3, result.intervalSeconds || deviceCode.intervalSeconds) * 1000
        );
      } catch (error) {
        pollingRef.current = false;
        await finishProcedureReport(loginReport.current, "error", String(error));
        setDeviceCode(null);
        setBusyAction(null);
        setMessageType("error");
        setMessage(`Microsoft-365-Anmeldung wurde nicht abgeschlossen: ${error}`);
      }
    };

    timeout = window.setTimeout(poll, Math.max(2, deviceCode.intervalSeconds) * 1000);
    return () => {
      pollingRef.current = false;
      if (timeout) window.clearTimeout(timeout);
    };
  }, [deviceCode]);

  const connect = async (chooseAccount = false) => {
    setBusyAction("connect");
    setMessage("");
    setConnectionError("");
    try {
      loginReport.current = await beginProcedureReport("m365_login");
      await showM365LoadingFrame();
      const account = await (chooseAccount ? connectMicrosoft365Interactively() : connectMicrosoft365WithWindowsAccount());
      setStatus({ configured: true, connected: true, account });
      const synchronizationReady = await prepareCompleteSynchronization(true, true);
      await finishProcedureReport(loginReport.current, synchronizationReady ? "success" : "error", synchronizationReady ? "Microsoft-365-Anmeldung und Einrichtung bestätigt." : preparationFailure.current, account.email || account.userPrincipalName || "");
      setShowCodeFallback(false);
      if (synchronizationReady) {
        setMessageType("success");
        setMessage("Microsoft 365 wurde verbunden. Kontakte und Kalender werden jetzt automatisch synchronisiert.");
      } else {
        setConnectionError((current) => current || "Microsoft 365 ist verbunden, aber die automatische Synchronisierung konnte nicht eingerichtet werden. Bitte „Automatik einschalten“ wählen oder die EDV informieren.");
      }
    } catch (error) {
      setShowCodeFallback(chooseAccount);
      await finishProcedureReport(loginReport.current, "error", String(error));
      setConnectionError(chooseAccount
        ? "Die Anmeldung wurde nicht abgeschlossen. Bitte erneut versuchen oder die EDV kontaktieren."
        : "Die automatische Anmeldung konnte nicht abgeschlossen werden. Bitte die EDV kontaktieren; Sie müssen hier kein Kennwort eingeben.");
      setMessageType("error");
      setMessage(`Microsoft-365-Anmeldung wurde nicht abgeschlossen: ${error}`);
    } finally {
      setBusyAction(null);
    }
  };

  const connectWithCode = async () => {
    setBusyAction("device-code");
    setMessage("");
    try {
      loginReport.current = await beginProcedureReport("m365_login");
      const code = await startMicrosoft365Connection();
      setDeviceCode(code);
      setMessageType("info");
      setMessage("Alternative Anmeldung: Geben Sie den angezeigten Code bei Microsoft ein.");
      await openMicrosoft365SignIn();
    } catch (error) {
      await finishProcedureReport(loginReport.current, "error", String(error));
      setBusyAction(null);
      setMessageType("error");
      setMessage(`Alternative Microsoft-Anmeldung konnte nicht gestartet werden: ${error}`);
    }
  };

  const cancelConnection = async () => {
    await finishProcedureReport(loginReport.current, "cancelled", "Anmeldung vom Benutzer abgebrochen.");
    pollingRef.current = false;
    setDeviceCode(null);
    setBusyAction(null);
    try {
      await cancelMicrosoft365Connection();
    } catch {
      // The short-lived code expires on its own; cancellation remains safe locally.
    }
    setMessageType("info");
    setMessage("Anmeldung wurde abgebrochen.");
  };

  const copyCode = async () => {
    if (!deviceCode) return;
    try {
      await writeText(deviceCode.userCode);
      setMessageType("success");
      setMessage("Anmeldecode wurde kopiert.");
    } catch (error) {
      setMessageType("error");
      setMessage(`Anmeldecode konnte nicht kopiert werden: ${error}`);
    }
  };

  const testConnection = async () => {
    const report = await beginProcedureReport("m365_login", status?.account?.email || status?.account?.userPrincipalName || "");
    setBusyAction("test");
    setMessage("");
    try {
      const refreshed = await testMicrosoft365Connection();
      if (!refreshed.connected) throw new Error("Microsoft-365-Verbindung wurde nicht bestätigt.");
      await finishProcedureReport(report, "success", "Microsoft-365-Verbindung geprüft.", refreshed.account?.email || refreshed.account?.userPrincipalName || "");
      setStatus(refreshed);
      setMessageType("success");
      setMessage("Verbindung zu Microsoft 365 wurde erfolgreich geprüft.");
    } catch (error) {
      setMessageType("error");
      await finishProcedureReport(report, "error", error instanceof Error ? error.message : String(error), status?.account?.email || "");
      setMessage(`Microsoft-365-Verbindung konnte nicht bestätigt werden: ${error}`);
    } finally {
      setBusyAction(null);
    }
  };

  const disconnect = async () => {
    if (!window.confirm("Microsoft-365-Konto von dieser App trennen?\n\nKontakte, Kalender und Daten in Microsoft 365 werden dadurch nicht gelöscht.")) {
      return;
    }
    setBusyAction("disconnect");
    setMessage("");
    try {
      await disconnectMicrosoft365Account();
      setStatus({ configured: status?.configured ?? true, connected: false, account: null });
      setMessageType("success");
      setMessage("Microsoft-365-Konto wurde von dieser App getrennt.");
    } catch (error) {
      setMessageType("error");
      setMessage(`Microsoft-365-Konto konnte nicht getrennt werden: ${error}`);
    } finally {
      setBusyAction(null);
    }
  };

  const synchronizeEverythingNow = async () => {
    if (!automaticSyncActive) {
      if (await prepareCompleteSynchronization(true)) {
        setMessageType("success");
        setMessage("Die automatische Synchronisierung für Kontakte und Kalender ist jetzt aktiv.");
      }
      return;
    }
    setMessageType("info");
    setMessage("Kontakte und Kalender werden jetzt geprüft …");
    window.dispatchEvent(new Event(calendarChangedEventName));
  };

  const automaticSyncActive = syncConfig.enabled && !syncConfig.paused;
  const contactsSyncActive = automaticSyncActive && syncConfig.contacts;
  const calendarsSyncActive = automaticSyncActive && syncConfig.calendars;

  if (!status) {
    return (
      <div className="page m365-page">
        <M365Loading active message="Microsoft-365-Verbindung wird geprüft. Bitte warten …" />
        <section className="form-panel m365-loading">
          <LoaderCircle className="spin" size={28} />
          <p>Microsoft-365-Verbindung wird geprüft …</p>
        </section>
      </div>
    );
  }

  return (
    <div className="page m365-page">
      <M365Loading active={overviewLoading || (busyAction !== null && !deviceCode) || syncPreparing} message="Microsoft 365 wird eingerichtet. Bitte warten und die Anwendung nicht schließen." />
      <header className="page-header">
        <div>
          <h2>{title}</h2>
          <p>Geschäftskonto für Kontakte und Kalender sicher verbinden.</p>
        </div>
      </header>

      <StatusMessage message={message} type={messageType} />
      {connectionError && <div className="m365-sync-error" role="alert"><CircleAlert size={19} /><span>{connectionError}</span></div>}

      {!status.configured && (
        <section className="form-panel m365-configuration-card">
          <div className="m365-card-icon"><ShieldCheck size={28} /></div>
          <div>
            <h3>Einrichtung durch die EDV erforderlich</h3>
            <p>
              Die Microsoft-Anwendung ist in diesem Build noch nicht hinterlegt. Die EDV muss
              einmalig Mandanten-ID und Anwendungs-ID für DMH Backup eintragen.
              Lokale Funktionen bleiben vollständig verfügbar.
            </p>
          </div>
        </section>
      )}

      {status.configured && !status.connected && !deviceCode && (
        <section className="form-panel m365-connect-card">
          <div className="m365-hero">
            <div className="m365-card-icon microsoft"><Cloud size={30} /></div>
            <div>
              <h3>Mit Microsoft 365 verbinden</h3>
              <p>
                Ihr vorhandenes Windows-/Office-Geschäftskonto wird im Hintergrund geprüft.
                Es öffnet sich kein zusätzliches Anmeldefenster.
              </p>
            </div>
          </div>
          <div className="m365-privacy-note">
            <ShieldCheck size={21} />
            <p>
              Die App verwendet Kontakte und Kalender nur im Rahmen Ihrer bestehenden
              Berechtigungen. Ihr Microsoft-Kennwort wird niemals gelesen oder gespeichert.
            </p>
          </div>
          <button className="primary large m365-connect-button" type="button" onClick={() => void connect()} disabled={busyAction !== null}>
            {busyAction === "connect" ? <LoaderCircle className="spin" size={22} /> : <Cloud size={22} />}
            {busyAction === "connect" ? "Microsoft-Anmeldung läuft …" : "Mit Microsoft 365 verbinden"}
          </button>
          <button className="m365-code-fallback" type="button" onClick={() => void connect(true)} disabled={busyAction !== null}>
            Anderes Konto verwenden
          </button>
          {showCodeFallback && busyAction === null && (
            <button className="m365-code-fallback" type="button" onClick={connectWithCode}>
              Anmeldung mit Code verwenden
            </button>
          )}
        </section>
      )}

      {deviceCode && (
        <section className="form-panel m365-device-card" aria-live="polite">
          <div className="m365-hero">
            <div className="m365-card-icon microsoft"><KeyRound size={29} /></div>
            <div>
              <h3>Microsoft-Anmeldung abschließen</h3>
              <p>Geben Sie diesen einmaligen Code im geöffneten Microsoft-Fenster ein.</p>
            </div>
          </div>
          <div className="m365-device-code-row">
            <strong>{deviceCode.userCode}</strong>
            <button type="button" onClick={copyCode}><Copy size={19} /> Code kopieren</button>
          </div>
          <div className="m365-device-actions">
            <button className="primary" type="button" onClick={openMicrosoft365SignIn}>
              <ExternalLink size={19} /> Microsoft-Anmeldung öffnen
            </button>
            <button type="button" onClick={cancelConnection}><X size={19} /> Abbrechen</button>
          </div>
          <p className="m365-waiting">
            <LoaderCircle className="spin" size={19} />
            Die App wartet auf Ihre Bestätigung. Dieses Fenster kann geöffnet bleiben.
          </p>
        </section>
      )}

      {status.connected && status.account && (
        <>
          <section className="form-panel m365-account-card">
            <div className="m365-account-summary">
              <div>
                <h3><CheckCircle2 size={16} className="m365-account-status-icon" aria-label="Verbunden" />{status.account.displayName}</h3>
                <p>{status.account.email || status.account.userPrincipalName}</p>
              </div>
            </div>
            <div className="inline-actions">
              <button type="button" onClick={testConnection} disabled={busyAction !== null}>
                <RefreshCw className={busyAction === "test" ? "spin" : ""} size={19} /> Verbindung prüfen
              </button>
              <button className="danger-button" type="button" onClick={disconnect} disabled={busyAction !== null}>
                <LogOut size={19} /> Konto trennen
              </button>
            </div>
            <OutlookAccountSummary
              key={`${status.account.id}:${status.account.email || status.account.userPrincipalName}`}
              email={status.account.email || status.account.userPrincipalName}
            />
          </section>

          <section className="form-panel m365-sync-overview">
            <div className="m365-sync-heading">
              <div>
                <h3>Automatische Synchronisierung</h3>
              </div>
            </div>

            {/* Background synchronization diagnostics are sent to EDV reports.
                User-initiated setup failures use the actionable connection notice above. */}

            <div className="m365-sync-areas">
              <article className={contactsSyncActive ? "active" : ""}>
                <span className="m365-sync-area-icon"><ContactRound size={19} /></span>
                <div className="m365-sync-area-copy">
                  <div className="m365-sync-area-heading">
                    <strong>Kontakte</strong>
                    <span>{contactsSyncActive ? "Automatisch" : "Aus"}</span>
                  </div>
                  <div className="m365-sync-area-time">Zuletzt geprüft: <time>{formatSyncTime(syncRuntimeStatus.contactsLastCheckedAt)}</time></div>
                </div>
              </article>
              <article className={calendarsSyncActive ? "active" : ""}>
                <span className="m365-sync-area-icon"><CalendarDays size={19} /></span>
                <div className="m365-sync-area-copy">
                  <div className="m365-sync-area-heading">
                    <strong>Kalender & Teams</strong>
                    <span>{calendarsSyncActive ? "Automatisch" : "Aus"}</span>
                  </div>
                  <div className="m365-sync-area-time">Zuletzt geprüft: <time>{formatSyncTime(syncRuntimeStatus.calendarsLastCheckedAt)}</time></div>
                </div>
              </article>
            </div>

            <OutlookExchangeProfileSetup
              key={`${status.account.id}:${status.account.email || status.account.userPrincipalName}`}
              email={status.account.email || status.account.userPrincipalName}
              disabled={busyAction !== null || m365SafeImportTestMode}
              compact
              leadingAction={
                <button type="button" onClick={() => void synchronizeEverythingNow()} disabled={syncPreparing}>
                  <RefreshCw size={18} /> {automaticSyncActive ? "Jetzt alles synchronisieren" : "Automatik einschalten"}
                </button>
              }
            />
          </section>
        </>
      )}
    </div>
  );
}
