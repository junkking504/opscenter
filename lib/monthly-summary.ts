import fs from "fs";
import path from "path";
import { availableDates, readMetrics, type AnyRecord } from "@/lib/opsData";
import { chicagoDateKey, addDays } from "@/lib/report-dates";

export type MonthlyDateOption = {
  key: string;
  label: string;
  date: string;
};

export type MonthlyRange = {
  monthKey: string;
  monthDisplay: string;
  monthStart: string;
  monthEnd: string;
  dates: string[];
  missingDates: string[];
  dataThroughDate: string;
  dataThroughLabel: string;
  isCurrentMonth: boolean;
  complete: boolean;
  warningLabel: string;
};

export type MonthlyMetricsEntry = {
  date: string;
  metrics: AnyRecord;
};

export type MonthlyAuthority = {
  month: string;
  completedJobs: number;
  grossRevenue: number;
  averageRevenuePerJob: number;
  verifiedAt: string | null;
  source: string;
  itemizedJobs: number;
  itemizedRevenue: number;
  jobDelta: number;
  revenueDelta: number;
};

export type MonthlySummary = {
  range: MonthlyRange;
  entries: MonthlyMetricsEntry[];
  authority: MonthlyAuthority | null;
  grossRevenue: number;
  completedJobs: number;
  itemizedGrossRevenue: number;
  itemizedCompletedJobs: number;
  revenueSource: "junkware-monthly-dashboard" | "published-daily-metrics";
};

export type FinanceMonthTrend = {
  monthKey: string;
  monthDisplay: string;
  dataThroughDate: string;
  complete: boolean;
  grossRevenue: number;
  totalOperatingExpenses: number;
  estimatedOperatingProfit: number;
  completedJobs: number;
  revenueSource: MonthlySummary["revenueSource"];
};

export type FinanceTrendSummary = {
  selectedMonth: FinanceMonthTrend;
  previousMonth: FinanceMonthTrend | null;
  months: FinanceMonthTrend[];
  yearToDate: {
    year: string;
    throughMonth: string;
    grossRevenue: number;
    totalOperatingExpenses: number;
    estimatedOperatingProfit: number;
    completedJobs: number;
  };
};

function monthKey(date: string): string {
  return String(date || "").slice(0, 7);
}

function previousMonthKey(value: string): string {
  const date = new Date(`${value}-01T12:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() - 1);
  return date.toISOString().slice(0, 7);
}

function monthDisplayLabel(monthKeyValue: string): string {
  // Format at UTC noon so converting to the Chicago timezone remains on the
  // intended calendar day in both CST and CDT. A fixed midnight offset shifts
  // winter months into the previous month.
  const date = new Date(`${monthKeyValue}-01T12:00:00Z`);
  return date.toLocaleDateString("en-US", {
    timeZone: "America/Chicago",
    month: "long",
    year: "numeric",
  });
}

function endOfMonth(monthKeyValue: string): string {
  const date = new Date(`${monthKeyValue}-01T12:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() + 1, 0);
  return date.toISOString().slice(0, 10);
}

function formatThroughLabel(date: string): string {
  const metrics = readMetrics(date);
  const candidate = metrics?.generated_at || metrics?.updated_at || metrics?.payroll_as_of || null;
  if (candidate) {
    const parsed = new Date(String(candidate));
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toLocaleString("en-US", {
        timeZone: "America/Chicago",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
      });
    }
  }

  return date;
}

export function monthKeyForDate(date: string): string {
  return monthKey(date);
}

export function monthDisplayForDate(date: string): string {
  return monthDisplayLabel(monthKey(date));
}

export function monthOptions(): MonthlyDateOption[] {
  const byMonth = new Map<string, string>();
  for (const date of availableDates()) {
    const key = monthKey(date);
    if (!byMonth.has(key) || date < byMonth.get(key)!) {
      byMonth.set(key, date);
    }
  }

  return Array.from(byMonth.entries())
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([key, date]) => ({
      key,
      label: monthDisplayLabel(key),
      date: `${key}-01`,
    }));
}

