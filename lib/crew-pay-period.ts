import fs from "fs";
import path from "path";
import { applyManualBonusesToMetrics } from "@/lib/manual-bonuses";
import { calculateWeeklyOvertime } from "@/lib/overtime";
import { payPeriodDates } from "@/lib/pay-period";
import { employeeJobRevenueWorked } from "@/lib/opsData";
import { payrollCorrectionForEmployee, type PayrollCorrection } from "@/lib/payroll-corrections";

export type CrewDayMetric = {
  date: string;
  revenue: number;
  jobRevenueWorked: number;
  jobsCompleted: number;
  estimatesClosed: number;
  estimatesGiven: number;
  firstVisitClosed: number;
  firstVisitOpportunities: number;
  hours: number;
  rph: number;
  averageJobSize: number;
  basePay: number;
  tips: number;
  bonuses: number;
  totalPay: number;
  clockIn: string;
  clockOut: string;
  hourlyRate: number | null;
  sourceClockIn: string;
  sourceClockOut: string;
  sourceHourlyRate: number | null;
  correction: PayrollCorrection | null;
};

export type CrewPayPeriodMetrics = {
  employee: string;
  selectedDate: string;
  periodStart: string;
  periodEnd: string;
  days: CrewDayMetric[];
  totals: CrewDayMetric & {
    firstVisitCloseRate: number | null;
    estimateCloseRate: number | null;
  };
};

export type CrewPayPeriodWeekDay = CrewDayMetric & {
  hoursWorked: number;
  regularHours: number;
  overtimeHours: number;
  basePay: number;
  straightTimePay: number;
  regularPayDisplay: number;
  overtimePremiumDisplay: number;
  overtimePayDisplay: number;
  hourlyLaborCostDisplay: number;
  totalPayDisplay: number;
  salary?: boolean;
};

export type CrewPayPeriodWorkWeek = {
  start: string;
  end: string;
  label: string;
  days: CrewPayPeriodWeekDay[];
  totals: {
    regularHours: number;
    overtimeHours: number;
    totalHours: number;
    jobs: number;
    estimatesClosedAsJobs: number;
    revenue: number;
    straightTimePay: number;
    regularPay: number;
    overtimePay: number;
    overtimePremium: number;
    hourlyLaborCost: number;
    tips: number;
    revenueBonus: number;
    manualBonus: number;
    otherBonus: number;
    bonuses: number;
    supplementalPay: number;
    totalPay: number;
  };
};

function metricsDir(): string {
  return path.join(process.cwd(), "data", "history", "daily_metrics");
}

function toDateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function parseDateKey(dateKey: string): Date {
  const [y, m, d] = dateKey.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function getPayPeriodForDate(dateKey: string): { start: string; end: string; dates: string[] } {
  return payPeriodDates(dateKey);
}

function normName(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[,]+/g, " ")
    .replace(/\s+/g, " ");
}

function nameSignature(value: unknown): string {
  return normName(value)
    .split(" ")
    .filter(Boolean)
    .sort()
    .join(" ");
}

function nameMatches(a: unknown, b: unknown): boolean {
  return nameSignature(a) === nameSignature(b);
}

function num(value: unknown): number {
  if (value === null || value === undefined) return 0;
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;

  const cleaned = String(value).replace(/[$,%\s,]/g, "");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : 0;
}

function clockHours(date: string, clockIn: string, clockOut: string): number | null {
  const parse = (value: string): Date | null => {
    const match = String(value || "").trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
    if (!match) return null;
    let hour = Number(match[1]);
    const minute = Number(match[2]);
    if (hour < 1 || hour > 12 || minute > 59) return null;
    if (match[3].toUpperCase() === "PM" && hour !== 12) hour += 12;
    if (match[3].toUpperCase() === "AM" && hour === 12) hour = 0;
    const parsed = new Date(`${date}T00:00:00`);
    parsed.setHours(hour, minute, 0, 0);
    return parsed;
  };

  const start = parse(clockIn);
  const end = clockOut ? parse(clockOut) : null;
  if (!start || !end) return null;
  const duration = (end.getTime() - start.getTime()) / 3_600_000;
  return duration >= 0 ? duration : null;
}

function readMetrics(date: string): Record<string, any> | null {
  const file = path.join(metricsDir(), `daily_metrics_${date}.json`);

  try {
    if (!fs.existsSync(file)) return null;
    return applyManualBonusesToMetrics(JSON.parse(fs.readFileSync(file, "utf8")), date);
  } catch {
    return null;
  }
}

function getEmployeeRows(metrics: Record<string, any>, employee: string): Record<string, any>[] {
  const rows: Record<string, any>[] = [];

  for (const listKey of ["employee_leaderboard", "payroll_records"]) {
    const list = metrics[listKey];

    if (!Array.isArray(list)) continue;

    for (const row of list) {
      if (!row || typeof row !== "object") continue;

      if (nameMatches(row.name, employee)) {
        rows.push(row);
      }
    }
  }

  return rows;
}

