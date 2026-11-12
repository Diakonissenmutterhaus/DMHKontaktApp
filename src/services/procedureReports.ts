import { invoke } from "@tauri-apps/api/core";
type Report = { attemptId: string; procedure: "m365_login" | "outlook_exchange" | "diagnostics"; sequence: number; done: boolean };
// Report delivery must never mask or replace the original procedure result.
const send = (event: object) => Promise.resolve().then(() => invoke("record_procedure_report", { event })).catch(() => undefined).finally(() => window.dispatchEvent(new Event("dmh:procedure-reports-changed")));
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
  const flush = () => { void invoke("flush_procedure_reports").catch(() => undefined); };
  flush(); const timer = window.setInterval(flush, 60_000); window.addEventListener("online", flush);
  return () => { window.clearInterval(timer); window.removeEventListener("online", flush); };
}
