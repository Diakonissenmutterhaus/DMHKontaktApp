import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SupportDiagnosticDialog } from "./SupportDiagnosticDialog";
const mocks = vi.hoisted(() => ({ state: null as unknown, writeText: vi.fn(), save: vi.fn(), writeTextFile: vi.fn() }));
vi.mock("../services/supportDiagnostics", () => ({ getSupportDiagnostic: () => mocks.state, supportDiagnosticEvent: "dmh:support-diagnostic" }));
vi.mock("@tauri-apps/plugin-clipboard-manager", () => ({ writeText: mocks.writeText }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ save: mocks.save }));
vi.mock("@tauri-apps/plugin-fs", () => ({ writeTextFile: mocks.writeTextFile }));
beforeEach(() => {
  mocks.state = null; vi.clearAllMocks();
  HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  HTMLDialogElement.prototype.close = function () { this.open = false; };
});
afterEach(cleanup);
const report = { request: { attemptId: "test-id", procedure: "outlook_exchange", stage: "outlook_open", message: "original failure" }, loading: false, report: { code: "DMH-OUTLOOK-CLOSE-BLOCKED", fileName: "DMH.log", text: "exact safe diagnostic", localPath: "C:\\Local\\DMH.log", saveError: null } };
function publish(value: unknown) { act(() => { mocks.state = value; window.dispatchEvent(new Event("dmh:support-diagnostic")); }); }
it("opens on failure, copies the full log and saves only the chosen file", async () => {
  render(<SupportDiagnosticDialog />); publish(report);
  expect(screen.getByRole("dialog")).toHaveAttribute("open");
  expect(screen.getByLabelText("Diagnoseprotokoll")).toHaveValue("exact safe diagnostic");
  fireEvent.click(screen.getByText("Diagnose kopieren"));
  await screen.findByText("Diagnose kopiert.");
  expect(mocks.writeText).toHaveBeenCalledWith("exact safe diagnostic");
  mocks.save.mockResolvedValue("C:\\Chosen\\test.log");
  fireEvent.click(screen.getByText(".log speichern"));
  await screen.findByText("Diagnose gespeichert.");
  expect(mocks.writeTextFile).toHaveBeenCalledWith("C:\\Chosen\\test.log", "exact safe diagnostic");
});
it("can reopen the report and cancel save without writing a file", async () => {
  render(<SupportDiagnosticDialog />); publish(report);
  fireEvent.click(screen.getAllByRole("button", { name: "Schließen" })[0]);
  fireEvent.click(screen.getByText("Letzte Diagnose"));
  expect(screen.getByRole("dialog")).toHaveAttribute("open");
  mocks.save.mockResolvedValue(null);
  await act(async () => { fireEvent.click(screen.getByText(".log speichern")); });
  await vi.waitFor(() => expect(screen.getByText(".log speichern")).not.toBeDisabled());
  expect(mocks.writeTextFile).not.toHaveBeenCalled();
});
it("keeps a copyable original error even when collection fails", async () => {
  render(<SupportDiagnosticDialog />);
  publish({ ...report, report: undefined, collectionError: "reader timeout" });
  fireEvent.click(screen.getByText("Diagnose kopieren"));
  await screen.findByText("Diagnose kopiert.");
  expect(mocks.writeText.mock.calls[0][0]).toContain("original failure");
  expect(mocks.writeText.mock.calls[0][0]).toContain("reader timeout");
});
