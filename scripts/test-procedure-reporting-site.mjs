// Explicit live smoke test. Creates only labelled test records and deletes its own records.
import { readFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { chromium, request } from '@playwright/test';
import ExcelJS from '../website/node_modules/exceljs/excel.js';
import { list, del } from '../website/node_modules/@vercel/blob/dist/index.js';
const base = process.argv[2] || 'https://dmh-migration.vercel.app';
if (!['https://dmh-migration.vercel.app','https://migration.dmh-aidlingen.de'].includes(base)) throw new Error('Unexpected test target');
const privateDir=join(process.env.LOCALAPPDATA,'DMH Backup EDV');
const username=process.env.REPORTING_TEST_USERNAME || 'edv';
const password=process.env.REPORTING_TEST_PASSWORD;
if (!password) throw new Error('Set REPORTING_TEST_PASSWORD locally before explicitly running this live test.');
const {token}=JSON.parse(await readFile(join(privateDir,'blob-test-env.json'),'utf8'));
const browser=await chromium.launch({headless:true});
const context=await browser.newContext({viewport:{width:1440,height:900}});
const page=await context.newPage();
const anonymous=await request.newContext();
let device;
const post=(action,data,headers={})=>context.request.post(`${base}/api/edv?action=${action}`,{data,headers:{Origin:base,...headers}});
const check=async response=>{if(!response.ok())throw new Error(`HTTP ${response.status()}: ${await response.text()}`);return response;};
try {
  assert.equal((await anonymous.get(`${base}/api/edv?action=reports`)).status(),401);
  await page.goto(`${base}/login`);
  await page.locator('#username').fill(username);
  await page.locator('#password').fill(password);
  await page.getByRole('button',{name:'Anmelden',exact:true}).click();
  await page.locator('#dashboard').waitFor({state:'visible'});
  device=await(await check(await post('devices',{name:'EDV-Funktionstest'}))).json();
  const header={'X-DMH-Device':device.deviceId,Authorization:`Bearer ${device.token}`};
  for (const result of ['error','success']) {
    const event={eventId:randomUUID(),attemptId:randomUUID(),sequence:0,procedure:'outlook_exchange',status:'running',computer:'EDV-Funktionstest',windowsUser:'Funktionstest',accountEmail:'test@example.invalid',appVersion:'0.1.test',occurredAt:new Date().toISOString(),step:'Prüfung',message:'',profile:'Exchange-Test'};
    await check(await post('ingest',event,header));
    const final={...event,eventId:randomUUID(),sequence:1,status:result,message:result==='error'?'Outlook-Hilfsprogramm konnte nicht gestartet werden.':'Exchange verbunden und Standardprofil bestätigt.'};
    await check(await post('ingest',final,header));
    await check(await post('ingest',final,header));
  }
  await page.getByRole('button',{name:'Aktualisieren',exact:true}).click();
  await page.getByText('Exchange verbunden und Standardprofil bestätigt.',{exact:true}).waitFor();
  await page.locator('#view').selectOption('history');
  await page.getByText('Outlook-Hilfsprogramm konnte nicht gestartet werden.',{exact:true}).waitFor();
  const current=await(await check(await context.request.get(`${base}/api/edv?action=reports`))).json();
  assert.equal(current.reports.filter(row=>row.deviceId===device.deviceId).length,1);
  assert.equal(current.reports.find(row=>row.deviceId===device.deviceId).status,'success');
  const reports=await(await check(await context.request.get(`${base}/api/edv?action=reports&view=history`))).json();
  assert.equal(reports.reports.filter(row=>row.deviceId===device.deviceId).length,2);
  const exported=await check(await context.request.get(`${base}/api/edv?action=export&search=EDV-Funktionstest`));
  const workbook=new ExcelJS.Workbook();await workbook.xlsx.load(await exported.body());
  assert.equal(workbook.getWorksheet('Übersicht').rowCount,2);assert.equal(workbook.getWorksheet('Versuche').rowCount,3);assert.equal(workbook.getWorksheet('Versuchsverlauf').rowCount,5);
  await mkdir('test-results/procedure-reporting',{recursive:true});
  await page.screenshot({path:'test-results/procedure-reporting/edv-reports.png'});
  await page.locator('#status').selectOption('error');
  await page.getByText('1 Versuch',{exact:true}).waitFor();
  await page.getByRole('button',{name:'Eigenschaften',exact:true}).click();
  await page.getByRole('dialog').getByText('Outlook-Hilfsprogramm konnte nicht gestartet werden.',{exact:true}).waitFor();
  await page.getByRole('dialog').getByRole('button',{name:'Schließen',exact:true}).last().click();
  await check(await post('revoke',{deviceId:device.deviceId}));
  assert.equal((await post('ingest',{eventId:randomUUID()},header)).status(),401);
  await page.getByRole('button',{name:'Abmelden',exact:true}).click();
  await page.locator('#login').waitFor({state:'visible'});
  assert.equal((await context.request.get(`${base}/api/edv?action=export`)).status(),401);
  console.log('Passed: login, private persistence, success/error, idempotency, filters, details, XLSX, revocation and logout.');
} finally {
  if(device){for(const prefix of [`events/${device.deviceId}/`,`devices/${device.deviceId}.json`]){let cursor;do{const page=await list({prefix,cursor,token});if(page.blobs.length)await del(page.blobs.map(b=>b.url),{token});cursor=page.hasMore?page.cursor:undefined;}while(cursor);}console.log('Removed own labelled live-test records.');}
  await browser.close();await anonymous.dispose();
}
