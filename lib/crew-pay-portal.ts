import fs from "fs";
import path from "path";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { applyManualBonusesToMetrics } from "@/lib/manual-bonuses";
import { calculateLivePay } from "@/lib/live-pay";
import { chicagoDateKey } from "@/lib/report-dates";
import {
  PAY_PERIOD_DAYS,
  payPeriodForDate as sharedPayPeriodForDate,
} from "@/lib/pay-period";
import { crewRows, employeeJobRevenueWorked } from "@/lib/opsData";

const DAY_MS = 24 * 60 * 60 * 1000;
const CREW_PORTAL_DATA_KEY = "crew-portal-data-v1";
const CREW_PORTAL_INDEX_KEY = `${CREW_PORTAL_DATA_KEY}:index`;

type AnyRecord = Record<string, any>;

export type CrewPayDay = {
  date: string;
  clockIn: string;
  clockOut: string;
  shiftStatus: string;
  hours: number;
  regularHours: number;
  overtimeHours: number;
  hourlyRate: number | null;
  regularPay: number;
  overtimePay: number;
  tips: number;
  bonuses: number;
  supplementalPay: number;
  totalPay: number;
  isSalary: boolean;
  isFinal: boolean;
  isLive: boolean;
  needsReview: boolean;
};

export type CrewPayTotals = {
  hours: number;
  regularHours: number;
  overtimeHours: number;
  regularPay: number;
  overtimePay: number;
  tips: number;
  bonuses: number;
  supplementalPay: number;
  totalPay: number;
  final: boolean;
  needsReview: boolean;
};

export type CrewPayPeriod = {
  start: string;
  end: string;
  days: CrewPayDay[];
  weeks: Array<{
    start: string;
    end: string;
    days: CrewPayDay[];
    totals: CrewPayTotals;
  }>;
  totals: CrewPayTotals;
};

export type CrewPayHistoryItem = {
  start: string;
  end: string;
  hours: number;
  totalPay: number;
  final: boolean;
  hasActivity: boolean;
};

export type CrewPerformanceWindow = "day" | "week" | "month";

export type CrewPerformanceStats = {
  name: string;
  creditedRevenue: number;
  jobRevenueWorked: number;
  jobsCompleted: number;
  averageJobSize: number;
  estimateCloseRate: number | null;
  tips: number;
  bonuses: number;
};

export type CrewPerformanceRange = {
  start: string;
  end: string;
  rows: CrewPerformanceStats[];
  totalRevenue: number;
  totalJobs: number;
  totalHours: number;
  totalTips: number;
  estimateCloseRate: number | null;
};

export type CrewPersonalPerformance = {
  window: CrewPerformanceWindow;
  start: string;
  end: string;
  stats: CrewPerformanceStats;
};

export type CrewPayPortalData = {
  employee: string;
  dailyLeaderboardDate: string;
  dailyLeaderboard: CrewPerformanceStats[];
  dailyPerformance: CrewPerformanceRange;
  payPeriodPerformance: CrewPerformanceRange;
  monthlyLeaderboard: CrewPerformanceRange;
  personalPerformance: CrewPersonalPerformance;
  today: CrewPayDay | null;
  currentWeek: CrewPayPeriod["weeks"][number];
  currentPeriod: CrewPayPeriod;
  selectedPeriod: CrewPayPeriod;
  currentPeriodStart: string;
  history: CrewPayHistoryItem[];
  availableFrom: string | null;
  availableThrough: string | null;
  lastUpdated: string | null;
};

function parseDate(dateKey: string): Date {
  return new Date(`${dateKey}T12:00:00Z`);
}

function dateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addDays(value: string, amount: number): string {
  const date = parseDate(value);
  date.setUTCDate(date.getUTCDate() + amount);
  return dateKey(date);
}

function dayDifference(a: string, b: string): number {
  return Math.round((parseDate(a).getTime() - parseDate(b).getTime()) / DAY_MS);
}

function validDateKey(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(parseDate(value).getTime());
}

export function payPeriodForDate(selectedDate: string): { start: string; end: string } {
  return sharedPayPeriodForDate(validDateKey(selectedDate) ? selectedDate : chicagoDateKey());
}

function metricDirectory(): string {
  return path.join(process.cwd(), "data", "history", "daily_metrics");
}

function availableMetricDates(): string[] {
  try {
    return fs.readdirSync(metricDirectory())
      .map((filename) => filename.match(/^daily_metrics_(\d{4}-\d{2}-\d{2})\.json$/)?.[1] || "")
      .filter(Boolean)
      .sort();
  } catch {
    return [];
  }
}

