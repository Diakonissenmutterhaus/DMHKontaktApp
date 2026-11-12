import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { challenge, validProof } from './device-enrollment.mjs';
import ExcelJS from 'exceljs';
import { createHandler } from '../api/edv.js';
import { currentState, digest, hashPassword, hasSession, redact, sessionCookie, summarize } from './protocol.mjs';
const origin='https://dmh-backup.vercel.app';
process.env.EDV_SESSION_SECRET='test-session-secret-not-for-production';
process.env.EDV_USERNAME='IDV';
process.env.EDV_PASSWORD_HASH=await hashPassword('test-password-only');
process.env.BLOB_READ_WRITE_TOKEN='test-only';
function fixture(){
  const rows=new Map();
  const handle=createHandler({read:async key=>rows.get(key)||null,write:async(key,value,overwrite=false)=>{if(rows.has(key)&&!overwrite)throw new Error('exists');rows.set(key,value);},scan:async prefix=>[...rows].filter(([key])=>key.startsWith(prefix)).map(([,v])=>v)});
  const admin=sessionCookie(process.env.EDV_SESSION_SECRET).split(';')[0];
  const request=(action,body,cookie=admin,extra={})=>{const headers={origin,cookie,...(body?{'content-type':'application/json'}:{}),...extra};if(extra.origin===null)delete headers.origin;return handle(new Request(`${origin}/api/edv?action=${action}`,{method:body?'POST':'GET',headers,...(body?{body:JSON.stringify(body)}:{})}));};
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

test('attempt totals count distinct attempts before filtering, including backfills without email', async () => {
  const { request, rows } = fixture();
  const base = { deviceId: 'pc-a', windowsUser: 'anna', computer: 'PC-A', procedure: 'm365_login', accountEmail: '', message: '', step: 'Login', appVersion: '0.1.40' };
  const events = [
    { ...base, attemptId: 'first', sequence: 0, status: 'running', occurredAt: '2026-11-01T10:00:00Z' },
    { ...base, attemptId: 'first', sequence: 1, status: 'error', occurredAt: '2026-11-01T10:01:00Z' },
    { ...base, attemptId: 'second', sequence: 1, status: 'success', accountEmail: 'anna@example.test', occurredAt: '2026-11-02T10:00:00Z' },
    { ...base, attemptId: 'third', sequence: 1, status: 'error', occurredAt: '2026-10-31T10:00:00Z' },
    { ...base, attemptId: 'other-user', windowsUser: 'bert', sequence: 1, status: 'success', occurredAt: '2026-11-02T10:00:00Z' },
    { ...base, attemptId: 'other-pc', deviceId: 'pc-b', sequence: 1, status: 'success', occurredAt: '2026-11-02T10:00:00Z' },
    { ...base, attemptId: 'other-procedure', procedure: 'outlook_exchange', sequence: 1, status: 'success', occurredAt: '2026-11-02T10:00:00Z' }
  ];
  events.forEach((event, index) => rows.set(`events/${index}`, { ...event, receivedAt: '2026-11-03T10:00:00Z' }));
  const result = await (await request('reports&status=success&sort=attemptCount&direction=desc')).json();
  assert.equal(result.reports[0].attemptId, 'second');
  assert.equal(result.reports[0].attemptCount, 3);
  assert(result.reports.slice(1).every(row => row.attemptCount === 1));
  const history = await (await request('reports&view=history&search=anna')).json();
  assert.equal(history.reports.find(row => row.attemptId === 'first').attemptCount, 3);
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(Buffer.from(await (await request('export&sort=attemptCount&direction=desc')).arrayBuffer()));
  assert.equal(book.getWorksheet('Übersicht').getCell('M2').value, 3);
});

test('diagnostic reports reach the private overview and Excel without gaining read access',async()=>{
  const {request}=fixture();const config=await(await request('devices',{name:'PC-Diagnose'})).json();const headers={'x-dmh-device':config.deviceId,authorization:`Bearer ${config.token}`};
  const event={eventId:randomUUID(),attemptId:randomUUID(),sequence:1,procedure:'diagnostics',status:'success',occurredAt:new Date().toISOString(),message:'Outlook: Exchange',computer:'PC-Diagnose',windowsUser:'employee'};
  assert.equal((await request('ingest',event,'',headers)).status,200);
  assert.equal((await request('reports',null,'',headers)).status,401);
  const reports=await(await request('reports')).json();assert.equal(reports.reports[0].procedure,'diagnostics');
  const exported=await request('export');assert.equal(exported.status,200);const book=new ExcelJS.Workbook();await book.xlsx.load(Buffer.from(await exported.arrayBuffer()));assert(book.worksheets.some(sheet=>JSON.stringify(sheet.getSheetValues()).includes('PC-Diagnose')));
});

function solve(value) {
  for(let nonce=0;nonce<=10000000;nonce++) {
    const bytes=createHash('sha256').update(`${value}:${nonce}`).digest();
    if(bytes[0]===0&&bytes[1]===0&&bytes[2]<64)return nonce;
  }
  throw new Error('work not solved');
}
test('automatic enrollment needs proof, survives retry, cannot overwrite or bypass revocation',async()=>{
  const {request,rows}=fixture();
  const token='a'.repeat(43),deviceId=randomUUID();
  const input={deviceId,token,computer:'PC-Auto',windowsUser:'anna'};
  const issued=await(await request('enroll-challenge',{deviceId,credentialHash:digest(token)},'',{origin:null})).json();
  assert.equal(issued.difficulty,18);
  input.challenge=issued.challenge;input.nonce=solve(issued.challenge);
  assert.equal((await request('enroll',{...input,token:'b'.repeat(43)},'')).status,400);
  assert.equal((await request('enroll',{...input,challenge:input.challenge+'x'},'')).status,400);
  assert.equal((await request('enroll',input,'',{origin:'https://foreign.example'})).status,403);
  for(let i=0;i<2;i++)assert.equal((await request('enroll',input,'',{origin:null})).status,200);
  assert.equal(rows.size,1);
  const headers={'x-dmh-device':deviceId,authorization:`Bearer ${token}`};
  assert.equal((await request('device-status',null,'',headers)).status,200);
  for(const action of ['reports','devices','export'])assert.equal((await request(action,null,'',headers)).status,401);
  const historical={eventId:randomUUID(),attemptId:randomUUID(),sequence:1,procedure:'outlook_exchange',status:'error',occurredAt:'2026-11-10T10:00:00Z',message:'Office-Konto nicht ermittelt',computer:'PC-Auto',windowsUser:'anna'};
  const successful={...historical,eventId:randomUUID(),attemptId:randomUUID(),status:'success',occurredAt:'2026-11-12T10:00:00Z',message:'Exchange eingerichtet'};
  for(const event of [successful,historical,historical])assert.equal((await request('ingest',event,'',{...headers,origin:null})).status,200);
  const current=await(await request('reports')).json();assert.equal(current.reports.length,1);assert.equal(current.reports[0].status,'success');
  const history=await(await request('reports&view=history')).json();assert.equal(history.reports.length,2);
  assert.equal(history.reports.find(row=>row.status==='error').occurredAt,historical.occurredAt.replace('Z','.000Z'));
  assert.equal(history.reports.find(row=>row.status==='error').message,historical.message);
  const listed=await(await request('devices')).json();
  assert.equal(listed.devices[0].registration,'automatic');assert.equal(listed.devices[0].identityVerified,false);
  assert(!JSON.stringify(listed).includes(digest(token)));
  assert.equal((await request('revoke',{deviceId})).status,200);
  assert.equal((await request('enroll',input,'')).status,403);
  assert.equal((await request('device-status',null,'',headers)).status,401);
  const other=challenge({deviceId,credentialHash:digest('b'.repeat(43))},process.env.EDV_SESSION_SECRET);
  assert.equal((await request('enroll',{...input,token:'b'.repeat(43),challenge:other.challenge,nonce:solve(other.challenge)},'')).status,409);
});
test('enrollment challenges expire and bind proof to the installation',()=>{
  const deviceId=randomUUID(),token='c'.repeat(43),key='test-key';
  const issued=challenge({deviceId,credentialHash:digest(token)},key,1000000);
  const input={deviceId,token,challenge:issued.challenge,nonce:solve(issued.challenge)};
  assert(validProof(input,key,1000010));assert(!validProof(input,key,1300001));
  assert(!validProof({...input,deviceId:randomUUID()},key,1000010));
  assert(!validProof(input,'wrong-key',1000010));
});
test('delayed historical failures never replace a newer successful attempt',()=>{
  const events=[
    {deviceId:'pc',windowsUser:'anna',procedure:'outlook_exchange',attemptId:'new',sequence:1,status:'success',occurredAt:'2026-11-12T12:00:00Z',receivedAt:'2026-11-12T12:00:01Z'},
    {deviceId:'pc',windowsUser:'anna',procedure:'outlook_exchange',attemptId:'old',sequence:1,status:'error',occurredAt:'2026-11-10T12:00:00Z',receivedAt:'2026-11-12T13:00:00Z'}];
  assert.equal(currentState(summarize(events))[0].status,'success');
});

test('login and sync errors without an email retain PC identity in the panel and Excel',async()=>{
 const {request}=fixture();const config=await(await request('devices',{name:'PC-Without-Email'})).json();
 const headers={'x-dmh-device':config.deviceId,authorization:`Bearer ${config.token}`};
 for(const procedure of ['m365_login','m365_sync']){
  const event={eventId:randomUUID(),attemptId:randomUUID(),sequence:1,procedure,status:'error',occurredAt:'2026-11-12T10:00:00Z',computer:'PC-Without-Email',windowsUser:'employee',message:procedure==='m365_sync'?'3 calendars unavailable':'Windows login failed'};
  assert.equal((await request('ingest',event,'',headers)).status,200);
 }
 const rows=(await(await request('reports')).json()).reports;
 assert.equal(rows.length,2);assert(rows.every(r=>r.accountEmail===''&&r.computer==='PC-Without-Email'&&r.windowsUser==='employee'&&r.status==='error'));
 const book=new ExcelJS.Workbook();await book.xlsx.load(Buffer.from(await(await request('export')).arrayBuffer()));
 const sheet=JSON.stringify(book.getWorksheet('Übersicht').getSheetValues());assert(sheet.includes('Windows login failed'));assert(sheet.includes('3 calendars unavailable'));assert(sheet.includes('PC-Without-Email'));
});
