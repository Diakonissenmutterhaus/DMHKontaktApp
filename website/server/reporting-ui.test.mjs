import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';

test('EDV loads logs only on request, renders untrusted text literally and can copy it', async () => {
  const html = await readFile(new URL('../edv/index.html', import.meta.url), 'utf8');
  const script = await readFile(new URL('../edv/reporting.js', import.meta.url), 'utf8');
  const dom = new JSDOM(html, { url: 'https://migration.example/login', runScripts: 'outside-only' });
  const w = dom.window;
  const calls = [];
  let copied;
  const log = 'PC: LOCAL-LAPTOP\n<script>window.compromised=true</script>\nprocessId: 42';
  Object.defineProperty(w.navigator, 'clipboard', { value: { writeText: async text => { copied = text; } } });
  w.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  w.HTMLDialogElement.prototype.close = function () { this.open = false; };
  w.fetch = async url => {
    calls.push(String(url));
    const action = new URL(url, w.location.origin).searchParams.get('action');
    const result = action === 'session' ? { authenticated: true } : action === 'diagnostic' ? { diagnostic: { code: 'DMH-M365-SYNC', text: log } } : { updatedAt: '2026-11-14T10:00:00Z', reports: [{ deviceId: 'device', attemptId: 'attempt', sequence: 2, status: 'error', procedure: 'm365_sync', computer: 'LOCAL-LAPTOP', windowsUser: 'Admin', occurredAt: '2026-11-14T10:00:00Z', receivedAt: '2026-11-14T10:01:00Z', hasDiagnostic: true }] };
    return { ok: true, status: 200, json: async () => result };
  };
  const click = label => [...w.document.querySelectorAll('button')].find(button => button.textContent === label).click();
  try {
    await w.eval(`(async () => {${script}\n})()`);
    click('Eigenschaften');
    assert.equal(calls.some(url => url.includes('action=diagnostic')), false);
    assert.equal(w.document.querySelector('#details').open, true);
    click('Protokoll laden');
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(w.document.querySelector('.diagnostic-log').textContent, log);
    assert.equal(w.document.querySelector('.diagnostic-log script'), null);
    assert.equal(w.compromised, undefined);
    click('Kopieren');
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(copied, log);
    assert.ok(calls.find(url => url.includes('action=diagnostic') && url.includes('sequence=2')));
  } finally { w.close(); }
});
