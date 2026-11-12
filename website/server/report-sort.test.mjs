import test from 'node:test';
import assert from 'node:assert/strict';
import { sortReports } from './report-sort.mjs';

test('sorts dates chronologically and versions/computers numerically in both directions', () => {
  const rows = [
    { computer: 'PC10', appVersion: '0.1.10', occurredAt: '2026-01-01T00:00:00Z' },
    { computer: 'PC2', appVersion: '0.1.9', occurredAt: '2025-12-31T23:30:00-01:00' }
  ];
  for (const key of ['computer', 'version', 'occurredAt']) {
    assert.equal(sortReports(rows, key, 'asc')[0], key === 'occurredAt' ? rows[0] : rows[1]);
    assert.equal(sortReports(rows, key, 'desc')[0], key === 'occurredAt' ? rows[1] : rows[0]);
  }
  assert.equal(rows[0].computer, 'PC10');
});

test('sorts visible German labels and secondary fields with missing values last', () => {
  const rows = [{ windowsUser: 'Anna', accountEmail: 'z@example.test', procedure: 'a', status: 'a', step: 'Start', message: 'Z' },
    { windowsUser: 'Anna', accountEmail: 'a@example.test', procedure: 'z', status: 'z', step: 'Start', message: 'A' }, {}];
  for (const key of ['person', 'message', 'procedure', 'status']) {
    const sorted = sortReports(rows, key, 'asc', { a: 'Z', z: 'A' }, { a: 'Z', z: 'A' });
    assert.equal(sorted[0], rows[1]);
    assert.equal(sorted.at(-1), rows[2]);
    assert.equal(sortReports(rows, key, 'desc', { a: 'Z', z: 'A' }, { a: 'Z', z: 'A' }).at(-1), rows[2]);
  }
});
