import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as db from "../services/db";
import { CalendarPage } from "./CalendarPage";
import { mergeMicrosoft365CalendarCategories } from "../utils/calendar";

vi.mock("../services/db", () => ({
  migrationCaptureStatusChangedEventName: "test:migration-status",
  getMigrationCaptureStatus: vi.fn().mockResolvedValue({ completed: false }),
  getCalendarOverview: vi.fn().mockResolvedValue({ total: 0, sources: [] }),
  listCalendarEventsInRange: vi.fn().mockResolvedValue([]),
  listCalendarEvents: vi.fn().mockResolvedValue([]),
  getCalendarCategoryOperation: vi.fn().mockResolvedValue(null),
  getCalendarCategoryRules: vi.fn().mockResolvedValue([]),
  changeCalendarCategories: vi.fn().mockResolvedValue({ localEvents: 2, exchangeEvents: 2, category: null }),
  saveMicrosoft365MasterCategory: vi.fn().mockImplementation(async (category) => category),
  saveCalendarEvents: vi.fn().mockResolvedValue(undefined),
  getAppSetting: vi.fn().mockResolvedValue(null),
  setAppSetting: vi.fn().mockResolvedValue(undefined),
  listMicrosoft365CalendarSources: vi.fn().mockResolvedValue([]),
  getMicrosoft365ConnectionStatus: vi.fn().mockResolvedValue({ connected: true }),
  getMicrosoft365ReadOnlyTestMode: vi.fn().mockResolvedValue(false),
  listMicrosoft365MasterCategories: vi.fn().mockResolvedValue([{ name: "Black category", color: "gray" }]),
  previewMicrosoft365CalendarCategoryRepair: vi.fn().mockResolvedValue({ linkedEvents: 2, categoryNames: ["Black category"], categoriesToRepair: 1, pendingOperations: 5, pendingDeletions: 1 }),
  repairMicrosoft365CalendarCategories: vi.fn().mockResolvedValue({ scanned: 2, updated: 1, errors: 1, errorMessages: ["Exchange hat die Kategorie am erneut gelesenen Termin nicht bestätigt."] })
}));

async function openCategories() {
  const user = userEvent.setup();
  render(<CalendarPage advancedMode={false} onAdvancedModeChange={() => undefined} onNavigate={() => undefined} />);
  await user.click(screen.getByRole("button", { name: "Weitere Kalenderaktionen" }));
  await user.click(screen.getByRole("button", { name: "Kategorien verwalten" }));
  await screen.findByText("Black category");
  return user;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(db.getMicrosoft365ReadOnlyTestMode).mockResolvedValue(false);
  vi.mocked(db.getCalendarOverview).mockResolvedValue({ total: 0, sources: [] });
  vi.mocked(db.listCalendarEventsInRange).mockResolvedValue([]);
  vi.mocked(db.listCalendarEvents).mockResolvedValue([]);
  vi.mocked(db.getCalendarCategoryOperation).mockResolvedValue(null);
  vi.mocked(db.getAppSetting).mockResolvedValue(null);
  vi.mocked(db.listMicrosoft365CalendarSources).mockResolvedValue([]);
  vi.mocked(db.getCalendarCategoryRules).mockResolvedValue([]);
  vi.mocked(db.listMicrosoft365MasterCategories).mockResolvedValue([{ name: "Black category", color: "gray" }]);
  vi.mocked(db.changeCalendarCategories).mockResolvedValue({ localEvents: 2, exchangeEvents: 2, category: null });
  vi.mocked(db.saveMicrosoft365MasterCategory).mockImplementation(async (category) => category);
  Object.defineProperty(window, "__TAURI_INTERNALS__", { configurable: true, value: {} });
});

afterEach(() => {
  Reflect.deleteProperty(window, "__TAURI_INTERNALS__");
  if (vi.isMockFunction(window.confirm)) window.confirm.mockRestore();
});

