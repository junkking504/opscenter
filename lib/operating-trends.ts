import type { PredictionDataset, PredictionForecast, PredictionSourceCoverage } from './prediction-data';

export type OperatingDay = {
  date: string; revenue: number | null; completedJobs: number | null;
  recordedFuel: number | null; wexCost: number | null; gallons: number | null;
  netPerGallon: number | null; dumpCost: number | null;
  averageJob?: number | null; operatingProfit?: number | null;
  adCost?: number | null; calls?: number | null; conversions?: number | null; costPerCall?: number | null;
  reviews?: number | null; averageRating?: number | null; miles?: number | null;
  scheduledAppointments?: number | null; labor?: number | null; dumpAndFuel?: number | null;
};
export type AnalyticsScope = 'expenses' | 'business' | 'forecast' | 'marketing' | 'reviews' | 'fleet' | 'jobs' | 'labor';
export const scopeMetrics: Record<AnalyticsScope, OperatingMetric[]> = {
  expenses: ['dumpAndFuel', 'fuelCost', 'fuelGallons', 'netPerGallon', 'dumpCost'],
  business: ['revenue', 'completedJobs', 'averageJob', 'operatingProfit'],
  forecast: ['revenue', 'completedJobs', 'fuelCost', 'dumpCost'],
  marketing: ['adCost', 'calls', 'conversions', 'costPerCall'],
  reviews: ['reviews', 'averageRating'],
  fleet: ['miles', 'fuelCost', 'fuelGallons', 'netPerGallon'],
  jobs: ['scheduledAppointments', 'completedJobs'], labor: ['labor'],
};
export type OperatingTrendsData = {
  generatedAt: string; historyThrough: string; snapshotDate: string;
  daily: OperatingDay[]; forecasts: PredictionForecast[];
  wexCoverage: PredictionSourceCoverage | null;
  sourceCoverage?: Record<string, PredictionSourceCoverage>;
  trucks?: Array<{ truck: string; daily: OperatingDay[] }>;
};
export type OperatingMetric = 'revenue' | 'completedJobs' | 'fuelCost' | 'fuelGallons' | 'netPerGallon' | 'dumpCost' | 'averageJob' | 'operatingProfit' | 'adCost' | 'calls' | 'conversions' | 'costPerCall' | 'reviews' | 'averageRating' | 'miles' | 'scheduledAppointments' | 'labor' | 'dumpAndFuel';
export type OperatingChartRow = { date: string; actual: number | null; secondary: number | null; forecast: number | null; spread: [number, number] | null };
export const shiftDay = (date: string, days: number) => new Date(Date.parse(`${date}T12:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
const centralDate = (value: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' }).format(value);
const finite = (value: unknown): number | null => typeof value === 'number' && Number.isFinite(value) ? value : null;

/** Bounded, aggregate-only payload; never serialize customer or transaction records. */
export function operatingTrendsSnapshot(dataset: PredictionDataset | null, selectedDate: string, now = new Date()): OperatingTrendsData | null {
  if (!dataset || !Number.isFinite(Date.parse(dataset.generatedAt))) return null;
  const snapshotDate = centralDate(new Date(dataset.generatedAt));
  const today = centralDate(now);
  // Exclude partial current/snapshot days. Historical selections include the selected day.
  const historyThrough = [selectedDate, shiftDay(today, -1), shiftDay(snapshotDate, -1)].sort()[0];
  const start = shiftDay(historyThrough, -364);
  return {
    generatedAt: dataset.generatedAt, snapshotDate, historyThrough,
    daily: dataset.daily.filter(row => row.date >= start && row.date <= historyThrough).map(row => {
      const gallons = finite(row.wex.gallons), wexCost = finite(row.wex.netCost);
      const publishedFuel = finite(row.junkware.recordedFuelCost);
      const supplementalWex = wexCost !== null && (publishedFuel === null || Math.abs(publishedFuel) < .005);
      const selectedFuel = supplementalWex ? wexCost : publishedFuel;
      return { date: row.date, revenue: finite(row.junkware.revenue), completedJobs: finite(row.junkware.completedJobs),
        recordedFuel: finite(row.junkware.recordedFuelCost), wexCost, gallons,
        netPerGallon: gallons !== null && gallons > 0 && wexCost !== null ? wexCost / gallons : null,
        dumpCost: finite(row.actuals.dumpCost), operatingProfit: row.junkware.netProfit === null ? null : row.junkware.netProfit - (supplementalWex ? wexCost! : 0),
        dumpAndFuel: row.actuals.dumpCost !== null && selectedFuel !== null ? row.actuals.dumpCost + selectedFuel : null,
        labor: finite(row.junkware.payroll), scheduledAppointments: finite(row.junkware.scheduledAppointments),
        averageJob: row.junkware.revenue !== null && row.junkware.completedJobs !== null && row.junkware.completedJobs > 0 ? row.junkware.revenue / row.junkware.completedJobs : null,
        adCost: finite(row.searchKings.adCost), calls: finite(row.searchKings.calls), conversions: finite(row.searchKings.conversions),
        costPerCall: row.searchKings.adCost !== null && row.searchKings.calls !== null && row.searchKings.calls > 0 ? row.searchKings.adCost / row.searchKings.calls : null,
        reviews: finite(row.podium.newReviews), averageRating: row.podium.ratingSum !== null && row.podium.newReviews !== null && row.podium.newReviews > 0 ? row.podium.ratingSum / row.podium.newReviews : null,
        miles: finite(row.fleet.miles) };
    }),
    // Today's model must never masquerade as a historical as-of forecast.
    forecasts: selectedDate === today && snapshotDate === today ? dataset.forecasts : [],
    wexCoverage: dataset.sourceCoverage.wex || null,
    sourceCoverage: dataset.sourceCoverage,
    trucks: [...new Set(dataset.truckDaily.map(row => row.truck))].sort().map(truck => ({ truck,
      daily: dataset.truckDaily.filter(row => row.truck === truck && row.date >= start && row.date <= historyThrough).map(row => ({
        date: row.date, revenue: null, completedJobs: null, dumpCost: null, recordedFuel: finite(row.recordedFuelCost),
        wexCost: finite(row.wexFuelCost), gallons: finite(row.wexGallons), miles: finite(row.miles),
        netPerGallon: row.wexGallons !== null && row.wexGallons > 0 && row.wexFuelCost !== null ? row.wexFuelCost / row.wexGallons : null,
      })) })),
  };
}

export function operatingChartRows(data: OperatingTrendsData, metric: OperatingMetric, days: number): OperatingChartRow[] {
  const start = shiftDay(data.historyThrough, 1 - Math.min(365, Math.max(1, days)));
  const forecast = data.forecasts.find(item => item.target === metric);
  const points = new Map((forecast?.points || []).filter(point => point.date > data.historyThrough).map(point => [point.date, point]));
  // All six graphs share calendar positions, including the forecast horizon.
  const end = [data.historyThrough, ...data.forecasts.flatMap(item => item.points.map(point => point.date))].sort().at(-1)!;
  const daily = new Map(data.daily.map(row => [row.date, row]));
  const rows: OperatingChartRow[] = [];
  for (let date = start; date <= end; date = shiftDay(date, 1)) {
    const row = date <= data.historyThrough ? daily.get(date) : undefined;
    const point = points.get(date);
    const actual = row ? metric === 'fuelCost' ? row.wexCost : metric === 'fuelGallons' ? row.gallons : row[metric] : null;
    rows.push({ date, actual: actual ?? null, secondary: metric === 'fuelCost' ? row?.recordedFuel ?? null : null,
      forecast: point ? finite(point.value) : null,
      spread: point && finite(point.expectedLow) !== null && finite(point.expectedHigh) !== null ? [point.expectedLow, point.expectedHigh] : null });
  }
  return rows;
}

/** Explicit allowlist prevents finance data from leaking through operations-only views. */
export function scopeOperatingTrends(data: OperatingTrendsData | null, scope: AnalyticsScope): OperatingTrendsData | null {
  if (!data) return null;
  const allowed = scopeMetrics[scope];
  const sources = scope === 'marketing' ? ['searchKings'] : scope === 'reviews' ? ['podium'] : scope === 'fleet' ? ['wex', 'linxup', 'junkware'] : ['wex', 'junkware'];
  const select = (row: OperatingDay): OperatingDay => {
    const projected: OperatingDay = { date: row.date, revenue: null, completedJobs: null, recordedFuel: null, wexCost: null, gallons: null, netPerGallon: null, dumpCost: null };
    for (const metric of allowed) {
      if (metric === 'fuelCost') { projected.wexCost = row.wexCost; projected.recordedFuel = row.recordedFuel; }
      else if (metric === 'fuelGallons') projected.gallons = row.gallons;
      else projected[metric] = row[metric] ?? null;
    }
    return projected;
  };
  return { ...data, daily: data.daily.map(select), forecasts: scope === 'forecast' ? data.forecasts.filter(model => allowed.includes(model.target)) : [],
    wexCoverage: sources.includes('wex') ? data.wexCoverage : null,
    sourceCoverage: Object.fromEntries(Object.entries(data.sourceCoverage || {}).filter(([key]) => sources.includes(key))),
    trucks: scope === 'fleet' ? data.trucks?.map(truck => ({ truck: truck.truck, daily: truck.daily.map(select) })) : undefined };
}
