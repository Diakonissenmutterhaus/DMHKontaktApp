import { act, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { StatusMessage } from "../components/StatusMessage";
import { useDiagnosticMessage } from "../hooks/useDiagnosticMessage";
import { inlineMessage, invokeWithDiagnostics, notifyExchangeFailures, publicNotification } from "./notificationPolicy";
import { migrateLegacyActivityDiagnostics, readActivities } from "./activityLog";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));

beforeEach(() => {
  invoke.mockReset().mockResolvedValue(undefined);
  localStorage.clear();
  Object.defineProperty(window, "__TAURI_INTERNALS__", { configurable: true, value: {} });
});

describe("EDV notification policy", () => {
  it("keeps colour maintenance private while a rejected content change stays actionable", () => {
    const failure = { entityKind: "calendar", entityId: "legacy-one", title: "Feriado", startsAt: "2026-12-25T00:00", sourceId: "calendar-a", error: "HTTP 404", userMessage: "Bitte die EDV kontaktieren." };
    for (const operation of ["category", "category-fallback", "outbox:category"]) {
      expect(notifyExchangeFailures([{ ...failure, operation }])).toBeUndefined();
    }
    expect(notifyExchangeFailures([{ ...failure, operation: "upsert" }])).toContain("Feriado");
  });
  it("records SQL/Graph diagnostics without presenting raw errors or success banners", async () => {
    const message = "Exchange konnte 1 Änderung(en) noch nicht übernehmen: UNIQUE constraint failed: m365_contact_links.source_id, m365_contact_links.remote_id";
    const { rerender } = render(<StatusMessage message={message} type="error" />);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByText(/UNIQUE/)).not.toBeInTheDocument();
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("record_ui_diagnostic", { entry: expect.objectContaining({ message, level: "error" }) }));
    rerender(<StatusMessage message="Microsoft 365 ist bereits synchron." type="success" />);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(notifyExchangeFailures([{ entityKind: "calendar", entityId: "a", title: "A", operation: "upsert", sourceId: "x", error: "HTTP 503", userMessage: null }])).toBeUndefined();
  });

  it("shows the precise rejected event, date and corrective action without technical details", () => {
    const message = notifyExchangeFailures([{ entityKind: "calendar", entityId: "m365:a:1", title: "Arzttermin", startsAt: "2026-10-12T15:00", operation: "upsert", sourceId: "a", error: "HTTP 403 ErrorAccessDenied", userMessage: "Bitte einen beschreibbaren Zielkalender wählen oder die EDV um Freigabe bitten." }])!;
    render(<StatusMessage message={message} type="error" />);
    expect(screen.getByRole("alert")).toHaveTextContent("Arzttermin");
    expect(screen.getByRole("alert")).toHaveTextContent("15:00");
    expect(screen.getByRole("alert")).toHaveTextContent("Zielkalender wählen");
    expect(screen.queryByText(/ErrorAccessDenied|HTTP 403/)).not.toBeInTheDocument();
  });

  it("keeps form validation usable and logs inline technical failures", async () => {
    expect(inlineMessage("Die beiden Kennwörter stimmen nicht überein.")).toContain("Kennwörter");
    function Form() { const [error, setError] = useDiagnosticMessage("Example:loadError", "inline"); return <><button onClick={() => setError("HTTP 404 ErrorItemNotFound")}>Load</button><p>{error}</p></>; }
    render(<Form />);
    act(() => screen.getByRole("button", { name: "Load" }).click());
    expect(screen.getByText(/Bitte die EDV informieren/)).toBeVisible();
    expect(screen.queryByText(/HTTP 404/)).not.toBeInTheDocument();
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("record_ui_diagnostic", { entry: expect.objectContaining({ origin: "Example:loadError", level: "error", message: "HTTP 404 ErrorItemNotFound" }) }));
  });

  it("logs every affected event when local saving fails and preserves the actual rejection", async () => {
    invoke.mockImplementation(async (command) => { if (command === "save_calendar_events") throw "database is locked while saving appointments"; });
    const error = "database is locked while saving appointments";
    const rejection = await invokeWithDiagnostics("save_calendar_events", { events: [{ id: "one", title: "Kita", startsAt: "2026-10-12T13:00" }, { id: "two", title: "Sitzung", startsAt: "2026-10-12T14:00" }] }).catch((cause) => cause);
    expect(rejection).toMatchObject({ technicalMessage: error });
    expect(invoke).toHaveBeenCalledWith("record_ui_diagnostic", { entry: expect.objectContaining({ entityId: "one", title: "Kita", startsAt: "2026-10-12T13:00", operation: "save_calendar_events" }) });
    expect(invoke).toHaveBeenCalledWith("record_ui_diagnostic", { entry: expect.objectContaining({ entityId: "two", title: "Sitzung" }) });
    expect(publicNotification(error)).toBeNull();
    expect(String(rejection)).toContain("EDV informieren");
    render(<StatusMessage message={String(rejection)} type="error" />);
    expect(screen.getByRole("alert")).toHaveTextContent("Kita");
    expect(screen.getByRole("alert")).not.toHaveTextContent("database");
  });

  it("hides and migrates old technical activities with their original dates", async () => {
    localStorage.setItem("dmh.activity-log.v1", JSON.stringify([{ id: "old", title: "Fehler", tone: "error", summary: "old HTTP 404", createdAt: "2026-10-08T13:42:00Z", read: false }]));
    expect(readActivities()).toEqual([]);
    await migrateLegacyActivityDiagnostics();
    expect(invoke).toHaveBeenCalledWith("record_ui_diagnostic", { entry: expect.objectContaining({ occurredAt: "2026-10-08T13:42:00Z", message: "old HTTP 404" }) });
    expect(JSON.parse(localStorage.getItem("dmh.activity-log.v1")!)).toEqual([]);
  });
});
