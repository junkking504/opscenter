import assert from 'node:assert/strict';
import { capitalRevenueHistory } from '../desktop-ui/lib/capital-overview';
import type { FinanceData } from '../desktop-ui/lib/commercial-contract';
const record = (monthKey: string, grossRevenue: number, overrides = {}) => ({ monthKey, grossRevenue, complete: true, reportingComplete: true, ...overrides }) as FinanceData['trends'][number];
const history = capitalRevenueHistory([
  record('2025-12', 1500), record('2026-01', 0), record('2026-02', 900, { revenueCovered: false }),
  record('2026-03', NaN), record('2026-04', 2500, { complete: false, reportingComplete: false }), record('2026-05', 99999),
], '2026-04-16');
assert.deepEqual(history.map(item => item.key), ['2025-11','2025-12','2026-01','2026-02','2026-03','2026-04']);
assert.deepEqual(history.map(item => item.revenue), [null,1500,0,null,null,2500]);
assert.equal(history.at(-1)?.partial, true);
assert.equal(history[1].partial, false);
assert.equal(capitalRevenueHistory([], '2026-01-01').filter(item => item.revenue === null).length, 6);
console.log('Capital revenue history: gaps, true zero, invalid coverage, year rollover, partial month and future exclusion passed.');
