// Legacy provider retained for a controlled, verified import of the existing history.
import { get, put, list } from '@vercel/blob';
export async function read(path) {
  const result = await get(path, { access: 'private', useCache: false });
  if (!result || result.statusCode === 404) return null;
  if (result.statusCode !== 200) throw new Error('Speicher konnte nicht gelesen werden.');
  return new Response(result.stream).json();
}
export async function write(path, value, overwrite = false) {
  return put(path, JSON.stringify(value), { access: 'private', addRandomSuffix: false, allowOverwrite: overwrite, contentType: 'application/json', cacheControlMaxAge: 60 });
}
export async function scan(prefix, maximum = 10000) {
  const values = [];
  let cursor;
  do {
    const page = await list({ prefix, cursor, limit: 1000 });
    for (let offset = 0; offset < page.blobs.length; offset += 20) {
      values.push(...(await Promise.all(page.blobs.slice(offset, offset + 20).map(blob => read(blob.pathname)))).filter(Boolean));
    }
    cursor = page.hasMore ? page.cursor : undefined;
    if (values.length > maximum || (cursor && values.length >= maximum)) throw new Error('Zu viele Einträge. Bitte den Zeitraum einschränken.');
  } while (cursor);
  return values;
}