export function buildMonthlyRange(selectedDate: string): MonthlyRange {
  const currentChicagoDate = chicagoDateKey();
  const key = monthKey(selectedDate);
  const selectedMonthLabel = monthDisplayLabel(key);
  const availableInMonth = availableDates()
    .filter((date) => date.startsWith(`${key}-`))
    .sort();
  const currentMonth = currentChicagoDate.startsWith(key);
  const monthStart = `${key}-01`;
  const monthEnd = currentMonth
    ? (availableInMonth[availableInMonth.length - 1] || currentChicagoDate)
    : endOfMonth(key);

  const expectedDates: string[] = [];
  for (let cursor = monthStart; cursor <= monthEnd; cursor = addDays(cursor, 1)) {
    expectedDates.push(cursor);
  }

  const published = availableInMonth.filter((date) => date >= monthStart && date <= monthEnd);
  const missingDates = expectedDates.filter((date) => !published.includes(date));
  const lastPublished = published[published.length - 1] || monthEnd;

  return {
    monthKey: key,
    monthDisplay: selectedMonthLabel,
    monthStart,
    monthEnd,
    dates: published,
    missingDates,
    dataThroughDate: lastPublished,
    dataThroughLabel: formatThroughLabel(lastPublished),
    isCurrentMonth: currentMonth,
    complete: !currentMonth && missingDates.length === 0,
    warningLabel: missingDates.length
      ? `Missing ${missingDates.length} published day${missingDates.length === 1 ? "" : "s"} in the selected month.`
      : currentMonth
        ? "Month-to-date through the latest successfully published date."
        : "Monthly data is complete.",
  };
}

