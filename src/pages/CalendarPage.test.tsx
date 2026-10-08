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
  saveCalendarEvents: vi.fn().mockResolvedValue(undefined),
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
  Object.defineProperty(window, "__TAURI_INTERNALS__", { configurable: true, value: {} });
});

afterEach(() => {
  Reflect.deleteProperty(window, "__TAURI_INTERNALS__");
  if (vi.isMockFunction(window.confirm)) window.confirm.mockRestore();
});

describe("Exchange category repair", () => {
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
