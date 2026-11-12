import { beforeEach, expect, it, vi } from "vitest";
const { invoke } = vi.hoisted(()=>({invoke:vi.fn()}));
vi.mock("@tauri-apps/api/core",()=>({invoke}));
import { beginProcedureReport, finishProcedureReport, sanitizeReportMessage } from "./procedureReports";
beforeEach(()=>{invoke.mockReset();});
it("records a terminal result once and removes credentials before sending to the native outbox",async()=>{
  invoke.mockResolvedValue(undefined);
  const report=await beginProcedureReport("outlook_exchange","test@example.invalid");
  await finishProcedureReport(report,"error","HTTP 401 Bearer private-token access_token=private-secret");
  await finishProcedureReport(report,"success");
  expect(invoke).toHaveBeenCalledTimes(2);
  const payload=invoke.mock.calls[1][1].event;
  expect(payload.status).toBe("error");expect(payload.sequence).toBe(1);
  expect(payload.message).not.toContain("private-token");expect(payload.message).not.toContain("private-secret");
});
it("never interrupts the actual procedure when reporting is unavailable",async()=>{
  invoke.mockRejectedValue(new Error("database unavailable"));
  const report=await beginProcedureReport("m365_login");
  await expect(finishProcedureReport(report,"success")).resolves.toBeUndefined();
  expect(sanitizeReportMessage("x".repeat(5000))).toHaveLength(1800);
});