function bestEmployeeRow(metrics: Record<string, any>, employee: string): Record<string, any> | null {
  const rows = getEmployeeRows(metrics, employee);

  if (!rows.length) return null;

  return rows
    .slice()
    .sort((a, b) => {
      const score = (row: Record<string, any>) => {
        let s = 0;
        if ("revenue_generated" in row) s += 20;
        if ("hours_worked" in row) s += 10;
        if ("total_daily_pay" in row) s += 8;
        if ("bonus" in row) s += 6;
        if ("tip" in row) s += 6;
        if ("rph" in row || "revenue_per_hour" in row) s += 5;
        return s;
      };

      return score(b) - score(a);
    })[0];
}

function countCreditedCompletedJobs(
  metrics: Record<string, any>,
  employee: string,
  row?: Record<string, any> | null,
): number {
  const audit = metrics.crew_credit_audit;

  if (!Array.isArray(audit)) {
    return num(row?.jobs_completed) || num(row?.completed_jobs);
  }

  const seenJobs = new Set<string>();

  for (const item of audit) {
    if (!item || typeof item !== "object") continue;

    const creditedPeople = Array.isArray(item.credited_people)
      ? item.credited_people
      : Array.isArray(item.creditedPeople)
        ? item.creditedPeople
        : [];

    const isCredited = creditedPeople.some((person: any) => {
      if (!person || typeof person !== "object") return false;
      return nameMatches(person.name, employee);
    });

    if (isCredited) {
      const key = String(item.job_id || item.appt_id || `${item.truck || ""}|${item.revenue || ""}`);
      seenJobs.add(key);
    }
  }

  return seenJobs.size || num(row?.jobs_completed) || num(row?.completed_jobs);
}

function mapCreditedRevenue(metrics: Record<string, any>, employee: string): number {
  const map = metrics.credited_revenue_by_employee;

  if (!map || typeof map !== "object") return 0;

  for (const [name, value] of Object.entries(map)) {
    if (nameMatches(name, employee)) return num(value);
  }

  return 0;
}


function addDays(dateKey: string, days: number): string {
  const [year, month, day] = dateKey.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  date.setDate(date.getDate() + days);
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function hoursWorked(day: Record<string, any>): number {
  if (typeof (day as any).hoursWorked === "number" && Number.isFinite((day as any).hoursWorked)) {
    return (day as any).hoursWorked;
  }
  const value = String((day as any).hoursDisplay || "");
  const match = value.match(/(-?\d+(?:\.\d+)?)/);
  if (!match) return 0;
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) ? parsed : 0;
}

function basePayFromDay(day: Record<string, any>): number {
  const tips = (day as any).tips ?? 0;
  const bonuses = (day as any).bonus ?? 0;
  const supplementalPay = (day as any).supplementalPay ?? 0;

  if (typeof (day as any).regularPay === "number" && Number.isFinite((day as any).regularPay)) {
    const regularPay = Math.max(0, (day as any).regularPay);
    if (regularPay > 0 || (day as any).totalPay == null) return regularPay;
  }

  if (typeof (day as any).totalPay === "number" && Number.isFinite((day as any).totalPay)) {
    return Math.max(0, (day as any).totalPay - tips - bonuses - supplementalPay);
  }

  return 0;
}

