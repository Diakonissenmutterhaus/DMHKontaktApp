import { saveUpdateHealth } from "../services/workstationHealth";
import { CircleAlert, DownloadCloud, LoaderCircle } from "lucide-react";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { isTauri } from "@tauri-apps/api/core";
import { check } from "@tauri-apps/plugin-updater";
import { getAppUpdatePolicy, installAppUpdate } from "../services/appUpdates";
import { reportDiagnostic } from "../utils/notificationPolicy";
import { m365SafeImportTestMode } from "../utils/automaticCalendarSync";
import "./UpdateNotifier.css";

type AvailableUpdate = NonNullable<Awaited<ReturnType<typeof check>>>;
type UpdateStatus = "available" | "checking" | "downloading" | "installing" | "managed" | "error";

export const updateAvailableEvent = "dmh:update-available";
const dismissedUpdateKey = "agendakontakte.dismissedUpdateVersion";
const retryDelayMs = 60_000;
const regularCheckDelayMs = 30 * 60_000;
const snoozeDelayMs = 4 * 60 * 60_000;
const managedMessage = "Updates werden auf diesem PC durch die EDV verteilt. Sie müssen nichts installieren.";

function updateIsSnoozed(version: string): boolean {
  const rawValue = localStorage.getItem(dismissedUpdateKey);
  if (!rawValue) return false;
  try {
    const snooze = JSON.parse(rawValue) as { version?: unknown; until?: unknown };
    return snooze.version === version && typeof snooze.until === "number" && snooze.until > Date.now();
  } catch {
    // The old permanent version-only snooze must not hide updates forever.
    return false;
  }
}

function UpdateProgress({ message, progress, version }: { message: string; progress: number | null; version: string }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const id = useId();
  useLayoutEffect(() => {
    const previousFocus = document.activeElement;
    const panel = dialog.current!;
    if (panel.showModal) panel.showModal(); else panel.setAttribute("open", "");
    panel.focus();
    return () => {
      if (panel.close) panel.close();
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
    };
  }, []);
  return createPortal(
    <dialog ref={dialog} className="app-update-window" tabIndex={-1} aria-modal="true" aria-busy="true"
      aria-labelledby={id} aria-describedby={id + "-hint"} onCancel={(event) => event.preventDefault()}
      onKeyDown={(event) => { if (event.key === "Tab" || event.key === "Escape") event.preventDefault(); }}>
      <header><DownloadCloud size={18} aria-hidden="true" /><strong id={id}>DMH Backup aktualisieren</strong><span>Version {version}</span></header>
      <div className="app-update-content">
        <p role="status"><LoaderCircle className="spin" size={20} aria-hidden="true" />{message}</p>
        <div className={"app-update-meter" + (progress === null ? " indeterminate" : "")}>
          <progress aria-label="Update-Fortschritt" max={100} value={progress ?? undefined} />
        </div>
        <small id={id + "-hint"}>Bitte warten und die App geöffnet lassen. DMH Backup startet anschließend automatisch neu.</small>
      </div>
    </dialog>, document.body,
  );
}

