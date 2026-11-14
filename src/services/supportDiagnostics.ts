import { invoke } from "@tauri-apps/api/core";

export interface SupportDiagnosticRequest {
  attemptId: string;
  procedure: "m365_login" | "outlook_exchange" | "m365_sync";
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
const captured = new Set<string>();
const sanitize = (message: string) => /bearer\s|access_token|refresh_token|id_token|client_secret|password|passwort|kennwort|authorization|eyJ/i.test(message)
  ? "Technische Meldung enthält möglicherweise Zugangsdaten und wurde ausgeblendet." : message.slice(0, 12000);

export async function captureSupportDiagnostic(request: SupportDiagnosticRequest): Promise<SupportDiagnosticReport | undefined> {
  if (import.meta.env.VITE_DMH_SUPPORT_DIAGNOSTICS !== "true" || captured.has(request.attemptId)) return;
  captured.add(request.attemptId);
  if (captured.size > 100) captured.delete(captured.values().next().value!);
  const safeRequest = { ...request, message: sanitize(request.message) };
  // No authentication/migration retries. Delivery uses the durable reporting queue.
  try {
    const report = await invoke<SupportDiagnosticReport>("collect_support_diagnostic", { request: safeRequest });
    return report;
  } catch (error: unknown) {
    return { code: "DMH-DIAGNOSE-UNVOLLSTAENDIG", fileName: "", localPath: null, saveError: null,
      text: `Versuch: ${request.attemptId}\nVorgang: ${request.procedure}\nSchritt: ${request.stage}\nMeldung: ${safeRequest.message}\nDiagnose: ${sanitize(String(error))}` };
  }
}

export const sanitizeSupportLog = (text: string) => {
  const safe = text.slice(0, 60_000).split(/\r?\n/).map(sanitize).join("\n");
  return text.length > 60_000 || safe.length > 60_000 ? `${safe.slice(0, 59_900)}\n[Protokoll gekürzt; vollständige Kopie lokal gespeichert.]` : safe;
};
