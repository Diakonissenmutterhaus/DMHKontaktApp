import { act, render, screen } from "@testing-library/react";
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

describe("UpdateNotifier", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    checkMock.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("não interrompe o usuário quando o GitHub não oferece atualização", async () => {
    checkMock.mockResolvedValue(null);
    render(<UpdateNotifier />);

    await act(() => vi.advanceTimersByTimeAsync(1_500));

    expect(checkMock).toHaveBeenCalledOnce();
    expect(screen.queryByRole("dialog", { name: "Update" })).not.toBeInTheDocument();
  });

  it("keeps automatic releases silent and shows a manually requested update", async () => {
    const update = {
      version: "0.1.2",
      currentVersion: "0.1.1",
      body: "",
      date: "2026-09-24",
      downloadAndInstall: vi.fn()
    };
    checkMock.mockResolvedValue(update);
    render(<UpdateNotifier />);

    await act(() => vi.advanceTimersByTimeAsync(1_500));
    expect(screen.queryByRole("dialog", { name: "Update" })).not.toBeInTheDocument();
    act(() => window.dispatchEvent(new CustomEvent(updateAvailableEvent, { detail: { force: true, update } })));

    expect(screen.getByRole("dialog", { name: "Update" })).toHaveTextContent("Neue Version verfügbar");
    expect(screen.getByRole("dialog", { name: "Update" })).toHaveTextContent("0.1.2");
  });
});
