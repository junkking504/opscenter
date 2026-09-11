import type { FinanceData } from './commercial-contract';
import { fromFinanceMonth, type TrendValues } from '../../lib/finance-trend-comparison';

export type PerformanceScope = 'month' | 'ytd';
export type PerformanceComparison = 'prior' | 'year';
export type FinanceMonth = FinanceData['trends'][number];
export const emptyValues = (): TrendValues => ({ revenue: null, jobs: null, averageJob: null, costs: null, profit: null, margin: null });
const sum = (values: Array<number | null | undefined>) => !values.length || values.some(v => v == null || !Number.isFinite(v)) ? null : values.reduce<number>((s, v) => s + v!, 0);
const monthEnd = (key: string) => { const [y, m] = key.split('-').map(Number); return new Date(Date.UTC(y, m, 0, 12)).toISOString().slice(0, 10); };
const aggregate = (values: TrendValues[], sales?: Array<number | null | undefined>): TrendValues => {
  const revenue = sum(values.map(v => v.revenue)), jobs = sum(values.map(v => v.jobs));
  const costs = sum(values.map(v => v.costs)), profit = sum(values.map(v => v.profit));
  // Recover each comparison's actual margin denominator; never average percentages.
  const basis = sales ? sum(sales) : sum(values.map(v => v.profit != null && v.margin != null && v.margin !== 0 ? v.profit / v.margin * 100 : null));
  return { revenue, jobs, costs, profit, averageJob: revenue != null && jobs != null && jobs > 0 ? revenue / jobs : null, margin: profit != null && basis != null && basis > 0 ? profit / basis * 100 : null };
};
export function financePerformance(data: Pick<FinanceData, 'trends' | 'trendComparisons'>, key: string, scope: PerformanceScope, comparison: PerformanceComparison) {
  const month = data.trends.find(m => m.monthKey === key);
  const isYear = scope === 'ytd' || comparison === 'year';
  const months = scope === 'month' ? [month] : Array.from({ length: Number(key.slice(5)) }, (_, i) => data.trends.find(m => m.monthKey === `${key.slice(0,4)}-${String(i + 1).padStart(2, '0')}`));
  const comparisons = months.map(m => m ? data.trendComparisons?.[m.monthKey] : undefined);
  const currentValues = months.map(m => fromFinanceMonth(m));
  const current = scope === 'month' ? currentValues[0] : aggregate(currentValues, months.map(m => m?.operatingRevenue));
  const baselineValues = comparisons.map(c => (isYear ? c?.yearPrior : c?.prior) ?? emptyValues());
  const matchedValues = comparisons.map(c => (isYear ? c?.yearCurrent : c?.current) ?? emptyValues());
  const baseline = scope === 'month' ? baselineValues[0] : aggregate(baselineValues);
  const matched = scope === 'month' ? matchedValues[0] : aggregate(matchedValues);
  // A delta must describe the value on its card, not an unseen daily subtotal.
  const prior = Object.fromEntries(Object.keys(current).map(k => {
    const field = k as keyof TrendValues;
    return [field, current[field] != null && matched[field] != null && Math.abs(current[field]! - matched[field]!) < .011 ? baseline[field] : null];
  })) as TrendValues;
  const selected = comparisons[comparisons.length - 1];
  const end = month ? ((month.reportingComplete ?? month.complete) ? monthEnd(key) : month.dataThroughDate) : monthEnd(key);
  const start = scope === 'ytd' ? `${key.slice(0, 4)}-01-01` : `${key}-01`;
  const priorStart = scope === 'ytd' ? `${Number(key.slice(0,4))-1}-01-01` : isYear ? selected?.yearPriorStart : selected?.priorStart;
  const priorEnd = isYear ? selected?.yearPriorEnd : selected?.priorEnd;
  const matchedEnd = isYear ? selected?.yearCurrentEnd : selected?.currentEnd;
  const missingMonths = months.filter(m => !m).length;
  const missingDates = months.flatMap(m => m?.missingDates ?? []);
  const operatingRevenue = sum(months.map(m => m?.operatingRevenue));
  const recyclingIncome = sum(months.map(m => m?.recyclingIncome));
  const revenueDifference = current.revenue != null && operatingRevenue != null ? current.revenue - operatingRevenue : null;
  return { month, months, current, prior, start, end, priorStart, priorEnd, matchedEnd, missingDates, missingMonths, operatingRevenue, recyclingIncome, revenueDifference };
}
export function financeChange(key: keyof TrendValues, current: number | null, prior: number | null) {
  if (current == null || prior == null) return null;
  const difference = current - prior;
  return { difference, percent: key === 'margin' ? difference : prior === 0 ? current === 0 ? 0 : null : difference / Math.abs(prior) * 100 };
}
export function performanceExplanation(current: TrendValues, prior: TrendValues): string {
  if (prior.revenue === 0 || prior.jobs === 0 || current.jobs === 0) return 'The period includes a zero revenue or job baseline. Review the amounts; a normal growth comparison would be misleading.';
  if ([current.revenue, current.jobs, current.averageJob, prior.revenue, prior.jobs, prior.averageJob].some(v => v == null)) return 'A complete, matching comparison is not available. Review the coverage and source details below.';
  const revenue = financeChange('revenue', current.revenue, prior.revenue)!;
  const jobs = financeChange('jobs', current.jobs, prior.jobs)!;
  const average = financeChange('averageJob', current.averageJob, prior.averageJob)!;
  const describe = (value: number) => Math.abs(value) < .05 ? 'was unchanged' : `${value > 0 ? 'rose' : 'fell'} ${Math.abs(value).toFixed(1)}%`;
  // Symmetric decomposition exactly allocates R = jobs × average job value.
  const volumeEffect = (current.jobs! - prior.jobs!) * (current.averageJob! + prior.averageJob!) / 2;
  const ticketEffect = (current.averageJob! - prior.averageJob!) * (current.jobs! + prior.jobs!) / 2;
  const driver = Math.abs(revenue.difference) < .01 ? '' : ` ${Math.abs(ticketEffect) > Math.abs(volumeEffect) ? 'Average job value' : 'Job count'} contributed more to the revenue change.`;
  return `Revenue ${describe(revenue.percent!)}. Job count ${describe(jobs.percent!)} and average job value ${describe(average.percent!)}.${driver}`;
}
