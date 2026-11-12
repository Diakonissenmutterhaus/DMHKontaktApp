import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { isKiRolloutActive, useKiRollout, type KiRolloutPolicy } from "./useKiRollout";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("../utils/notificationPolicy", () => ({ invokeWithDiagnostics: invoke }));
const policy: KiRolloutPolicy = { schemaVersion: 1, enabled: true, activateAt: "2026-12-01T08:00:00+01:00", updatedAt: "2026-11-12T10:00:00Z" };
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-12-01T06:59:50Z"));
  Object.defineProperty(window, "__TAURI_INTERNALS__", { configurable: true, value: {} });
  invoke.mockReset();
});
afterEach(() => {
  cleanup();
  delete (window as any).__TAURI_INTERNALS__;
  vi.useRealTimers();
});
it("respeita ativação, desativação e horário com fuso explícito", () => {
  expect(isKiRolloutActive(null)).toBe(false);
  expect(isKiRolloutActive({ ...policy, enabled: false, activateAt: null })).toBe(false);
  expect(isKiRolloutActive({ ...policy, activateAt: null })).toBe(true);
  expect(isKiRolloutActive(policy)).toBe(false);
  expect(isKiRolloutActive(policy, Date.parse("2026-12-01T07:00:00Z"))).toBe(true);
  expect(isKiRolloutActive({ ...policy, activateAt: "invalid" })).toBe(false);
});
it("ativa o agendamento em cache mesmo offline, sem perder a configuração válida", async () => {
  invoke.mockImplementation((_command, args) => args.refresh
    ? Promise.reject(new Error("offline"))
    : Promise.resolve({ policy, lastCheckedAt: null, lastSuccessAt: policy.updatedAt, error: null }));
  const { result } = renderHook(() => useKiRollout());
  await act(async () => {});
  expect(result.current.enabled).toBe(false);
  expect(result.current.status.policy).toEqual(policy);
  await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
  expect(result.current.enabled).toBe(true);
  expect(invoke).toHaveBeenCalledTimes(2);
  await act(async () => { window.dispatchEvent(new Event("online")); });
  expect(result.current.enabled).toBe(true);
  expect(result.current.status.error).toBeTruthy();
});
it("aguarda o armazenamento estar pronto e remove o polling ao desmontar", async () => {
  invoke.mockResolvedValue({ policy: null, lastCheckedAt: null, lastSuccessAt: null, error: null });
  const { rerender, unmount } = renderHook(({ ready }) => useKiRollout(ready), { initialProps: { ready: false } });
  await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
  expect(invoke).not.toHaveBeenCalled();
  rerender({ ready: true });
  await act(async () => {});
  expect(invoke).toHaveBeenCalledTimes(2);
  unmount();
  await act(async () => { await vi.advanceTimersByTimeAsync(120_000); window.dispatchEvent(new Event("online")); });
  expect(invoke).toHaveBeenCalledTimes(2);
});
