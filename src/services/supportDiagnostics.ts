import { invoke } from "@tauri-apps/api/core";

export const supportDiagnosticEvent = "dmh:support-diagnostic";
export interface SupportDiagnosticRequest {
  attemptId: string;
  procedure: "m365_login" | "outlook_exchange";
  stage: string;
  message: string;
}
export interface SupportDiagnosticReport {
  code: string;
  fileName: string;
  text: string;
  localPath: string | null;
  saveError: string | null;
}
export interface SupportDiagnosticState {
  request: SupportDiagnosticRequest;
  loading: boolean;
  report?: SupportDiagnosticReport;
  collectionError?: string;
}
let current: SupportDiagnosticState | null = null;
const captured = new Set<string>();
const sanitize = (message: string) => /bearer\s|access_token|refresh_token|id_token|client_secret|password|passwort|kennwort|authorization|eyJ/i.test(message)
  ? "Technische Meldung enthält möglicherweise Zugangsdaten und wurde ausgeblendet." : message.slice(0, 12000);

export const getSupportDiagnostic = () => current;
function publish(value: SupportDiagnosticState) {
  current = value;
  window.dispatchEvent(new Event(supportDiagnosticEvent));
}
export function captureSupportDiagnostic(request: SupportDiagnosticRequest) {
  if (import.meta.env.VITE_DMH_SUPPORT_DIAGNOSTICS !== "true" || captured.has(request.attemptId)) return;
  captured.add(request.attemptId);
  if (captured.size > 100) captured.delete(captured.values().next().value!);
  const safeRequest = { ...request, message: sanitize(request.message) };
  publish({ request: safeRequest, loading: true });
  // No network, retries, auth calls or migration calls. Native collection has a timeout.
  void invoke<SupportDiagnosticReport>("collect_support_diagnostic", { request: safeRequest }).then((report) => {
    if (current?.request.attemptId === request.attemptId) publish({ request: safeRequest, loading: false, report });
  }).catch((error: unknown) => {
    if (current?.request.attemptId === request.attemptId) publish({ request: safeRequest, loading: false, collectionError: sanitize(String(error)) });
  });
}
