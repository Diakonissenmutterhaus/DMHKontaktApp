import { randomUUID } from 'node:crypto';
import ExcelJS from 'exceljs';
import { currentState, digest, equal, hasSession, logoutCookie, redact, secret, sessionCookie, summarize, uuid, validateEvent, verifyPassword } from '../server/protocol.mjs';
import { read, scan, write } from '../server/storage.mjs';

const labels = { running: 'In Bearbeitung', success: 'Erfolgreich', error: 'Fehler', cancelled: 'Abgebrochen', interrupted: 'Unterbrochen' };
const procedures = { m365_login: 'Microsoft-365-Anmeldung', outlook_exchange: 'Outlook Exchange', diagnostics: 'PC-Diagnose' };
const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'X-Robots-Tag': 'noindex, nofollow' };
const json = (value, status = 200, extra = {}) => Response.json(value, { status, headers: { ...headers, ...extra } });
async function body(request) {
  if (!request.headers.get('content-type')?.startsWith('application/json')) throw new Error('JSON erforderlich.');
  const reader = request.body?.getReader();
  if (!reader) throw new Error('Leere Anfrage.');
  let bytes = 0; const parts = [];
  while (true) { const chunk = await reader.read(); if (chunk.done) break; bytes += chunk.value.length; if (bytes > 12000) { await reader.cancel(); throw new Error('Anfrage zu groß.'); } parts.push(chunk.value); }
  return JSON.parse(Buffer.concat(parts).toString('utf8'));
}
export function createHandler(storage = { read, scan, write }) {
const { read, scan, write } = storage;
return async function handle(request) {
  try {
    const url = new URL(request.url), action = url.searchParams.get('action') || 'reports';
    const key = process.env.EDV_SESSION_SECRET;
    if (!key || !process.env.EDV_USERNAME || !process.env.EDV_PASSWORD_HASH || !process.env.BLOB_READ_WRITE_TOKEN) return json({ error: 'EDV-Berichte sind noch nicht eingerichtet.' }, 503);
    if (request.method === 'POST' && action !== 'ingest' && request.headers.get('origin') !== url.origin) return json({ error: 'Ungültiger Ursprung.' }, 403);
    if (request.method === 'POST' && action === 'login') {
      const input = await body(request);
      const passwordMatches = await verifyPassword(input.password, process.env.EDV_PASSWORD_HASH);
      if (typeof input.username !== 'string' || input.username.length > 64
        || !equal(input.username, process.env.EDV_USERNAME) || !passwordMatches) return json({ error: 'Benutzername oder Passwort ungültig.' }, 401);
      return json({ authenticated: true }, 200, { 'Set-Cookie': sessionCookie(key) });
    }
    if (request.method === 'POST' && action === 'ingest') {
      const deviceId = request.headers.get('x-dmh-device');
      if (!uuid(deviceId)) return json({ error: 'PC-Zugang erforderlich.' }, 401);
      const token = request.headers.get('authorization')?.replace(/^Bearer /, '') || '';
      const device = await read(`devices/${deviceId}.json`);
      if (!device || device.revoked || !equal(digest(token), device.secretHash)) return json({ error: 'PC-Zugang ungültig.' }, 401);
      const event = validateEvent(await body(request), deviceId);
      const path = `events/${deviceId}/${event.attemptId}/${String(event.sequence).padStart(5, '0')}.json`;
      const previous = await read(path);
      if (previous && previous.eventId !== event.eventId) return json({ error: 'Berichtsfolge kollidiert.' }, 409);
      if (!previous) {
        try { await write(path, event); } catch (error) { const saved = await read(path); if (saved?.eventId !== event.eventId) throw error; }
      }
      return json({ accepted: true, eventId: event.eventId });
    }
    if (!hasSession(request, key)) return json({ error: 'Bitte als EDV anmelden.' }, 401);
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
      const events = await scan('events/');
      const attempts = summarize(events);
      let reports = url.searchParams.get('view') === 'history' ? attempts : currentState(attempts);
      const search = (url.searchParams.get('search') || '').toLocaleLowerCase('de-DE').slice(0, 200);
      reports = reports.filter(row => (!url.searchParams.get('status') || row.status === url.searchParams.get('status'))
        && (!url.searchParams.get('procedure') || row.procedure === url.searchParams.get('procedure'))
        && (!search || [row.computer, row.windowsUser, row.accountEmail, row.message].some(v => v.toLocaleLowerCase('de-DE').includes(search))));
      if (action === 'reports') return json({ reports, updatedAt: new Date().toISOString() });
      const workbook = new ExcelJS.Workbook();
      workbook.creator = 'DMH EDV';
      const matching = event => reports.some(report => report.deviceId === event.deviceId && report.windowsUser === event.windowsUser && report.procedure === event.procedure);
      for (const [name, rows] of [['Übersicht', reports], ['Versuche', attempts.filter(matching)], ['Versuchsverlauf', events.filter(matching)]]) {
        const sheet = workbook.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 1 }] });
        sheet.columns = ['Benutzer', 'Microsoft-Konto', 'Computer', 'Vorgang', 'Ergebnis', 'Schritt', 'Fehlermeldung / Hinweis', 'Profil', 'App-Version', 'Zeitpunkt', 'Empfangen', 'Versuchs-ID'].map((header, i) => ({ header, width: i === 6 ? 65 : i === 11 ? 40 : 24 }));
        for (const row of rows) sheet.addRow([row.windowsUser, row.accountEmail, row.computer, procedures[row.procedure], labels[row.status], row.step, row.message, row.profile, row.appVersion, row.occurredAt, row.receivedAt, row.attemptId]);
        sheet.autoFilter = { from: 'A1', to: 'L1' };
        sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
        sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF891538' } };
      }
      return new Response(await workbook.xlsx.writeBuffer(), { headers: { ...headers, 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Disposition': 'attachment; filename="DMH-Verfahrensberichte.xlsx"' } });
    }
    return json({ error: 'Unbekannte Aktion.' }, 404);
  } catch (error) {
    const validation = /JSON|Bericht|Anfrage|erforderlich|Unexpected token/.test(String(error));
    if (!validation) console.error('EDV reporting request failed', redact(error?.message));
    return json({ error: validation ? 'Ungültige Anfrage.' : 'Berichtsdienst momentan nicht erreichbar. Bitte erneut versuchen.' }, validation ? 400 : 503);
  }
};
}
export const handle = createHandler();
export default { fetch: handle };
