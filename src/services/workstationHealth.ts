import { invoke, isTauri } from '@tauri-apps/api/core';
import { getAppSetting, getMicrosoft365ConnectionStatus, getOutlookAccountConfiguration, getOutlookOfficeAccountCheck } from './db';
import type { Microsoft365ConnectionStatus } from '../types/m365';
import type { OutlookAccountConfiguration, OutlookOfficeAccountCheck } from '../types/outlookExchange';
import { parseSynchronizationRuntimeStatus, synchronizationRuntimeStatusKey, type Microsoft365SynchronizationRuntimeStatus } from '../utils/automaticCalendarSync';
export interface PcHealth { checkedAt:string; appVersion:string; outlookInstalled:boolean; outlookRunning:boolean; freeBytes:number|null; drive:string; computer:string; windowsUser:string }
export interface ReportStatus { configured:boolean;pending:number;error:string|null }
export interface ProcedureEvent { eventId:string;attemptId:string;sequence:number;procedure:'m365_login'|'outlook_exchange'|'m365_sync'|'diagnostics';status:'running'|'success'|'error'|'cancelled'|'interrupted';occurredAt:string;message:string;profile:string;accountEmail:string;step:string }
export interface NewsItem { id:string;title:string;body:string;publishAt:string;expiresAt?:string|null }
export interface NewsStatus { items:NewsItem[];lastCheckedAt:string|null;lastSuccessAt:string|null;error:string|null }
export interface UpdateHealth { checkedAt:string;available:string|null;error:boolean }
export const healthUpdatedEvent = 'dmh:health-updated';
export const updateHealthKey = 'dmh:update-health.v1';
export function saveUpdateHealth(available:string|null,error=false) { const value:UpdateHealth={checkedAt:new Date().toISOString(),available,error};try{localStorage.setItem(updateHealthKey,JSON.stringify(value));}catch{/* Storage is optional. */}window.dispatchEvent(new Event(healthUpdatedEvent)); }
export function readUpdateHealth():UpdateHealth|null {try{const v=JSON.parse(localStorage.getItem(updateHealthKey)||'null');return typeof v?.checkedAt==='string' && typeof v?.error==='boolean'?v:null;}catch{return null;} }
export interface HealthSnapshot {checkedAt:string|null; pc:PcHealth|null;m365:Microsoft365ConnectionStatus|null;outlook:OutlookAccountConfiguration|null;office:OutlookOfficeAccountCheck|null;sync:Microsoft365SynchronizationRuntimeStatus;reporting:ReportStatus|null;history:ProcedureEvent[];errors:string[]}
export const emptyHealth:HealthSnapshot={checkedAt:null,pc:null,m365:null,outlook:null,office:null,sync:parseSynchronizationRuntimeStatus(null),reporting:null,history:[],errors:[]};
let pending:Promise<HealthSnapshot>|null=null;
let cached:HealthSnapshot=emptyHealth;
export function getCachedHealth(){return cached;}
export function loadHealth():Promise<HealthSnapshot> {
  if(!isTauri())return Promise.resolve(emptyHealth);
  if(pending)return pending;
  pending=(async()=>{
    const results=await Promise.allSettled([invoke<PcHealth>('get_workstation_health'),getMicrosoft365ConnectionStatus(),getOutlookAccountConfiguration(),getOutlookOfficeAccountCheck(),getAppSetting(synchronizationRuntimeStatusKey),invoke<ReportStatus>('get_procedure_reporting_status'),invoke<ProcedureEvent[]>('list_local_procedure_reports')] as const);
    const value=<T,>(r:PromiseSettledResult<T>):T|null=>r.status==='fulfilled'?r.value:null;
    cached={checkedAt:new Date().toISOString(),pc:value(results[0]),m365:value(results[1]),outlook:value(results[2]),office:value(results[3]),sync:parseSynchronizationRuntimeStatus(value(results[4])),reporting:value(results[5]),history:value(results[6])??[],errors:results.flatMap((r,i)=>r.status==='rejected'?[['PC','Microsoft 365','Outlook','Office-Konten','Synchronisierung','Berichtsversand','Verlauf'][i]]:[])};
    return cached;
  })().finally(()=>{pending=null;});return pending;
}
export function officeAccountComparison(health:HealthSnapshot):'unknown'|'match'|'different'|'ambiguous' {
  if(!health.m365?.connected||!health.office?.readSucceeded||!health.office.accounts.length)return 'unknown';
  const aliases=new Set([...(health.office.dmhEmails??[]),health.m365.account?.email??'',health.m365.account?.userPrincipalName??''].map(s=>s.trim().toLowerCase()).filter(Boolean));
  const emails=[...new Set(health.office.accounts.map(a=>a.email.trim().toLowerCase()).filter(Boolean))];
  if(!emails.some(e=>aliases.has(e)))return 'different';
  return emails.some(e=>!aliases.has(e))?'ambiguous':'match';
}
export function latestAttempts(history:ProcedureEvent[]) {const byId=new Map<string,ProcedureEvent>();for(const event of history){const old=byId.get(event.attemptId);if(!old||event.sequence>old.sequence)byId.set(event.attemptId,event);}return [...byId.values()].sort((a,b)=>b.occurredAt.localeCompare(a.occurredAt));}
export const loadNews=(refresh:boolean)=>invoke<NewsStatus>('get_edv_announcements',{refresh});
