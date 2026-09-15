import assert from 'node:assert/strict';
import { buildDailyFinanceSummary } from '../lib/daily-finance-summary';
import { dailyFinanceEvidence, presentDailyFinance, financeReading, ageFinanceKpi } from '../lib/daily-finance-freshness';
import { desktopCommandKpis } from '../lib/desktop-command';

const date = '2026-09-15', now = Date.parse('2026-09-15T18:10:00Z');
const fresh = { status: 'current', as_of: '2026-09-15T18:05:00Z' };
const old = { status: 'current', as_of: '2026-09-15T13:16:14Z' };
const metrics = { date, generated_at: '2026-09-15T18:09:00Z', sales: 0, total_payroll: 68.26, dump_expense: 0, fuel_expense: 0, total_expenses: 68.26, net_profit: -68.26,
  source_freshness: { version: 1, metrics: { revenue: fresh, payroll: fresh, costs: fresh, net: fresh }, sources: { junkware_truck_records: fresh } } };
const display = (input: typeof metrics | null, clock = now) => {
  const raw = buildDailyFinanceSummary(input);
  return presentDailyFinance(raw, dailyFinanceEvidence(input, raw, date), date, clock);
};
assert.equal(display(metrics).revenue.value, 0, 'fresh zero is valid revenue');
const frozen = { ...metrics, source_freshness: { ...metrics.source_freshness, metrics: { ...metrics.source_freshness.metrics, revenue: old } } };
assert.equal(display(frozen).revenue.value, null, 'fresh publication cannot disguise old source zero');
assert.equal(display(frozen).revenue.state, 'stale');
assert.match(display(frozen).revenue.detail, /Last recorded \$0.00.*8:16 AM.*4h 53m old/);
assert.equal(display(frozen).net.value, null, 'net depends on revenue freshness too');
const revenueRecovered = { ...metrics, sales: 4262.98, net_profit: 4194.72, source_freshness: { ...metrics.source_freshness,
  metrics: { revenue: fresh, payroll: old, costs: old, net: old } } };
assert.equal(display(revenueRecovered).revenue.value, 4262.98);
assert.equal(display(revenueRecovered).labor.value, null);
assert.equal(display(revenueRecovered).totalCosts.value, null);
assert.equal(display(revenueRecovered).net.value, null, 'fresh revenue never implies complete costs or net');
assert.ok(Object.values(display(null)).every(reading => reading.value === null));
const raw = buildDailyFinanceSummary(metrics);
const noContract = { ...metrics, source_freshness: undefined };
assert.equal(presentDailyFinance(raw, dailyFinanceEvidence(noContract, raw, date), date, now).revenue.value, 0, 'legacy fresh zero remains usable with dated publication evidence');
assert.equal(presentDailyFinance(raw, dailyFinanceEvidence({ ...noContract, generated_at: old.as_of }, raw, date), date, now).revenue.value, null);
assert.equal(presentDailyFinance(raw, dailyFinanceEvidence({ ...metrics, source_freshness: { version: 1 } }, raw, date), date, now).revenue.value, null, 'missing contract entries do not fall back to publication');
assert.equal(financeReading(0, { status: 'current', asOf: '2026-09-15T19:00:00Z' }, date, now).value, null, 'future source rejected');
assert.equal(financeReading(0, { status: 'current', asOf: '2026-09-15T04:59:00Z' }, date, Date.parse('2026-09-15T05:01:00Z')).state, 'stale', 'prior Chicago day cannot masquerade as today');
assert.equal(financeReading(0, { status: 'current', asOf: '2026-09-14T18:00:00Z' }, '2026-09-14', now).value, 0, 'historical snapshot is not aged against today');
assert.equal(financeReading(0, { status: 'stale', asOf: '2026-09-14T18:00:00Z' }, '2026-09-14', now).value, null, 'explicit historical stale status still honored');
const cards = desktopCommandKpis(metrics, null, 0, undefined, date, now);
assert.equal(cards[1].value, '$0.00');
assert.equal(cards[2].value, '$68.26', 'labor stays visible when fresh revenue is zero');
const later = ageFinanceKpi(cards[1], now + 11 * 60_000);
assert.equal(later.value, '—', 'retained browser snapshot ages during network failure');
assert.equal(later.tone, 'warning');
assert.equal(later.progress, 0);
assert.match(later.detail, /Stale source.*Last recorded \$0.00/);
assert.equal(display(metrics, now + 11 * 60_000).revenue.value, null, 'Capital re-ages retained source evidence');
const missingLabor = { ...metrics, total_payroll: undefined };
const missingRaw = buildDailyFinanceSummary(missingLabor);
assert.equal(presentDailyFinance(missingRaw, dailyFinanceEvidence(missingLabor, missingRaw, date), date, now).totalCosts.value, null, 'a missing payroll amount makes aggregate costs incomplete');
const staggered = { ...metrics, sales: 1000, source_freshness: { ...metrics.source_freshness, metrics: { ...metrics.source_freshness.metrics,
  revenue: { ...fresh, as_of: '2026-09-15T18:01:00Z' }, payroll: { ...fresh, as_of: '2026-09-15T18:09:00Z' } } } };
const laborCard = desktopCommandKpis(staggered, null, 0, undefined, date, now)[2];
assert.ok(laborCard.secondaryValue);
const laterLabor = ageFinanceKpi(laborCard, now + 2 * 60_000);
assert.equal(laterLabor.value, '$68.26');
assert.equal(laterLabor.secondaryValue, undefined, 'aging revenue invalidates the ratio while payroll stays fresh');
console.log('Daily finance freshness passed: fresh/stale zero, independent costs, missing/malformed timestamps, historical dates, and retained browser snapshots.');
