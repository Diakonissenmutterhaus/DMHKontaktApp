import {
  applyMicrosoft365Sync,
  flushMicrosoft365CalendarOutbox,
  flushMicrosoft365ContactOutbox,
  getAppSetting,
  getMicrosoft365ConnectionStatus,
  getMicrosoft365ReadOnlyTestMode,
  setAppSetting
} from "../services/db";
import type { CalendarEvent } from "../types/calendar";
import type { Microsoft365SyncHistoryEntry, Microsoft365SyncResult } from "../types/m365";
import { parseSyncConfig, type SyncConfig } from "../types/sync";
import { calendarCategoryRulesStorageKey, mergeImportedCalendarCategories, mergeMicrosoft365CalendarCategories } from "./calendar";

export const synchronizationConfigKey = "synchronization_config_v1";
export const synchronizationHistoryKey = "synchronization_history_v1";
export const synchronizationRuntimeStatusKey = "synchronization_runtime_status_v1";
export const synchronizationRuntimeStatusUpdatedEventName = "dmh:synchronization-runtime-status-updated";
export const calendarChangedEventName = "dmh:calendar-changed";
export const contactChangedEventName = "dmh:contact-changed";
export const calendarStorageUpdatedEventName = "dmh:calendar-storage-updated";
export const calendarAutomaticSyncStatusEventName = "dmh:calendar-automatic-sync-status";
export const m365DataUpdatedEventName = "dmh:m365-data-updated";
export const m365SafeImportTestMode = import.meta.env.VITE_DMH_M365_SAFE_IMPORT === "true";

export interface CalendarAutomaticSyncStatus {
  state: "success" | "error";
  message: string;
}

export interface Microsoft365SynchronizationRuntimeStatus {
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  lastExchangeAt: string | null;
  contactsLastCheckedAt: string | null;
  calendarsLastCheckedAt: string | null;
  lastError: string | null;
}

export const emptyMicrosoft365SynchronizationRuntimeStatus: Microsoft365SynchronizationRuntimeStatus = {
  lastAttemptAt: null,
  lastSuccessAt: null,
  lastExchangeAt: null,
  contactsLastCheckedAt: null,
  calendarsLastCheckedAt: null,
  lastError: null
};

export function parseSynchronizationRuntimeStatus(raw: string | null): Microsoft365SynchronizationRuntimeStatus {
  if (!raw) return emptyMicrosoft365SynchronizationRuntimeStatus;
  try {
    const parsed = JSON.parse(raw) as Partial<Microsoft365SynchronizationRuntimeStatus>;
    return { ...emptyMicrosoft365SynchronizationRuntimeStatus, ...parsed };
  } catch {
    return emptyMicrosoft365SynchronizationRuntimeStatus;
  }
}

async function saveRuntimeStatus(status: Microsoft365SynchronizationRuntimeStatus): Promise<void> {
  await setAppSetting(synchronizationRuntimeStatusKey, JSON.stringify(status));
  window.dispatchEvent(new Event(synchronizationRuntimeStatusUpdatedEventName));
}

export type AutomaticSyncTrigger = "open" | "change" | "contact-change" | "poll" | "calendar-poll";

export function describeMicrosoft365SyncFailure(errors: number, messages: string[]): string {
  const detail = messages.find((message) => message.trim())?.trim();
  if (messages.some((message) => /HTTP (?:429|500|502|503|504)\b|ErrorInternalServerError|ErrorServerBusy/i.test(message))) {
    return "Microsoft 365 hat einen Serverfehler gemeldet. Lokale Änderungen bleiben gespeichert und werden erneut versucht. Falls der Fehler anhält, prüfen Sie die Verbindung.";
  }
  return detail
    ? `Exchange konnte ${errors} Änderung(en) noch nicht übernehmen: ${detail.slice(0, 300)}`
    : `Exchange konnte ${errors} Änderung(en) noch nicht übernehmen. Die Änderungen bleiben lokal gespeichert und werden erneut versucht.`;
}

