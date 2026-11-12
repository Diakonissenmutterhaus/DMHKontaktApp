import { getAppSetting, getMicrosoft365ConnectionStatus, listMicrosoft365SyncSources, setAppSetting } from "../services/db";
import type { Microsoft365SyncSource, Microsoft365SyncSources } from "../types/m365";
import { parseSyncConfig, type SyncConfig } from "../types/sync";
import { synchronizationConfigKey } from "./automaticCalendarSync";

export const automaticSyncAccountKey = "m365_automatic_sync_account_v1";

export const completeAutomaticSyncInitializedKey = "m365_complete_automatic_sync_initialized_v1";

export function isTechnicalMicrosoft365Source(source: Microsoft365SyncSource): boolean {
  return /(birthday|birthdays|geburtstag|geburtstage|holiday|holidays|feiertag|feiertage|weather|wetter|trash|papierkorb)/i.test(source.name);
}

export function initializeMicrosoft365SourceSelection(config: SyncConfig, sources: Microsoft365SyncSources): SyncConfig {
  const sourceDirections = { ...config.sourceDirections };
  const selectedContactSourceIds = new Set(config.selectedContactSourceIds);
  const selectedCalendarSourceIds = new Set(config.selectedCalendarSourceIds);

  for (const source of [...sources.contacts, ...sources.calendars]) {
    if (sourceDirections[source.id]) continue;
    sourceDirections[source.id] = config.direction;
    if (isTechnicalMicrosoft365Source(source)) continue;
    if (source.kind === "contactFolder") selectedContactSourceIds.add(source.id);
    else selectedCalendarSourceIds.add(source.id);
  }

  return {
    ...config,
    sourceSelectionInitialized: true,
    selectedContactSourceIds: Array.from(selectedContactSourceIds),
    selectedCalendarSourceIds: Array.from(selectedCalendarSourceIds),
    sourceDirections
  };
}

export function selectAllMicrosoft365Sources(config: SyncConfig, sources: Microsoft365SyncSources): SyncConfig {
  const sourceDirections = { ...config.sourceDirections };
  // Explicitly enabling all sources after connecting uses the current account's
  // discovered sources, rather than retaining IDs from an earlier connection.
  const selectedContactSourceIds = new Set<string>();
  const selectedCalendarSourceIds = new Set<string>();

  for (const source of [...sources.contacts, ...sources.calendars]) {
    if (isTechnicalMicrosoft365Source(source)) continue;
    sourceDirections[source.id] = config.direction;
    if (source.kind === "contactFolder") selectedContactSourceIds.add(source.id);
    else selectedCalendarSourceIds.add(source.id);
  }

  return {
    ...config,
    enabled: true,
    paused: false,
    providers: { ...config.providers, m365: true },
    direction: config.direction,
    contacts: true,
    contactGroups: true,
    calendars: true,
    recurringEvents: true,
    attendeesAndTeamsLinks: true,
    categoriesAndColors: true,
    sourceSelectionInitialized: true,
    selectedContactSourceIds: Array.from(selectedContactSourceIds),
    selectedCalendarSourceIds: Array.from(selectedCalendarSourceIds),
    sourceDirections,
    runOnOpen: true,
    runOnClose: true
  };
}

export async function enableCompleteAutomaticMicrosoft365Sync(force = false): Promise<SyncConfig> {
  const [rawConfig, initialized, owner, connection] = await Promise.all([
    getAppSetting(synchronizationConfigKey),
    getAppSetting(completeAutomaticSyncInitializedKey),
    getAppSetting(automaticSyncAccountKey),
    getMicrosoft365ConnectionStatus()
  ]);
  const current = parseSyncConfig(rawConfig);
  if (!connection.connected || !connection.account) throw new Error("Microsoft-365-Anmeldung muss erneut bestätigt werden.");
  const accountKey = `${connection.account.id}:${connection.account.email || connection.account.userPrincipalName || ""}`.toLowerCase();
  if (!force && initialized === "true" && owner === accountKey) return current;

  const sources = await listMicrosoft365SyncSources(current.sharedMailboxAddresses);
  const complete = selectAllMicrosoft365Sources(current, sources);
  const next = !force && initialized === "true" ? {
    ...current,
    sourceSelectionInitialized:true,
    selectedCalendarSourceIds:complete.selectedCalendarSourceIds,
    selectedContactSourceIds:complete.selectedContactSourceIds,
    sourceDirections:complete.sourceDirections
  } : complete;
  // Publish the configuration before its initialization/ownership markers.
  // A failed discovery never deletes an unavailable source or a queued change.
  await setAppSetting(synchronizationConfigKey, JSON.stringify(next));
  await setAppSetting(automaticSyncAccountKey, accountKey);
  await setAppSetting(completeAutomaticSyncInitializedKey, "true");
  return next;
}
