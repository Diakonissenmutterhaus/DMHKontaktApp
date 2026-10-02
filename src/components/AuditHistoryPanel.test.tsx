import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { AuditLogEntry, AuditLogFilter } from "../types/audit";

const { listAuditLogMock } = vi.hoisted(() => ({ listAuditLogMock: vi.fn() }));
vi.mock("../services/db", () => ({ listAuditLog: listAuditLogMock }));

import { AuditHistoryPanel } from "./AuditHistoryPanel";

const records: AuditLogEntry[] = [
  { id: 3, occurredAt: "2026-10-01T10:00:00Z", actor: "ORG\\Anna", source: "user", action: "created", entityKind: "contact", entityId: "3", summary: "Kontakt erstellt: Anna" },
  { id: 2, occurredAt: "2026-10-01T09:00:00Z", actor: "ORG\\Anna", source: "m365", action: "created", entityKind: "calendar", entityId: "2", summary: "Termin erstellt: Sitzung" },
  { id: 1, occurredAt: "2026-09-01T08:00:00Z", actor: "ORG\\Julius", source: "user", action: "updated", entityKind: "contact", entityId: "1", summary: "Kontakt geändert: Jürgen" }
];

describe("AuditHistoryPanel", () => {
  it("kennzeichnet eine automatische Exchange-Verknüpfung statt einer Löschung", async () => {
    listAuditLogMock.mockReset();
    listAuditLogMock.mockResolvedValue({
      entries: [{
        id: 4,
        occurredAt: "2026-10-02T09:42:00Z",
        actor: "Automatische Microsoft-365-Synchronisierung",
        source: "m365",
        action: "linked",
        entityKind: "calendar",
        entityId: "m365:calendar:remote-dentist",
        summary: "Termin mit Microsoft 365 verknüpft: Praxis Sanos (technischer ID-Wechsel; kein Termin gelöscht)"
      } satisfies AuditLogEntry],
      hasMore: false
    });
    render(<AuditHistoryPanel />);

    expect(await screen.findByText("Mit Microsoft 365 verknüpft")).toBeVisible();
    expect(screen.getByText(/technischer ID-Wechsel; kein Termin gelöscht/)).toBeVisible();
  });

  it("lädt ältere Einträge und sucht mit Aktionsfilter im ganzen Protokoll", async () => {
    listAuditLogMock.mockReset();
    listAuditLogMock.mockImplementation(async (filter: AuditLogFilter) => {
      if (filter.search || filter.action) return { entries: [records[2]], hasMore: false };
      if (filter.beforeId === 2) return { entries: [records[2]], hasMore: false };
      return { entries: records.slice(0, 2), hasMore: true };
    });
    const user = userEvent.setup();
    render(<AuditHistoryPanel />);

    expect(await screen.findByText("Kontakt erstellt: Anna")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Weitere Einträge laden" }));
    expect(await screen.findByText("Kontakt geändert: Jürgen")).toBeVisible();
    expect(listAuditLogMock).toHaveBeenCalledWith(expect.objectContaining({ beforeId: 2, limit: 50 }));

    await user.selectOptions(screen.getByLabelText("Aktion"), "modified");
    await user.type(screen.getByRole("searchbox", { name: "Historie durchsuchen" }), "Jürgen");
    await waitFor(() => expect(listAuditLogMock).toHaveBeenCalledWith(expect.objectContaining({ action: "modified", search: "Jürgen" })));
    expect(screen.getByText("Kontakt geändert: Jürgen")).toBeVisible();
  });
});
