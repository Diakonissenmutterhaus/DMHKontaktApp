import { isDeepStrictEqual } from 'node:util';
import { uuid, validateEvent } from './protocol.mjs';

// Validate and compare the entire source before writing anything. Never replace a target row.
export async function importReportingHistory(source, destination, { apply = false } = {}) {
  const [devices, events] = await Promise.all([source.scan('devices/'), source.scan('events/')]);
  const deviceIds = new Set();
  const paths = new Set();
  const rows = [];
  for (const device of devices) {
    if (!uuid(device.deviceId) || !/^[a-f0-9]{64}$/.test(device.secretHash || '') || typeof device.revoked !== 'boolean' || !Number.isFinite(Date.parse(device.createdAt))) throw new Error('Ungültiger historischer PC-Zugang.');
    deviceIds.add(device.deviceId);
    rows.push({ path: `devices/${device.deviceId}.json`, payload: device });
  }
  for (const event of events) {
    validateEvent(event, event.deviceId);
    if (!deviceIds.has(event.deviceId) || !Number.isFinite(Date.parse(event.receivedAt))) throw new Error('Historischer Bericht ohne passenden PC-Zugang oder Empfangszeitpunkt.');
    rows.push({ path: `events/${event.deviceId}/${event.attemptId}/${String(event.sequence).padStart(5, '0')}.json`, payload: event });
  }
  const pending = [];
  for (const row of rows) {
    if (paths.has(row.path)) throw new Error('Doppelter historischer Speicherschlüssel.');
    paths.add(row.path);
    const existing = await destination.read(row.path);
    if (existing !== null && !isDeepStrictEqual(existing, row.payload)) throw new Error('Abweichende Zieldaten vorhanden. Import gestoppt, nichts überschrieben.');
    if (existing === null) pending.push(row);
  }
  if (apply) {
    for (const row of pending) {
      await destination.write(row.path, row.payload);
      if (!isDeepStrictEqual(await destination.read(row.path), row.payload)) throw new Error('Import konnte nicht bestätigt werden. Quelle bleibt erhalten.');
    }
  }
  return { devices: devices.length, events: events.length, alreadyPresent: rows.length - pending.length, pending: pending.length, written: apply ? pending.length : 0, dryRun: !apply };
}