export function summarizeWorkWeeks(
  days: Array<Record<string, any>>,
  periodStart: string,
  periodEnd: string,
): CrewPayPeriodWorkWeek[] {
  const starts: string[] = [];
  for (let cursor = periodStart; cursor <= periodEnd; cursor = addDays(cursor, 7)) {
    starts.push(cursor);
  }

  const weeks: CrewPayPeriodWorkWeek[] = [];

  for (let index = 0; index < starts.length; index += 1) {
    const start = starts[index];
    const end = index + 1 < starts.length ? addDays(starts[index + 1], -1) : periodEnd;
    const weekDays = days
      .filter((day) => day.date >= start && day.date <= end)
      .sort((a, b) => a.date.localeCompare(b.date));

    const derivedDays: CrewPayPeriodWeekDay[] = [];
    let regularHoursTotal = 0;
    let overtimeHoursTotal = 0;
    let totalHours = 0;
    let jobsTotal = 0;
    let estimatesClosedTotal = 0;
    let revenueTotal = 0;
    let straightTimePayTotal = 0;
    let regularPayTotal = 0;
    let overtimePayTotal = 0;
    let overtimePremiumTotal = 0;
    let hourlyLaborCostTotal = 0;
    let tipsTotal = 0;
    let revenueBonusTotal = 0;
    let manualBonusTotal = 0;
    let otherBonusTotal = 0;
    let bonusesTotal = 0;
    let supplementalPayTotal = 0;
    let totalPayTotal = 0;

    const overtimeAllocations = calculateWeeklyOvertime(
      weekDays.map((day) => ({
        hours: hoursWorked(day),
        hourlyRate: (day as any).hourlyRate ?? 0,
        straightTimePay: basePayFromDay(day),
        isSalary: Boolean((day as any).salary),
      })),
    );

    for (const [dayIndex, day] of weekDays.entries()) {
      const workedHours = hoursWorked(day);
      const tips = (day as any).tips ?? 0;
      const revenueBonus = (day as any).revenueBonus ?? 0;
      const manualBonus = (day as any).manualBonus ?? 0;
      const otherBonus = (day as any).otherBonus ?? 0;
      const bonuses = (day as any).totalBonuses ?? (day as any).bonus ?? revenueBonus + manualBonus + otherBonus;
      const supplementalPay = (day as any).supplementalPay ?? 0;
      const basePay = basePayFromDay(day);
      const overtime = overtimeAllocations[dayIndex];
      const regularHours = overtime.regularHours;
      const overtimeHours = overtime.overtimeHours;
      const regularPay = overtime.regularPay;
      const overtimePay = overtime.overtimePay;
      const overtimePremium = overtime.overtimePremium;
      const hourlyLaborCost = overtime.hourlyLaborCost;
      const totalPayDisplay = hourlyLaborCost + tips + bonuses + supplementalPay;

      regularHoursTotal += regularHours;
      overtimeHoursTotal += overtimeHours;
      totalHours += workedHours;
      jobsTotal += (day as any).jobs ?? 0;
      estimatesClosedTotal += (day as any).estimatesClosedAsJobs ?? 0;
      revenueTotal += (day as any).revenue ?? 0;
      straightTimePayTotal += overtime.straightTimePay;
      regularPayTotal += regularPay;
      overtimePayTotal += overtimePay;
      overtimePremiumTotal += overtimePremium;
      hourlyLaborCostTotal += hourlyLaborCost;
      tipsTotal += tips;
      revenueBonusTotal += revenueBonus;
      manualBonusTotal += manualBonus;
      otherBonusTotal += otherBonus;
      bonusesTotal += bonuses;
      supplementalPayTotal += supplementalPay;
      totalPayTotal += totalPayDisplay;

      derivedDays.push({
        ...(day as any),
        hoursWorked: workedHours,
        regularHours,
        overtimeHours,
        basePay,
        straightTimePay: overtime.straightTimePay,
        regularPayDisplay: regularPay,
        overtimePremiumDisplay: overtimePremium,
        overtimePayDisplay: overtimePay,
        hourlyLaborCostDisplay: hourlyLaborCost,
        totalPayDisplay,
      });
    }

    weeks.push({
      start,
      end,
      label: `Week ${index + 1}: ${start}–${end}`,
      days: derivedDays,
      totals: {
        regularHours: Number(regularHoursTotal.toFixed(2)),
        overtimeHours: Number(overtimeHoursTotal.toFixed(2)),
        totalHours: Number(totalHours.toFixed(2)),
        jobs: jobsTotal,
        estimatesClosedAsJobs: estimatesClosedTotal,
        revenue: Number(revenueTotal.toFixed(2)),
        straightTimePay: Number(straightTimePayTotal.toFixed(2)),
        regularPay: Number(regularPayTotal.toFixed(2)),
        overtimePay: Number(overtimePayTotal.toFixed(2)),
        overtimePremium: Number(overtimePremiumTotal.toFixed(2)),
        hourlyLaborCost: Number(hourlyLaborCostTotal.toFixed(2)),
        tips: Number(tipsTotal.toFixed(2)),
        revenueBonus: Number(revenueBonusTotal.toFixed(2)),
        manualBonus: Number(manualBonusTotal.toFixed(2)),
        otherBonus: Number(otherBonusTotal.toFixed(2)),
        bonuses: Number(bonusesTotal.toFixed(2)),
        supplementalPay: Number(supplementalPayTotal.toFixed(2)),
        totalPay: Number(totalPayTotal.toFixed(2)),
      },
    });
  }

  return weeks;
}

