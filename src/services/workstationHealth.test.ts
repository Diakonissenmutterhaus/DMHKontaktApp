import {beforeEach,expect,it,vi} from 'vitest';
const native=vi.hoisted(()=>({invoke:vi.fn(),isTauri:()=>true}));
vi.mock('@tauri-apps/api/core',()=>native);
vi.mock('./db',()=>({getMicrosoft365ConnectionStatus:()=>Promise.resolve({connected:true,account:{email:'employee@example.test'}}),getOutlookAccountConfiguration:()=>Promise.reject(new Error('Outlook unavailable')),getOutlookOfficeAccountCheck:()=>Promise.resolve(null),getAppSetting:()=>Promise.resolve(null)}));
import {emptyHealth,latestAttempts,loadHealth,officeAccountComparison,type HealthSnapshot,type ProcedureEvent} from './workstationHealth';
beforeEach(()=>native.invoke.mockReset());
it('coalesces overlapping health queries and preserves partial data when Outlook cannot be read',async()=>{
 let resolve!: (v:unknown)=>void;native.invoke.mockImplementation((cmd:string)=>cmd==='get_workstation_health'?new Promise(r=>{resolve=r;}):Promise.resolve(cmd==='list_local_procedure_reports'?[]:{configured:false,pending:0,error:null}));
 const a=loadHealth();const b=loadHealth();expect(a).toBe(b);resolve({appVersion:'1.2.3'});const snapshot=await a;
 expect(snapshot.pc?.appVersion).toBe('1.2.3');expect(snapshot.errors).toContain('Outlook');expect(snapshot.outlook).toBeNull();expect(native.invoke.mock.calls.filter(c=>c[0]==='get_workstation_health')).toHaveLength(1);
});
it('does not infer the active Excel identity from ambiguous stored Office accounts',()=>{
 const health={...emptyHealth,m365:{connected:true,account:{email:'employee@example.test'}},office:{readSucceeded:true,accounts:[{email:'employee@example.test'},{email:'admin@example.test'}],dmhEmails:['employee@example.test']}} as HealthSnapshot;
 expect(officeAccountComparison(health)).toBe('ambiguous');health.office!.accounts=[{email:'admin@example.test',displayName:'Admin'}];expect(officeAccountComparison(health)).toBe('different');health.office!.readSucceeded=false;expect(officeAccountComparison(health)).toBe('unknown');
});
it('a late start cannot overwrite the confirmed result and a missing finish never means success',()=>{
 const event={attemptId:'one',procedure:'outlook_exchange',sequence:1,status:'success',occurredAt:'2026-11-12T10:00:00Z'} as ProcedureEvent;
 const rows=latestAttempts([{...event,sequence:0,status:'running',occurredAt:'2026-11-12T10:10:00Z'},event,{...event,attemptId:'two',status:'running',sequence:0,occurredAt:'2026-11-12T11:00:00Z'}]);
 expect(rows[0].status).toBe('running');expect(rows[1].status).toBe('success');
});
