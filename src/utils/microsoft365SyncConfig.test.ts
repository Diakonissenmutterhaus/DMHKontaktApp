import { describe, expect, it, vi } from "vitest";
import { defaultSyncConfig } from "../types/sync";
vi.mock("../services/db", () => ({}));
vi.mock("./automaticCalendarSync", () => ({ synchronizationConfigKey: "synchronization_config_v1" }));
import { initializeMicrosoft365SourceSelection, selectAllMicrosoft365Sources } from "./microsoft365SyncConfig";

describe("Microsoft 365 source selection after connecting", () => {
  const sources = { contacts: [], calendars: [{ id: "current", name: "Calendar", kind: "calendar" as const,
    editable: true, shared: false, resourcePath: "https://graph.microsoft.com/v1.0/me/calendars/current", mailbox: null }], sharedMailboxes: [], sharedAccessAvailable: false };
  const previous = { ...defaultSyncConfig, selectedCalendarSourceIds: ["previous"], selectedContactSourceIds: ["previous-contacts"],
    sourceDirections: { previous: "bidirectional" as const } };
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
