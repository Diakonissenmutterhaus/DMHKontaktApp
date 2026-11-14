// One-time administrator operation. Default is read-only; --apply writes after full validation.
// Keep the original Blob store and its token until the import is verified.
import * as source from '../website/server/blob-storage.mjs';
import { createSupabaseStorage } from '../website/server/supabase-storage.mjs';
import { importReportingHistory } from '../website/server/reporting-import.mjs';

const args = process.argv.slice(2);
if (args.includes('--help')) {
  console.log('node --env-file=PRIVATE_ENV_FILE scripts/import-procedure-reports-supabase.mjs [--apply]\nRequired server variables: BLOB_READ_WRITE_TOKEN, SUPABASE_URL, SUPABASE_SECRET_KEY.\nDefault: validate and compare only. --apply: copy missing rows, verify each row, never delete the source or overwrite target records.');
} else {
  if (args.some(arg => arg !== '--apply')) throw new Error('Unknown argument. Use --help.');
  if (!process.env.BLOB_READ_WRITE_TOKEN) throw new Error('Legacy Blob credential missing.');
  const result = await importReportingHistory(source, createSupabaseStorage(), { apply: args.includes('--apply') });
  console.log(JSON.stringify(result, null, 2));
}
