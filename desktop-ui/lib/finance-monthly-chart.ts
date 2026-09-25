import type { FinanceData } from './commercial-contract';
import { fromFinanceMonth } from '../../lib/finance-trend-comparison';

export type MonthlyChartMetric = 'revenue' | 'jobs' | 'averageJob';

export function financeMonthlyChart(
  data: Pick<FinanceData, 'date' | 'trends' | 'trendComparisons'>,
  key: string,
  metric: MonthlyChartMetric,
  projection: { remaining: number } | null,
) {
  const year = Number(key.slice(0, 4));
  return Array.from({ length: Number(key.slice(5)) }, (_, i) => {
    const suffix = String(i + 1).padStart(2, '0');
    const monthKey = `${year}-${suffix}`;
    const month = data.trends.find(m => m.monthKey === monthKey);
    const complete = month && (month.reportingComplete ?? month.complete);
    const previousMonth = data.trends.find(m => m.monthKey === `${year - 1}-${suffix}` && (m.reportingComplete ?? m.complete));
    const comparison = data.trendComparisons?.[monthKey];
    // Never use a partial matched-period value as a full-month chart bar.
    const previous = comparison?.yearPriorFullMonth ?? (previousMonth ? fromFinanceMonth(previousMonth) : complete ? comparison?.yearPrior : null);
    const liveRevenue = metric === 'revenue' && monthKey === data.date.slice(0, 7);
    return {
      month: new Date(`${monthKey}-01T12:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short' }),
      current: month && (complete || liveRevenue) ? fromFinanceMonth(month)[metric] : null,
      remaining: liveRevenue ? projection?.remaining ?? null : null,
      prior: previous?.[metric] ?? null,
    };
  });
}
