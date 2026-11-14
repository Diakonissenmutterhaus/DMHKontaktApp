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
 await reports.reportSynchronizationFailure("Generic post-login failure","account@example.test",0);
 await reports.reportSynchronizationRecovery();
 const terminal=invoke.mock.calls.filter(([cmd,args])=>cmd==="record_procedure_report"&&args.event.sequence===1).map(([,args])=>args.event);
 expect(terminal.map(e=>[e.procedure,e.status])).toEqual([["m365_sync","error"],["m365_sync","success"]]);
});

it("queues the diagnostic on the same attempt without delaying or changing its result",async()=>{
 vi.stubEnv("VITE_DMH_SUPPORT_DIAGNOSTICS","true");
 let complete!:(value:unknown)=>void;
 invoke.mockImplementation(async(command)=>command==="collect_support_diagnostic" ? new Promise(resolve=>{complete=resolve;}) : undefined);
 const report=await reports.beginProcedureReport("m365_login");
 await reports.finishProcedureReport(report,"error","Account unavailable");
 const original=invoke.mock.calls.find(([command,args])=>command==="record_procedure_report" && args.event.sequence===1)![1].event;
 expect(original.accountEmail).toBe("");
 complete({code:"DMH-M365-LOGIN",text:'PC: LAPTOP\nprocessId: 42\npassword=do-not-export\npath: C:/Office'});
 await vi.waitFor(()=>expect(invoke.mock.calls.some(([command,args])=>command==="record_procedure_report" && args.event.diagnostic)).toBe(true));
 const enriched=invoke.mock.calls.find(([command,args])=>command==="record_procedure_report" && args.event.diagnostic)![1].event;
 expect(enriched).toMatchObject({attemptId:original.attemptId,procedure:"m365_login",status:"error",sequence:2,occurredAt:original.occurredAt,accountEmail:""});
 expect(enriched.diagnostic.text).toContain('processId: 42');
 expect(enriched.diagnostic.text).not.toContain('do-not-export');
 vi.unstubAllEnvs();
});

it("replays a diagnostic after an unavailable local queue without losing its original timestamp",async()=>{
 vi.stubEnv("VITE_DMH_SUPPORT_DIAGNOSTICS","true");
 invoke.mockImplementation(async(command)=>{if(command==="collect_support_diagnostic")return {code:"DMH-M365-SYNC",text:"PC: Test\nDetails"};throw new Error("database unavailable");});
 const report=await reports.beginProcedureReport("m365_sync");
 await reports.finishProcedureReport(report,"error","Calendar unavailable");
 await vi.waitFor(()=>expect(JSON.parse(localStorage.getItem("dmh.procedure-report-retry.v1")!).length).toBe(3));
 const saved=JSON.parse(localStorage.getItem("dmh.procedure-report-retry.v1")!)[2];
 invoke.mockClear();invoke.mockResolvedValue(undefined);
 vi.resetModules();reports=await import("./procedureReports");
 const stop=reports.startReportDelivery();
 await vi.waitFor(()=>expect(JSON.parse(localStorage.getItem("dmh.procedure-report-retry.v1")!)).toHaveLength(0));
 expect(invoke.mock.calls.find(([cmd,args])=>cmd==="record_procedure_report" && args.event.eventId===saved.eventId)?.[1].event).toEqual(saved);
 stop();vi.unstubAllEnvs();
});
