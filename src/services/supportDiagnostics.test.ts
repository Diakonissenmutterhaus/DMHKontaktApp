import { beforeEach, afterEach, expect, it, vi } from "vitest";
const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
beforeEach(() => { vi.resetModules(); invoke.mockReset(); vi.stubEnv("VITE_DMH_SUPPORT_DIAGNOSTICS", "true"); });
afterEach(() => vi.unstubAllEnvs());
const request = { attemptId: "5c731aab-5ee1-433c-9c29-cd3429d30f43", procedure: "outlook_exchange" as const, stage: "outlook_open", message: "Outlook could not close" };
it("captures a blocked result once without retrying migration or authentication", async () => {
  const { captureSupportDiagnostic } = await import("./supportDiagnostics");
  invoke.mockResolvedValue({ code: "DMH-OUTLOOK-CLOSE-BLOCKED", text: "report" });
  const result = await captureSupportDiagnostic(request); await captureSupportDiagnostic(request);
  expect(result?.text).toBe("report");
  expect(invoke).toHaveBeenCalledTimes(1);
  expect(invoke).toHaveBeenCalledWith("collect_support_diagnostic", { request });
});
it("preserves the original failure when diagnostic collection itself fails", async () => {
  const { captureSupportDiagnostic } = await import("./supportDiagnostics");
  invoke.mockRejectedValue(new Error("reader failed"));
  const result = await captureSupportDiagnostic(request);
  expect(result?.text).toContain("reader failed");
  expect(result?.text).toContain(request.message);
});
it("does not collect outside the diagnostic build and strips secret-bearing errors", async () => {
  const { captureSupportDiagnostic } = await import("./supportDiagnostics");
  vi.stubEnv("VITE_DMH_SUPPORT_DIAGNOSTICS", "false");
  captureSupportDiagnostic(request);
  expect(invoke).not.toHaveBeenCalled();
  vi.stubEnv("VITE_DMH_SUPPORT_DIAGNOSTICS", "true");
  invoke.mockResolvedValue({ code: "code", text: "safe" });
  captureSupportDiagnostic({ ...request, message: "Bearer never-export-this" });
  expect(JSON.stringify(invoke.mock.calls)).not.toContain("never-export-this");

});
