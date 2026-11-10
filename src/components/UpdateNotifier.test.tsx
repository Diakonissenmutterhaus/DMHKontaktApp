import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { checkMock } = vi.hoisted(() => ({ checkMock: vi.fn() }));

vi.mock("@tauri-apps/api/core", () => ({
  isTauri: () => true,
  invoke: vi.fn().mockResolvedValue(undefined)
}));

vi.mock("@tauri-apps/plugin-updater", () => ({
  check: checkMock
}));

import { UpdateNotifier, updateAvailableEvent } from "./UpdateNotifier";

const update = { version: "0.1.2", currentVersion: "0.1.1", body: "", date: "2026-09-24", downloadAndInstall: vi.fn() };
const snoozeKey = "agendakontakte.dismissedUpdateVersion";

describe("UpdateNotifier", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    checkMock.mockReset();
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
    fireEvent.click(screen.getByRole("button", { name: "Spaeter" }));
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
});
