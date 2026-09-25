import assert from 'node:assert/strict';
import { financeMonthlyChart } from '../desktop-ui/lib/finance-monthly-chart';
import { financeTrendComparisons, type TrendValues } from '../lib/finance-trend-comparison';
import type { FinanceData } from '../desktop-ui/lib/commercial-contract';

type Month = FinanceData['trends'][number];
const month = (key: string, complete = false): Month => ({ monthKey: key, monthDisplay: key, dataThroughDate: `${key}-06`, complete, reportingComplete: complete, revenueCovered: true, grossRevenue: 600, completedJobs: 3, totalOperatingExpenses: null, estimatedOperatingProfit: null, revenueSource: 'fixture' });
const full: TrendValues = { revenue: 8000, jobs: 40, averageJob: 200, costs: null, profit: null, margin: null };

// Every month, not a September exception; include year rollover and leap year.
for (const year of [2026, 2027, 2028]) for (let number = 1; number <= 12; number++) {
  const suffix = String(number).padStart(2, '0'), key = `${year}-${suffix}`;
  const months = [month(key)];
  const readKeys: string[] = [];
  const comparisons = financeTrendComparisons(months, () => null, priorKey => { readKeys.push(priorKey); return full; });
  const data = { date: `${key}-06`, trends: months, trendComparisons: comparisons };
  const bar = financeMonthlyChart(data, key, 'revenue', { remaining: 900 }).at(-1)!;
  assert.deepEqual(readKeys, [`${year - 1}-${suffix}`]);
  assert.equal(bar.prior, 8000, `${key}: full prior-year month must show while current month is open`);
  assert.equal(bar.current, 600);
  assert.equal(bar.remaining, 900);
  assert.equal(comparisons[key].yearPrior.revenue, null, 'Matched MTD cannot use full-month authority');
  assert.equal(financeMonthlyChart(data, key, 'jobs', { remaining: 900 }).at(-1)!.prior, 40);
  assert.equal(financeMonthlyChart(data, key, 'averageJob', null).at(-1)!.prior, 200);
  assert.equal(financeMonthlyChart(data, key, 'jobs', null).at(-1)!.current, null, 'Do not compare partial job counts as full months');
  assert.equal(financeMonthlyChart(data, key, 'jobs', { remaining: 900 }).at(-1)!.remaining, null);
}

const key = '2026-09', current = month(key);
const prior = { ...month('2025-09', true), complete: false, grossRevenue: 12000, completedJobs: 60, missingDates: ['2025-09-02'], revenueSource: 'junkware-monthly-dashboard' };
const data = { date: '2026-09-06', trends: [prior, current], trendComparisons: financeTrendComparisons([prior, current], () => null) };
assert.equal(financeMonthlyChart(data, key, 'revenue', null).at(-1)!.prior, 12000, 'Verified monthly total survives daily gaps');
assert.equal(financeMonthlyChart({ ...data, trendComparisons: undefined }, key, 'revenue', null).at(-1)!.prior, 12000, 'Existing payload with complete monthly row remains supported');

const missing = { ...data, trends: [current], trendComparisons: financeTrendComparisons([current], () => null) };
assert.equal(financeMonthlyChart(missing, key, 'revenue', null).at(-1)!.prior, null, 'Unknown is not zero');
const partial = { ...data, trends: [current], trendComparisons: financeTrendComparisons([current], date => date < '2025-09-07' ? { sales: 100, completed_jobs: 1 } : null) };
assert.equal(partial.trendComparisons[key].yearPrior.revenue, 600);
assert.equal(financeMonthlyChart(partial, key, 'revenue', null).at(-1)!.prior, null, 'Partial prior history must not become full-month bar');
const completeDaily = { ...missing, trendComparisons: financeTrendComparisons([current], () => ({ sales: 100, completed_jobs: 1 })) };
assert.equal(financeMonthlyChart(completeDaily, key, 'revenue', null).at(-1)!.prior, 3000, 'Complete daily history can supply full September');
assert.equal(completeDaily.trendComparisons[key].yearPrior.revenue, 600, 'Matched period remains six days');
const zero = { ...missing, trendComparisons: financeTrendComparisons([current], () => null, () => ({ ...full, revenue: 0, jobs: 0, averageJob: null })) };
assert.equal(financeMonthlyChart(zero, key, 'revenue', null).at(-1)!.prior, 0, 'Real zero is preserved');
assert.equal(financeMonthlyChart({ ...data, trends: [prior] }, key, 'revenue', null).at(-1)!.prior, 12000, 'Missing current month must not hide available prior month');
const historical = financeMonthlyChart({ ...data, date: '2026-10-06' }, key, 'revenue', { remaining: 900 }).at(-1)!;
assert.equal(historical.remaining, null, 'Do not replay live forecast onto historical selection');
console.log('PASS: all months, year rollover, full-month authority, matched MTD separation, missing history, zero values and forecast placement');
