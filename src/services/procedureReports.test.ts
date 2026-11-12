import {beforeEach,afterEach,expect,it,vi} from "vitest";
const {invoke}=vi.hoisted(()=>({invoke:vi.fn()}));
vi.mock("@tauri-apps/api/core",()=>({invoke}));
let reports:typeof import("./procedureReports");
beforeEach(async()=>{invoke.mockReset();localStorage.clear();vi.resetModules();reports=await import("./procedureReports");});
afterEach(()=>vi.useRealTimers());
it("records a terminal result once and redacts credentials",async()=>{
 invoke.mockResolvedValue(undefined);
 const report=await reports.beginProcedureReport("outlook_exchange","test@example.invalid");
 await reports.finishProcedureReport(report,"error","HTTP 401 Bearer private-token access_token=private-secret");
 await reports.finishProcedureReport(report,"success");
 expect(invoke).toHaveBeenCalledTimes(2);
 const payload=invoke.mock.calls[1][1].event;
 expect(payload.status).toBe("error");expect(payload.sequence).toBe(1);
 expect(payload.message).not.toContain("private-token");expect(payload.message).not.toContain("private-secret");
});
it("keeps failures without an email for retry when the native queue is unavailable",async()=>{
 invoke.mockRejectedValue(new Error("database unavailable"));
 const report=await reports.beginProcedureReport("m365_login");
 await expect(reports.finishProcedureReport(report,"error","Login failed Bearer secret-token")).resolves.toBeUndefined();
 const saved=JSON.parse(localStorage.getItem("dmh.procedure-report-retry.v1")!);
 expect(saved).toHaveLength(2);expect(saved[1].accountEmail).toBe("");expect(saved[1].status).toBe("error");
 expect(saved[1].message).not.toContain("secret-token");
 invoke.mockClear();invoke.mockResolvedValue(undefined);
 vi.resetModules();reports=await import("./procedureReports");
 const stop=reports.startReportDelivery();
 await vi.waitFor(()=>expect(JSON.parse(localStorage.getItem("dmh.procedure-report-retry.v1")!)).toHaveLength(0));
 const replay=invoke.mock.calls.find(([cmd,args])=>cmd==="record_procedure_report"&&args.event.eventId===saved[1].eventId&&args.event.occurredAt===saved[1].occurredAt);
 expect(replay).toBeDefined();stop();
});
it("reports synchronization failures and their recovery separately from login",async()=>{
 invoke.mockResolvedValue(undefined);
 await reports.reportSynchronizationFailure("3 calendars unavailable");
 await reports.reportSynchronizationFailure("3 calendars unavailable");
 await reports.reportSynchronizationRecovery();
 const terminal=invoke.mock.calls.filter(([cmd,args])=>cmd==="record_procedure_report"&&args.event.sequence===1).map(([,args])=>args.event);
 expect(terminal.map(e=>[e.procedure,e.status])).toEqual([["m365_sync","error"],["m365_sync","success"]]);
});
