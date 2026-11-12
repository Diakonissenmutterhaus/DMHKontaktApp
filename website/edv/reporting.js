const $ = id => document.getElementById(id);
const statuses = { running:'In Bearbeitung',success:'Erfolgreich',error:'Fehler',cancelled:'Abgebrochen',interrupted:'Unterbrochen' };
const procedures = { m365_login:'Microsoft-365-Anmeldung',outlook_exchange:'Outlook Exchange',m365_sync:'Microsoft-365-Synchronisierung',diagnostics:'PC-Diagnose' };
let busy = false, queued = false;
let sort = 'occurredAt', direction = 'desc';
function updateSortHeaders() {
  document.querySelectorAll('[data-sort]').forEach(button => {
    const active = button.dataset.sort === sort;
    button.closest('th').setAttribute('aria-sort', active ? (direction === 'asc' ? 'ascending' : 'descending') : 'none');
    button.querySelector('.sort-arrow').textContent = active ? (direction === 'asc' ? '↑' : '↓') : '↕';
    button.title = active && direction === 'asc' ? 'Absteigend sortieren' : 'Aufsteigend sortieren';
  });
}
function notice(message, error = false) { $('notice').textContent = message; $('notice').classList.toggle('error', error); }
function date(value) { return new Date(value).toLocaleString('de-DE', {dateStyle:'short',timeStyle:'short'}); }
async function api(action, data) {
  const response = await fetch(`/api/edv?action=${action}`, data ? {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)} : {cache:'no-store'});
  const result = await response.json();
  if (response.status === 401) { $('login').hidden = false; $('dashboard').hidden = true; $('logout').hidden = true; }
  if (!response.ok) throw new Error(result.error || 'Anfrage fehlgeschlagen.');
  return result;
}
function query(action) { const args = new URLSearchParams({action,view:$('view').value,search:$('search').value,status:$('status').value,procedure:$('procedure').value,sort,direction}); return `/api/edv?${args}`; }
function element(tag,text,className) { const e=document.createElement(tag);e.textContent=text;if(className)e.className=className;return e; }
async function load() {
  if (busy) { queued=true; return; } busy=true; $('refresh').disabled=true; notice('Berichte werden geladen …');
  try {
    const response=await fetch(query('reports'),{cache:'no-store'}), result=await response.json();
    if (!response.ok) { if(response.status===401){$('login').hidden=false;$('dashboard').hidden=true;$('logout').hidden=true;} throw new Error(result.error); }
    $('rows').replaceChildren();
    for (const row of result.reports) {
      const tr=document.createElement('tr'), person=element('td',row.windowsUser || row.computer || row.deviceId || 'Unbekannt'); person.append(element('small',row.accountEmail || 'Konto nicht ermittelt'));tr.append(person);
      tr.append(element('td',row.computer || row.deviceId),element('td',procedures[row.procedure]),element('td',statuses[row.status],`status ${row.status}`));
      const message=element('td',row.step,'message');message.append(element('small',row.message));tr.append(message,element('td',String(row.attemptCount ?? 1),'attempt-count'),element('td',date(row.occurredAt)),element('td',row.appVersion));
      const td=document.createElement('td'), details=element('button','Eigenschaften');details.addEventListener('click',()=>showDetails(row));td.append(details);tr.append(td);$('rows').append(tr);
    }
    if(!result.reports.length){const tr=document.createElement('tr'),td=element('td','Keine Berichte vorhanden. Neue Ergebnisse erscheinen, sobald ein eingerichteter PC sie übermittelt.');td.colSpan=9;tr.append(td);$('rows').append(tr);}
    const count=result.reports.length;
    $('count').textContent=`${count} ${$('view').value==='history'?(count===1?'Versuch':'Versuche'):(count===1?'Vorgang':'Vorgänge')}`; $('updated').textContent=`Stand: ${date(result.updatedAt)}`;notice('');
  } catch(error){notice(error.message,true);}finally{busy=false;$('refresh').disabled=false;if(queued){queued=false;void load();}}
}
function showDetails(row) {
  $('detail-fields').replaceChildren();
  for(const [label,value] of [['Benutzer',row.windowsUser],['Microsoft-Konto',row.accountEmail],['Computer',row.computer],['Vorgang',procedures[row.procedure]],['Ergebnis',statuses[row.status]],['Schritt',row.step],['Meldung',row.message],['Outlook-Profil',row.profile],['App-Version',row.appVersion],['Versuche',String(row.attemptCount ?? 1)],['Zeitpunkt',date(row.occurredAt)],['Empfangen',date(row.receivedAt)],['Versuchs-ID',row.attemptId],['PC-ID',row.deviceId]])$('detail-fields').append(element('dt',label),element('dd',value||'—'));
  $('details').showModal();
}
async function deviceList(){const {devices}=await api('devices');$('device-list').replaceChildren();for(const device of devices){const li=element('li',`${device.name}${device.windowsUser?' / '+device.windowsUser:''} · ${device.registration==='automatic'?'Automatisch · App-Meldung':'Manuell'} · ${device.revoked?'Gesperrt':'Aktiv'}`);if(!device.revoked){const button=element('button','Sperren');button.addEventListener('click',async()=>{if(!confirm(`PC-Zugang „${device.name}“ sperren?`))return;try{await api('revoke',{deviceId:device.deviceId});await deviceList();}catch(error){notice(error.message,true);}});li.append(button);}$('device-list').append(li);}}
function download(content,name,type){const url=URL.createObjectURL(new Blob([content],{type})),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
$('login').addEventListener('submit',async event=>{event.preventDefault();const button=event.submitter;button.disabled=true;try{await api('login',{username:$('username').value,password:$('password').value});$('password').value='';$('login').hidden=true;$('dashboard').hidden=false;$('logout').hidden=false;await load();}catch(error){notice(error.message,true);}finally{button.disabled=false;}});
$('logout').addEventListener('click',async()=>{try{await api('logout',{});location.reload();}catch(error){notice(error.message,true);}});
$('refresh').addEventListener('click',load);
document.querySelectorAll('[data-sort]').forEach(button => button.addEventListener('click', () => {
  direction = sort === button.dataset.sort ? (direction === 'asc' ? 'desc' : 'asc') : (['occurredAt','version','attemptCount'].includes(button.dataset.sort) ? 'desc' : 'asc');
  sort = button.dataset.sort;
  updateSortHeaders();
  void load();
}));
updateSortHeaders();
for(const id of ['status','procedure','view'])$(id).addEventListener('change',load);
let debounce;$('search').addEventListener('input',()=>{clearTimeout(debounce);debounce=setTimeout(load,300);});
$('export').addEventListener('click',async()=>{try{const response=await fetch(query('export'));if(!response.ok)throw new Error((await response.json()).error);download(await response.arrayBuffer(),'DMH-Verfahrensberichte.xlsx','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');}catch(error){notice(error.message,true);}});
$('devices').addEventListener('click',async()=>{try{await deviceList();$('pc-dialog').showModal();}catch(error){notice(error.message,true);}});
$('new-device').addEventListener('submit',async event=>{event.preventDefault();event.submitter.disabled=true;try{const config=await api('devices',{name:$('pc-name').value});download(JSON.stringify(config,null,2),'DMH-Berichte-PC-Zugang.json','application/json');$('pc-name').value='';await deviceList();}catch(error){notice(error.message,true);}finally{event.submitter.disabled=false;}});
document.querySelectorAll('dialog .close').forEach(button=>button.addEventListener('click',()=>button.closest('dialog').close()));
setInterval(()=>{if(!document.hidden&&!$('dashboard').hidden)void load();},30000);
try{await api('session');$('dashboard').hidden=false;$('logout').hidden=false;await load();}catch(error){notice(error.message,true);}
