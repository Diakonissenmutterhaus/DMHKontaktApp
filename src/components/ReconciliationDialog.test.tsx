import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ReconciliationDialog } from "./ReconciliationDialog";
import type { ReconciliationPreview } from "../types/reconciliation";
const api = vi.hoisted(() => ({ previewReconciliation: vi.fn(), applyReconciliation: vi.fn() }));
vi.mock("../services/reconciliation", () => api);
const preview: ReconciliationPreview = {
  token: "native-plan", counts: { update: 1, new: 1, deleted: 1, review: 1 }, warnings: [], items: [
    { key: "update", label: "Anna", status: "update", reason: "Sicher aktualisieren", selectable: true, differences: [{ field: "city", current: "Alt", incoming: "Neu" }] },
    { key: "new", label: "Bea", status: "new", reason: "Neu seit Prüfung", selectable: true, differences: [] },
    { key: "deleted", label: "Clara", status: "deleted", reason: "Bleibt gelöscht", selectable: false, differences: [] },
    { key: "review", label: "Dora", status: "review", reason: "Unklar", selectable: false, differences: [] }
  ]
};
const renderDialog = (extra = {}) => render(<ReconciliationDialog open kind="contacts" onClose={vi.fn()} onChanged={vi.fn()} {...extra} />);
describe("safe reconciliation", () => {
  beforeEach(() => {
    vi.resetAllMocks(); api.previewReconciliation.mockResolvedValue(preview);
    api.applyReconciliation.mockResolvedValue({ added: 0, updated: 1, unchanged: 3, review: 1 });
  });
  it("scans without writing and only submits reviewed selectable rows", async () => {
    const user = userEvent.setup(); renderDialog();
    await user.click(screen.getByRole("button", { name: "Outlook Classic" }));
    expect(await screen.findByText("Anna")).toBeVisible(); expect(api.applyReconciliation).not.toHaveBeenCalled();
    expect(screen.getByRole("checkbox", { name: "Anna übernehmen" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Bea übernehmen" })).not.toBeChecked();
    expect(screen.queryByRole("checkbox", { name: "Clara übernehmen" })).toBeNull();
    expect(screen.queryByRole("checkbox", { name: "Dora übernehmen" })).toBeNull();
    await user.click(screen.getByText("1 Unterschiede")); expect(screen.getByText("Aktuell:")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Auswahl übernehmen (1)" }));
    expect(api.applyReconciliation).toHaveBeenCalledWith("native-plan", ["update"]);
    expect(await screen.findByText(/1 Einträge benötigen/)).toBeVisible();
    expect(screen.queryByText("Kontakte sind aktuell")).toBeNull();
  });
  it("cancelling does not apply or restore a backup", async () => {
    const user = userEvent.setup(); const onClose = vi.fn(); renderDialog({ onClose });
    await user.click(screen.getByRole("button", { name: "Outlook Classic" })); await screen.findByText("Anna");
    await user.click(screen.getByRole("button", { name: "Schließen" })); expect(onClose).toHaveBeenCalledOnce();
    expect(api.applyReconciliation).not.toHaveBeenCalled();
  });
  it("explicitly selected new rows are included once and double clicks cannot apply twice", async () => {
    const user = userEvent.setup(); let resolve!: (value: unknown) => void;
    api.applyReconciliation.mockImplementation(() => new Promise(done => { resolve = done; }));
    renderDialog(); await user.click(screen.getByRole("button", { name: "Outlook Classic" }));
    await user.click(await screen.findByRole("checkbox", { name: "Bea übernehmen" }));
    const submit = screen.getByRole("button", { name: "Auswahl übernehmen (2)" }); fireEvent.click(submit); fireEvent.click(submit);
    expect(api.applyReconciliation).toHaveBeenCalledTimes(1); expect(api.applyReconciliation).toHaveBeenCalledWith("native-plan", ["update", "new"]);
    expect(screen.getByRole("button", { name: "Schließen" })).toBeDisabled();
    await act(async () => resolve({ added: 1, updated: 1, unchanged: 2, review: 1 }));
  });
  it("stale preview stays open and offers a new scan without claiming success", async () => {
    const user = userEvent.setup(); api.applyReconciliation.mockRejectedValue("Daten wurden seit der Vorschau geändert."); renderDialog();
    await user.click(screen.getByRole("button", { name: "Outlook Classic" }));
    await user.click(await screen.findByRole("button", { name: "Auswahl übernehmen (1)" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("seit der Vorschau");
    expect(screen.queryByText("Prüfung abgeschlossen")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Erneut prüfen" })); await waitFor(() => expect(api.previewReconciliation).toHaveBeenCalledTimes(2));
  });
  it("paginates and retains selection when filters change", async () => {
    const user = userEvent.setup(); api.previewReconciliation.mockResolvedValue({ ...preview,
      items: [...preview.items, ...Array.from({ length: 80 }, (_, i) => ({ ...preview.items[2], key: `x${i}`, label: `Alt ${i}` }))] });
    renderDialog(); await user.click(screen.getByRole("button", { name: "Outlook Classic" })); await screen.findByText("Anna");
    expect(screen.getAllByRole("row")).toHaveLength(51);
    await user.click(screen.getByRole("button", { name: "Weiter" })); expect(screen.getByText("Seite 2 / 2")).toBeVisible();
    await user.selectOptions(screen.getByRole("combobox", { name: "Status" }), "update");
    expect(await screen.findByText("Seite 1 / 1")).toBeVisible(); expect(screen.getByRole("checkbox", { name: "Anna übernehmen" })).toBeChecked();
  });
  it("calendar and Thunderbird use the same safe native plan", async () => {
    const user = userEvent.setup(); renderDialog({ kind: "calendar" });
    await user.click(screen.getByRole("button", { name: "Thunderbird" })); await screen.findByText("Anna");
    expect(api.previewReconciliation).toHaveBeenCalledWith("calendar", "thunderbird");
  });
  it("an empty selection only finishes the check", async () => {
    const user = userEvent.setup(); renderDialog(); await user.click(screen.getByRole("button", { name: "Outlook Classic" }));
    await user.click(await screen.findByRole("checkbox", { name: "Anna übernehmen" }));
    await user.click(screen.getByRole("button", { name: "Prüfung abschließen" }));
    expect(api.applyReconciliation).toHaveBeenCalledWith("native-plan", []);
  });
  it("refresh failure after a successful transaction does not claim rollback or repeat writes", async () => {
    const user = userEvent.setup(); renderDialog({ onChanged: vi.fn().mockRejectedValue(new Error("refresh")) });
    await user.click(screen.getByRole("button", { name: "Outlook Classic" }));
    await user.click(await screen.findByRole("button", { name: "Auswahl übernehmen (1)" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Gespeichert");
    expect(screen.getByText("Prüfung abgeschlossen")).toBeVisible(); expect(api.applyReconciliation).toHaveBeenCalledOnce();
  });
});