describe("Exchange category repair", () => {
  it("honors the global import-only direction when editing an Exchange event", async () => {
    vi.mocked(db.getAppSetting).mockResolvedValue(JSON.stringify({ enabled: true, direction: "import", selectedCalendarSourceIds: ["a"] }));
    vi.mocked(db.listMicrosoft365CalendarSources).mockResolvedValue([
      { id: "a", name: "Arbeit", kind: "calendar", editable: true, shared: false, mailbox: null, resourcePath: "/me/calendars/a" }
    ]);
    const starts = new Date();
    starts.setHours(10, 0, 0, 0);
    vi.mocked(db.getCalendarOverview).mockResolvedValue({ total: 1, sources: ["Microsoft 365 · Arbeit"] });
    vi.mocked(db.listCalendarEventsInRange).mockResolvedValue([{
      id: "m365:a:read-only", title: "Nur Import", startsAt: starts.toISOString(), endsAt: new Date(starts.getTime() + 3600000).toISOString(),
      location: "", description: "", category: "", color: "blue", source: "Microsoft 365 · Arbeit", calendarSourceId: "a"
    }]);
    const user = userEvent.setup();
    render(<CalendarPage advancedMode={false} onAdvancedModeChange={() => undefined} onNavigate={() => undefined} />);
    await user.click(await screen.findByText("Nur Import"));
    await screen.findByLabelText("Kalender für diesen Termin");
    await waitFor(() => expect(screen.getByRole("option", { name: /Microsoft 365 · Arbeit/ })).toBeDisabled());
    await user.click(screen.getByRole("button", { name: /Speichern/ }));
    await screen.findByText(/Dieser Kalender erlaubt keine Änderungen/);
    expect(db.saveCalendarEvents).not.toHaveBeenCalled();
  });

  it("lists empty Exchange calendars and persists the selected destination ID when saving", async () => {
    vi.mocked(db.getAppSetting).mockResolvedValue(JSON.stringify({ enabled: true, selectedCalendarSourceIds: ["a"], sharedMailboxAddresses: ["team@example.test"] }));
    vi.mocked(db.listMicrosoft365CalendarSources).mockResolvedValue([
      { id: "a", name: "Arbeit", kind: "calendar", editable: true, shared: false, mailbox: null, resourcePath: "/me/calendars/a" },
      { id: "b", name: "Privat", kind: "calendar", editable: true, shared: false, mailbox: null, resourcePath: "/me/calendars/b" },
      { id: "c", name: "Team", kind: "calendar", editable: false, shared: true, mailbox: "team@example.test", resourcePath: "/users/team/calendars/c" }
    ]);
    const user = userEvent.setup();
    render(<CalendarPage advancedMode={false} onAdvancedModeChange={() => undefined} onNavigate={() => undefined} />);
    await user.click(screen.getByRole("button", { name: /Neuer Termin/ }));
    const selector = await screen.findByLabelText("Kalender für diesen Termin");
    await waitFor(() => expect(selector).toBeEnabled());
    expect(db.listMicrosoft365CalendarSources).toHaveBeenCalledWith(["team@example.test"]);
    expect(screen.getByRole("option", { name: /Microsoft 365 · Team/ })).toBeDisabled();
    await user.type(screen.getByPlaceholderText("Titel hinzufügen"), "Neuer Zielkalender");
    await user.selectOptions(selector, "b");
    await user.click(screen.getByRole("button", { name: /Speichern/ }));
    await waitFor(() => expect(db.saveCalendarEvents).toHaveBeenCalledWith([expect.objectContaining({ title: "Neuer Zielkalender", calendarSourceId: "b", source: "Microsoft 365 · Privat" })]));
    expect(db.setAppSetting).toHaveBeenCalledWith("synchronization_config_v1", expect.any(String));
    const settingCalls = vi.mocked(db.setAppSetting).mock.calls;
    const savedConfig = JSON.parse(settingCalls[settingCalls.length - 1][1]);
    expect(savedConfig.selectedCalendarSourceIds).toEqual(["a", "b"]);
  });

  it("loads categories used outside the visible calendar and searches the complete list", async () => {
    vi.mocked(db.listCalendarEvents).mockResolvedValue([{ id: "old", title: "Alter Termin", startsAt: "2020-01-01T10:00", endsAt: "2020-01-01T11:00", location: "", description: "", category: "Historisch", color: "red", source: "Import" }]);
    const user = await openCategories();
    expect(screen.getByText("Historisch")).toBeInTheDocument();
    expect(screen.getByText("Lokal · 1 Termine in der App")).toBeInTheDocument();
    await user.type(screen.getByRole("searchbox", { name: "Kategorien suchen" }), "histor");
    expect(screen.queryByText("Black category")).not.toBeInTheDocument();
    expect(screen.getByText("Historisch")).toBeInTheDocument();
  });

  it("confirms bulk deletion and leaves a truly empty catalogue", async () => {
    vi.mocked(db.changeCalendarCategories).mockImplementation(async (operation) => {
      vi.mocked(db.listMicrosoft365MasterCategories).mockResolvedValue([]);
      vi.mocked(db.getCalendarCategoryRules).mockResolvedValue([operation]);
      return { localEvents: 2, exchangeEvents: 2, category: null };
    });
    const user = await openCategories();
    await user.click(screen.getByRole("button", { name: "Alle löschen" }));
    expect(db.changeCalendarCategories).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Endgültig löschen" }));
    await screen.findByText("Keine Kategorien. Termine ohne Kategorie verwenden Blau.");
    expect(db.changeCalendarCategories).toHaveBeenCalledWith({ names: ["Black category"], replacement: null, exchange: true });
    expect(JSON.parse(localStorage.getItem("agendakontakte.calendarCategories") ?? "null")).toEqual([]);
  });

  it("renames a category and transfers the app catalogue to the confirmed name", async () => {
    vi.mocked(db.changeCalendarCategories).mockImplementation(async (operation) => {
      vi.mocked(db.listMicrosoft365MasterCategories).mockResolvedValue([operation.replacement!]);
      vi.mocked(db.getCalendarCategoryRules).mockResolvedValue([operation]);
      return { localEvents: 2, exchangeEvents: 2, category: operation.replacement };
    });
    const user = await openCategories();
    await user.click(screen.getByRole("button", { name: "Black category umbenennen" }));
    const input = screen.getByRole("textbox", { name: "Neuer Name für Black category" });
    await user.clear(input); await user.type(input, "Sitzung");
    await user.click(screen.getByRole("button", { name: "Speichern" }));
    await screen.findByText("Sitzung");
    expect(screen.queryByText("Black category")).not.toBeInTheDocument();
    expect(db.changeCalendarCategories).toHaveBeenCalledWith({ names: ["Black category"], replacement: { name: "Sitzung", color: "gray" }, exchange: true });
  });

  it("offers resume after partial Exchange failure and does not claim successful deletion", async () => {
    vi.mocked(db.changeCalendarCategories).mockImplementation(async (operation) => {
      vi.mocked(db.getCalendarCategoryOperation).mockResolvedValue(operation);
      throw new Error("Exchange nicht erreichbar");
    });
    const user = await openCategories();
    await user.click(screen.getByRole("button", { name: "Black category löschen" }));
    await user.click(screen.getByRole("button", { name: "Endgültig löschen" }));
    await screen.findByRole("button", { name: "Änderung fortsetzen" });
    expect(screen.getByRole("alert")).toHaveTextContent("Exchange nicht erreichbar");
    expect(screen.getByRole("checkbox", { name: "Black category auswählen" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Alle löschen" })).toBeDisabled();
  });

  it("keeps the confirmed colour when an Exchange colour edit fails", async () => {
    vi.mocked(db.saveMicrosoft365MasterCategory).mockRejectedValueOnce(new Error("Exchange nicht erreichbar"));
    const user = await openCategories();
    await user.selectOptions(screen.getByRole("combobox", { name: "Farbe für Black category" }), "red");
    await screen.findByRole("alert");
    expect(screen.getByRole("combobox", { name: "Farbe für Black category" })).toHaveValue("gray");
  });
  it("shows an uncolored Exchange category as gray instead of pretending it is blue", async () => {
    await openCategories();
    expect(screen.getByRole("combobox", { name: "Farbe für Black category" })).toHaveValue("gray");
    expect(screen.getByRole("option", { name: "Ohne sichtbare Exchange-Farbe" })).toBeInTheDocument();
  });

  it("blocks repairs and category writes in the read-only native test", async () => {
    vi.mocked(db.getMicrosoft365ReadOnlyTestMode).mockResolvedValue(true);
    await openCategories();
    expect(screen.getByText(/Farben können hier angezeigt/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Farben prüfen und reparieren" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Kategorie anlegen" })).toBeDisabled();
    expect(screen.getByRole("combobox", { name: "Farbe für Black category" })).toBeDisabled();
    expect(db.previewMicrosoft365CalendarCategoryRepair).not.toHaveBeenCalled();
    expect(db.repairMicrosoft365CalendarCategories).not.toHaveBeenCalled();
  });

  it("reports only verified appointments and surfaces a persisted-category mismatch", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    const user = await openCategories();
    await user.click(screen.getByRole("button", { name: "Farben prüfen und reparieren" }));
    await screen.findByRole("heading", { name: "Exchange-Kategorien teilweise bestätigt" });
    expect(screen.getByText(/bei 1 von 2 erneut gelesenen Terminen/)).toBeInTheDocument();
    expect(screen.getByText(/am erneut gelesenen Termin nicht bestätigt/)).toBeInTheDocument();
    expect(confirm).toHaveBeenCalledOnce();
    await waitFor(() => expect(db.repairMicrosoft365CalendarCategories).toHaveBeenCalledOnce());
  });

  it("updates an open category manager when a Teams color change is received", async () => {
    await openCategories();
    act(() => mergeMicrosoft365CalendarCategories([{ name: "Black category", color: "purple" }]));
    expect(screen.getByRole("combobox", { name: "Farbe für Black category" })).toHaveValue("purple");
  });

  it("saves a direct event color selection through a color category rather than its old category", async () => {
    const starts = new Date();
    starts.setHours(10, 0, 0, 0);
    const ends = new Date(starts.getTime() + 3600000);
    vi.mocked(db.getCalendarOverview).mockResolvedValue({ total: 1, sources: ["Microsoft 365"] });
    vi.mocked(db.listCalendarEventsInRange).mockResolvedValue([{
      id: "m365:calendar-a:event-1", title: "Testtermin", startsAt: starts.toISOString(), endsAt: ends.toISOString(),
      location: "", description: "", color: "blue", category: "Alte Kategorie", source: "Microsoft 365"
    }]);
    const user = userEvent.setup();
    render(<CalendarPage advancedMode={false} onAdvancedModeChange={() => undefined} onNavigate={() => undefined} />);
    const title = await screen.findByText("Testtermin");
    fireEvent.contextMenu(title.closest("button")!, { clientX: 100, clientY: 100 });
    await user.click(screen.getByRole("menuitem", { name: "Symbol" }));
    await user.click(screen.getByRole("button", { name: "Grün" }));
    await waitFor(() => expect(db.saveCalendarEvents).toHaveBeenCalledWith([expect.objectContaining({
      id: "m365:calendar-a:event-1", color: "green", category: ""
    })]));
  });
});