type CrewMetricsDataset = {
  dates?: Record<string, AnyRecord>;
};

type CrewMetricsIndex = {
  keys?: string[];
};

type CrewMetricsNamespace = {
  get<T>(key: string, type: "json"): Promise<T | null>;
};

async function cloudflareMetricsByDate(): Promise<Map<string, AnyRecord>> {
  try {
    const { env } = await getCloudflareContext({ async: true });
    const namespace = (env as unknown as { CREW_METRICS?: CrewMetricsNamespace }).CREW_METRICS;
    if (!namespace) return new Map();

    const index = await namespace.get<CrewMetricsIndex>(CREW_PORTAL_INDEX_KEY, "json");
    const datasets = index?.keys?.length
      ? await Promise.all(index.keys.map((key) => namespace.get<CrewMetricsDataset>(key, "json")))
      : [await namespace.get<CrewMetricsDataset>(CREW_PORTAL_DATA_KEY, "json")];
    const dates: Record<string, AnyRecord> = Object.assign(
      {},
      ...datasets.map((dataset) => dataset?.dates || {}),
    );
    const entries = Object.entries(dates)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, metrics]) => [date, applyManualBonusesToMetrics(metrics, date) || metrics] as const);
    return new Map(entries);
  } catch {
    return new Map();
  }
}

function readMetrics(date: string): AnyRecord | null {
  try {
    const filename = path.join(metricDirectory(), `daily_metrics_${date}.json`);
    if (!fs.existsSync(filename)) return null;
    const metrics = JSON.parse(fs.readFileSync(filename, "utf8")) as AnyRecord;
    return applyManualBonusesToMetrics(metrics, date);
  } catch {
    return null;
  }
}

