import { randomUUID } from 'node:crypto';
import ExcelJS from 'exceljs';
import { challenge, validProof } from '../server/device-enrollment.mjs';
import { currentState, digest, equal, hasSession, logoutCookie, redact, secret, sessionCookie, summarize, uuid, validateEvent, verifyPassword } from '../server/protocol.mjs';
import { configured, listAttempts, read, scan, write } from '../server/storage.mjs';
import { sortReports } from '../server/report-sort.mjs';

const labels = { running: 'In Bearbeitung', success: 'Erfolgreich', error: 'Fehler', cancelled: 'Abgebrochen', interrupted: 'Unterbrochen' };
const procedures = { m365_login: 'Microsoft-365-Anmeldung', outlook_exchange: 'Outlook Exchange', m365_sync: 'Microsoft-365-Synchronisierung', diagnostics: 'PC-Diagnose' };
const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'X-Robots-Tag': 'noindex, nofollow' };
const json = (value, status = 200, extra = {}) => Response.json(value, { status, headers: { ...headers, ...extra } });
async function body(request, limit = 12000) {
  if (!request.headers.get('content-type')?.startsWith('application/json')) throw new Error('JSON erforderlich.');
  const reader = request.body?.getReader();
  if (!reader) throw new Error('Leere Anfrage.');
  let bytes = 0; const parts = [];
  while (true) { const chunk = await reader.read(); if (chunk.done) break; bytes += chunk.value.length; if (bytes > limit) { await reader.cancel(); throw new Error('Anfrage zu groß.'); } parts.push(chunk.value); }
  return JSON.parse(Buffer.concat(parts).toString('utf8'));
}
export function createHandler(storage = { read, scan, write, configured, listAttempts }) {
const { read, scan, write } = storage;
return async function handle(request) {
  try {
    const url = new URL(request.url), action = url.searchParams.get('action') || 'reports';
    const key = process.env.EDV_SESSION_SECRET;
    if (!key || !process.env.EDV_USERNAME || !process.env.EDV_PASSWORD_HASH || !(storage.configured || configured)()) return json({ error: 'EDV-Berichte sind noch nicht eingerichtet.' }, 503);
    if (request.method === 'POST' && (!['ingest','ingest-diagnostic','enroll','enroll-challenge'].includes(action) || request.headers.has('origin')) && request.headers.get('origin') !== url.origin) return json({ error: 'Ungültiger Ursprung.' }, 403);
    if (request.method === 'POST' && action === 'login') {
      const input = await body(request);
      const passwordMatches = await verifyPassword(input.password, process.env.EDV_PASSWORD_HASH);
      if (typeof input.username !== 'string' || input.username.length > 64
        || !equal(input.username, process.env.EDV_USERNAME) || !passwordMatches) return json({ error: 'Benutzername oder Passwort ungültig.' }, 401);
      return json({ authenticated: true }, 200, { 'Set-Cookie': sessionCookie(key) });
    }
    // Enrollment grants write-only access to a new self-reported installation, never admin access.
    if (request.method === 'POST' && action === 'enroll-challenge') return json(challenge(await body(request), key));
    if (request.method === 'POST' && action === 'enroll') {
      const input = await body(request);
      if (!uuid(input.deviceId) || !/^[A-Za-z0-9_-]{43}$/.test(input.token || '') || !validProof(input, key)) return json({error:'Ungültiger Registrierungsnachweis.'},400);
      const path = `devices/${input.deviceId}.json`;
      const matches = device => device && equal(device.secretHash,digest(input.token));
      let device = await read(path);
      if (!device) {
        if (typeof input.computer !== 'string' || !input.computer.trim() || input.computer.length > 100 || typeof input.windowsUser !== 'string' || input.windowsUser.length > 100) return json({error:'Ungültige PC-Angaben.'},400);
        device = {deviceId:input.deviceId,name:input.computer,windowsUser:input.windowsUser,registration:'automatic',identityVerified:false,createdAt:new Date().toISOString(),revoked:false,secretHash:digest(input.token)};
        try { await write(path,device); } catch (error) { device=await read(path); if(!device) throw error; }
      }
      if (!matches(device)) return json({error:'PC-Zugang kollidiert.'},409);
      if (device.revoked) return json({error:'PC-Zugang gesperrt.'},403);
      return json({registered:true,deviceId:input.deviceId});
    }
    if ((request.method === 'POST' && ['ingest', 'ingest-diagnostic'].includes(action)) || (request.method === 'GET' && action === 'device-status')) {
      const deviceId = request.headers.get('x-dmh-device');
      if (!uuid(deviceId)) return json({ error: 'PC-Zugang erforderlich.' }, 401);
      const token = request.headers.get('authorization')?.replace(/^Bearer /, '') || '';
      const device = await read(`devices/${deviceId}.json`);
      if (!device || device.revoked || !equal(digest(token), device.secretHash)) return json({ error: 'PC-Zugang ungültig.' }, 401);
      if (action === 'device-status') return json({registered:true,deviceId});
      const event = validateEvent(await body(request, action === 'ingest-diagnostic' ? 512000 : 12000), deviceId);
      if (action === 'ingest-diagnostic' && !event.diagnostic) return json({ error: 'Diagnosebericht erforderlich.' }, 400);
      const path = `events/${deviceId}/${event.attemptId}/${String(event.sequence).padStart(5, '0')}.json`;
      const previous = await read(path);
      if (previous && previous.eventId !== event.eventId) return json({ error: 'Berichtsfolge kollidiert.' }, 409);
      if (!previous) {
        try { await write(path, event); } catch (error) { const saved = await read(path); if (saved?.eventId !== event.eventId) throw error; }
      }
      return json({ accepted: true, eventId: event.eventId, diagnosticAccepted: Boolean(event.diagnostic) });
    }
    if (!hasSession(request, key)) return json({ error: 'Bitte als EDV anmelden.' }, 401);
    if (action === 'diagnostic' && request.method === 'GET') {
      const device = url.searchParams.get('deviceId'), attempt = url.searchParams.get('attemptId'), sequence = url.searchParams.get('sequence');
      if (!uuid(device) || !uuid(attempt) || !/^\d{1,5}$/.test(sequence || '') || Number(sequence) > 10000) return json({ error: 'Ungültiger Bericht.' }, 400);
      const event = await read(`events/${device}/${attempt}/${String(Number(sequence)).padStart(5, '0')}.json`);
      return event?.diagnostic ? json({ diagnostic: event.diagnostic }) : json({ error: 'Kein Diagnoseprotokoll vorhanden.' }, 404);
    }
    if (action === 'session' && request.method === 'GET') return json({ authenticated: true });
    if (action === 'logout' && request.method === 'POST') return json({ authenticated: false }, 200, { 'Set-Cookie': logoutCookie });
    if (action === 'devices' && request.method === 'GET') return json({ devices: (await scan('devices/')).map(({ secretHash, ...device }) => device) });
    if (action === 'devices' && request.method === 'POST') {
      const input = await body(request);
      if (typeof input.name !== 'string' || !input.name.trim() || input.name.length > 100) return json({ error: 'Computername erforderlich.' }, 400);
      const deviceId = randomUUID(), token = secret();
      await write(`devices/${deviceId}.json`, { deviceId, name: input.name.trim(), createdAt: new Date().toISOString(), revoked: false, secretHash: digest(token) });
      return json({ schemaVersion: 1, endpoint: `${process.env.REPORTING_ORIGIN || url.origin}/api/edv?action=ingest`, deviceId, token });
    }
    if (action === 'revoke' && request.method === 'POST') {
      const input = await body(request);
      if (!uuid(input.deviceId)) return json({ error: 'Ungültiger PC.' }, 400);
      const path = `devices/${input.deviceId}.json`, device = await read(path);
      if (!device) return json({ error: 'PC nicht gefunden.' }, 404);
      await write(path, { ...device, revoked: true }, true);
      return json({ revoked: true });
    }
    if (request.method === 'GET' && ['reports', 'export'].includes(action)) {
      let events;
      const attempts = storage.listAttempts ? await storage.listAttempts() : summarize(events = await scan('events/'));
      let reports = url.searchParams.get('view') === 'history' ? attempts : currentState(attempts);
      const search = (url.searchParams.get('search') || '').toLocaleLowerCase('de-DE').slice(0, 200);
      reports = reports.filter(row => (!url.searchParams.get('status') || row.status === url.searchParams.get('status'))
        && (!url.searchParams.get('procedure') || row.procedure === url.searchParams.get('procedure'))
        && (!search || [row.computer, row.windowsUser, row.accountEmail, row.message].some(v => v.toLocaleLowerCase('de-DE').includes(search))));
      reports = sortReports(reports, url.searchParams.get('sort'), url.searchParams.get('direction'), procedures, labels);
      if (action === 'reports') return json({ reports: reports.map(({ diagnostic, ...row }) => ({ ...row, hasDiagnostic: Boolean(diagnostic) })), updatedAt: new Date().toISOString() });
      events ||= await scan('events/');
      const workbook = new ExcelJS.Workbook();
      workbook.creator = 'DMH EDV';
      const matching = event => reports.some(report => report.deviceId === event.deviceId && report.windowsUser === event.windowsUser && report.procedure === event.procedure);
      for (const [name, rows] of [['Übersicht', reports], ['Versuche', attempts.filter(matching)], ['Versuchsverlauf', events.filter(matching)]]) {
        const sheet = workbook.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 1 }] });
        sheet.columns = ['Benutzer', 'Microsoft-Konto', 'Computer', 'Vorgang', 'Ergebnis', 'Schritt', 'Fehlermeldung / Hinweis', 'Profil', 'App-Version', 'Zeitpunkt', 'Empfangen', 'Versuchs-ID', 'Versuche gesamt'].map((header, i) => ({ header, width: i === 6 ? 65 : i === 11 ? 40 : 24 }));
        for (const row of rows) sheet.addRow([row.windowsUser, row.accountEmail, row.computer, procedures[row.procedure], labels[row.status], row.step, row.message, row.profile, row.appVersion, row.occurredAt, row.receivedAt, row.attemptId, row.attemptCount ?? attempts.find(attempt => attempt.deviceId === row.deviceId && attempt.attemptId === row.attemptId)?.attemptCount ?? 1]);
        sheet.autoFilter = { from: 'A1', to: 'M1' };
        sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
        sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF891538' } };
      }
      return new Response(await workbook.xlsx.writeBuffer(), { headers: { ...headers, 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Disposition': 'attachment; filename="DMH-Verfahrensberichte.xlsx"' } });
    }
    return json({ error: 'Unbekannte Aktion.' }, 404);
  } catch (error) {
    const validation = /JSON|Bericht|Diagnosebericht|Anfrage|erforderlich|Unexpected token/.test(String(error));
    if (!validation) console.error('EDV reporting request failed', redact(error?.message));
    return json({ error: validation ? 'Ungültige Anfrage.' : 'Berichtsdienst momentan nicht erreichbar. Bitte erneut versuchen.' }, validation ? 400 : 503);
  }
};
}
export const handle = createHandler();
export default { fetch: handle };
