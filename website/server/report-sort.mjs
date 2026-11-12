const collator = new Intl.Collator('de', { numeric: true, sensitivity: 'base' });

export function sortReports(rows, key, direction, procedures = {}, statuses = {}) {
  const values = {
    person: row => [row.windowsUser || row.computer || row.deviceId, row.accountEmail],
    computer: row => [row.computer || row.deviceId],
    procedure: row => [procedures[row.procedure] || row.procedure],
    status: row => [statuses[row.status] || row.status],
    message: row => [row.step, row.message],
    occurredAt: row => [Number.isFinite(Date.parse(row.occurredAt)) ? Date.parse(row.occurredAt) : null],
    version: row => [row.appVersion],
    attemptCount: row => [row.attemptCount]
  };
  const field = Object.hasOwn(values, key) ? key : 'occurredAt';
  const sign = direction === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    const left = values[field](a), right = values[field](b);
    for (let i = 0; i < left.length; i++) {
      const x = left[i], y = right[i];
      const emptyX = x == null || x === '', emptyY = y == null || y === '';
      if (emptyX !== emptyY) return emptyX ? 1 : -1;
      if (emptyX) continue;
      const comparison = ['occurredAt', 'attemptCount'].includes(field) ? x - y : collator.compare(String(x), String(y));
      if (comparison) return sign * comparison;
    }
    return 0;
  });
}
