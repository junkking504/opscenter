import assert from 'node:assert/strict';
import { desktopCommandKpis } from '../lib/desktop-command';
import { fromDailyFinanceMetrics } from '../lib/finance-trend-comparison';
import { ageFinanceKpi } from '../lib/daily-finance-freshness';
import { commandKpiDestination } from '../desktop-ui/lib/command-kpi-navigation';
import type { AnyRecord } from '../lib/opsData';

const date = '2026-10-20', now = Date.parse('2026-10-20T18:01:00Z');
const fresh = { status: 'current', as_of: '2026-10-20T18:00:00Z' };
const metrics = { date, total_revenue: 1800, sales: 1500, completed_jobs: 4,
  source_freshness: { version: 1, metrics: { revenue: fresh } } };
// Six appointments includes two estimates. AJS must use the four completed jobs.
const schedule = { scheduled: 6, completedJobs: 4, closedEstimates: 2, unclosed: 0, closed: 6, remaining: 0 };
const cards = (source: AnyRecord | null = metrics, selectedDate = date, clock = now) => desktopCommandKpis(source, schedule, 0, undefined, selectedDate, clock);
const ajs = (source: AnyRecord | null = metrics, selectedDate = date, clock = now) => cards(source, selectedDate, clock).find(k => k.label === 'AJS')!;
assert.equal(ajs().value, '$450.00');
assert.equal(ajs().financeEvidence?.recorded, fromDailyFinanceMetrics(metrics).averageJob);
assert.equal(cards().at(-2)?.label, 'RPH');
assert.equal(cards().at(-1)?.label, 'AJS');
assert.equal(ajs({ ...metrics, jobs_by_market: { north: 2, south: 1 }, completed_jobs: 99 }).value, '$600.00');
assert.equal(ajs({ ...metrics, total_revenue: 0 }).value, '$0.00');
for (const completed_jobs of [0, -1, null, undefined, '', NaN, Infinity]) {
  assert.equal(ajs({ ...metrics, completed_jobs }).value, '—', `invalid/zero jobs: ${completed_jobs}`);
}
for (const total_revenue of [null, undefined, '', NaN, Infinity]) {
  assert.equal(ajs({ ...metrics, total_revenue, sales: undefined }).value, '—', `missing revenue: ${total_revenue}`);
}
assert.equal(ajs(null).value, '—');
assert.equal(ajs({ ...metrics, jobs_by_market: { north: 2, south: null } }).value, '—');
assert.equal(ajs({ ...metrics, jobs_by_market: {}, completed_jobs: 4 }).value, '$450.00');
assert.equal(fromDailyFinanceMetrics({ gross_revenue: 900, total_jobs: 3 }).averageJob, 300);
assert.equal(fromDailyFinanceMetrics({ sales: 1000, jobs_completed: 4 }).averageJob, 250);
assert.equal(ajs({ ...metrics, employee_leaderboard: [{ individual_revenue: 5 }], appointments: Array(50).fill({}) }).value, '$450.00');
const evidence = (entry: unknown) => ({ ...metrics, generated_at: fresh.as_of, source_freshness: { version: 1, metrics: { revenue: entry } } });
for (const entry of [undefined, { ...fresh, status: 'missing' }, { ...fresh, status: 'stale' }, { ...fresh, as_of: 'bad' }, { ...fresh, as_of: '2026-10-20T19:00:00Z' }]) {
  assert.equal(ajs(evidence(entry)).value, '—');
  assert.equal(ajs(evidence(entry)).tone, 'warning');
}
assert.equal(ajs(evidence({ ...fresh, as_of: '2026-10-20T17:30:00Z' })).value, '—');
assert.equal(ajs({ ...metrics, source_freshness: undefined, generated_at: fresh.as_of }).value, '$450.00');
assert.equal(ajs({ ...metrics, source_freshness: undefined }).value, '—');
assert.equal(ajs(metrics, date, Date.parse('2026-10-21T18:00:00Z')).value, '$450.00', 'historical source stays usable');
assert.equal(ajs(metrics, '2026-10-21', Date.parse('2026-10-21T18:00:00Z')).value, '—', 'prior-day source cannot establish selected day');
const retained = ageFinanceKpi(ajs(), now + 11 * 60_000);
assert.equal(retained.value, '—'); assert.equal(retained.secondaryValue, undefined);
assert.match(retained.detail, /Stale source.*Last recorded \$450.00/);
assert.deepEqual(commandKpiDestination('AJS'), { workspace: 'Finance', scope: 'business', metric: 'averageJob', financeView: 'trends' });
console.log('PASS AJS: shared Finance basis, completed jobs excluding estimates, zero/missing/malformed inputs, precedence, freshness, historical dates, retained aging, and trend navigation.');
