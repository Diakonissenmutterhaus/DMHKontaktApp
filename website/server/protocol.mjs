import { createHash, createHmac, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
const derivePassword = promisify(scrypt);
export async function hashPassword(password) {
  const salt = randomBytes(16).toString('base64url');
  const hash = await derivePassword(password, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$16384$8$1$${salt}$${hash.toString('base64url')}`;
}
export async function verifyPassword(password, encoded) {
  if (typeof password !== 'string' || password.length > 300 || typeof encoded !== 'string') return false;
  const parts = encoded.split('$');
  if (parts.length !== 6 || parts.slice(0, 4).join('$') !== 'scrypt$16384$8$1'
    || !/^[A-Za-z0-9_-]{22}$/.test(parts[4]) || !/^[A-Za-z0-9_-]{86}$/.test(parts[5])) return false;
  const hash = await derivePassword(password, parts[4], 64, { N: 16384, r: 8, p: 1 });
  return equal(hash.toString('base64url'), parts[5]);
}
export const digest = value => createHash('sha256').update(value).digest('hex');
export const secret = () => randomBytes(32).toString('base64url');
export const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
export const equal = (a, b) => typeof a === 'string' && typeof b === 'string' && Buffer.byteLength(a) === Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a), Buffer.from(b));
export function redact(value) {
  return String(value ?? '').replace(/\b(Bearer\s+)[^\s,;]+/gi, '$1[entfernt]')
    .replace(/\b(?:eyJ[A-Za-z0-9_-]+\.)[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '[Token entfernt]')
    .replace(/((?:password|passwort|kennwort|client_secret|access_token|refresh_token|id_token|authorization|code)\s*[=:]\s*)[^\s,;&]+/gi, '$1[entfernt]')
    .slice(0, 1800);
}
function text(value, limit) { return typeof value === 'string' ? value.replace(/[\u0000-\u001f]/g, ' ').slice(0, limit).trim() : ''; }
export function validateEvent(input, deviceId) {
  if (!input || !uuid(input.eventId) || !uuid(input.attemptId) || !['m365_login', 'outlook_exchange', 'diagnostics'].includes(input.procedure)
    || !['running', 'success', 'error', 'cancelled', 'interrupted'].includes(input.status)
    || !Number.isSafeInteger(input.sequence) || input.sequence < 0 || input.sequence > 10000
    || !Number.isFinite(Date.parse(input.occurredAt))) throw new Error('Ungültiger Bericht.');
  return { schemaVersion: 1, deviceId, eventId: input.eventId, attemptId: input.attemptId, sequence: input.sequence,
    procedure: input.procedure, status: input.status, occurredAt: new Date(input.occurredAt).toISOString(), receivedAt: new Date().toISOString(),
    computer: text(input.computer, 100), windowsUser: text(input.windowsUser, 150), accountEmail: text(input.accountEmail, 250),
    appVersion: text(input.appVersion, 30), step: text(input.step, 120), message: redact(input.message), profile: text(input.profile, 100) };
}
export function summarize(events) {
  const attempts = new Map();
  for (const event of events) {
    const key = `${event.deviceId}/${event.attemptId}`;
    const previous = attempts.get(key);
    if (!previous || event.sequence > previous.sequence) attempts.set(key, event);
  }
  return [...attempts.values()].sort((a, b) => (b.occurredAt || b.receivedAt).localeCompare(a.occurredAt || a.receivedAt) || b.receivedAt.localeCompare(a.receivedAt));
}
export function currentState(attempts) {
  const groups = new Map();
  // summarize() returns newest occurred attempt first, including delayed backfills. Historical failures must
  // not make an already corrected PC look broken in the default overview.
  for (const row of attempts) {
    const key = `${row.deviceId}/${row.windowsUser}/${row.procedure}`;
    if (!groups.has(key)) groups.set(key, row);
  }
  return [...groups.values()];
}
const cookie = '__Host-dmh-edv';
export function sessionCookie(key, now = Date.now()) {
  const value = `${Math.floor(now / 1000) + 28800}.${secret()}`;
  return `${cookie}=${value}.${createHmac('sha256', key).update(value).digest('base64url')}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=28800`;
}
export function hasSession(request, key, now = Date.now()) {
  if (!key) return false;
  const value = request.headers.get('cookie')?.split(';').map(p => p.trim()).find(p => p.startsWith(`${cookie}=`))?.slice(cookie.length + 1);
  if (!value) return false;
  const parts = value.split('.');
  if (parts.length !== 3 || !/^\d+$/.test(parts[0])) return false;
  const expires = Number(parts[0]);
  return expires > now / 1000 && expires <= now / 1000 + 28800 && equal(parts[2], createHmac('sha256', key).update(parts.slice(0, 2).join('.')).digest('base64url'));
}
export const logoutCookie = `${cookie}=; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=0`;
