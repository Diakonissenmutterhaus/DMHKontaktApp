import { cp, mkdir, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
// The public directory contains only explicitly selected assets, never API source or credentials.
const root = dirname(fileURLToPath(import.meta.url));
const output = resolve(root, 'public');
if (dirname(output) !== root || output === root) throw new Error('Unexpected build target');
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
const paths = process.env.REPORTING_SITE_ONLY === '1' ? ['edv'] : ['index.html', 'app.js', 'styles.css', 'video-config.js', 'assets', 'media', 'downloads', 'edv'];
for (const path of paths) {
  await cp(resolve(root, path), resolve(output, path), { recursive: true });
}
if (process.env.REPORTING_SITE_ONLY === '1') {
  await cp(resolve(root, 'migration'), output, { recursive: true });
  // Temporary reuse of the existing guide, explicitly requested by EDV.
  // Copy only the web video and its poster, not unrelated downloads.
  await mkdir(resolve(output, 'media'), { recursive: true });
  await cp(resolve(root, 'media/dmh-backup-anleitung-web.mp4'), resolve(output, 'media/dmh-backup-anleitung-web.mp4'));
  await cp(resolve(root, 'assets/kurzanleitung.png'), resolve(output, 'assets/kurzanleitung.png'));
}
