import fs from "node:fs";
import path from "node:path";

type JsonRecord = Record<string, any>;

export type PredictionSourceCoverage = {
  status: "available" | "partial" | "missing" | "invalid";
  records: number;
  coverageFrom: string | null;
  coverageThrough: string | null;
  updatedAt: string | null;
  note: string;
};

export type DailyPredictionFeatures = {
  date: string;
  calendar: { dayOfWeek: number; month: number; dayOfMonth: number; isWeekend: boolean };
  junkware: {
    revenue: number | null;
    completedJobs: number | null;
    estimates: number | null;
    appointments: number | null;
    payroll: number | null;
    recordedFuelCost: number | null;
    recordedDumpCost: number | null;
    otherExpense: number | null;
    netProfit: number | null;
  };
  fleet: { miles: number | null; driveMinutes: number | null; idleMinutes: number | null };
  searchKings: {
    adCost: number | null;
    conversions: number | null;
    impressions: number | null;
    clicks: number | null;
    calls: number | null;
    qualifiedCalls: number | null;
    answeredCalls: number | null;
    callMinutes: number | null;
  };
  podium: { newReviews: number | null; ratingSum: number | null; reviewsNeedingResponse: number | null };
  qbo: { postedPayments: number | null; postedPaymentTotal: number | null; matchedTotal: number | null };
  wex: {
    postedTransactions: number | null;
    gallons: number | null;
    netCost: number | null;
    averageUnitCost: number | null;
  };
  actuals: {
    fuelCost: number | null;
    fuelCostSource: "wex" | "junkware" | "unavailable";
    dumpCost: number | null;
    dumpCostSource: "junkware-recorded" | "unavailable";
  };
  availability: Record<"junkware" | "fleet" | "searchKings" | "podium" | "qbo" | "wex", boolean>;
};

export type TruckDayPredictionFeatures = {
  date: string;
  truck: string;
  revenue: number | null;
  jobs: number | null;
  miles: number | null;
  driveMinutes: number | null;
  idleMinutes: number | null;
  recordedFuelCost: number | null;
  recordedDumpCost: number | null;
  wexFuelCost: number | null;
  wexGallons: number | null;
};

export type ForecastPoint = {
  date: string;
  value: number;
  expectedLow: number;
  expectedHigh: number;
  trainingObservations: number;
  confidence: "low" | "medium";
};

export type PredictionForecast = {
  target: "revenue" | "completedJobs" | "fuelCost" | "fuelGallons" | "dumpCost";
  unit: "usd" | "count" | "gallons";
  method: "same-weekday trailing baseline";
  dataThrough: string | null;
  historyObservations: number;
  backtest: { observations: number; meanAbsoluteError: number | null; weightedAbsolutePercentError: number | null };
  points: ForecastPoint[];
};

export type PredictiveRelationship = {
  feature: string;
  outcome: "revenue";
  lagDays: number;
  observations: number;
  correlation: number | null;
  status: "eligible" | "insufficient-history";
  note: string;
};

export type PredictionDataset = {
  schemaVersion: 1;
  generatedAt: string;
  dataThrough: string | null;
  sourceCoverage: Record<string, PredictionSourceCoverage>;
  daily: DailyPredictionFeatures[];
  truckDaily: TruckDayPredictionFeatures[];
  forecasts: PredictionForecast[];
  relationships: PredictiveRelationship[];
  guardrails: string[];
};

const DATE_FILE = /_(\d{4}-\d{2}-\d{2})(?:_|\.)/;

