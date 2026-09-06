import type { FinanceData } from '../desktop-ui/lib/commercial-contract';
export type TrendValues = { revenue: number | null; jobs: number | null; averageJob: number | null; costs: number | null; profit: number | null; margin: number | null };
export type TrendComparison = { currentStart: string; currentEnd: string; priorStart: string; priorEnd: string; current: TrendValues; prior: TrendValues; yearCurrentStart: string; yearCurrentEnd: string; yearPriorStart: string; yearPriorEnd: string; yearCurrent: TrendValues; yearPrior: TrendValues };
type Month = FinanceData['trends'][number];
const finite = (v: unknown) => v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v);
const values = (revenue: number | null, jobs: number | null, costs: number | null, profit: number | null): TrendValues => ({ revenue, jobs, costs, profit, averageJob: revenue != null && jobs != null && jobs > 0 ? revenue / jobs : null, margin: profit != null && revenue != null && revenue !== 0 ? profit / revenue * 100 : null });
const fromMonth = (month?: Month) => values(month?.grossRevenue ?? null, month?.completedJobs ?? null, month?.totalOperatingExpenses ?? null, month?.estimatedOperatingProfit ?? null);
export function financeTrendComparisons(months: Month[], read: (date: string) => Record<string, unknown> | null, readYearMonth?: (key: string) => TrendValues | null): Record<string, TrendComparison> {
  const cache = new Map<string, Record<string, unknown> | null>();
  const daily = (key: string, days: number) => {
    const rows = Array.from({length: days}, (_, i) => {
      const date = `${key}-${String(i + 1).padStart(2, '0')}`;
      if (!cache.has(date)) cache.set(date, read(date));
      return cache.get(date);
    });
    const sum = (get: (row: Record<string, unknown>) => unknown) => {
      const entries = rows.map(row => row ? finite(get(row)) : null);
      return entries.some(v => v == null) ? null : entries.reduce<number>((a,v) => a + v!, 0);
    };
    return values(sum(r => r.total_revenue ?? r.gross_revenue ?? r.sales), sum(r => {
      const market = r.jobs_by_market;
      if (market && typeof market === 'object' && !Array.isArray(market) && Object.keys(market).length) {
        const counts = Object.values(market).map(finite);
        return counts.some(v=>v==null) ? null : counts.reduce<number>((a,v)=>a+v!,0);
      }
      return r.completed_jobs ?? r.total_jobs ?? r.jobs_completed;
    }), sum(r => r.total_expenses), sum(r => r.net_profit));
  };
  return Object.fromEntries(months.map(month => {
    const [year, number] = month.monthKey.split('-').map(Number);
    const priorEndDate = new Date(Date.UTC(year, number - 1, 0, 12));
    const priorKey = priorEndDate.toISOString().slice(0,7);
    const days = month.complete ? priorEndDate.getUTCDate() : Math.min(Number(month.dataThroughDate.slice(-2)), priorEndDate.getUTCDate());
    const currentEnd = month.complete ? new Date(Date.UTC(year,number,0,12)).toISOString().slice(0,10) : `${month.monthKey}-${String(days).padStart(2,'0')}`;
    const prior = months.find(m => m.monthKey === priorKey && m.complete);
    const priorValues = month.complete && prior ? fromMonth(prior) : daily(priorKey, days);
    const current = month.complete ? fromMonth(month) : daily(month.monthKey, days);
    const yearPriorKey = `${year - 1}-${String(number).padStart(2, '0')}`;
    const yearPriorLastDay = new Date(Date.UTC(year - 1, number, 0, 12)).getUTCDate();
    const yearDays = month.complete ? yearPriorLastDay : Math.min(Number(month.dataThroughDate.slice(-2)), yearPriorLastDay);
    const yearPriorMonth = months.find(m => m.monthKey === yearPriorKey && m.complete);
    const yearCurrentEnd = month.complete ? new Date(Date.UTC(year, number, 0, 12)).toISOString().slice(0, 10) : `${month.monthKey}-${String(yearDays).padStart(2, '0')}`;
    const yearCurrent = month.complete ? fromMonth(month) : daily(month.monthKey, yearDays);
    const yearPrior = month.complete ? (readYearMonth?.(yearPriorKey) ?? (yearPriorMonth ? fromMonth(yearPriorMonth) : daily(yearPriorKey, yearDays))) : daily(yearPriorKey, yearDays);
    return [month.monthKey, {
      currentStart: `${month.monthKey}-01`, currentEnd,
      priorStart: `${priorKey}-01`, priorEnd: `${priorKey}-${String(days).padStart(2,'0')}`,
      current, prior: priorValues,
      yearCurrentStart: `${month.monthKey}-01`, yearCurrentEnd,
      yearPriorStart: `${yearPriorKey}-01`, yearPriorEnd: `${yearPriorKey}-${String(yearDays).padStart(2, '0')}`,
      yearCurrent, yearPrior,
    }];
  }));
}
