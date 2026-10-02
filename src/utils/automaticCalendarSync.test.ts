import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultSyncConfig } from "../types/sync";

const mocks = vi.hoisted(() => ({
  applyMicrosoft365Sync: vi.fn(),
  flushMicrosoft365CalendarOutbox: vi.fn(),
  flushMicrosoft365ContactOutbox: vi.fn(),
  getAppSetting: vi.fn(),
  getMicrosoft365ConnectionStatus: vi.fn(),
  setAppSetting: vi.fn(),
  mergeImportedCalendarCategories: vi.fn()
}));
vi.mock("../services/db", () => mocks);
vi.mock("./calendar", () => ({ mergeImportedCalendarCategories: mocks.mergeImportedCalendarCategories }));

import { calendarStorageUpdatedEventName, runAutomaticCalendarSync, synchronizationConfigKey } from "./automaticCalendarSync";

const incomingEvent = {
  id: "m365:me:calendar:dentist",
  title: "Zahnarzt",
  startsAt: "2026-10-09T09:00:00",
  endsAt: "2026-10-09T10:00:00",
  location: "Praxis",
  description: "",
  color: "blue",
  category: "Blue category",
  source: "Microsoft 365"
};

describe("automatic Microsoft 365 calendar polling", () => {
  beforeEach(() => {
    Object.defineProperty(window, "__TAURI_INTERNALS__", { value: {}, configurable: true });
    vi.clearAllMocks();
    mocks.getAppSetting.mockImplementation(async (key: string) => key === synchronizationConfigKey
      ? JSON.stringify({
          ...defaultSyncConfig,
          enabled: true,
          contacts: true,
          calendars: true,
          sharedMailboxes: true,
          sharedMailboxAddresses: ["shared@example.org"],
          selectedContactSourceIds: ["me:default-contacts"],
          selectedCalendarSourceIds: ["me:calendar"],
          sourceDirections: { "me:calendar": "bidirectional" }
        })
      : null);
    mocks.getMicrosoft365ConnectionStatus.mockResolvedValue({ connected: true });
    mocks.setAppSetting.mockResolvedValue(undefined);
    mocks.applyMicrosoft365Sync.mockResolvedValue({
      startedAt: "2026-10-02T10:00:00Z",
      finishedAt: "2026-10-02T10:00:01Z",
      created: 0,
      updated: 1,
      deleted: 0,
      ignored: 0,
      conflicts: 0,
      errors: 0,
      errorMessages: [],
      calendarUpserts: [incomingEvent],
      calendarDeletes: []
    });
  });

  afterEach(() => {
    delete (window as Window & { __TAURI_INTERNALS__?: object }).__TAURI_INTERNALS__;
  });

  it("reads Exchange calendar changes without waiting for a failing contact outbox", async () => {
    mocks.flushMicrosoft365ContactOutbox.mockRejectedValue(new Error("contacts unavailable"));
    const refreshed = vi.fn();
    window.addEventListener(calendarStorageUpdatedEventName, refreshed);

    const status = await runAutomaticCalendarSync("calendar-poll");

    expect(status?.state).toBe("success");
    expect(mocks.mergeImportedCalendarCategories).toHaveBeenCalledWith([incomingEvent]);
    expect(refreshed).toHaveBeenCalledOnce();
    expect(mocks.flushMicrosoft365CalendarOutbox).not.toHaveBeenCalled();
    expect(mocks.flushMicrosoft365ContactOutbox).not.toHaveBeenCalled();
    expect(mocks.applyMicrosoft365Sync).toHaveBeenCalledWith(expect.objectContaining({
      calendars: true,
      contacts: false,
      sharedMailboxes: true,
      sharedMailboxAddresses: ["shared@example.org"],
      allowPartialSources: true,
      selectedCalendarSourceIds: ["me:calendar"],
      selectedContactSourceIds: [],
      sourceDirections: expect.objectContaining({ "me:calendar": "import" })
    }));
    window.removeEventListener(calendarStorageUpdatedEventName, refreshed);
  });
});