function round(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function finite(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function sumNumbers(value: unknown): number | null {
  if (!value || typeof value !== "object") return null;
  const numbers = Object.values(value as Record<string, unknown>).map(finite).filter((item): item is number => item !== null);
  return numbers.length ? round(numbers.reduce((sum, item) => sum + item, 0), 3) : null;
}

function durationMinutes(value: unknown): number | null {
  const match = String(value || "").trim().match(/^(\d+):(\d{2})$/);
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

function sumDurations(value: unknown): number | null {
  if (!value || typeof value !== "object") return null;
  const durations = Object.values(value as Record<string, unknown>).map(durationMinutes).filter((item): item is number => item !== null);
  return durations.length ? durations.reduce((sum, item) => sum + item, 0) : null;
}

function readJson(file: string): JsonRecord | null {
  try {
    const value = JSON.parse(fs.readFileSync(file, "utf8"));
    return value && typeof value === "object" ? value : null;
  } catch {
    return null;
  }
}

function files(directory: string, pattern: RegExp): string[] {
  try {
    return fs.readdirSync(directory).filter((name) => pattern.test(name)).sort().map((name) => path.join(directory, name));
  } catch {
    return [];
  }
}

function chicagoDate(value: string | Date): string | null {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.valueOf())) return null;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(date);
  const pick = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value || "";
  const result = `${pick("year")}-${pick("month")}-${pick("day")}`;
  return /^\d{4}-\d{2}-\d{2}$/.test(result) ? result : null;
}

function parseDisplayDate(value: unknown): string | null {
  const parsed = new Date(`${String(value || "").replace(/,/g, "")} 12:00:00 UTC`);
  return Number.isNaN(parsed.valueOf()) ? null : parsed.toISOString().slice(0, 10);
}

function addDays(date: string, days: number): string {
  const parsed = new Date(`${date}T12:00:00Z`);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

function calendar(date: string): DailyPredictionFeatures["calendar"] {
  const parsed = new Date(`${date}T12:00:00Z`);
  const dayOfWeek = parsed.getUTCDay();
  return { dayOfWeek, month: parsed.getUTCMonth() + 1, dayOfMonth: parsed.getUTCDate(), isWeekend: dayOfWeek === 0 || dayOfWeek === 6 };
}

function normalizeTruck(value: unknown): string {
  const match = String(value || "").match(/(?:truck\s*#?\s*)?(\d+)/i);
  return match ? `Truck ${Number(match[1])}` : String(value || "Unassigned").trim() || "Unassigned";
}

function aggregateSearchKings(dataRoot: string) {
  const snapshots = files(path.join(dataRoot, "history", "searchkings"), /^searchkings_\d{4}-\d{2}\.json$/);
  const daily = new Map<string, NonNullable<DailyPredictionFeatures["searchKings"]>>();
  const seenCalls = new Map<string, JsonRecord>();
  let latestUpdated: string | null = null;
  let coverageFrom: string | null = null;
  let coverageThrough: string | null = null;
  let valid = 0;
  for (const file of snapshots) {
    const snapshot = readJson(file);
    if (!snapshot || !Array.isArray(snapshot.accounts) || !Array.isArray(snapshot.calls?.calls)) continue;
    valid += 1;
    latestUpdated = [latestUpdated, String(snapshot.fetchedAt || "")].filter(Boolean).sort().at(-1) || null;
    coverageFrom = [coverageFrom, String(snapshot.range?.startDate || "")].filter(Boolean).sort()[0] || null;
    coverageThrough = [coverageThrough, String(snapshot.range?.endDate || "")].filter(Boolean).sort().at(-1) || null;
    for (const account of snapshot.accounts) {
      for (const metric of Array.isArray(account.metrics) ? account.metrics : []) {
        const label = String(metric.label || "").toLowerCase();
        const labels = Array.isArray(metric.chartData?.labels) ? metric.chartData.labels : [];
        const values = Array.isArray(metric.chartData?.datasets?.[0]?.data) ? metric.chartData.datasets[0].data : [];
        labels.forEach((displayDate: unknown, index: number) => {
          const date = parseDisplayDate(displayDate);
          const value = finite(values[index]);
          if (!date || value === null) return;
          const row = daily.get(date) || { adCost: null, conversions: null, impressions: null, clicks: null, calls: null, qualifiedCalls: null, answeredCalls: null, callMinutes: null };
          const key = label === "cost" ? "adCost" : label === "conversions" ? "conversions" : label === "impressions" ? "impressions" : label === "clicks" ? "clicks" : null;
          if (key) row[key] = round((row[key] || 0) + value, 3);
          daily.set(date, row);
        });
      }
    }
    for (const call of snapshot.calls.calls) {
      const id = String(call.id || "");
      if (id) seenCalls.set(id, call);
    }
  }
  for (const call of seenCalls.values()) {
    const date = parseDisplayDate(call.calledAtDate);
    if (!date) continue;
    const row = daily.get(date) || { adCost: null, conversions: null, impressions: null, clicks: null, calls: null, qualifiedCalls: null, answeredCalls: null, callMinutes: null };
    row.calls = (row.calls || 0) + 1;
    if (Number(call.score || 0) >= 3) row.qualifiedCalls = (row.qualifiedCalls || 0) + 1;
    if (String(call.status || "").toLowerCase() === "answered") row.answeredCalls = (row.answeredCalls || 0) + 1;
    const seconds = String(call.duration || "").split(":").reduce((total: number, part: string) => total * 60 + Number(part || 0), 0);
    if (Number.isFinite(seconds)) row.callMinutes = round((row.callMinutes || 0) + seconds / 60, 2);
    daily.set(date, row);
  }
  return { daily, valid, snapshots: snapshots.length, calls: seenCalls.size, latestUpdated, coverageFrom, coverageThrough };
}

function aggregatePodium(dataRoot: string) {
  const snapshots = files(path.join(dataRoot, "history", "podium-google-reviews"), /^podium-google-reviews_\d{4}-\d{2}-\d{2}\.json$/);
  const reviews = new Map<string, JsonRecord>();
  let latestUpdated: string | null = null;
  let valid = 0;
  for (const file of snapshots) {
    const snapshot = readJson(file);
    if (!snapshot || !Array.isArray(snapshot.locations)) continue;
    valid += 1;
    latestUpdated = [latestUpdated, String(snapshot.fetchedAt || "")].filter(Boolean).sort().at(-1) || null;
    for (const location of snapshot.locations) {
      for (const review of Array.isArray(location.reviews) ? location.reviews : []) {
        const id = String(review.uid || "");
        if (id) reviews.set(id, review);
      }
    }
  }
  const daily = new Map<string, DailyPredictionFeatures["podium"]>();
  for (const review of reviews.values()) {
    const date = chicagoDate(String(review.createdAt || ""));
    if (!date) continue;
    const row = daily.get(date) || { newReviews: 0, ratingSum: 0, reviewsNeedingResponse: 0 };
    row.newReviews = (row.newReviews || 0) + 1;
    row.ratingSum = round((row.ratingSum || 0) + Number(review.rating || 0), 2);
    if (review.needsResponse === true) row.reviewsNeedingResponse = (row.reviewsNeedingResponse || 0) + 1;
    daily.set(date, row);
  }
  const dates = [...daily.keys()].sort();
  return { daily, valid, snapshots: snapshots.length, reviews: reviews.size, latestUpdated, coverageFrom: dates[0] || null, coverageThrough: dates.at(-1) || null };
}

function aggregateQbo(dataRoot: string) {
  const snapshots = files(path.join(dataRoot, "history", "payment_reconciliation"), /^payment_reconciliation_\d{4}-\d{2}-\d{2}\.json$/);
  const daily = new Map<string, DailyPredictionFeatures["qbo"]>();
  let valid = 0;
  let latestUpdated: string | null = null;
  for (const file of snapshots) {
    const snapshot = readJson(file);
    const date = String(snapshot?.date || file.match(DATE_FILE)?.[1] || "");
    const source = snapshot?.sources?.merchant_center;
    if (!snapshot || !/^\d{4}-\d{2}-\d{2}$/.test(date) || source?.available !== true) continue;
    valid += 1;
    latestUpdated = [latestUpdated, String(snapshot.generated_at || source.collected_at || "")].filter(Boolean).sort().at(-1) || null;
    daily.set(date, {
      postedPayments: finite(snapshot.summary?.merchant_center_count),
      postedPaymentTotal: finite(snapshot.summary?.merchant_center_total),
      matchedTotal: finite(snapshot.summary?.matched_total),
    });
  }
  const dates = [...daily.keys()].sort();
  return { daily, valid, snapshots: snapshots.length, latestUpdated, coverageFrom: dates[0] || null, coverageThrough: dates.at(-1) || null };
}

function aggregateWex(dataRoot: string) {
  const file = path.join(dataRoot, "integrations", "wex-fuel", "posted-transactions.json");
  const snapshot = readJson(file);
  const daily = new Map<string, DailyPredictionFeatures["wex"]>();
  const truckDaily = new Map<string, { netCost: number; gallons: number }>();
  if (!snapshot || !Array.isArray(snapshot.transactions)) return { daily, truckDaily, snapshot: null as JsonRecord | null };
  for (const transaction of snapshot.transactions) {
    const date = String(transaction.transactionDate || "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    const row = daily.get(date) || { postedTransactions: 0, gallons: 0, netCost: 0, averageUnitCost: null };
    row.postedTransactions = (row.postedTransactions || 0) + 1;
    row.gallons = round((row.gallons || 0) + Number(transaction.gallons || 0), 3);
    row.netCost = round((row.netCost || 0) + Number(transaction.netCost || 0), 2);
    row.averageUnitCost = row.gallons ? round((row.netCost || 0) / row.gallons, 3) : null;
    daily.set(date, row);
    const key = `${date}|${normalizeTruck(transaction.truck)}`;
    const truck = truckDaily.get(key) || { netCost: 0, gallons: 0 };
    truck.netCost = round(truck.netCost + Number(transaction.netCost || 0), 2);
    truck.gallons = round(truck.gallons + Number(transaction.gallons || 0), 3);
    truckDaily.set(key, truck);
  }
  return { daily, truckDaily, snapshot };
}

function percentile(values: number[], point: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = (sorted.length - 1) * point;
  const lower = Math.floor(index);
  const fraction = index - lower;
  return sorted[lower + 1] === undefined ? sorted[lower] : sorted[lower] + fraction * (sorted[lower + 1] - sorted[lower]);
}

function targetValue(row: DailyPredictionFeatures, target: PredictionForecast["target"]): number | null {
  if (target === "revenue") return row.junkware.revenue;
  if (target === "completedJobs") return row.junkware.completedJobs;
  if (target === "fuelCost") return row.actuals.fuelCost;
  if (target === "fuelGallons") return row.wex.gallons;
  return row.actuals.dumpCost;
}

function baseline(history: DailyPredictionFeatures[], date: string, target: PredictionForecast["target"]): { value: number; low: number; high: number; observations: number } | null {
  const weekday = calendar(date).dayOfWeek;
  const observed = history.filter((row) => row.date < date && targetValue(row, target) !== null);
  const sameWeekday = observed.filter((row) => row.calendar.dayOfWeek === weekday).slice(-8);
  const sample = sameWeekday.length >= 4 ? sameWeekday : observed.slice(-28);
  const values = sample.map((row) => targetValue(row, target)!).filter(Number.isFinite);
  if (values.length < 4) return null;
  const weights = values.map((_, index) => index + 1);
  const value = values.reduce((sum, item, index) => sum + item * weights[index], 0) / weights.reduce((sum, item) => sum + item, 0);
  return { value: round(Math.max(0, value), target === "completedJobs" ? 1 : 2), low: round(Math.max(0, percentile(values, 0.2)), 2), high: round(Math.max(0, percentile(values, 0.8)), 2), observations: values.length };
}

function buildForecast(daily: DailyPredictionFeatures[], target: PredictionForecast["target"], startDate: string): PredictionForecast {
  const observations = daily.filter((row) => row.date < startDate && targetValue(row, target) !== null);
  const testRows = observations.slice(-56);
  const errors: number[] = [];
  let absoluteActual = 0;
  for (const row of testRows) {
    const result = baseline(observations.filter((prior) => prior.date < row.date), row.date, target);
    const actual = targetValue(row, target);
    if (!result || actual === null) continue;
    errors.push(Math.abs(actual - result.value));
    absoluteActual += Math.abs(actual);
  }
  const weightedAbsolutePercentError = errors.length && absoluteActual > 0
    ? round(errors.reduce((sum, item) => sum + item, 0) / absoluteActual, 4)
    : null;
  const points = Array.from({ length: 7 }, (_, index) => addDays(startDate, index)).flatMap((date) => {
    const result = baseline(observations, date, target);
    const confidence = result && result.observations >= 8 && errors.length >= 21
      && weightedAbsolutePercentError !== null && weightedAbsolutePercentError <= 0.35 ? "medium" as const : "low" as const;
    return result ? [{ date, value: result.value, expectedLow: result.low, expectedHigh: result.high, trainingObservations: result.observations, confidence }] : [];
  });
  return {
    target,
    unit: target === "completedJobs" ? "count" : target === "fuelGallons" ? "gallons" : "usd",
    method: "same-weekday trailing baseline",
    dataThrough: observations.at(-1)?.date || null,
    historyObservations: observations.length,
    backtest: {
      observations: errors.length,
      meanAbsoluteError: errors.length ? round(errors.reduce((sum, item) => sum + item, 0) / errors.length, 2) : null,
      weightedAbsolutePercentError,
    },
    points,
  };
}

function pearson(pairs: Array<[number, number]>): number | null {
  if (pairs.length < 2) return null;
  const xMean = pairs.reduce((sum, [x]) => sum + x, 0) / pairs.length;
  const yMean = pairs.reduce((sum, [, y]) => sum + y, 0) / pairs.length;
  let numerator = 0;
  let xSquare = 0;
  let ySquare = 0;
  for (const [x, y] of pairs) {
    numerator += (x - xMean) * (y - yMean);
    xSquare += (x - xMean) ** 2;
    ySquare += (y - yMean) ** 2;
  }
  const denominator = Math.sqrt(xSquare * ySquare);
  return denominator ? round(numerator / denominator, 3) : null;
}

function buildRelationships(daily: DailyPredictionFeatures[]): PredictiveRelationship[] {
  const rows = new Map(daily.map((row) => [row.date, row]));
  const candidates: Array<{ feature: string; lagDays: number; read: (row: DailyPredictionFeatures) => number | null }> = [
    { feature: "searchKings.adCost", lagDays: 1, read: (row) => row.searchKings.adCost },
    { feature: "searchKings.qualifiedCalls", lagDays: 1, read: (row) => row.searchKings.qualifiedCalls },
    { feature: "searchKings.conversions", lagDays: 1, read: (row) => row.searchKings.conversions },
    { feature: "podium.newReviews", lagDays: 7, read: (row) => row.podium.newReviews },
    { feature: "fleet.miles", lagDays: 0, read: (row) => row.fleet.miles },
    { feature: "junkware.completedJobs", lagDays: 0, read: (row) => row.junkware.completedJobs },
  ];
  return candidates.map((candidate) => {
    const pairs: Array<[number, number]> = [];
    for (const row of daily) {
      const feature = candidate.read(row);
      const outcome = rows.get(addDays(row.date, candidate.lagDays))?.junkware.revenue;
      if (feature !== null && outcome !== null && outcome !== undefined) pairs.push([feature, outcome]);
    }
    const eligible = pairs.length >= 21;
    return {
      feature: candidate.feature,
      outcome: "revenue",
      lagDays: candidate.lagDays,
      observations: pairs.length,
      correlation: eligible ? pearson(pairs) : null,
      status: eligible ? "eligible" : "insufficient-history",
      note: eligible ? "Association only; this does not establish causation." : "At least 21 overlapping observed days are required.",
    };
  });
}

export function buildPredictionDataset(dataRoot: string, now = new Date()): PredictionDataset {
  const metricsFiles = files(path.join(dataRoot, "history", "daily_metrics"), /^daily_metrics_\d{4}-\d{2}-\d{2}\.json$/);
  const searchKings = aggregateSearchKings(dataRoot);
  const podium = aggregatePodium(dataRoot);
  const qbo = aggregateQbo(dataRoot);
  const wex = aggregateWex(dataRoot);
  const dailyByDate = new Map<string, DailyPredictionFeatures>();
  const truckDaily = new Map<string, TruckDayPredictionFeatures>();
  let validMetrics = 0;
  let metricsUpdatedAt: string | null = null;

  for (const file of metricsFiles) {
    const metrics = readJson(file);
    const date = String(metrics?.date || file.match(DATE_FILE)?.[1] || "");
    if (!metrics || !/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    validMetrics += 1;
    metricsUpdatedAt = [metricsUpdatedAt, String(metrics.generated_at || "")].filter(Boolean).sort().at(-1) || null;
    const appointments = Array.isArray(metrics.appointments) ? metrics.appointments : [];
    const publishedJobs = sumNumbers(metrics.jobs_by_truck);
    const jobs = publishedJobs ?? appointments.filter((appointment) =>
      String(appointment.appointment_type || "").toLowerCase() === "job"
      && String(appointment.job_status || "").toLowerCase().includes("completed")
    ).length;
    const estimates = appointments.filter((appointment) => String(appointment.appointment_type || "").toLowerCase() === "estimate").length;
    const search = searchKings.daily.get(date) || { adCost: null, conversions: null, impressions: null, clicks: null, calls: null, qualifiedCalls: null, answeredCalls: null, callMinutes: null };
    const reviews = podium.daily.get(date) || { newReviews: null, ratingSum: null, reviewsNeedingResponse: null };
    const payments = qbo.daily.get(date) || { postedPayments: null, postedPaymentTotal: null, matchedTotal: null };
    const fuel = wex.daily.get(date) || { postedTransactions: null, gallons: null, netCost: null, averageUnitCost: null };
    const junkwareFuel = finite(metrics.fuel_expense);
    const recordedDump = finite(metrics.dump_expense);
    const row: DailyPredictionFeatures = {
      date,
      calendar: calendar(date),
      junkware: {
        revenue: finite(metrics.total_revenue ?? metrics.sales),
        completedJobs: jobs,
        estimates,
        appointments: appointments.length,
        payroll: finite(metrics.total_payroll ?? metrics.payroll),
        recordedFuelCost: junkwareFuel,
        recordedDumpCost: recordedDump,
        otherExpense: finite(metrics.other_expense),
        netProfit: finite(metrics.net_profit),
      },
      fleet: { miles: sumNumbers(metrics.miles_by_truck), driveMinutes: sumDurations(metrics.drive_time_by_truck), idleMinutes: sumDurations(metrics.idle_time_by_truck) },
      searchKings: search,
      podium: reviews,
      qbo: payments,
      wex: fuel,
      actuals: {
        fuelCost: fuel.netCost !== null ? fuel.netCost : junkwareFuel,
        fuelCostSource: fuel.netCost !== null ? "wex" : junkwareFuel !== null ? "junkware" : "unavailable",
        dumpCost: recordedDump,
        dumpCostSource: recordedDump !== null ? "junkware-recorded" : "unavailable",
      },
      availability: { junkware: true, fleet: sumNumbers(metrics.miles_by_truck) !== null, searchKings: searchKings.daily.has(date), podium: podium.daily.has(date), qbo: qbo.daily.has(date), wex: wex.daily.has(date) },
    };
    dailyByDate.set(date, row);

    const jobsByTruck = metrics.jobs_by_truck && typeof metrics.jobs_by_truck === "object" ? metrics.jobs_by_truck : {};
    const revenueByTruck = metrics.revenue_by_truck && typeof metrics.revenue_by_truck === "object" ? metrics.revenue_by_truck : {};
    const milesByTruck = metrics.miles_by_truck && typeof metrics.miles_by_truck === "object" ? metrics.miles_by_truck : {};
    const driveByTruck = metrics.drive_time_by_truck && typeof metrics.drive_time_by_truck === "object" ? metrics.drive_time_by_truck : {};
    const idleByTruck = metrics.idle_time_by_truck && typeof metrics.idle_time_by_truck === "object" ? metrics.idle_time_by_truck : {};
    const expenseRows = Array.isArray(metrics.truck_record_financial_rows) ? metrics.truck_record_financial_rows : [];
    const expenses = new Map(expenseRows.map((expense: JsonRecord) => [normalizeTruck(expense.truck), expense]));
    const names = new Set([...Object.keys(jobsByTruck), ...Object.keys(revenueByTruck), ...Object.keys(milesByTruck), ...expenseRows.map((expense: JsonRecord) => expense.truck)].map(normalizeTruck).filter((name) => name !== "Truck 0"));
    for (const truck of names) {
      const originalKey = [...new Set([...Object.keys(jobsByTruck), ...Object.keys(revenueByTruck), ...Object.keys(milesByTruck), ...Object.keys(driveByTruck), ...Object.keys(idleByTruck)])].find((key) => normalizeTruck(key) === truck);
      const expense = expenses.get(truck) || {};
      const wexTruck = wex.truckDaily.get(`${date}|${truck}`);
      truckDaily.set(`${date}|${truck}`, {
        date, truck,
        revenue: finite(originalKey ? revenueByTruck[originalKey] : null),
        jobs: finite(originalKey ? jobsByTruck[originalKey] : null),
        miles: finite(originalKey ? milesByTruck[originalKey] : null),
        driveMinutes: durationMinutes(originalKey ? driveByTruck[originalKey] : null),
        idleMinutes: durationMinutes(originalKey ? idleByTruck[originalKey] : null),
        recordedFuelCost: finite(expense.fuel_expense),
        recordedDumpCost: finite(expense.dump_expense),
        wexFuelCost: wexTruck ? wexTruck.netCost : null,
        wexGallons: wexTruck ? wexTruck.gallons : null,
      });
    }
  }

  for (const [date, fuel] of wex.daily) {
    if (dailyByDate.has(date)) continue;
    dailyByDate.set(date, {
      date, calendar: calendar(date),
      junkware: { revenue: null, completedJobs: null, estimates: null, appointments: null, payroll: null, recordedFuelCost: null, recordedDumpCost: null, otherExpense: null, netProfit: null },
      fleet: { miles: null, driveMinutes: null, idleMinutes: null },
      searchKings: searchKings.daily.get(date) || { adCost: null, conversions: null, impressions: null, clicks: null, calls: null, qualifiedCalls: null, answeredCalls: null, callMinutes: null },
      podium: podium.daily.get(date) || { newReviews: null, ratingSum: null, reviewsNeedingResponse: null },
      qbo: qbo.daily.get(date) || { postedPayments: null, postedPaymentTotal: null, matchedTotal: null },
      wex: fuel,
      actuals: { fuelCost: fuel.netCost, fuelCostSource: "wex", dumpCost: null, dumpCostSource: "unavailable" },
      availability: { junkware: false, fleet: false, searchKings: searchKings.daily.has(date), podium: podium.daily.has(date), qbo: qbo.daily.has(date), wex: true },
    });
  }

  const daily = [...dailyByDate.values()].sort((left, right) => left.date.localeCompare(right.date));
  const dataThrough = daily.filter((row) => row.junkware.revenue !== null).at(-1)?.date || null;
  const forecastStart = chicagoDate(now) || addDays(dataThrough || "1970-01-01", 1);
  const metricDates = daily.filter((row) => row.availability.junkware).map((row) => row.date);
  const wexSnapshot = wex.snapshot;
  const sourceCoverage: Record<string, PredictionSourceCoverage> = {
    junkware: { status: validMetrics ? (validMetrics === metricsFiles.length ? "available" : "partial") : "missing", records: validMetrics, coverageFrom: metricDates[0] || null, coverageThrough: metricDates.at(-1) || null, updatedAt: metricsUpdatedAt, note: `${metricsFiles.length - validMetrics} unreadable daily metric files.` },
    linxup: { status: daily.some((row) => row.availability.fleet) ? "available" : "missing", records: daily.filter((row) => row.availability.fleet).length, coverageFrom: daily.find((row) => row.availability.fleet)?.date || null, coverageThrough: daily.filter((row) => row.availability.fleet).at(-1)?.date || null, updatedAt: metricsUpdatedAt, note: "Fleet distance and time are derived from daily LinxUp-backed metrics." },
    searchKings: { status: searchKings.valid ? (searchKings.valid === searchKings.snapshots ? "available" : "partial") : "missing", records: searchKings.calls, coverageFrom: searchKings.coverageFrom, coverageThrough: searchKings.coverageThrough, updatedAt: searchKings.latestUpdated, note: `${searchKings.valid}/${searchKings.snapshots} monthly snapshots readable; calls deduplicated by source ID.` },
    podium: { status: podium.valid ? "partial" : "missing", records: podium.reviews, coverageFrom: podium.coverageFrom, coverageThrough: podium.coverageThrough, updatedAt: podium.latestUpdated, note: "Podium retains the latest 100 reviews per location in each snapshot; older history may be incomplete." },
    qbo: { status: qbo.valid ? "partial" : "missing", records: qbo.valid, coverageFrom: qbo.coverageFrom, coverageThrough: qbo.coverageThrough, updatedAt: qbo.latestUpdated, note: `${qbo.valid}/${qbo.snapshots} reconciliation days contain an available QBO-backed source.` },
    wex: { status: wexSnapshot ? "partial" : "missing", records: Number(wexSnapshot?.transactionCount || 0), coverageFrom: String(wexSnapshot?.coverageFrom || "") || null, coverageThrough: String(wexSnapshot?.coverageThrough || "") || null, updatedAt: String(wexSnapshot?.importedAt || "") || null, note: "Posted purchases only; coverage is limited to imported WEX exports." },
  };

  return {
    schemaVersion: 1,
    generatedAt: now.toISOString(),
    dataThrough,
    sourceCoverage,
    daily,
    truckDaily: [...truckDaily.values()].sort((left, right) => `${left.date}|${left.truck}`.localeCompare(`${right.date}|${right.truck}`)),
    forecasts: (["revenue", "completedJobs", "fuelCost", "fuelGallons", "dumpCost"] as const).map((target) => buildForecast(daily, target, forecastStart)),
    relationships: buildRelationships(daily),
    guardrails: [
      "Forecasts are deterministic same-weekday baselines, not commitments or causal claims.",
      "Only source-observed actual fuel and recorded dump costs train cost forecasts; dump assumptions are excluded.",
      "Rows preserve missing values and source coverage instead of converting unavailable evidence to zero.",
      "The feature dataset excludes direct customer, employee, card, address, recording, and review-text identifiers.",
      "Predictions must remain advisory until backtest error and source coverage are displayed beside them.",
    ],
  };
}

export function writePredictionDataset(dataRoot: string, outputFile = path.join(dataRoot, "prediction", "daily-operating-features.json"), now = new Date()): PredictionDataset {
  const dataset = buildPredictionDataset(dataRoot, now);
  fs.mkdirSync(path.dirname(outputFile), { recursive: true, mode: 0o700 });
  const temporary = `${outputFile}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(dataset, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporary, outputFile);
  fs.chmodSync(outputFile, 0o600);
  return dataset;
}

export function readPredictionDataset(dataRoot = process.env.OPSCENTER_DATA_DIR || process.env.OPSBOT_DATA_DIR || path.join(process.cwd(), "data")): PredictionDataset | null {
  const dataset = readJson(path.join(dataRoot, "prediction", "daily-operating-features.json")) as PredictionDataset | null;
  return dataset?.schemaVersion === 1 && Array.isArray(dataset.daily) && Array.isArray(dataset.forecasts) ? dataset : null;
}
