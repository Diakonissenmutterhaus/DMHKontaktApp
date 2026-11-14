import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { importReportingHistory } from './reporting-import.mjs';

function fixture() {
  const device = { deviceId: randomUUID(), secretHash: 'a'.repeat(64), revoked: true, createdAt: '2026-11-10T12:00:00Z', name: 'PC-Test' };
  const event = { deviceId: device.deviceId, attemptId: randomUUID(), eventId: randomUUID(), sequence: 1, procedure: 'outlook_exchange', status: 'error', windowsUser: 'test', computer: 'PC-Test', occurredAt: '2026-11-10T12:00:00Z', receivedAt: '2026-11-10T12:01:00Z', message: 'Original error', profile: 'Outlook', step: 'error', appVersion: '0.1.test', accountEmail: '' };
  const rows = new Map();
  let writes = 0;
  return {
    device, event, rows,
    source: { scan: async prefix => prefix === 'devices/' ? [device] : [event] },
    destination: { read: async path => rows.get(path) ?? null, write: async (path, value) => { writes++; if (rows.has(path)) throw new Error('duplicate'); rows.set(path, structuredClone(value)); } },
    writes: () => writes,
  };
}

test('migration is read-only by default and preserves identities, revocation and timestamps on apply', async () => {
  const f = fixture();
  const dry = await importReportingHistory(f.source, f.destination);
  assert.deepEqual(dry, { devices: 1, events: 1, alreadyPresent: 0, pending: 2, written: 0, dryRun: true });
  assert.equal(f.writes(), 0);
  assert.equal((await importReportingHistory(f.source, f.destination, { apply: true })).written, 2);
  assert.equal(f.rows.get(`devices/${f.device.deviceId}.json`).revoked, true);
  assert.deepEqual([...f.rows.values()][1], f.event);
  assert.equal((await importReportingHistory(f.source, f.destination, { apply: true })).written, 0);
  assert.equal(f.writes(), 2);
});

test('a single conflicting row prevents the entire import from writing', async () => {
  const f = fixture();
  const path = `events/${f.device.deviceId}/${f.event.attemptId}/00001.json`;
  f.rows.set(path, { ...f.event, eventId: randomUUID() });
  await assert.rejects(importReportingHistory(f.source, f.destination, { apply: true }), /Abweichende/);
  assert.equal(f.writes(), 0);
});

test('unreadable legacy storage, orphan events and invalid devices never become an empty successful import', async () => {
  const f = fixture();
  await assert.rejects(importReportingHistory({ scan: async () => { throw new Error('403 Forbidden'); } }, f.destination, { apply: true }), /403/);
  f.device.secretHash = 'invalid';
  await assert.rejects(importReportingHistory(f.source, f.destination, { apply: true }), /Ungültiger/);
  f.device.secretHash = 'a'.repeat(64);
  f.event.deviceId = randomUUID();
  await assert.rejects(importReportingHistory(f.source, f.destination, { apply: true }), /ohne passenden/);
  assert.equal(f.writes(), 0);
});
