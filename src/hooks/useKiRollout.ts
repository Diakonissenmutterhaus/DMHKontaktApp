import { useCallback, useEffect, useRef, useState } from "react";
import { invokeWithDiagnostics } from "../utils/notificationPolicy";

export interface KiRolloutPolicy { schemaVersion: 1; enabled: boolean; activateAt: string | null; updatedAt: string }
export interface KiRolloutStatus { policy: KiRolloutPolicy | null; lastCheckedAt: string | null; lastSuccessAt: string | null; error: string | null }
const empty: KiRolloutStatus = { policy: null, lastCheckedAt: null, lastSuccessAt: null, error: null };
export function isKiRolloutActive(policy: KiRolloutPolicy | null, now = Date.now()): boolean {
  return Boolean(policy?.schemaVersion === 1 && policy.enabled && (!policy.activateAt || Date.parse(policy.activateAt) <= now));
}

export function useKiRollout(ready = true) {
  const [status, setStatus] = useState<KiRolloutStatus>(empty);
  const [refreshing, setRefreshing] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const alive = useRef(false);
  const pending = useRef<Promise<void> | null>(null);
  const refresh = useCallback((): Promise<void> => {
    if (pending.current) return pending.current;
    if (!ready || !("__TAURI_INTERNALS__" in window)) return Promise.resolve();
    setRefreshing(true);
    const job = invokeWithDiagnostics<KiRolloutStatus>("get_ki_rollout_status", { refresh: true })
      .then((next) => { if (alive.current && next) setStatus(next); })
      .catch(() => { if (alive.current) setStatus((current) => ({ ...current, error: "Zentrale Freigabe konnte nicht geprüft werden." })); })
      .finally(() => { pending.current = null; if (alive.current) setRefreshing(false); });
    pending.current = job;
    return job;
  }, [ready]);
  useEffect(() => {
    if (!ready) return;
    alive.current = true;
    let cancelled = false;
    // Load cached schedules first, including when the PC starts offline.
    if ("__TAURI_INTERNALS__" in window) void invokeWithDiagnostics<KiRolloutStatus>("get_ki_rollout_status", { refresh: false })
      .then((next) => { if (!cancelled && next) setStatus(next); })
      .catch(() => undefined).finally(() => { if (!cancelled) void refresh(); });
    const poll = window.setInterval(() => { void refresh(); }, 60_000);
    const onVisible = () => { if (!document.hidden) void refresh(); };
    const onOnline = () => { void refresh(); };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", onOnline);
    return () => {
      cancelled = true; alive.current = false;
      window.clearInterval(poll);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", onOnline);
    };
  }, [refresh, ready]);
  useEffect(() => {
    let timer: number | undefined;
    const update = () => {
      window.clearTimeout(timer);
      setEnabled(isKiRolloutActive(status.policy));
      const target = status.policy?.enabled && status.policy.activateAt ? Date.parse(status.policy.activateAt) : NaN;
      if (target > Date.now()) timer = window.setTimeout(update, Math.min(target - Date.now(), 2_147_000_000));
    };
    update();
    document.addEventListener("visibilitychange", update);
    return () => { window.clearTimeout(timer); document.removeEventListener("visibilitychange", update); };
  }, [status.policy]);
  return { status, refreshing, refresh, enabled };
}