function finiteNumber(value: unknown): number {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function dailyGrossRevenue(metrics: AnyRecord): number {
  // Keep this order aligned with the monthly reconciliation job. total_revenue
  // is the canonical published daily figure; sales is the Truck Records subtotal.
  return finiteNumber(metrics.total_revenue ?? metrics.gross_revenue ?? metrics.sales);
}

function dailyCompletedJobs(metrics: AnyRecord): number {
  const jobsByMarket = metrics.jobs_by_market;
  if (jobsByMarket && typeof jobsByMarket === "object" && !Array.isArray(jobsByMarket)) {
    return Object.values(jobsByMarket).reduce<number>(
      (sum, value) => sum + finiteNumber(value),
      0,
    );
  }

  return finiteNumber(metrics.completed_jobs ?? metrics.total_jobs ?? metrics.jobs_completed);
}

export function readMonthlyAuthority(selectedDate: string): MonthlyAuthority | null {
  const key = monthKey(selectedDate);
  const file = path.join(
    process.cwd(),
    "data",
    "history",
    "monthly_metrics",
    `monthly_metrics_${key}.json`,
  );

  if (!fs.existsSync(file)) return null;

  try {
    const payload = JSON.parse(fs.readFileSync(file, "utf8"));
    if (String(payload?.month || "") !== key) return null;
    if (String(payload?.source_status || "").toLowerCase() !== "authoritative") return null;

    const completedJobs = Number(payload?.completed_jobs);
    const grossRevenue = Number(payload?.gross_revenue);
    if (!Number.isFinite(completedJobs) || !Number.isFinite(grossRevenue)) return null;

    const itemizedJobs = Number(payload?.stored_daily_metrics_jobs || 0);
    const itemizedRevenue = Number(payload?.stored_daily_metrics_revenue || 0);

    return {
      month: key,
      completedJobs,
      grossRevenue,
      averageRevenuePerJob: Number(payload?.average_revenue_per_job || 0),
      verifiedAt: payload?.verified_at ? String(payload.verified_at) : null,
      source: String(payload?.source || "JunkWare Dashboard"),
      itemizedJobs,
      itemizedRevenue,
      jobDelta: completedJobs - itemizedJobs,
      revenueDelta: grossRevenue - itemizedRevenue,
    };
  } catch {
    return null;
  }
}

/**
 * The single source of truth for headline monthly revenue and completed jobs.
 * Every page that reports a monthly total must consume this summary instead of
 * independently choosing between the reconciled dashboard and daily records.
 */
export function buildMonthlySummary(selectedDate: string): MonthlySummary {
  const range = buildMonthlyRange(selectedDate);
  const entries = range.dates
    .map((date) => {
      const metrics = readMetrics(date);
      return metrics ? { date, metrics } : null;
    })
    .filter((entry): entry is MonthlyMetricsEntry => Boolean(entry));
  const authority = readMonthlyAuthority(selectedDate);
  const itemizedGrossRevenue = entries.reduce(
    (sum, entry) => sum + dailyGrossRevenue(entry.metrics),
    0,
  );
  const itemizedCompletedJobs = entries.reduce(
    (sum, entry) => sum + dailyCompletedJobs(entry.metrics),
    0,
  );

  return {
    range,
    entries,
    authority,
    grossRevenue: authority?.grossRevenue ?? itemizedGrossRevenue,
    completedJobs: authority?.completedJobs ?? itemizedCompletedJobs,
    itemizedGrossRevenue,
    itemizedCompletedJobs,
    revenueSource: authority ? "junkware-monthly-dashboard" : "published-daily-metrics",
  };
}

function dailyOperatingExpenses(metrics: AnyRecord): number {
  return finiteNumber(metrics.total_expenses);
}

function dailyEstimatedOperatingProfit(metrics: AnyRecord): number {
  return finiteNumber(metrics.net_profit);
}

/**
 * Finance's cross-month reporting contract. Revenue keeps the reconciled
 * JunkWare monthly authority where it exists; expense and profit remain the
 * aggregate of the published daily finance records that produced them.
 */
export function buildFinanceTrendSummary(selectedDate: string): FinanceTrendSummary {
  const selectedMonthKey = monthKey(selectedDate);
  const keys = Array.from(new Set(availableDates().map(monthKey)))
    .filter((key) => key <= selectedMonthKey)
    .sort();

  const months = keys.map((key) => {
    const summary = buildMonthlySummary(`${key}-01`);
    return {
      monthKey: key,
      monthDisplay: summary.range.monthDisplay,
      dataThroughDate: summary.range.dataThroughDate,
      complete: summary.range.complete,
      grossRevenue: summary.grossRevenue,
      totalOperatingExpenses: summary.entries.reduce(
        (sum, entry) => sum + dailyOperatingExpenses(entry.metrics),
        0,
      ),
      estimatedOperatingProfit: summary.entries.reduce(
        (sum, entry) => sum + dailyEstimatedOperatingProfit(entry.metrics),
        0,
      ),
      completedJobs: summary.completedJobs,
      revenueSource: summary.revenueSource,
    } satisfies FinanceMonthTrend;
  });

  const selectedMonth = months.find((month) => month.monthKey === selectedMonthKey)
    ?? (() => {
      const summary = buildMonthlySummary(selectedDate);
      return {
        monthKey: summary.range.monthKey,
        monthDisplay: summary.range.monthDisplay,
        dataThroughDate: summary.range.dataThroughDate,
        complete: summary.range.complete,
        grossRevenue: summary.grossRevenue,
        totalOperatingExpenses: summary.entries.reduce(
          (sum, entry) => sum + dailyOperatingExpenses(entry.metrics),
          0,
        ),
        estimatedOperatingProfit: summary.entries.reduce(
          (sum, entry) => sum + dailyEstimatedOperatingProfit(entry.metrics),
          0,
        ),
        completedJobs: summary.completedJobs,
        revenueSource: summary.revenueSource,
      } satisfies FinanceMonthTrend;
    })();
  const previousMonth = months.find((month) => month.monthKey === previousMonthKey(selectedMonth.monthKey)) ?? null;
  const year = selectedMonth.monthKey.slice(0, 4);
  const yearMonths = months.filter((month) => month.monthKey.startsWith(`${year}-`));

  return {
    selectedMonth,
    previousMonth,
    months,
    yearToDate: {
      year,
      throughMonth: selectedMonth.monthDisplay,
      grossRevenue: yearMonths.reduce((sum, month) => sum + month.grossRevenue, 0),
      totalOperatingExpenses: yearMonths.reduce((sum, month) => sum + month.totalOperatingExpenses, 0),
      estimatedOperatingProfit: yearMonths.reduce((sum, month) => sum + month.estimatedOperatingProfit, 0),
      completedJobs: yearMonths.reduce((sum, month) => sum + month.completedJobs, 0),
    },
  };
}
