import { uuid } from './protocol.mjs';

const pageSize = 500;
function location(path) {
  const parts = path.split('/');
  if (parts.length === 2 && parts[0] === 'devices' && uuid(parts[1].replace(/\.json$/, '')) && parts[1].endsWith('.json')) {
    return { table: 'dmh_reporting_devices', ids: { device_id: parts[1].slice(0, -5) } };
  }
  if (parts.length === 4 && parts[0] === 'events' && uuid(parts[1]) && uuid(parts[2]) && /^\d{5}\.json$/.test(parts[3]) && Number(parts[3].slice(0, 5)) <= 10000) {
    return { table: 'dmh_reporting_events', ids: { device_id: parts[1], attempt_id: parts[2], sequence: Number(parts[3].slice(0, 5)) } };
  }
  throw new Error('Ungültiger Speicherpfad.');
}

export function createSupabaseStorage({ env = process.env, fetcher = fetch } = {}) {
  const base = new URL(env.SUPABASE_URL || 'https://not-configured.invalid');
  const key = env.SUPABASE_SECRET_KEY;
  if (base.protocol !== 'https:' || !base.hostname.endsWith('.supabase.co') || base.username || base.password || base.port || base.pathname !== '/' || base.search || base.hash || !key || (!key.startsWith('sb_secret_') && !key.startsWith('eyJ'))) {
    throw new Error('Supabase-Berichtsspeicher ist nicht korrekt eingerichtet.');
  }
  async function request(table, params = {}, { method = 'GET', value, prefer } = {}) {
    const url = new URL(`/rest/v1/${table}`, base);
    for (const [name, filter] of Object.entries(params)) url.searchParams.set(name, String(filter));
    const headers = { apikey: key, Accept: 'application/json' };
    // Modern secret keys are API keys, not JWTs. Only legacy service-role keys use Bearer.
    if (key.startsWith('eyJ')) headers.Authorization = `Bearer ${key}`;
    if (value !== undefined) headers['Content-Type'] = 'application/json';
    if (prefer) headers.Prefer = prefer;
    const response = await fetcher(url, { method, headers, redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(12000), ...(value === undefined ? {} : { body: JSON.stringify(value) }) });
    if (!response.ok) {
      // Provider bodies can include row contents. Do not leak them, keys or URLs into logs.
      throw new Error(`Supabase-Berichtsspeicher: HTTP ${response.status}${response.status === 409 ? ' (Eintrag bereits vorhanden)' : ''}.`);
    }
    if (response.status === 204 || prefer === 'return=minimal') return null;
    return response.json();
  }
  const filters = ids => Object.fromEntries(Object.entries(ids).map(([name, value]) => [name, `eq.${value}`]));
  async function pages(table, order, maximum = 10000) {
    if (!Number.isSafeInteger(maximum) || maximum < 1) throw new Error('Ungültiges Eintragslimit.');
    const values = [];
    let offset = 0;
    while (true) {
      const limit = Math.min(pageSize, maximum - values.length + 1);
      const rows = await request(table, { select: 'payload', ...(order ? { order } : {}), offset, limit });
      if (!Array.isArray(rows) || rows.some(row => !row.payload || typeof row.payload !== 'object' || Array.isArray(row.payload))) throw new Error('Ungültige Speicherantwort.');
      values.push(...rows.map(row => row.payload));
      if (values.length > maximum) throw new Error('Zu viele Einträge. Bitte den Zeitraum einschränken.');
      if (!rows.length) return values;
      // Continue by actual row count: PostgREST may impose a smaller project page limit.
      offset += rows.length;
    }
  }
  return {
    async read(path) {
      const { table, ids } = location(path);
      const rows = await request(table, { ...filters(ids), select: 'payload', limit: 1 });
      if (!Array.isArray(rows)) throw new Error('Ungültige Speicherantwort.');
      return rows[0]?.payload ?? null;
    },
    async write(path, payload, overwrite = false) {
      const { table, ids } = location(path);
      if (!payload || payload.deviceId !== ids.device_id || (table === 'dmh_reporting_events' && (payload.attemptId !== ids.attempt_id || payload.sequence !== ids.sequence || !uuid(payload.eventId)))) throw new Error('Speicherpfad stimmt nicht mit dem Bericht überein.');
      if (overwrite) {
        if (table !== 'dmh_reporting_devices') throw new Error('Gespeicherte Ereignisse dürfen nicht überschrieben werden.');
        const rows = await request(table, { ...filters(ids), select: 'payload' }, { method: 'PATCH', value: { payload }, prefer: 'return=representation' });
        if (!Array.isArray(rows) || rows.length !== 1) throw new Error('PC-Zugang konnte nicht aktualisiert werden.');
        return;
      }
      await request(table, {}, { method: 'POST', value: { ...ids, ...(table === 'dmh_reporting_events' ? { event_id: payload.eventId } : {}), payload }, prefer: 'return=minimal' });
    },
    async scan(prefix, maximum = 10000) {
      if (prefix === 'devices/') return pages('dmh_reporting_devices', 'device_id.asc', maximum);
      if (prefix === 'events/') return pages('dmh_reporting_events', 'device_id.asc,attempt_id.asc,sequence.asc', maximum);
      throw new Error('Ungültiger Speicherpfad.');
    },
    // One SQL snapshot: pagination cannot move an attempt between pages during ingestion.
    async listAttempts() {
      const result = await request('rpc/dmh_reporting_attempts');
      if (!result || !Array.isArray(result.attempts) || typeof result.truncated !== 'boolean') throw new Error('Ungültige Speicherantwort.');
      if (result.truncated) throw new Error('Zu viele Einträge. Bitte den Zeitraum einschränken.');
      return result.attempts;
    },
  };
}
