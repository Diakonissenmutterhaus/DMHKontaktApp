import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultSyncConfig } from "../types/sync";

const mocks = vi.hoisted(() => ({
  applyMicrosoft365Sync: vi.fn(),
  flushMicrosoft365CalendarOutbox: vi.fn(),
  flushMicrosoft365ContactOutbox: vi.fn(),
  getAppSetting: vi.fn(),
  getMicrosoft365ConnectionStatus: vi.fn(),
  setAppSetting: vi.fn(),
  mergeImportedCalendarCategories: vi.fn(),
  mergeMicrosoft365CalendarCategories: vi.fn()
}));
vi.mock("../services/db", () => mocks);
vi.mock("./calendar", () => ({ calendarCategoryRulesStorageKey: "agendakontakte.calendarCategoryRules.v1", mergeImportedCalendarCategories: mocks.mergeImportedCalendarCategories, mergeMicrosoft365CalendarCategories: mocks.mergeMicrosoft365CalendarCategories }));

import { calendarStorageUpdatedEventName, describeMicrosoft365SyncFailure, runAutomaticCalendarSync, synchronizationConfigKey } from "./automaticCalendarSync";

const emptyOutbox = { processed: 0, created: 0, updated: 0, deleted: 0, pending: 0, errors: 0, errorMessages: [] };

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
    mocks.flushMicrosoft365CalendarOutbox.mockResolvedValue(emptyOutbox);
    mocks.flushMicrosoft365ContactOutbox.mockResolvedValue(emptyOutbox);
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
    expect(mocks.flushMicrosoft365CalendarOutbox).toHaveBeenCalledOnce();
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

  it("sends a calendar edit without running the contact outbox or a full import", async () => {
    mocks.flushMicrosoft365ContactOutbox.mockRejectedValue(new Error("Microsoft Graph HTTP 500"));
    mocks.flushMicrosoft365CalendarOutbox.mockResolvedValue({ ...emptyOutbox, processed: 1, updated: 1 });

    const status = await runAutomaticCalendarSync("change");

    expect(status).toEqual({ state: "success", message: "1 Änderung(en) sicher an Exchange übertragen." });
    expect(mocks.flushMicrosoft365CalendarOutbox).toHaveBeenCalledOnce();
    expect(mocks.flushMicrosoft365ContactOutbox).not.toHaveBeenCalled();
    expect(mocks.applyMicrosoft365Sync).not.toHaveBeenCalled();
  });

  it("refreshes changed master-category colors even when Exchange returns no changed events", async () => {
    mocks.applyMicrosoft365Sync.mockResolvedValue({
      startedAt: "2026-10-08T10:00:00Z", finishedAt: "2026-10-08T10:00:01Z",
      created: 0, updated: 0, deleted: 0, ignored: 0, conflicts: 0, errors: 0,
      errorMessages: [], calendarUpserts: [], calendarDeletes: [],
      calendarCategories: [{ name: "Vortrag", color: "purple" }]
    });
    const refreshed = vi.fn();
    window.addEventListener(calendarStorageUpdatedEventName, refreshed);
    const status = await runAutomaticCalendarSync("calendar-poll");
    expect(status?.state).toBe("success");
    expect(mocks.mergeMicrosoft365CalendarCategories).toHaveBeenCalledWith([{ name: "Vortrag", color: "purple" }]);
    expect(refreshed).toHaveBeenCalledOnce();
    expect(mocks.flushMicrosoft365CalendarOutbox).toHaveBeenCalledOnce();
    window.removeEventListener(calendarStorageUpdatedEventName, refreshed);
  });

  it("sends a contact edit without touching the calendar outbox", async () => {
    mocks.flushMicrosoft365CalendarOutbox.mockRejectedValue(new Error("calendar unavailable"));
    mocks.flushMicrosoft365ContactOutbox.mockResolvedValue({ ...emptyOutbox, processed: 1, updated: 1 });

    const status = await runAutomaticCalendarSync("contact-change");

    expect(status?.state).toBe("success");
    expect(mocks.flushMicrosoft365ContactOutbox).toHaveBeenCalledOnce();
    expect(mocks.flushMicrosoft365CalendarOutbox).not.toHaveBeenCalled();
    expect(mocks.applyMicrosoft365Sync).not.toHaveBeenCalled();
  });

  it("sends queued calendar changes during the frequent calendar poll", async () => {
    mocks.flushMicrosoft365CalendarOutbox.mockResolvedValue({ ...emptyOutbox, processed: 1, created: 1 });
    const status = await runAutomaticCalendarSync("calendar-poll");
    expect(status?.state).toBe("success");
    expect(mocks.flushMicrosoft365CalendarOutbox).toHaveBeenCalledOnce();
    expect(mocks.applyMicrosoft365Sync).toHaveBeenCalledOnce();
    expect(mocks.flushMicrosoft365ContactOutbox).not.toHaveBeenCalled();
  });

  it("still imports Exchange changes if sending the calendar outbox fails", async () => {
    mocks.flushMicrosoft365CalendarOutbox.mockRejectedValue(new Error("Microsoft Graph HTTP 504"));
    const status = await runAutomaticCalendarSync("calendar-poll");
    expect(status?.state).toBe("error");
    expect(mocks.applyMicrosoft365Sync).toHaveBeenCalledOnce();
    expect(mocks.mergeImportedCalendarCategories).toHaveBeenCalledWith([incomingEvent]);
  });

  it("keeps export-only calendars sending during the frequent poll", async () => {
    mocks.getAppSetting.mockImplementation(async (key: string) => key === synchronizationConfigKey
      ? JSON.stringify({ ...defaultSyncConfig, enabled: true, contacts: false, calendars: true,
          selectedCalendarSourceIds: ["me:calendar"], sourceDirections: { "me:calendar": "export" } })
      : null);
    mocks.flushMicrosoft365CalendarOutbox.mockResolvedValue({ ...emptyOutbox, processed: 1, created: 1 });
    const status = await runAutomaticCalendarSync("calendar-poll");
    expect(status?.state).toBe("success");
    expect(mocks.flushMicrosoft365CalendarOutbox).toHaveBeenCalledOnce();
    expect(mocks.applyMicrosoft365Sync).not.toHaveBeenCalled();
  });

  it("runs the slower contact poll independently of the calendar queue", async () => {
    const status = await runAutomaticCalendarSync("poll");
    expect(status?.state).toBe("success");
    expect(mocks.flushMicrosoft365CalendarOutbox).not.toHaveBeenCalled();
    expect(mocks.flushMicrosoft365ContactOutbox).toHaveBeenCalledOnce();
    expect(mocks.applyMicrosoft365Sync).toHaveBeenCalledWith(expect.objectContaining({
      calendars: false, contacts: true, selectedCalendarSourceIds: []
    }));
  });

  it("explains a temporary Graph failure without claiming the local change was lost", async () => {
    mocks.applyMicrosoft365Sync.mockResolvedValue({
      startedAt: "2026-10-02T10:00:00Z", finishedAt: "2026-10-02T10:00:01Z",
      created: 0, updated: 0, deleted: 0, ignored: 0, conflicts: 0, errors: 1,
      errorMessages: ["Kalender: Microsoft Graph HTTP 500, ErrorInternalServerError"],
      calendarUpserts: [], calendarDeletes: []
    });

    const status = await runAutomaticCalendarSync("poll");

    expect(status).toEqual({
      state: "error",
      message: "Microsoft 365 hat einen Serverfehler gemeldet. Lokale Änderungen bleiben gespeichert und werden erneut versucht. Falls der Fehler anhält, prüfen Sie die Verbindung."
    });
    expect(mocks.setAppSetting).toHaveBeenCalledWith(
      "synchronization_runtime_status_v1",
      expect.stringContaining("HTTP 500")
    );
  });

  it("shows the actual reason for a non-transient sync failure", () => {
    expect(describeMicrosoft365SyncFailure(1, ["Termin: HTTP 400 InvalidParameter"]))
      .toContain("Termin: HTTP 400 InvalidParameter");
  });
});