function numberValue(value: unknown): number {
  if (value === null || value === undefined || value === "") return 0;
  const parsed = Number(String(value).replace(/[$,%\s,]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function firstNumber(row: AnyRecord, keys: string[]): number {
  for (const key of keys) {
    if (row[key] !== null && row[key] !== undefined && row[key] !== "") {
      return numberValue(row[key]);
    }
  }
  return 0;
}

function normalizedName(value: unknown): string {
  return String(value || "")
    .trim()
    .toLocaleLowerCase()
    .replace(/[,]+/g, " ")
    .replace(/\s+/g, " ")
    .split(" ")
    .filter(Boolean)
    .sort()
    .join(" ");
}

function rowName(row: AnyRecord): string {
  return String(row.name || row.employee || row.employee_name || "").trim();
}

function hasClockIn(row: AnyRecord): boolean {
  return Boolean(String(row.clock_in || row.time_in || row.clockIn || row.timeIn || "").trim());
}

function performanceRows(metrics: AnyRecord | null | undefined): AnyRecord[] {
  if (!metrics) return [];
  if (Array.isArray(metrics.employee_leaderboard) && metrics.employee_leaderboard.length) {
    return crewRows(metrics);
  }
  for (const listKey of ["employee_leaderboard", "payroll_records"]) {
    if (Array.isArray(metrics[listKey]) && metrics[listKey].length) return metrics[listKey];
  }
  return [];
}

function performanceValues(row: AnyRecord, metrics?: AnyRecord | null): {
  jobsCompleted: number;
  creditedRevenue: number;
  jobRevenueWorked: number;
  estimatesAttended: number;
  closedEstimates: number;
  tips: number;
  bonuses: number;
} {
  const jobsCompleted = firstNumber(row, ["completed_jobs", "jobs_completed"]);
  let creditedRevenue = firstNumber(row, ["individual_revenue", "revenue_generated", "truck_revenue"]);
  if (!creditedRevenue && jobsCompleted > 0) {
    creditedRevenue = firstNumber(row, ["average_job_size"]) * jobsCompleted;
  }

  return {
    jobsCompleted,
    creditedRevenue,
    jobRevenueWorked: employeeJobRevenueWorked(row, metrics),
    estimatesAttended: firstNumber(row, ["estimates_attended"]),
    closedEstimates: firstNumber(row, ["closed_estimates"]),
    tips: firstNumber(row, ["tip", "tips"]),
    bonuses: firstNumber(row, ["total_bonus", "bonus", "bonuses", "daily_bonus"]),
  };
}

function performanceStats(row: AnyRecord, metrics?: AnyRecord | null): CrewPerformanceStats {
  const values = performanceValues(row, metrics);
  return {
    name: rowName(row),
    creditedRevenue: roundMoney(values.creditedRevenue),
    jobRevenueWorked: roundMoney(values.jobRevenueWorked),
    jobsCompleted: values.jobsCompleted,
    averageJobSize: values.jobsCompleted > 0
      ? roundMoney(values.jobRevenueWorked / values.jobsCompleted)
      : 0,
    estimateCloseRate: values.estimatesAttended > 0
      ? roundHours((values.closedEstimates / values.estimatesAttended) * 100)
      : null,
    tips: roundMoney(values.tips),
    bonuses: roundMoney(values.bonuses),
  };
}

function objectNumberTotal(value: unknown): number {
  if (!value || typeof value !== "object" || Array.isArray(value)) return 0;
  return Object.values(value as AnyRecord).reduce<number>((sum, item) => sum + numberValue(item), 0);
}

function businessJobTotal(metrics: AnyRecord): number {
  const byMarket = objectNumberTotal(metrics.jobs_by_market);
  return byMarket > 0 ? byMarket : objectNumberTotal(metrics.jobs_by_truck);
}

function rphEligibleHours(row: AnyRecord): number {
  if (row.is_rph_eligible === false) return 0;
  return firstNumber(row, ["hours_for_rph", "hours_worked", "hours"]);
}

export function monthlyLeaderboardSummary(range: CrewPerformanceRange): {
  averageJobSize: number | null;
  revenuePerHour: number | null;
} {
  return {
    averageJobSize: range.totalJobs > 0 ? roundMoney(range.totalRevenue / range.totalJobs) : null,
    revenuePerHour: range.totalHours > 0 ? roundMoney(range.totalRevenue / range.totalHours) : null,
  };
}

function crewPerformanceRange(
  start: string,
  end: string,
  metricsByDate: Map<string, AnyRecord>,
  options: { requireClockIn?: boolean } = {},
): CrewPerformanceRange {
  const crew = new Map<string, {
    name: string;
    jobsCompleted: number;
    creditedRevenue: number;
    jobRevenueWorked: number;
    estimatesAttended: number;
    closedEstimates: number;
    tips: number;
    bonuses: number;
  }>();
  let totalRevenue = 0;
  let totalJobs = 0;
  let totalHours = 0;
  let totalTips = 0;
  let estimatesAttended = 0;
  let closedEstimates = 0;

  for (const [date, metrics] of metricsByDate.entries()) {
    if (date < start || date > end) continue;
    totalRevenue += firstNumber(metrics, ["total_revenue", "net_revenue"]);
    totalJobs += businessJobTotal(metrics);
    const rowsForDate = performanceRows(metrics);
    const reportedTips = firstNumber(metrics, ["total_tips", "tips"]);
    const crewTips = rowsForDate.reduce((sum, row) => sum + performanceValues(row, metrics).tips, 0);
    totalTips += reportedTips > 0 ? reportedTips : crewTips;

    for (const row of rowsForDate) {
      if (options.requireClockIn && !hasClockIn(row)) continue;
      totalHours += rphEligibleHours(row);
      const name = rowName(row);
      if (!name) continue;
      const key = normalizedName(name);
      const values = performanceValues(row, metrics);
      const current = crew.get(key) || {
        name,
        jobsCompleted: 0,
        creditedRevenue: 0,
        jobRevenueWorked: 0,
        estimatesAttended: 0,
        closedEstimates: 0,
        tips: 0,
        bonuses: 0,
      };
      current.name = name;
      current.jobsCompleted += values.jobsCompleted;
      current.creditedRevenue += values.creditedRevenue;
      current.jobRevenueWorked += values.jobRevenueWorked;
      current.estimatesAttended += values.estimatesAttended;
      current.closedEstimates += values.closedEstimates;
      current.tips += values.tips;
      current.bonuses += values.bonuses;
      estimatesAttended += values.estimatesAttended;
      closedEstimates += values.closedEstimates;
      crew.set(key, current);
    }
  }

  const rows = [...crew.values()]
    .map((row): CrewPerformanceStats => ({
      name: row.name,
      creditedRevenue: roundMoney(row.creditedRevenue),
      jobRevenueWorked: roundMoney(row.jobRevenueWorked),
      jobsCompleted: row.jobsCompleted,
      averageJobSize: row.jobsCompleted > 0 ? roundMoney(row.jobRevenueWorked / row.jobsCompleted) : 0,
      estimateCloseRate: row.estimatesAttended > 0
        ? roundHours((row.closedEstimates / row.estimatesAttended) * 100)
        : null,
      tips: roundMoney(row.tips),
      bonuses: roundMoney(row.bonuses),
    }))
    .sort((a, b) => (
      b.jobsCompleted - a.jobsCompleted
      || b.creditedRevenue - a.creditedRevenue
      || a.name.localeCompare(b.name)
    ));

  return {
    start,
    end,
    rows,
    totalRevenue: roundMoney(totalRevenue),
    totalJobs,
    totalHours: roundHours(totalHours),
    totalTips: roundMoney(totalTips),
    estimateCloseRate: estimatesAttended > 0
      ? roundHours((closedEstimates / estimatesAttended) * 100)
      : null,
  };
}

function dailyPerformanceLeaderboard(metrics: AnyRecord | null): CrewPerformanceStats[] {
  return performanceRows(metrics)
    .filter((row) => rowName(row))
    .map((row) => performanceStats(row, metrics))
    .sort((a, b) => (
      b.jobsCompleted - a.jobsCompleted
      || b.creditedRevenue - a.creditedRevenue
      || a.name.localeCompare(b.name)
    ));
}

function performanceWindow(value: unknown): CrewPerformanceWindow {
  return value === "week" || value === "month" ? value : "day";
}

function startOfWeek(date: string): string {
  const parsed = parseDate(date);
  const daysSinceMonday = (parsed.getUTCDay() + 6) % 7;
  return addDays(date, -daysSinceMonday);
}

function personalPerformance(
  employee: string,
  windowValue: unknown,
  todayKey: string,
  metricsByDate: Map<string, AnyRecord>,
): CrewPersonalPerformance {
  const window = performanceWindow(windowValue);
  const start = window === "month"
    ? `${todayKey.slice(0, 7)}-01`
    : window === "week"
      ? startOfWeek(todayKey)
      : todayKey;
  const target = normalizedName(employee);
  const totals = {
    jobsCompleted: 0,
    creditedRevenue: 0,
    jobRevenueWorked: 0,
    estimatesAttended: 0,
    closedEstimates: 0,
    tips: 0,
    bonuses: 0,
  };

  for (const [date, metrics] of metricsByDate.entries()) {
    if (date < start || date > todayKey) continue;
    const row = performanceRows(metrics).find((candidate) => normalizedName(rowName(candidate)) === target);
    if (!row) continue;
    const values = performanceValues(row, metrics);
    totals.jobsCompleted += values.jobsCompleted;
    totals.creditedRevenue += values.creditedRevenue;
    totals.jobRevenueWorked += values.jobRevenueWorked;
    totals.estimatesAttended += values.estimatesAttended;
    totals.closedEstimates += values.closedEstimates;
    totals.tips += values.tips;
    totals.bonuses += values.bonuses;
  }

  return {
    window,
    start,
    end: todayKey,
    stats: {
      name: employee,
      creditedRevenue: roundMoney(totals.creditedRevenue),
      jobRevenueWorked: roundMoney(totals.jobRevenueWorked),
      jobsCompleted: totals.jobsCompleted,
      averageJobSize: totals.jobsCompleted > 0
        ? roundMoney(totals.jobRevenueWorked / totals.jobsCompleted)
        : 0,
      estimateCloseRate: totals.estimatesAttended > 0
        ? roundHours((totals.closedEstimates / totals.estimatesAttended) * 100)
        : null,
      tips: roundMoney(totals.tips),
      bonuses: roundMoney(totals.bonuses),
    },
  };
}

function employeeRow(metrics: AnyRecord, employee: string): AnyRecord | null {
  const target = normalizedName(employee);
  for (const listKey of ["payroll_records", "employee_leaderboard"]) {
    const rows = Array.isArray(metrics[listKey]) ? metrics[listKey] : [];
    const row = rows.find((candidate: AnyRecord) => normalizedName(rowName(candidate)) === target);
    if (row) return row;
  }
  return null;
}

function rawDay(date: string, employee: string, metrics: AnyRecord, todayKey: string): CrewPayDay | null {
  const row = employeeRow(metrics, employee);
  if (!row) return null;

  const isSalary = Boolean(row.is_salary);
  const clockIn = String(row.clock_in || row.time_in || "").trim();
  const clockOut = String(row.clock_out || row.time_out || "").trim();
  const hourlyRateValue = firstNumber(row, ["hourly_rate"]);
  const hourlyRate = hourlyRateValue > 0 ? hourlyRateValue : null;
  let hours = firstNumber(row, ["hours_worked", "hours"]);
  let straightPay = firstNumber(row, ["hourly_pay", "base_pay", "regular_pay", "pay"]);
  const tips = firstNumber(row, ["tip", "tips"]);
  const bonuses = firstNumber(row, ["total_bonus", "bonus", "bonuses", "daily_bonus"]);
  const supplementalPay = firstNumber(row, ["supplemental_daily_pay", "supplemental_pay"]);
  const isOpenToday = date === todayKey && Boolean(clockIn) && !clockOut && !isSalary;

  if (isOpenToday) {
    const live = calculateLivePay({ date, clockIn, hourlyRate, totalBonus: bonuses, tips });
    if (live.valid && live.workedHours !== null && live.regularPay !== null) {
      hours = live.workedHours;
      straightPay = live.regularPay;
    }
  }

  const hasActivity = hours > 0 || straightPay > 0 || tips > 0 || bonuses > 0 || supplementalPay > 0 || Boolean(clockIn);
  if (!hasActivity) return null;

  const sourceFinal = row.pay_is_final;
  const isFinal = sourceFinal === true || (sourceFinal !== false && date < todayKey && Boolean(clockOut || !clockIn));
  const needsReview = Boolean(clockIn && !clockOut && date < todayKey) || (!isSalary && hours > 0 && !hourlyRate);

  return {
    date,
    clockIn,
    clockOut,
    shiftStatus: String(row.shift_status || (clockIn && !clockOut ? "On Shift" : clockOut ? "Clocked Out" : "Recorded")),
    hours,
    regularHours: hours,
    overtimeHours: 0,
    hourlyRate,
    regularPay: straightPay,
    overtimePay: 0,
    tips,
    bonuses,
    supplementalPay,
    totalPay: straightPay + tips + bonuses + supplementalPay,
    isSalary,
    isFinal,
    isLive: isOpenToday,
    needsReview,
  };
}

function emptyTotals(): CrewPayTotals {
  return {
    hours: 0,
    regularHours: 0,
    overtimeHours: 0,
    regularPay: 0,
    overtimePay: 0,
    tips: 0,
    bonuses: 0,
    supplementalPay: 0,
    totalPay: 0,
    final: true,
    needsReview: false,
  };
}

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function roundHours(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function totalsForDays(days: CrewPayDay[]): CrewPayTotals {
  const totals = emptyTotals();
  for (const day of days) {
    totals.hours += day.hours;
    totals.regularHours += day.regularHours;
    totals.overtimeHours += day.overtimeHours;
    totals.regularPay += day.regularPay;
    totals.overtimePay += day.overtimePay;
    totals.tips += day.tips;
    totals.bonuses += day.bonuses;
    totals.supplementalPay += day.supplementalPay;
    totals.totalPay += day.totalPay;
    totals.final = totals.final && day.isFinal;
    totals.needsReview = totals.needsReview || day.needsReview;
  }
  if (!days.length) totals.final = false;
  totals.hours = roundHours(totals.hours);
  totals.regularHours = roundHours(totals.regularHours);
  totals.overtimeHours = roundHours(totals.overtimeHours);
  totals.regularPay = roundMoney(totals.regularPay);
  totals.overtimePay = roundMoney(totals.overtimePay);
  totals.tips = roundMoney(totals.tips);
  totals.bonuses = roundMoney(totals.bonuses);
  totals.supplementalPay = roundMoney(totals.supplementalPay);
  totals.totalPay = roundMoney(totals.totalPay);
  return totals;
}

function applyWeeklyOvertime(days: CrewPayDay[]): CrewPayDay[] {
  let remainingRegularHours = 40;
  return days.map((sourceDay) => {
    const day = { ...sourceDay };
    if (day.isSalary || !day.hourlyRate || day.hours <= 0) return day;

    day.regularHours = Math.min(day.hours, remainingRegularHours);
    day.overtimeHours = Math.max(0, day.hours - day.regularHours);
    remainingRegularHours = Math.max(0, remainingRegularHours - day.regularHours);
    day.regularPay = day.regularHours * day.hourlyRate;
    day.overtimePay = day.overtimeHours * day.hourlyRate * 1.5;
    day.totalPay = day.regularPay + day.overtimePay + day.tips + day.bonuses + day.supplementalPay;
    return day;
  });
}

function periodFromMetrics(
  employee: string,
  periodStart: string,
  metricsByDate: Map<string, AnyRecord>,
  todayKey: string,
): CrewPayPeriod {
  const periodEnd = addDays(periodStart, PAY_PERIOD_DAYS - 1);
  const rawDays: CrewPayDay[] = [];
  for (let cursor = periodStart; cursor <= periodEnd; cursor = addDays(cursor, 1)) {
    const metrics = metricsByDate.get(cursor);
    if (!metrics) continue;
    const day = rawDay(cursor, employee, metrics, todayKey);
    if (day) rawDays.push(day);
  }

  const weekStarts = [periodStart, addDays(periodStart, 7)];
  const weeks = weekStarts.map((start) => {
    const end = addDays(start, 6);
    const days = applyWeeklyOvertime(rawDays.filter((day) => day.date >= start && day.date <= end));
    return { start, end, days, totals: totalsForDays(days) };
  });
  const days = weeks.flatMap((week) => week.days).sort((a, b) => a.date.localeCompare(b.date));
  return { start: periodStart, end: periodEnd, days, weeks, totals: totalsForDays(days) };
}

function latestTimestamp(metricsByDate: Map<string, AnyRecord>): string | null {
  let latest: string | null = null;
  for (const metrics of metricsByDate.values()) {
    const candidate = String(metrics.payroll_as_of || metrics.generated_at || "").trim();
    if (candidate && (!latest || candidate > latest)) latest = candidate;
  }
  return latest;
}

export async function getCrewPayPortalData(
  employee: string,
  selectedPeriodValue?: string,
  performanceWindowValue?: string,
): Promise<CrewPayPortalData> {
  const todayKey = chicagoDateKey();
  const dates = availableMetricDates();
  const metricsByDate = new Map<string, AnyRecord>();
  for (const date of dates) {
    const metrics = readMetrics(date);
    if (metrics) metricsByDate.set(date, metrics);
  }
  if (!metricsByDate.size) {
    const cloudflareMetrics = await cloudflareMetricsByDate();
    for (const [date, metrics] of cloudflareMetrics) metricsByDate.set(date, metrics);
  }
  const loadedDates = [...metricsByDate.keys()].sort();

  const currentPeriod = payPeriodForDate(todayKey);
  const selectedPeriod = payPeriodForDate(validDateKey(selectedPeriodValue) ? selectedPeriodValue : todayKey);
  const selected = periodFromMetrics(employee, selectedPeriod.start, metricsByDate, todayKey);
  const current = selectedPeriod.start === currentPeriod.start
    ? selected
    : periodFromMetrics(employee, currentPeriod.start, metricsByDate, todayKey);
  const today = current.days.find((day) => day.date === todayKey) || null;
  const currentWeek = current.weeks.find((week) => todayKey >= week.start && todayKey <= week.end) || current.weeks[0];
  const dailyPerformance = crewPerformanceRange(todayKey, todayKey, metricsByDate, { requireClockIn: true });
  const payPeriodPerformance = crewPerformanceRange(
    selectedPeriod.start,
    selectedPeriod.end < todayKey ? selectedPeriod.end : todayKey,
    metricsByDate,
  );
  const monthlyLeaderboard = crewPerformanceRange(`${todayKey.slice(0, 7)}-01`, todayKey, metricsByDate);

  const history: CrewPayHistoryItem[] = [];
  if (loadedDates.length) {
    let cursor = payPeriodForDate(loadedDates[0]).start;
    while (cursor < currentPeriod.start) {
      const period = periodFromMetrics(employee, cursor, metricsByDate, todayKey);
      history.push({
        start: period.start,
        end: period.end,
        hours: period.totals.hours,
        totalPay: period.totals.totalPay,
        final: period.totals.final,
        hasActivity: period.days.length > 0,
      });
      cursor = addDays(cursor, PAY_PERIOD_DAYS);
    }
  }

  return {
    employee,
    dailyLeaderboardDate: todayKey,
    dailyLeaderboard: dailyPerformance.rows,
    dailyPerformance,
    payPeriodPerformance,
    monthlyLeaderboard,
    personalPerformance: personalPerformance(employee, performanceWindowValue, todayKey, metricsByDate),
    today,
    currentWeek,
    currentPeriod: current,
    selectedPeriod: selected,
    currentPeriodStart: currentPeriod.start,
    history: history.filter((period) => period.hasActivity).reverse(),
    availableFrom: loadedDates[0] || null,
    availableThrough: loadedDates[loadedDates.length - 1] || null,
    lastUpdated: latestTimestamp(metricsByDate),
  };
}
