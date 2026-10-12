import { invoke as nativeInvoke } from "@tauri-apps/api/core";
import type { SyncFailure } from "../types/m365";

export interface DiagnosticMessage {
  origin: string; level: "success" | "info" | "warning" | "error";
  entityKind?: string; entityId?: string; title?: string; startsAt?: string; operation?: string; message: string;
  occurredAt?: string;
}
const notices = new Map<string, string>();
const noticeDetails = new Map<string, string[]>();
export function notificationDetails(message: string): string[] { return noticeDetails.get(message) ?? []; }
const recentDiagnostics = new Map<string, number>();

class UserOperationError extends Error {
  constructor(public readonly technicalMessage: string, private readonly publicMessage: string) { super(technicalMessage); this.name = "UserOperationError"; }
  toString() { return this.publicMessage; }
}

export function isTechnicalMessage(message: string): boolean {
  return /HTTP\s?\d{3}|Microsoft Graph|Error[A-Z]\w+|UNIQUE constraint|constraint failed|Sqlite|rusqlite|SQLSTATE|database is (?:locked|malformed)|no such table|syntax error|disk I\/O error|not a database|stack trace|TypeError|ReferenceError|HRESULT|os error|Bearer |access_token|refresh_token/i.test(message);
}

export function publicNotification(message: string): string | null {
  if (!message) return null;
  // Explicitly registered, item-specific outbound failures are the only sync
  // notifications shown. Never infer permanence from retry counts or "error".
  for (const [key, value] of notices) if (message.includes(key)) return value;
  if (/Kalenderänderung konnte nicht sicher gespeichert|Änderungen konnten nicht gespeichert|Datenbank.*(?:beschädigt|nicht.*öffnen)|App.*nicht.*(?:öffnen|starten)/i.test(message) && !isTechnicalMessage(message)) {
    return "Die Änderung konnte nicht sicher gespeichert oder geöffnet werden. Bitte die App nicht schließen und die EDV informieren.";
  }
  return null;
}

export function inlineMessage(message: string): string {
  return isTechnicalMessage(message) ? "Diese Aktion konnte nicht abgeschlossen werden. Bitte die EDV informieren." : message;
}

export async function reportDiagnostic(entry: DiagnosticMessage): Promise<void> {
  if (!entry.message.trim() || !("__TAURI_INTERNALS__" in window)) return;
  const key = JSON.stringify(entry);
  const previous = recentDiagnostics.get(key);
  if (previous !== undefined && Date.now() - previous < 15_000) return;
  try {
    await nativeInvoke("record_ui_diagnostic", { entry: { ...entry, occurredAt: entry.occurredAt ?? new Date().toISOString() } });
    recentDiagnostics.set(key, Date.now());
    if (recentDiagnostics.size > 500) {
      for (const [id, at] of recentDiagnostics) if (Date.now() - at > 15_000) recentDiagnostics.delete(id);
    }
  } catch {
    // A logging failure must not pretend a save succeeded or create an alert loop.
  }
}

export function notifyExchangeFailures(failures: SyncFailure[] = []): string | undefined {
  const actionable = failures.filter((failure) => failure.userMessage && failure.entityId && !["category", "category-fallback", "outbox:category"].includes(failure.operation));
  if (!actionable.length) return undefined;
  const unique = new Map(actionable.map((failure) => [`${failure.entityId}:${failure.userMessage}`, failure]));
  const messages = [...unique.values()].map((failure) => {
    const date = failure.startsAt ? new Date(failure.startsAt) : null;
    const when = date && !Number.isNaN(date.getTime()) ? ` (${date.toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short" })})` : "";
    return `${failure.entityKind === "calendar" ? "Termin" : "Kontakt"} „${failure.title.trim() || "Ohne Titel"}“${when} konnte nicht an Exchange übertragen werden. ${failure.userMessage}`;
  });
  const message = messages.length === 1 ? messages[0] : `${messages[0]}\n\n${messages.length - 1} weitere Einträge benötigen eine Korrektur.`;
  if (messages.length > 1) noticeDetails.set(message, messages.slice(1));
  notices.set(message, message);
  if (notices.size > 100) notices.delete(notices.keys().next().value!);
  return message;
}

export async function invokeWithDiagnostics<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  try { return await nativeInvoke<T>(command, args); }
  catch (error) {
    const values = args?.event ?? args?.events ?? args?.contact ?? args?.contacts ?? args?.input ?? args?.entry ?? args?.request ?? args;
    const affected = Array.isArray(values) ? values : [values];
    const errorText = error instanceof Error ? error.message : String(error);
    let userError: UserOperationError | undefined;
    if (/^(?:save_calendar_events|save_contact|save_contacts|save_vault_entry|restore_backup|restore_automatic_backup|set_vault_protection)$/.test(command)) {
      const labels = affected.filter((item) => item && typeof item === "object").map((item) => typeof item.title === "string" ? `Termin „${item.title}“ (${item.startsAt ?? ""})` : typeof item.displayName === "string" ? `Kontakt „${item.displayName}“` : "Eintrag");
      const notice = `${labels.join("; ") || "Die angeforderte Änderung"} konnte nicht sicher gespeichert werden. Bitte die App nicht schließen und die EDV informieren.`;
      notices.set(notice, notice);
      userError = new UserOperationError(errorText, notice);
    }
    for (const values of affected) {
    const item = values && typeof values === "object" ? values as Record<string, unknown> : {};
    await reportDiagnostic({ origin: `native:${command}`, level: "error", operation: command,
      entityId: typeof item.id === "string" || typeof item.id === "number" ? String(item.id) : typeof item.itemId === "string" ? item.itemId : undefined,
      title: typeof item.title === "string" ? item.title : typeof item.displayName === "string" ? item.displayName : typeof item.platform === "string" ? item.platform : typeof item.name === "string" ? item.name : undefined,
      startsAt: typeof item.startsAt === "string" ? item.startsAt : undefined,
      entityKind: command.includes("calendar") ? "calendar" : command.includes("contact") ? "contact" : "notification",
      message: errorText });
    }
    // Preserve the actual error for recovery/retry logic. UI text passes through
    // the notification policy; technical data is never substituted for state.
    throw userError ?? error;
  }
}