export async function recordMicrosoft365SynchronizationError(error: unknown): Promise<void> {
  const previous = parseSynchronizationRuntimeStatus(await getAppSetting(synchronizationRuntimeStatusKey));
  await saveRuntimeStatus({
    ...previous,
    lastAttemptAt: new Date().toISOString(),
    lastError: error instanceof Error ? error.message : String(error)
  });
}

export async function recordMicrosoft365SynchronizationSuccess(
  config: SyncConfig,
  result: Microsoft365SyncResult,
  checked = { contacts: config.contacts, calendars: config.calendars }
): Promise<void> {
  const previous = parseSynchronizationRuntimeStatus(await getAppSetting(synchronizationRuntimeStatusKey));
  const exchangeCount = result.created + result.updated + result.deleted;
  const successful = result.errors === 0;
  await saveRuntimeStatus({
    ...previous,
    lastAttemptAt: result.finishedAt,
    lastSuccessAt: successful ? result.finishedAt : previous.lastSuccessAt,
    lastExchangeAt: successful && exchangeCount > 0 ? result.finishedAt : previous.lastExchangeAt,
    contactsLastCheckedAt: successful && checked.contacts ? result.finishedAt : previous.contactsLastCheckedAt,
    calendarsLastCheckedAt: successful && checked.calendars ? result.finishedAt : previous.calendarsLastCheckedAt,
    lastError: successful ? null : result.errorMessages.join(" · ") || `${result.errors} Fehler`
  });
}

function parseHistory(raw: string | null): Microsoft365SyncHistoryEntry[] {
  if (!raw) return [];
  try {
    const value: unknown = JSON.parse(raw);
    return Array.isArray(value) ? value.slice(0, 30) as Microsoft365SyncHistoryEntry[] : [];
  } catch {
    return [];
  }
}

export function announceMicrosoft365CalendarChanges(result: Pick<Microsoft365SyncResult, "calendarUpserts" | "calendarDeletes" | "calendarCategories" | "calendarCategoryRules">): void {
  const { calendarUpserts, calendarDeletes, calendarCategories = [] } = result;
  if (result.calendarCategoryRules) {
    localStorage.setItem(calendarCategoryRulesStorageKey, JSON.stringify(result.calendarCategoryRules));
    mergeMicrosoft365CalendarCategories([]);
  }
  if (calendarUpserts.length === 0 && calendarDeletes.length === 0 && calendarCategories.length === 0) return;
  // apply_m365_sync already committed the events and delta acknowledgements
  // atomically in SQLite before returning to the WebView.
  mergeImportedCalendarCategories(calendarUpserts);
  if (calendarCategories.length > 0) mergeMicrosoft365CalendarCategories(calendarCategories);
  window.dispatchEvent(new Event(calendarStorageUpdatedEventName));
}