export function UpdateNotifier() {
  const [availableUpdate, setAvailableUpdate] = useState<AvailableUpdate | null>(null);
  const [status, setStatus] = useState<UpdateStatus>("available");
  const [message, setMessage] = useState("");
  const [progress, setProgress] = useState<number | null>(null);
  // Synchronous lock covers double clicks and checks resolving during install.
  const installing = useRef(false);

  useEffect(() => {
    if (!isTauri() || m365SafeImportTestMode) return;
    let cancelled = false;
    let checking = false;
    let timer: number | undefined;
    const schedule = (delay: number) => {
      if (timer !== undefined) window.clearTimeout(timer);
      if (!cancelled) timer = window.setTimeout(runCheck, delay);
    };
    const runCheck = async () => {
      if (checking) return;
      if (installing.current) { schedule(regularCheckDelayMs); return; }
      checking = true;
      try {
        const nextUpdate = await check();
        if (cancelled) return;
        saveUpdateHealth(nextUpdate?.version ?? null);
        if (!installing.current && nextUpdate && !updateIsSnoozed(nextUpdate.version)) {
          setAvailableUpdate(nextUpdate);
          setStatus("available");
          setMessage("");
        }
        schedule(regularCheckDelayMs);
      } catch (error) {
        if (cancelled) return;
        saveUpdateHealth(null, true);
        console.warn("DMH Backup update check failed:", error);
        schedule(retryDelayMs);
      } finally { checking = false; }
    };
    const handleOnline = () => { if (!installing.current) void runCheck(); };
    const handleManualUpdate = (event: Event) => {
      const detail = (event as CustomEvent<{ force?: boolean; update?: AvailableUpdate }>).detail;
      const nextUpdate = detail?.update;
      if (installing.current || !nextUpdate || (!detail.force && updateIsSnoozed(nextUpdate.version))) return;
      setAvailableUpdate(nextUpdate);
      setStatus("available");
      setMessage("");
      setProgress(null);
    };
    schedule(1500);
    window.addEventListener("online", handleOnline);
    window.addEventListener(updateAvailableEvent, handleManualUpdate);
    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
      window.removeEventListener("online", handleOnline);
      window.removeEventListener(updateAvailableEvent, handleManualUpdate);
    };
  }, []);

  if (!availableUpdate) return null;
  const dismiss = () => {
    localStorage.setItem(dismissedUpdateKey, JSON.stringify({ version: availableUpdate.version, until: Date.now() + snoozeDelayMs }));
    setAvailableUpdate(null);
  };
  const installUpdate = async () => {
    if (installing.current) return;
    installing.current = true;
    setStatus("checking");
    setProgress(null);
    setMessage("Aktualisierung wird vorbereitet …");
    try {
      const policy = await getAppUpdatePolicy();
      if (!policy?.canSelfUpdate) {
        setStatus("managed");
        setMessage(managedMessage);
        void reportDiagnostic({ origin: "UpdateNotifier", operation: "update_policy", level: "info", message: "Self-update deferred to EDV: " + (policy?.reason ?? "unknown_installation") });
        return;
      }
      let downloaded = 0;
      let contentLength = 0;
      setStatus("downloading");
      setMessage("Update wird heruntergeladen …");
      await installAppUpdate(availableUpdate.rid, (event) => {
        if (event.event === "Started") {
          contentLength = event.data.contentLength ?? 0;
          downloaded = 0;
          setProgress(contentLength > 0 ? 0 : null);
        } else if (event.event === "Progress") {
          downloaded += event.data.chunkLength;
          if (contentLength > 0) {
            const percent = Math.min(100, Math.round(downloaded / contentLength * 100));
            setProgress(percent);
            setMessage("Update wird heruntergeladen … " + percent + " %");
          }
        } else if (event.event === "Installing") {
          // Download percentage is not installation progress. Stay indeterminate
          // until the Windows installer closes and restarts this process.
          setProgress(null);
          setStatus("installing");
          setMessage("Update wird installiert. DMH Backup startet neu …");
        }
      });
      throw new Error("update_installer_did_not_take_over");
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      const managed = detail.startsWith("update_managed:");
      setStatus(managed ? "managed" : "error");
      setMessage(managed ? managedMessage : "Die Aktualisierung konnte nicht abgeschlossen werden. Bitte später erneut versuchen oder die EDV informieren.");
      void reportDiagnostic({ origin: "UpdateNotifier", operation: "install_update", level: managed ? "info" : "error", message: detail });
    } finally { installing.current = false; }
  };

  const isWorking = status === "checking" || status === "downloading" || status === "installing";
  if (isWorking) return <UpdateProgress message={message} progress={progress} version={availableUpdate.version} />;
  const StatusIcon = status === "error" ? CircleAlert : DownloadCloud;
  return (
    <section className={"update-notifier " + status} role="dialog" aria-live="polite" aria-label="Update">
      <StatusIcon className="update-notifier-icon" size={26} aria-hidden="true" />
      <div className="update-notifier-copy">
        <strong>{status === "error" ? "Update nicht abgeschlossen" : status === "managed" ? "Updates durch die EDV" : "Neue Version verfügbar"}</strong>
        <p>{message || "Version " + availableUpdate.version + " kann jetzt installiert werden."}</p>
      </div>
      <div className="update-notifier-actions">
        {status === "available" && <><button className="primary" type="button" onClick={installUpdate}>Jetzt aktualisieren</button><button type="button" onClick={dismiss}>Später</button></>}
        {status === "error" && <button className="primary" type="button" onClick={installUpdate}>Erneut versuchen</button>}
        {(status === "error" || status === "managed") && <button type="button" onClick={dismiss}>Schließen</button>}
      </div>
    </section>
  );
}
