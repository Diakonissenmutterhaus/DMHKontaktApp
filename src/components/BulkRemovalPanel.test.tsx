import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BulkRemovalPanel } from "./BulkRemovalPanel";
import type { BulkFilter, BulkItem, BulkSelection } from "../types/bulkRemoval";

const db = vi.hoisted(() => ({ listEdvBulkItems: vi.fn(), previewEdvBulkRemoval: vi.fn(), executeEdvBulkRemoval: vi.fn() }));
vi.mock("../services/db", () => db);
const items: BulkItem[] = Array.from({ length: 105 }, (_, index) => ({ id: String(index), title: "Mittagspause", start: "2026-10-12T12:00", end: "2026-10-12T13:00", source: "Microsoft 365", category: "Work", email: "", company: "", groups: "", series: false }));
describe("BulkRemovalPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.listEdvBulkItems.mockImplementation(async (filter: BulkFilter) => {
      const all = filter.kind === "contacts" ? [{ ...items[0], title: "Anna", email: "anna@example.test", company: "DMH" }] : [...items, { ...items[0], id: "other", title: "Andere" }];
      const matches = all.filter(item => !filter.search || (filter.exact ? item.title.toLowerCase() === filter.search.toLowerCase() : item.title.toLowerCase().includes(filter.search.toLowerCase())));
      return { items: matches.slice(filter.offset, filter.offset + 100), total: matches.length, sources: ["Microsoft 365"], categories: ["Work"], companies: ["DMH"], groups: [] };
    });
    db.previewEdvBulkRemoval.mockImplementation(async (selection: BulkSelection) => ({ selected: selection.allMatching ? 105 - selection.excludedIds.length : selection.ids.length, affected: 104, series: 0, revision: "safe-preview" }));
    db.executeEdvBulkRemoval.mockResolvedValue(104);
  });
  it("selects every matching result beyond the visible page, excludes rows, and requires confirmation", async () => {
    const user = userEvent.setup(); render(<BulkRemovalPanel />);
    await user.type(screen.getByRole("searchbox", { name: "Termine suchen" }), "mittagspause");
    await user.click(await screen.findByRole("button", { name: "Alle 105 Treffer auswählen" }));
    await user.click(screen.getByRole("button", { name: "Nächste Seite" }));
    await waitFor(() => expect(screen.getAllByRole("checkbox", { name: /Mittagspause,/ })).toHaveLength(5));
    await user.click(screen.getAllByRole("checkbox", { name: /Mittagspause,/ })[0]);
    await user.click(screen.getByRole("button", { name: "104 ausgewählte löschen" }));
    expect(db.executeEdvBulkRemoval).not.toHaveBeenCalled();
    expect(db.previewEdvBulkRemoval).toHaveBeenCalledWith(expect.objectContaining({ allMatching: true, excludedIds: ["100"], filter: expect.objectContaining({ search: "mittagspause" }) }));
    expect(screen.getByRole("dialog")).toHaveTextContent("Exchange");
    await user.click(screen.getByRole("button", { name: "Abbrechen" }));
    expect(db.executeEdvBulkRemoval).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "104 ausgewählte löschen" }));
    await user.click(await screen.findByRole("button", { name: "Auswahl in den Papierkorb verschieben" }));
    await waitFor(() => expect(db.executeEdvBulkRemoval).toHaveBeenCalledWith(expect.objectContaining({ allMatching: true, excludedIds: ["100"] }), "safe-preview"));
  });
  it("keeps individual selections while searching but clears select-all when criteria change", async () => {
    const user = userEvent.setup(); render(<BulkRemovalPanel />);
    await user.click((await screen.findAllByRole("checkbox", { name: /Mittagspause,/ }))[0]);
    await user.type(screen.getByRole("searchbox", { name: "Termine suchen" }), "Andere");
    await waitFor(() => expect(screen.getByRole("button", { name: "Alle 1 Treffer auswählen" })).toBeEnabled());
    expect(screen.getByRole("button", { name: "1 ausgewählte löschen" })).toBeEnabled();
    await user.click(screen.getByRole("button", { name: "Alle 1 Treffer auswählen" }));
    await user.click(screen.getByRole("checkbox", { name: "Titel stimmt genau überein" }));
    expect(screen.getByRole("button", { name: "0 ausgewählte löschen" })).toBeDisabled();
  });
  it("provides the contacts subtab and queues deletion through its confirmed native command", async () => {
    const user = userEvent.setup(); render(<BulkRemovalPanel />);
    await user.click(screen.getByRole("button", { name: "Kontakte" }));
    await user.click(await screen.findByRole("checkbox", { name: "Anna, anna@example.test" }));
    await user.click(screen.getByRole("button", { name: "1 ausgewählte löschen" }));
    await user.click(await screen.findByRole("button", { name: "Auswahl in den Papierkorb verschieben" }));
    await waitFor(() => expect(db.executeEdvBulkRemoval).toHaveBeenCalledWith(expect.objectContaining({ ids: ["0"], filter: expect.objectContaining({ kind: "contacts" }) }), "safe-preview"));
  });
});
