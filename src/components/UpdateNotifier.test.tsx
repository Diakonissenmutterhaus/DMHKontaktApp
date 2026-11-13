import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { checkMock, policyMock, installMock, diagnosticMock } = vi.hoisted(() => ({
  checkMock: vi.fn(), policyMock: vi.fn(), installMock: vi.fn(), diagnosticMock: vi.fn(),
}));
vi.mock("../services/appUpdates", () => ({ getAppUpdatePolicy: policyMock, installAppUpdate: installMock }));
vi.mock("../utils/notificationPolicy", () => ({ reportDiagnostic: diagnosticMock }));

vi.mock("@tauri-apps/api/core", () => ({
  isTauri: () => true,
  invoke: vi.fn().mockResolvedValue(undefined)
}));

vi.mock("@tauri-apps/plugin-updater", () => ({
  check: checkMock
}));

import { UpdateNotifier, updateAvailableEvent } from "./UpdateNotifier";

const update = { rid: 42, version: "0.1.2", currentVersion: "0.1.1", body: "", date: "2026-09-24", downloadAndInstall: vi.fn() };
const snoozeKey = "agendakontakte.dismissedUpdateVersion";

describe("UpdateNotifier", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    checkMock.mockReset();
    policyMock.mockReset().mockResolvedValue({ canSelfUpdate: true, reason: "per_user_nsis" });
    installMock.mockReset().mockImplementation(() => new Promise(() => {}));
    diagnosticMock.mockReset();
    update.downloadAndInstall.mockReset();
    localStorage.removeItem(snoozeKey);
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("não interrompe o usuário quando o GitHub não oferece atualização", async () => {
    checkMock.mockResolvedValue(null);
    render(<UpdateNotifier />);

    await act(() => vi.advanceTimersByTimeAsync(1_500));

    expect(checkMock).toHaveBeenCalledOnce();
    expect(screen.queryByRole("dialog", { name: "Update" })).not.toBeInTheDocument();
  });

  it("automatically shows a new release without installing it or requiring a manual check", async () => {
    checkMock.mockResolvedValue(update);
    render(<UpdateNotifier />);

    await act(() => vi.advanceTimersByTimeAsync(1_500));
    expect(screen.getByRole("dialog", { name: "Update" })).toHaveTextContent("Neue Version verfügbar");
    expect(screen.getByRole("dialog", { name: "Update" })).toHaveTextContent("0.1.2");
    expect(screen.getByRole("button", { name: "Jetzt aktualisieren" })).toBeVisible();
    expect(update.downloadAndInstall).not.toHaveBeenCalled();
  });

  it("snoozes a dismissed version for four hours and then shows it again", async () => {
    checkMock.mockResolvedValue(update);
    render(<UpdateNotifier />);
    await act(() => vi.advanceTimersByTimeAsync(1_500));
    fireEvent.click(screen.getByRole("button", { name: "Später" }));
    expect(screen.queryByRole("dialog", { name: "Update" })).toBeNull();
    await act(() => vi.advanceTimersByTimeAsync(30 * 60_000));
    expect(screen.queryByRole("dialog", { name: "Update" })).toBeNull();
    await act(() => vi.advanceTimersByTimeAsync(210 * 60_000));
    expect(screen.getByRole("dialog", { name: "Update" })).toHaveTextContent("0.1.2");
  });

  it("does not snooze a different new release", async () => {
    localStorage.setItem(snoozeKey, JSON.stringify({ version: "0.1.2", until: Date.now() + 4 * 60 * 60_000 }));
    checkMock.mockResolvedValue({ ...update, version: "0.1.3" });
    render(<UpdateNotifier />);
    await act(() => vi.advanceTimersByTimeAsync(1_500));
    expect(screen.getByRole("dialog", { name: "Update" })).toHaveTextContent("0.1.3");
  });

  it("shows a manually requested update even when its automatic notice is snoozed", async () => {
    localStorage.setItem(snoozeKey, JSON.stringify({ version: update.version, until: Date.now() + 4 * 60 * 60_000 }));
    checkMock.mockResolvedValue(update);
    render(<UpdateNotifier />);
    await act(() => vi.advanceTimersByTimeAsync(1_500));
    expect(screen.queryByRole("dialog", { name: "Update" })).toBeNull();
    act(() => window.dispatchEvent(new CustomEvent(updateAvailableEvent, { detail: { force: true, update } })));
    expect(screen.getByRole("dialog", { name: "Update" })).toHaveTextContent("Neue Version verfügbar");
  });

  it("silently retries a failed network check and shows the available update on recovery", async () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      checkMock.mockRejectedValueOnce(new Error("Offline")).mockResolvedValue(update);
      render(<UpdateNotifier />);
      await act(() => vi.advanceTimersByTimeAsync(1_500));
      expect(screen.queryByRole("dialog", { name: "Update" })).toBeNull();
      await act(() => vi.advanceTimersByTimeAsync(60_000));
      expect(screen.getByRole("dialog", { name: "Update" })).toHaveTextContent("0.1.2");
    } finally { warning.mockRestore(); }
  });

  async function showUpdate() {
    checkMock.mockResolvedValue(update);
    render(<UpdateNotifier />);
    await act(() => vi.advanceTimersByTimeAsync(1_500));
  }

  it.each(["managed_msi", "machine_installation", "protected_installation", "installation_check_failed"])(
    "does not invoke an installer or restart for %s", async (reason) => {
      policyMock.mockResolvedValue({ canSelfUpdate: false, reason });
      await showUpdate();
      await act(async () => fireEvent.click(screen.getByText("Jetzt aktualisieren")));
      expect(installMock).not.toHaveBeenCalled();
      expect(update.downloadAndInstall).not.toHaveBeenCalled();
      expect(screen.getByRole("dialog", { name: "Update" })).toHaveTextContent("Updates durch die EDV");
      expect(screen.queryByText(/abgeschlossen/)).toBeNull();
    },
  );

  it("fails closed when checking installation permissions fails", async () => {
    policyMock.mockRejectedValue(new Error("os error: denied"));
    await showUpdate();
    await act(async () => fireEvent.click(screen.getByText("Jetzt aktualisieren")));
    expect(installMock).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: "Update" })).toHaveTextContent("Update nicht abgeschlossen");
    expect(screen.queryByText(/os error/)).toBeNull();
    expect(diagnosticMock).toHaveBeenCalledWith(expect.objectContaining({ level: "error", message: "os error: denied" }));
  });

  it("shows a modal immediately and only installs once after eligibility is confirmed", async () => {
    let resolvePolicy!: (value: unknown) => void;
    policyMock.mockImplementation(() => new Promise(resolve => { resolvePolicy = resolve; }));
    await showUpdate();
    const button = screen.getByText("Jetzt aktualisieren");
    act(() => { fireEvent.click(button); fireEvent.click(button); });
    expect(screen.getByRole("dialog", { name: "DMH Backup aktualisieren" })).toHaveAttribute("aria-modal", "true");
    expect(screen.getByRole("status")).toHaveTextContent("vorbereitet");
    expect(screen.getByRole("progressbar")).not.toHaveAttribute("value");
    expect(installMock).not.toHaveBeenCalled();
    await act(async () => resolvePolicy({ canSelfUpdate: true, reason: "per_user_nsis" }));
    expect(policyMock).toHaveBeenCalledOnce();
    expect(installMock).toHaveBeenCalledOnce();
    expect(installMock).toHaveBeenCalledWith(42, expect.any(Function));
  });

  it("shows download percentage then indeterminate installation without claiming success", async () => {
    await showUpdate();
    await act(async () => fireEvent.click(screen.getByText("Jetzt aktualisieren")));
    const onEvent = installMock.mock.calls[0][1];
    act(() => {
      onEvent({ event: "Started", data: { contentLength: 1000 } });
      onEvent({ event: "Progress", data: { chunkLength: 300 } });
    });
    expect(screen.getByRole("progressbar")).toHaveAttribute("value", "30");
    expect(screen.getByRole("status")).toHaveTextContent("30 %");
    act(() => onEvent({ event: "Installing" }));
    expect(screen.getByRole("progressbar")).not.toHaveAttribute("value");
    expect(screen.getByRole("status")).toHaveTextContent("wird installiert");
    expect(screen.queryByText("Update abgeschlossen")).toBeNull();
  });

  it("keeps unknown download length indeterminate", async () => {
    await showUpdate();
    await act(async () => fireEvent.click(screen.getByText("Jetzt aktualisieren")));
    act(() => {
      installMock.mock.calls[0][1]({ event: "Started", data: {} });
      installMock.mock.calls[0][1]({ event: "Progress", data: { chunkLength: 100 } });
    });
    expect(screen.getByRole("progressbar")).not.toHaveAttribute("value");
  });

  it("online, scheduled and manual checks cannot replace an ongoing installation", async () => {
    await showUpdate();
    await act(async () => fireEvent.click(screen.getByText("Jetzt aktualisieren")));
    act(() => {
      window.dispatchEvent(new Event("online"));
      window.dispatchEvent(new CustomEvent(updateAvailableEvent, { detail: { force: true, update: { ...update, version: "9.9.9" } } }));
    });
    await act(() => vi.advanceTimersByTimeAsync(regularCheckDelay()));
    expect(checkMock).toHaveBeenCalledOnce();
    expect(screen.getByRole("dialog", { name: "DMH Backup aktualisieren" })).toHaveTextContent("0.1.2");
    expect(installMock).toHaveBeenCalledOnce();
  });

  it("a check already in flight cannot close the loading dialog", async () => {
    await showUpdate();
    let resolveCheck!: (value: unknown) => void;
    checkMock.mockImplementationOnce(() => new Promise(resolve => { resolveCheck = resolve; }));
    act(() => window.dispatchEvent(new Event("online")));
    await act(async () => fireEvent.click(screen.getByText("Jetzt aktualisieren")));
    await act(async () => resolveCheck({ ...update, version: "9.9.9" }));
    expect(screen.getByRole("dialog", { name: "DMH Backup aktualisieren" })).toHaveTextContent("0.1.2");
  });

  it("releases the loading dialog after a failure and allows retry without showing technical data", async () => {
    installMock.mockRejectedValueOnce(new Error("HTTP 403: invalid signature"));
    await showUpdate();
    await act(async () => fireEvent.click(screen.getByText("Jetzt aktualisieren")));
    expect(screen.queryByRole("dialog", { name: "DMH Backup aktualisieren" })).toBeNull();
    expect(screen.getByRole("dialog", { name: "Update" })).not.toHaveTextContent("HTTP");
    await act(async () => fireEvent.click(screen.getByText("Erneut versuchen")));
    expect(installMock).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("dialog", { name: "DMH Backup aktualisieren" })).toBeVisible();
  });

  it("handles a policy change during download without launching a fallback installer", async () => {
    installMock.mockRejectedValueOnce("update_managed: machine_installation");
    await showUpdate();
    await act(async () => fireEvent.click(screen.getByText("Jetzt aktualisieren")));
    expect(screen.getByRole("dialog", { name: "Update" })).toHaveTextContent("Updates durch die EDV");
    expect(update.downloadAndInstall).not.toHaveBeenCalled();
  });

  it("does not announce success if the native handoff returns unexpectedly", async () => {
    installMock.mockResolvedValueOnce(undefined);
    await showUpdate();
    await act(async () => fireEvent.click(screen.getByText("Jetzt aktualisieren")));
    expect(screen.getByRole("dialog", { name: "Update" })).toHaveTextContent("Update nicht abgeschlossen");
  });
});

function regularCheckDelay() { return 30 * 60_000; }
