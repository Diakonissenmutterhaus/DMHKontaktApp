import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import ExcelJS from 'exceljs';
import { createHandler } from '../api/edv.js';
import { currentState, hashPassword, hasSession, redact, sessionCookie, summarize } from './protocol.mjs';
const origin='https://dmh-backup.vercel.app';
process.env.EDV_SESSION_SECRET='test-session-secret-not-for-production';
process.env.EDV_USERNAME='IDV';
process.env.EDV_PASSWORD_HASH=await hashPassword('test-password-only');
process.env.BLOB_READ_WRITE_TOKEN='test-only';
function fixture(){
  const rows=new Map();
  const handle=createHandler({read:async key=>rows.get(key)||null,write:async(key,value,overwrite=false)=>{if(rows.has(key)&&!overwrite)throw new Error('exists');rows.set(key,value);},scan:async prefix=>[...rows].filter(([key])=>key.startsWith(prefix)).map(([,v])=>v)});
  const admin=sessionCookie(process.env.EDV_SESSION_SECRET).split(';')[0];
  const request=(action,body,cookie=admin,extra={})=>handle(new Request(`${origin}/api/edv?action=${action}`,{method:body?'POST':'GET',headers:{origin,cookie,...(body?{'content-type':'application/json'}:{}),...extra},...(body?{body:JSON.stringify(body)}:{})}));
  return {rows,request};
}
test('anonymous users and write-only devices cannot read reports or export Excel',async()=>{
  const {request}=fixture();for(const action of ['reports','export','devices','session'])assert.equal((await request(action,null,'')).status,401);
  assert.equal((await request('login',{username:'IDV',password:'wrong'},'')).status,401);
  const login=await request('login',{username:'IDV',password:'test-password-only'},'');assert.equal(login.status,200);assert.match(login.headers.get('set-cookie'),/Secure; HttpOnly; SameSite=Strict/);
  assert.equal((await request('devices',{name:'PC'},undefined,{origin:'https://other.example'})).status,403);
});
test('session rejects forgery and expires after eight hours',()=>{
  const cookie=sessionCookie('key',1000000).split(';')[0];
  const req=new Request(origin,{headers:{cookie}});assert.equal(hasSession(req,'key',1001000),true);assert.equal(hasSession(req,'wrong',1001000),false);assert.equal(hasSession(req,'key',1000000+28800001),false);
});
test('reports survive retries, preserve latest sequence, redact tokens and export string cells',async()=>{
  const {request,rows}=fixture();const config=await(await request('devices',{name:'PC-Test'})).json();
  const headers={'x-dmh-device':config.deviceId,authorization:`Bearer ${config.token}`};
  const start={eventId:randomUUID(),attemptId:randomUUID(),sequence:0,procedure:'outlook_exchange',status:'running',occurredAt:new Date().toISOString(),windowsUser:'=CMD()',computer:'PC-Test',accountEmail:'test@example.test',step:'Start',appVersion:'0.1.test'};
  assert.equal((await request('ingest',start,'',headers)).status,200);
  assert.equal((await request('ingest',start,'',headers)).status,200);
  const end={...start,eventId:randomUUID(),sequence:1,status:'error',message:'HTTP 401 Bearer secret-token access_token=top-secret'};
  assert.equal((await request('ingest',end,'',headers)).status,200);
  assert.equal([...rows.keys()].filter(k=>k.startsWith('events/')).length,2);
  const overview=await(await request('reports')).json();assert.equal(overview.reports.length,1);assert.equal(overview.reports[0].status,'error');assert.doesNotMatch(overview.reports[0].message,/secret-token|top-secret/);
  const exported=await request('export');assert.equal(exported.status,200);const workbook=new ExcelJS.Workbook();await workbook.xlsx.load(Buffer.from(await exported.arrayBuffer()));assert.equal(workbook.getWorksheet('Übersicht').getCell('A2').value,'=CMD()');assert.equal(workbook.getWorksheet('Versuchsverlauf').rowCount,3);
  assert.equal((await request('ingest',{...end,eventId:randomUUID()},'',headers)).status,409);
  await request('revoke',{deviceId:config.deviceId});assert.equal((await request('ingest',{...end,eventId:randomUUID(),sequence:2},'',headers)).status,401);
});
test('rejects malformed reports and keeps independent devices and attempts separate',async()=>{
  const {request}=fixture();const config=await(await request('devices',{name:'PC'})).json();const headers={'x-dmh-device':config.deviceId,authorization:`Bearer ${config.token}`};assert.equal((await request('ingest',{password:'secret'},'',headers)).status,400);
  assert.equal(summarize([{deviceId:'a',attemptId:'x',sequence:1,receivedAt:'2026-01-01'},{deviceId:'b',attemptId:'x',sequence:0,receivedAt:'2026-01-02'}]).length,2);
  assert.equal(redact('a'.repeat(2000)).length,1800);
});
test('current view replaces an old failure with the successful retry, preserving history and other users',()=>{
  const events=[{deviceId:'pc',windowsUser:'anna',procedure:'outlook_exchange',attemptId:'old',sequence:1,status:'error',receivedAt:'2026-11-01'},
    {deviceId:'pc',windowsUser:'anna',procedure:'outlook_exchange',attemptId:'new',sequence:1,status:'success',receivedAt:'2026-11-02'},
    {deviceId:'pc',windowsUser:'bert',procedure:'outlook_exchange',attemptId:'other-user',sequence:1,status:'error',receivedAt:'2026-11-02'}];
  const attempts=summarize(events);assert.equal(attempts.length,3);const current=currentState(attempts);assert.equal(current.length,2);assert.equal(current.find(row=>row.windowsUser==='anna').status,'success');
});

test('diagnostic reports reach the private overview and Excel without gaining read access',async()=>{
  const {request}=fixture();const config=await(await request('devices',{name:'PC-Diagnose'})).json();const headers={'x-dmh-device':config.deviceId,authorization:`Bearer ${config.token}`};
  const event={eventId:randomUUID(),attemptId:randomUUID(),sequence:1,procedure:'diagnostics',status:'success',occurredAt:new Date().toISOString(),message:'Outlook: Exchange',computer:'PC-Diagnose',windowsUser:'employee'};
  assert.equal((await request('ingest',event,'',headers)).status,200);
  assert.equal((await request('reports',null,'',headers)).status,401);
  const reports=await(await request('reports')).json();assert.equal(reports.reports[0].procedure,'diagnostics');
  const exported=await request('export');assert.equal(exported.status,200);const book=new ExcelJS.Workbook();await book.xlsx.load(Buffer.from(await exported.arrayBuffer()));assert(book.worksheets.some(sheet=>JSON.stringify(sheet.getSheetValues()).includes('PC-Diagnose')));
});
