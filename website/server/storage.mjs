import * as blob from './blob-storage.mjs';
import { createSupabaseStorage } from './supabase-storage.mjs';
import { summarize } from './protocol.mjs';

export function storageProvider(env = process.env) {
  const provider = env.REPORTING_STORAGE || (env.SUPABASE_URL || env.SUPABASE_SECRET_KEY ? 'supabase' : 'blob');
  if (!['blob', 'supabase'].includes(provider)) throw new Error('Unbekannter Berichtsspeicher.');
  return provider;
}
export function configured(env = process.env) {
  return storageProvider(env) === 'supabase'
    ? Boolean(env.SUPABASE_URL && env.SUPABASE_SECRET_KEY)
    : Boolean(env.BLOB_READ_WRITE_TOKEN);
}
function backend() {
  // Never silently return to Blob after a failed Supabase request: that would split the history.
  return storageProvider() === 'supabase' ? createSupabaseStorage() : blob;
}
export const read = (...args) => backend().read(...args);
export const write = (...args) => backend().write(...args);
export const scan = (...args) => backend().scan(...args);
export async function listAttempts() {
  const storage = backend();
  return storage.listAttempts ? storage.listAttempts() : summarize(await storage.scan('events/'));
}