export async function runAutomaticCalendarSync(trigger: AutomaticSyncTrigger): Promise<CalendarAutomaticSyncStatus | null> {
  if (!("__TAURI_INTERNALS__" in window)) return null;
  if (m365SafeImportTestMode && (trigger === "change" || trigger === "contact-change")) return null;
  if (m365SafeImportTestMode && !(await getMicrosoft365ReadOnlyTestMode())) {
    return { state: "error", message: "Sicherer Kalender-Test wurde abgebrochen: Das Schreibverbot in der nativen App ist nicht aktiv." };
  }
  const config = parseSyncConfig(await getAppSetting(synchronizationConfigKey));
  if (!config.enabled || config.paused || !config.providers.m365 || (!config.calendars && !config.contacts)) return null;
  if (trigger === "open" && !config.runOnOpen) return null;
  const fastCalendarPoll = m365SafeImportTestMode || trigger === "calendar-poll";
  const contactOnlyCycle = !m365SafeImportTestMode && (trigger === "poll" || trigger === "contact-change");
  const calendars = config.calendars && !contactOnlyCycle;
  if (fastCalendarPoll && !config.calendars) return null;
  if (calendars && config.selectedCalendarSourceIds.length === 0) {
    const message = "Automatische Synchronisierung ist aktiviert, aber es wurde kein Microsoft-365-Kalender ausgewählt.";
    await recordMicrosoft365SynchronizationError(message);
    return { state: "error", message };
  }
  const selectedContactSourceIds = config.contacts && config.selectedContactSourceIds.length === 0
    ? ["me:default-contacts"]
    : config.selectedContactSourceIds;

  const attemptedAt = new Date().toISOString();
  const connection = await getMicrosoft365ConnectionStatus();
  if (!connection.connected) {
    await saveRuntimeStatus({
      ...parseSynchronizationRuntimeStatus(await getAppSetting(synchronizationRuntimeStatusKey)),
      lastAttemptAt: attemptedAt,
      lastError: "Microsoft 365 ist momentan nicht verbunden."
    });
    return { state: "error", message: "Die Änderung wurde lokal gespeichert. Microsoft 365 ist momentan nicht verbunden." };
  }

  // Local calendar changes use a durable SQLite outbox. They are sent first
  // and are only removed after Microsoft Graph confirms the write. This avoids
  // re-scanning a 50,000-item calendar before a newly saved appointment can
  // leave the app.
  const emptyOutbox = { processed: 0, created: 0, updated: 0, deleted: 0, pending: 0, errors: 0, errorMessages: [] as string[] };
  const queued = m365SafeImportTestMode || !calendars ? emptyOutbox : await flushMicrosoft365CalendarOutbox({
    direction: config.direction,
    selectedCalendarSourceIds: config.selectedCalendarSourceIds,
    sourceDirections: config.sourceDirections,
    sharedCalendars: config.sharedCalendars,
    sharedMailboxAddresses: config.sharedMailboxAddresses
  }).catch((error: unknown) => ({ ...emptyOutbox, errors: 1, errorMessages: [String(error)] }));
  const queuedExchangeCount = queued.created + queued.updated + queued.deleted;
  if (queued.created > 0) window.dispatchEvent(new Event(calendarStorageUpdatedEventName));

  const queuedContacts = config.contacts && !fastCalendarPoll && trigger !== "change"
    ? await flushMicrosoft365ContactOutbox({
        direction: config.direction,
        contactGroups: config.contactGroups,
        selectedContactSourceIds,
        sourceDirections: config.sourceDirections,
        sharedMailboxes: config.sharedMailboxes,
        sharedMailboxAddresses: config.sharedMailboxAddresses
      })
    : emptyOutbox;
  const queuedContactCount = queuedContacts.created + queuedContacts.updated + queuedContacts.deleted;

  // Outbound calendar writes and inbound reconciliation are two independent
  // halves of the same cycle.  Finishing the cycle after flushing the outbox
  // meant that a busy local calendar could indefinitely starve changes made
  // in Exchange/Teams.  The full synchronizer now receives only calendar
  // sources that permit importing, and those sources are forced to import-only
  // here because outbound writes are already handled safely by the outbox.
  const inboundCalendarSourceIds = calendars
    ? config.selectedCalendarSourceIds.filter((sourceId) =>
        (config.sourceDirections[sourceId] ?? config.direction) !== "export")
    : [];
  const reconciliationSourceDirections = { ...config.sourceDirections };
  for (const sourceId of inboundCalendarSourceIds) reconciliationSourceDirections[sourceId] = "import";
  const inboundContactSourceIds = config.contacts && !fastCalendarPoll
    ? selectedContactSourceIds.filter((sourceId) =>
        (config.sourceDirections[sourceId] ?? config.direction) !== "export")
    : [];
  for (const sourceId of inboundContactSourceIds) reconciliationSourceDirections[sourceId] = "import";
  // A local change only flushes the durable outboxes above. Rebuilding the full
  // import plan is reserved for opening the app and the periodic background poll.
  // This keeps typing or moving an appointment responsive on slower computers.
  const shouldRunReconciliation = trigger !== "change" && trigger !== "contact-change"
    && (inboundContactSourceIds.length > 0 || inboundCalendarSourceIds.length > 0);

  if (!shouldRunReconciliation) {
    const queueErrors = queued.errors + queuedContacts.errors;
    if (queueErrors > 0) {
      const messages = [...queued.errorMessages, ...queuedContacts.errorMessages];
      const message = messages.join(" · ") || "Die ausstehenden Änderungen werden erneut versucht.";
      await recordMicrosoft365SynchronizationError(message);
      return { state: "error", message: describeMicrosoft365SyncFailure(queueErrors, messages) };
    }
    const processed = queued.processed + queuedContacts.processed;
    const transferred = queuedExchangeCount + queuedContactCount;
    if (processed > 0) window.dispatchEvent(new Event(m365DataUpdatedEventName));
    return processed > 0
      ? {
          state: "success",
          message: transferred > 0
            ? `${transferred} Änderung(en) sicher an Exchange übertragen.`
            : "Lokale Änderungen wurden abgeglichen."
        }
      : { state: "success", message: "Microsoft 365 ist bereits synchron." };
  }

  // The native synchronizer reads its compact backup directly from SQLite. This
  // avoids sending contacts and settings through the WebView on every poll.
  const result = await applyMicrosoft365Sync({
    direction: config.direction,
    base: config.base,
    contacts: inboundContactSourceIds.length > 0,
    contactGroups: config.contactGroups,
    calendars: inboundCalendarSourceIds.length > 0,
    sharedCalendars: config.sharedCalendars,
    sharedMailboxes: config.sharedMailboxes,
    sharedMailboxAddresses: config.sharedMailboxAddresses,
    selectedContactSourceIds: inboundContactSourceIds,
    selectedCalendarSourceIds: inboundCalendarSourceIds,
    sourceDirections: reconciliationSourceDirections,
    decisions: {},
    allowPartialSources: true
  });

  announceMicrosoft365CalendarChanges(result);
  if (result.created + result.updated + result.deleted > 0) {
    window.dispatchEvent(new Event(m365DataUpdatedEventName));
  }
  const combinedResult: Microsoft365SyncResult = {
    ...result,
    created: result.created + queued.created + queuedContacts.created,
    updated: result.updated + queued.updated + queuedContacts.updated,
    deleted: result.deleted + queued.deleted + queuedContacts.deleted,
    errors: result.errors + queued.errors + queuedContacts.errors,
    errorMessages: [...queued.errorMessages, ...queuedContacts.errorMessages, ...result.errorMessages]
  };
  if (combinedResult.created + combinedResult.updated + combinedResult.deleted + combinedResult.conflicts + combinedResult.errors > 0) {
    const history = parseHistory(await getAppSetting(synchronizationHistoryKey));
    const entry: Microsoft365SyncHistoryEntry = {
      id: `${combinedResult.startedAt}-${Date.now()}`,
      startedAt: combinedResult.startedAt,
      finishedAt: combinedResult.finishedAt,
      created: combinedResult.created,
      updated: combinedResult.updated,
      deleted: combinedResult.deleted,
      ignored: combinedResult.ignored,
      conflicts: combinedResult.conflicts,
      errors: combinedResult.errors,
      errorMessages: combinedResult.errorMessages
    };
    await setAppSetting(synchronizationHistoryKey, JSON.stringify([entry, ...history].slice(0, 30)));
  }

  const exchangeCount = combinedResult.created + combinedResult.updated + combinedResult.deleted;
  await recordMicrosoft365SynchronizationSuccess(config, combinedResult, {
    contacts: inboundContactSourceIds.length > 0,
    calendars: inboundCalendarSourceIds.length > 0
  });

  if (combinedResult.errors > 0) {
    return { state: "error", message: describeMicrosoft365SyncFailure(combinedResult.errors, combinedResult.errorMessages) };
  }
  if (result.conflicts > 0) {
    return {
      state: "error",
      message: `${result.conflicts} bereits vorhandene Einträge wurden vorsichtshalber nicht geändert. Die EDV kann sie später prüfen.`
    };
  }
  if (exchangeCount === 0) {
    return { state: "success", message: "Microsoft 365 ist bereits synchron." };
  }
  return {
    state: "success",
    message: `${exchangeCount} Änderung(en) automatisch mit Microsoft 365 synchronisiert.`
  };
}
