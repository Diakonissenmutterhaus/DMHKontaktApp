import { invoke } from "@tauri-apps/api/core";
type Report = { attemptId: string; procedure: "m365_login" | "outlook_exchange" | "m365_sync" | "diagnostics"; sequence: number; done: boolean };
// Report delivery must never mask or replace the original procedure result.
const pendingKey = "dmh.procedure-report-retry.v1";
const pending = new Map<string, Record<string, unknown>>();
let retrying: Promise<void> | null = null;
function savePending() {
  try { localStorage.setItem(pendingKey, JSON.stringify([...pending.values()])); } catch { /* Keep the in-memory copy if browser storage is unavailable. */ }
}
async function retryPending() {
  if (retrying) return retrying;
  retrying = (async () => {
    for (const [id,event] of pending) {
      try { await invoke("record_procedure_report", {event}); pending.delete(id); savePending(); }
      catch { break; }
    }
  })();
  try { await retrying; } finally { retrying=null; }
}
const send = async (event: Record<string, unknown>) => {
  pending.set(String(event.eventId), {...event,accountEmail:typeof event.accountEmail === "string" ? event.accountEmail : "",occurredAt:new Date().toISOString()});
  savePending();
  await retryPending();
  window.dispatchEvent(new Event("dmh:procedure-reports-changed"));
};
export const sanitizeReportMessage = (value: string) => value.replace(/\bBearer\s+[^\s,;]+/gi, "Bearer [entfernt]")
  .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, "[Token entfernt]")
  .replace(/((?:password|passwort|kennwort|client_secret|access_token|refresh_token|id_token|authorization|code)\s*[=:]\s*)[^\s,;&]+/gi, "$1[entfernt]").slice(0, 1800);
export async function beginProcedureReport(procedure: Report["procedure"], accountEmail = ""): Promise<Report> {
  const report: Report = { attemptId: crypto.randomUUID(), procedure, sequence: 0, done: false };
  await send({ eventId: crypto.randomUUID(), attemptId: report.attemptId, sequence: 0, procedure, status: "running", accountEmail, step: "Start", message: "", profile: "" });
  return report;
}
export async function finishProcedureReport(report: Report | null, status: "success" | "error" | "cancelled" | "interrupted", message = "", accountEmail = "", profile = "") {
  if (!report || report.done) return;
  report.done = true;
  await send({ eventId: crypto.randomUUID(), attemptId: report.attemptId, sequence: ++report.sequence, procedure: report.procedure, status, accountEmail, step: status === "success" ? "Abschluss bestätigt" : "Abschluss nicht bestätigt", message: sanitizeReportMessage(message), profile });
}
export function startReportDelivery() {
  const flush = () => { void retryPending().then(()=>invoke("flush_procedure_reports")).catch(() => undefined); };
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(pendingKey) || "[]");
    if (Array.isArray(saved)) for (const entry of saved) {
      if (entry && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(entry.eventId) && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(entry.attemptId)
        && ["m365_login","outlook_exchange","m365_sync","diagnostics"].includes(entry.procedure)
        && ["running","success","error","cancelled","interrupted"].includes(entry.status)
        && Number.isInteger(entry.sequence) && entry.sequence>=0 && entry.sequence<=10000
        && ["accountEmail","step","message","profile","occurredAt"].every(key=>typeof entry[key] === "string")
        && entry.message.length<=1800 && entry.accountEmail.length<=300 && entry.step.length<=200 && entry.profile.length<=200
        && Number.isFinite(Date.parse(entry.occurredAt))) pending.set(entry.eventId, {...entry,message:sanitizeReportMessage(entry.message)});
    }
  } catch { /* Existing native outbox remains independent of this fallback. */ }
  flush(); const timer = window.setInterval(flush, 60_000); window.addEventListener("online", flush);
  return () => { window.clearInterval(timer); window.removeEventListener("online", flush); };
}

// Synchronization errors are distinct from authentication and Exchange-profile setup.
let syncFailure = "";
let syncFailureAt = 0;
export async function reportSynchronizationFailure(message: string, accountEmail = "") {
  const detail=sanitizeReportMessage(message), key=`${accountEmail}:${detail}`;
  if (syncFailure === key && Date.now()-syncFailureAt<15*60_000) return;
  syncFailure=key;syncFailureAt=Date.now();
  const report=await beginProcedureReport("m365_sync",accountEmail);
  await finishProcedureReport(report,"error",detail,accountEmail);
}
export async function reportSynchronizationRecovery(accountEmail = "", previousFailure = false) {
  if (!syncFailure && !previousFailure) return;
  syncFailure="";
  const report=await beginProcedureReport("m365_sync",accountEmail);
  await finishProcedureReport(report,"success","Synchronisierung wieder erfolgreich.",accountEmail);
}
export async function reportMicrosoft365Failure(message: string, accountEmail = "") {
  const report=await beginProcedureReport("m365_login",accountEmail);
  await finishProcedureReport(report,"error",message,accountEmail);
}