function dailyCrewMetric(date: string, employee: string, metrics: Record<string, any>): CrewDayMetric | null {
  const row = bestEmployeeRow(metrics, employee);

  if (!row) return null;

  const revenue =
    num(row.revenue_generated) ||
    num(row.credited_revenue) ||
    mapCreditedRevenue(metrics, employee);
  const jobRevenueWorked = employeeJobRevenueWorked(row, metrics);

  const jobsCompleted = countCreditedCompletedJobs(metrics, employee, row);

  const sourceClockIn = String(row.clock_in || row.time_in || row.clockIn || row.timeIn || "").trim();
  const sourceClockOut = String(row.clock_out || row.time_out || row.clockOut || row.timeOut || "").trim();
  const sourceHourlyRate = num(row.hourly_rate) || null;
  const correction = payrollCorrectionForEmployee(date, employee);
  const clockIn = correction?.clockIn || sourceClockIn;
  const clockOut = correction?.clockOut || sourceClockOut;
  const hourlyRate = correction?.hourlyRate || sourceHourlyRate;
  const correctedHours = correction ? clockHours(date, clockIn, clockOut) : null;
  const hours = correctedHours ?? (num(row.hours_worked) || num(row.hours));
  const basePay = num(row.hourly_pay) || num(row.pay) || num(row.base_pay);
  const tips = num(row.tip) || num(row.tips);
  const bonuses = num(row.bonus) || num(row.bonuses);

  // Total Pay = base pay + tips + bonuses.
  const totalPay = basePay + tips + bonuses;

  const rph =
    num(row.rph) ||
    num(row.revenue_per_hour) ||
    (hours > 0 ? revenue / hours : 0);

  // Average Job Size = employee revenue generated / employee completed jobs.
  const averageJobSize = jobsCompleted > 0 ? jobRevenueWorked / jobsCompleted : 0;

  return {
    date,
    revenue,
    jobRevenueWorked,
    jobsCompleted,
    estimatesClosed: num(row.estimates_closed) || num(row.closed_estimates),
    estimatesGiven: num(row.estimates_given) || num(row.estimates),
    firstVisitClosed: num(row.first_visit_closed) || num(row.first_visit_closes),
    firstVisitOpportunities: num(row.first_visit_opportunities) || num(row.first_visit_estimates),
    hours,
    rph,
    averageJobSize,
    basePay,
    tips,
    bonuses,
    totalPay,
    clockIn,
    clockOut,
    hourlyRate,
    sourceClockIn,
    sourceClockOut,
    sourceHourlyRate,
    correction,
  };
}

export function getCrewPayPeriodMetrics(employee: string, selectedDate: string): CrewPayPeriodMetrics {
  const period = getPayPeriodForDate(selectedDate);
  const days: CrewDayMetric[] = [];

  for (const date of period.dates) {
    const metrics = readMetrics(date);
    if (!metrics) continue;

    const day = dailyCrewMetric(date, employee, metrics);
    if (!day) continue;

    const hasActivity = [
      day.revenue,
      day.jobRevenueWorked,
      day.jobsCompleted,
      day.estimatesClosed,
      day.estimatesGiven,
      day.firstVisitClosed,
      day.firstVisitOpportunities,
      day.hours,
      day.rph,
      day.basePay,
      day.tips,
      day.bonuses,
      day.totalPay,
    ].some((value) => Number(value) !== 0);

    if (hasActivity) days.push(day);
  }

  const sum = (key: keyof CrewDayMetric) =>
    days.reduce((total, day) => total + Number(day[key] ?? 0), 0);

  const revenue = sum("revenue");
  const jobRevenueWorked = sum("jobRevenueWorked");
  const jobsCompleted = sum("jobsCompleted");
  const estimatesClosed = sum("estimatesClosed");
  const estimatesGiven = sum("estimatesGiven");
  const firstVisitClosed = sum("firstVisitClosed");
  const firstVisitOpportunities = sum("firstVisitOpportunities");
  const hours = sum("hours");
  const basePay = sum("basePay");
  const tips = sum("tips");
  const bonuses = sum("bonuses");
  const totalPay = sum("totalPay");

  return {
    employee,
    selectedDate,
    periodStart: period.start,
    periodEnd: period.end,
    days,
    totals: {
      date: "total",
      revenue,
      jobRevenueWorked,
      jobsCompleted,
      estimatesClosed,
      estimatesGiven,
      firstVisitClosed,
      firstVisitOpportunities,
      hours,
      rph: hours > 0 ? revenue / hours : 0,
      averageJobSize: jobsCompleted > 0 ? jobRevenueWorked / jobsCompleted : 0,
      basePay,
      tips,
      bonuses,
      totalPay,
      clockIn: "",
      clockOut: "",
      hourlyRate: null,
      sourceClockIn: "",
      sourceClockOut: "",
      sourceHourlyRate: null,
      correction: null,
      firstVisitCloseRate:
        firstVisitOpportunities > 0 ? firstVisitClosed / firstVisitOpportunities : null,
      estimateCloseRate:
        estimatesGiven > 0 ? estimatesClosed / estimatesGiven : null,
    },
  };
}

export function employeeSlug(employee: string): string {
  return encodeURIComponent(employee);
}
