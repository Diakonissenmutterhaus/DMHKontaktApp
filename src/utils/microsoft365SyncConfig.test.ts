import { beforeEach, describe, expect, it, vi } from "vitest";
import { defaultSyncConfig } from "../types/sync";
const db=vi.hoisted(()=>({getAppSetting:vi.fn(),getMicrosoft365ConnectionStatus:vi.fn(),listMicrosoft365SyncSources:vi.fn(),setAppSetting:vi.fn()}));
vi.mock("../services/db", () => db);
vi.mock("./automaticCalendarSync", () => ({ synchronizationConfigKey: "synchronization_config_v1" }));
import { automaticSyncAccountKey, enableCompleteAutomaticMicrosoft365Sync, initializeMicrosoft365SourceSelection, selectAllMicrosoft365Sources } from "./microsoft365SyncConfig";

describe("Microsoft 365 source selection after connecting", () => {
  const sources = { contacts: [], calendars: [{ id: "current", name: "Calendar", kind: "calendar" as const,
    editable: true, shared: false, resourcePath: "https://graph.microsoft.com/v1.0/me/calendars/current", mailbox: null }], sharedMailboxes: [], sharedAccessAvailable: false };
  const previous = { ...defaultSyncConfig, selectedCalendarSourceIds: ["previous"], selectedContactSourceIds: ["previous-contacts"],
    sourceDirections: { previous: "bidirectional" as const } };
  beforeEach(()=>{
    vi.clearAllMocks();
    db.getAppSetting.mockImplementation(async (key:string)=>key === "synchronization_config_v1" ? JSON.stringify(previous) : key === "m365_complete_automatic_sync_initialized_v1" ? "true" : null);
    db.getMicrosoft365ConnectionStatus.mockResolvedValue({connected:true,account:{id:"current-account",email:"anna@example.test"}});
    db.listMicrosoft365SyncSources.mockResolvedValue(sources);
    db.setAppSetting.mockResolvedValue(undefined);
  });
  it("replaces legacy calendar IDs even when the old global initialized flag is true",async()=>{
    const config=await enableCompleteAutomaticMicrosoft365Sync(false);
    expect(config.selectedCalendarSourceIds).toEqual(["current"]);
    expect(db.setAppSetting).toHaveBeenCalledWith(automaticSyncAccountKey,"current-account:anna@example.test");
  });
  it("keeps stored selections when discovery fails instead of treating failure as an empty calendar list",async()=>{
    db.listMicrosoft365SyncSources.mockRejectedValue(new Error("HTTP 503"));
    await expect(enableCompleteAutomaticMicrosoft365Sync(false)).rejects.toThrow("HTTP 503");
    expect(db.setAppSetting).not.toHaveBeenCalled();
  });
  it("does not re-enable a paused configuration while binding legacy selections to the account",async()=>{
    db.getAppSetting.mockImplementation(async (key:string)=>key === "synchronization_config_v1" ? JSON.stringify({...previous,enabled:true,paused:true}) : key === "m365_complete_automatic_sync_initialized_v1" ? "true" : null);
    const config=await enableCompleteAutomaticMicrosoft365Sync(false);
    expect(config.paused).toBe(true);expect(config.selectedCalendarSourceIds).toEqual(["current"]);
  });
  it("explicitly selecting all uses sources available in the connected account", () => {
    const config = selectAllMicrosoft365Sources(previous, sources);
    expect(config.selectedCalendarSourceIds).toEqual(["current"]);
    expect(config.selectedContactSourceIds).toEqual([]);
    expect(config.sourceDirections.current).toBe("bidirectional");
  });
  it("ordinary discovery preserves selections that may be temporarily unavailable", () => {
    const config = initializeMicrosoft365SourceSelection(previous, sources);
    expect(config.selectedCalendarSourceIds).toEqual(["previous", "current"]);
  });
});
