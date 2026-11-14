import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createSupabaseStorage } from './supabase-storage.mjs';
import { configured, storageProvider } from './storage.mjs';

const env = { SUPABASE_URL: 'https://test-project.supabase.co', SUPABASE_SECRET_KEY: 'sb_secret_test-only' };
const deviceId = randomUUID(), attemptId = randomUUID();
const eventPath = `events/${deviceId}/${attemptId}/00001.json`;
const event = { deviceId, attemptId, sequence: 1, eventId: randomUUID(), status: 'success' };
const json = (body, status = 200) => Response.json(body, { status });

test('Supabase is selected without requiring the suspended Blob token; partial settings fail closed', () => {
  assert.equal(storageProvider(env), 'supabase');
  assert.equal(configured(env), true);
  assert.equal(configured({ SUPABASE_URL: env.SUPABASE_URL }), false);
  assert.equal(configured({ BLOB_READ_WRITE_TOKEN: 'legacy' }), true);
  assert.equal(configured({ REPORTING_STORAGE: 'supabase', BLOB_READ_WRITE_TOKEN: 'legacy' }), false);
  assert.throws(() => storageProvider({ REPORTING_STORAGE: 'unknown' }));
  assert.throws(() => createSupabaseStorage({ env: { ...env, SUPABASE_SECRET_KEY: 'sb_publishable_public' } }));
  assert.throws(() => createSupabaseStorage({ env: { ...env, SUPABASE_URL: 'https://attacker.invalid' } }));
});

test('server secret stays in apikey header; event insert preserves immutable identity and duplicates fail', async () => {
  const calls = [];
  const store = createSupabaseStorage({ env, fetcher: async (url, options) => { calls.push({ url, options }); return calls.length === 1 ? new Response(null, { status: 201 }) : json({ secret: 'must-not-leak' }, 409); } });
  await store.write(eventPath, event);
  const { url, options } = calls[0];
  assert.equal(url.pathname, '/rest/v1/dmh_reporting_events');
  assert(!url.href.includes(env.SUPABASE_SECRET_KEY));
  assert.equal(options.headers.apikey, env.SUPABASE_SECRET_KEY);
  assert.equal(options.headers.Authorization, undefined);
  assert.equal(options.redirect, 'error');
  assert.deepEqual(JSON.parse(options.body), { device_id: deviceId, attempt_id: attemptId, sequence: 1, event_id: event.eventId, payload: event });
  await assert.rejects(store.write(eventPath, event), error => /409/.test(error.message) && !/must-not-leak/.test(error.message));
  await assert.rejects(store.write(eventPath, event, true), /überschrieben/);
  await assert.rejects(store.write(eventPath, { ...event, deviceId: randomUUID() }), /stimmt nicht/);
  assert.equal(calls.length, 2);
});

test('private reads distinguish missing rows, failures and successful revocation', async () => {
  const calls = [];
  const store = createSupabaseStorage({ env, fetcher: async (url, options) => { calls.push({ url, options }); return json(options.method === 'PATCH' ? [{ payload: { deviceId, revoked: true } }] : []); } });
  assert.equal(await store.read(eventPath), null);
  assert.equal(calls[0].url.searchParams.get('device_id'), `eq.${deviceId}`);
  assert.equal(calls[0].url.searchParams.get('sequence'), 'eq.1');
  await store.write(`devices/${deviceId}.json`, { deviceId, revoked: true }, true);
  assert.equal(calls[1].options.method, 'PATCH');
  const unavailable = createSupabaseStorage({ env, fetcher: async () => json({ error: 'private' }, 503) });
  await assert.rejects(unavailable.read(eventPath), /503/);
  await assert.rejects(store.read('devices/../../private.json'), /Speicherpfad/);
});

test('bulk scans handle a smaller server page cap and never silently truncate', async () => {
  const entries = Array.from({ length: 7 }, (_, i) => ({ payload: { i } }));
  const offsets = [];
  const store = createSupabaseStorage({ env, fetcher: async url => {
    const offset = Number(url.searchParams.get('offset')), limit = Number(url.searchParams.get('limit'));
    offsets.push(offset);
    return json(entries.slice(offset, offset + Math.min(2, limit)));
  } });
  assert.equal((await store.scan('events/')).length, 7);
  assert.deepEqual(offsets, [0, 2, 4, 6, 7]);
  await assert.rejects(store.scan('events/', 6), /Zu viele/);
  await assert.rejects(store.scan('other/'), /Speicherpfad/);
});

test('overview uses one aggregated SQL snapshot and rejects incomplete snapshots', async () => {
  let calls = 0;
  const store = createSupabaseStorage({ env, fetcher: async url => {
    calls++;
    assert.equal(url.pathname, '/rest/v1/rpc/dmh_reporting_attempts');
    return json({ attempts: [{ ...event, attemptCount: 3 }], truncated: false });
  } });
  assert.equal((await store.listAttempts())[0].attemptCount, 3);
  assert.equal(calls, 1);
  const truncated = createSupabaseStorage({ env, fetcher: async () => json({ attempts: [], truncated: true }) });
  await assert.rejects(truncated.listAttempts(), /Zu viele/);
});
