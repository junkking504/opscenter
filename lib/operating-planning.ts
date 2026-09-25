import { shiftDay, type OperatingDay, type OperatingTrendsData } from './operating-trends';

export const weekdayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const weekday = (date: string) => new Date(`${date}T12:00:00Z`).getUTCDay();
const usable = (row: OperatingDay) => row.jobDay === 'operating' && (row.completedJobs ?? 0) > 0;
const mean = (values: number[]) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
export type PlanningMetric = 'revenue' | 'completedJobs';
export type PlanningEstimate = { value: number; samples: number; method: 'matching weekdays' | 'operating-day fallback' };

/** No future observations, imputed zeros, or synthetic training rows. */
export function planningEstimate(rows: OperatingDay[], date: string, metric: PlanningMetric): PlanningEstimate | null {
  const observed = rows.filter(row => row.date < date && row.date >= shiftDay(date, -84) && usable(row) && typeof row[metric] === 'number' && Number.isFinite(row[metric])).sort((a, b) => a.date.localeCompare(b.date));
  const matching = observed.filter(row => weekday(row.date) === weekday(date)).slice(-8);
  const sample = matching.length >= 2 ? matching : observed.slice(-28);
  if (sample.length < (matching.length >= 2 ? 2 : 7)) return null;
  const weight = sample.reduce((sum, _, i) => sum + i + 1, 0);
  return { value: Math.max(0, sample.reduce((sum, row, i) => sum + row[metric]! * (i + 1), 0) / weight), samples: sample.length, method: matching.length >= 2 ? 'matching weekdays' : 'operating-day fallback' };
}

export function planningBacktest(rows: OperatingDay[], metric: PlanningMetric) {
  const tests = rows.filter(row => usable(row) && row[metric] != null).sort((a, b) => a.date.localeCompare(b.date)).slice(-56).flatMap(row => {
    const estimate = planningEstimate(rows, row.date, metric);
    return estimate ? [{ actual: row[metric]!, error: Math.abs(estimate.value - row[metric]!) }] : [];
  });
  const total = tests.reduce((sum, row) => sum + Math.abs(row.actual), 0);
  return { samples: tests.length, wape: total > 0 ? tests.reduce((sum, row) => sum + row.error, 0) / total : null };
}

export function operatingPatterns(data: OperatingTrendsData, days: number) {
  const start = shiftDay(data.historyThrough, 1 - days);
  const rows = data.daily.filter(row => row.date >= start && row.date <= data.historyThrough && usable(row));
  const summarize = (sample: OperatingDay[], label: string) => ({ label, samples: sample.length, jobs: mean(sample.map(row => row.completedJobs!)), revenue: mean(sample.flatMap(row => row.revenue == null ? [] : [row.revenue])), revenueSamples: sample.filter(row => row.revenue != null).length });
  return {
    start,
    weekdays: [1, 2, 3, 4, 5, 6, 0].map(value => summarize(rows.filter(row => weekday(row.date) === value), weekdayNames[value])),
    monthDays: Array.from({ length: 31 }, (_, i) => summarize(rows.filter(row => Number(row.date.slice(8)) === i + 1), String(i + 1))),
  };
}

export function upcomingDemand(data: OperatingTrendsData, today: string, count = 14) {
  if (data.snapshotDate !== today || data.historyThrough !== shiftDay(today, -1)) return [];
  const history = data.daily.filter(row => row.date <= data.historyThrough);
  return Array.from({ length: count }, (_, i) => {
    const date = shiftDay(today, i);
    const jobs = planningEstimate(history, date, 'completedJobs');
    const revenue = planningEstimate(history, date, 'revenue');
    return { date, label: `${weekdayNames[weekday(date)]} ${date.slice(5)}`, jobs: jobs?.value ?? null, revenue: revenue?.value ?? null, samples: jobs?.samples ?? 0, method: jobs?.method ?? null };
  });
}

export function monthRevenueProjection(data: OperatingTrendsData | null | undefined, input: { today: string; month: string; actual: number | null; through: string; partialDayRevenue: number | null; missingDates?: string[] }) {
  if (!data || data.snapshotDate !== input.today || data.historyThrough !== shiftDay(input.today, -1) || input.month !== input.today.slice(0, 7) || input.actual == null || !Number.isFinite(input.actual) || input.through < `${input.month}-01` || input.through > input.today) return null;
  const [year, month] = input.month.split('-').map(Number);
  const end = new Date(Date.UTC(year, month, 0, 12)).toISOString().slice(0, 10);
  const history = data.daily.filter(row => row.date <= data.historyThrough);
  let remaining = 0, lowSampleDays = 0;
  const estimates: Array<{ date: string; value: number; samples: number; method: string }> = [];
  for (let date = input.through === input.today ? input.today : shiftDay(input.through, 1); date <= end; date = shiftDay(date, 1)) {
    const result = planningEstimate(history, date, 'revenue');
    if (!result) return null;
    // Monthly actuals already include today's published partial amount. Never count it twice.
    if (date === input.through && input.partialDayRevenue == null) return null;
    const value = date === input.through ? Math.max(0, result.value - input.partialDayRevenue!) : result.value;
    remaining += value;
    if (result.samples < 4 || result.method !== 'matching weekdays') lowSampleDays++;
    estimates.push({ date, value, samples: result.samples, method: result.method });
  }
  return { actual: input.actual, remaining, total: input.actual + remaining, through: input.through, estimates, lowSampleDays, missingDates: input.missingDates ?? [], backtest: planningBacktest(history, 'revenue') };
}
