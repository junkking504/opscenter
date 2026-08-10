import fs from "fs";
import path from "path";
import type { ReactNode } from "react";
import PageHeader from "@/components/PageHeader";
import CrewPayPeriodCards, {
  type CrewPayPeriodDayRow,
  type CrewPayPeriodEmployeeView,
  type CrewPayPeriodSummaryRow,
} from "@/components/CrewPayPeriodCards";
import { summarizeWorkWeeks } from "@/lib/crew-pay-period";
import OpsMonthSelector from "@/components/OpsMonthSelector";
import ManualBonusEditor from "@/components/ManualBonusEditor";
import {
  AnyRecord,
  crewRows,
  employeeJobRevenueWorked,
  money,
  readMetrics,
  resolveDate,
} from "@/lib/opsData";
import {
  manualBonusEntriesForEmployee,
  manualBonusForEmployee,
} from "@/lib/manual-bonuses";
import LiveClockTime from "@/components/LiveClockTime";
import CrewDataRefresh from "@/components/CrewDataRefresh";
import LivePayrollValue, { LivePayrollRecord } from "@/components/LivePayrollValue";
import { buildMonthlyRange, buildMonthlySummary, monthOptions } from "@/lib/monthly-summary";
import { buildFleetDailyRecord } from "@/lib/fleet-history";
import { payPeriodForDate } from "@/lib/pay-period";
import CrewCallInPlan from "@/components/CrewCallInPlan";
import { buildCrewCallInPlan } from "@/lib/crew-call-in-recommendations";

export const dynamic = "force-dynamic";

function chicagoTodayIso(): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function sourceRefreshLabel(value: unknown): string {
  const parsed = new Date(String(value || ""));
  if (Number.isNaN(parsed.getTime())) return "Unavailable";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(parsed);
}

function firstNumber(row: AnyRecord, keys: string[]): number {
  for (const key of keys) {
    const value = row?.[key];
    if (value !== undefined && value !== null && value !== "") {
      const n = Number(value);
      if (!Number.isNaN(n)) return n;
    }
  }
  return 0;
}

function employeeName(row: AnyRecord): string {
  return row.name || row.employee || row.employee_name || "Unknown";
}

function employeeTruck(row: AnyRecord): string {
  const truckValue = row.truck || row.trucks || row.assigned_truck || row.truck_name;
  if (Array.isArray(truckValue)) {
    const list = truckValue.map((truck: unknown) => String(truck || "").trim()).filter(Boolean);
    return list.length ? list.join(", ") : "Unassigned";
  }

  const text = String(truckValue || "").trim();
  return text || "Unassigned";
}

function employeeRevenue(row: AnyRecord): number {
  return firstNumber(row, [
    "individual_revenue",
    "revenue_generated",
    "employee_revenue",
    "revenue",
    "credited_revenue",
    "total_revenue",
  ]);
}

function lookupEmployeeMap(metrics: AnyRecord | null, name: string, mapKeys: string[]): number {
  if (!metrics || !name) return 0;

  for (const mapKey of mapKeys) {
    const map = metrics?.[mapKey];
    if (!map || typeof map !== "object" || Array.isArray(map)) continue;

    const direct = map[name];
    if (direct !== undefined && direct !== null && direct !== "") {
      const n = Number(direct);
      if (!Number.isNaN(n)) return n;
    }

    const normalizedName = name.trim().toLowerCase();
    for (const [key, value] of Object.entries(map)) {
      if (String(key).trim().toLowerCase() === normalizedName) {
        const n = Number(value);
        if (!Number.isNaN(n)) return n;
      }
    }
  }

  return 0;
}

function employeeJobs(row: AnyRecord, metrics?: AnyRecord | null): number {
  const exact = firstNumber(row, [
    "jobs_completed",
    "completed_jobs",
    "completed_job_count",
    "completed_jobs_count",
    "job_count",
    "jobs",
    "employee_jobs",
    "employee_job_count",
    "employee_completed_jobs",
    "credited_jobs",
    "jobs_credited",
    "closed_jobs",
    "jobs_closed",
    "generated_jobs",
    "revenue_jobs",
  ]);

  if (exact > 0) return exact;

  // Look for numeric job-like fields without accidentally using average job size.
  for (const [key, value] of Object.entries(row || {})) {
    const k = key.toLowerCase();
    if (
      k.includes("job") &&
      !k.includes("avg") &&
      !k.includes("average") &&
      !k.includes("size") &&
      !k.includes("revenue") &&
      !k.includes("rph")
    ) {
      const n = Number(value);
      if (!Number.isNaN(n) && n > 0) return n;
    }
  }

  return lookupEmployeeMap(metrics || null, employeeName(row), [
    "jobs_by_employee",
    "employee_jobs_by_name",
    "employee_job_count_by_name",
    "completed_jobs_by_employee",
    "employee_completed_jobs_by_name",
    "jobs_completed_by_employee",
    "employee_jobs",
    "employee_job_counts",
    "job_count_by_employee",
    "closed_jobs_by_employee",
  ]);
}

function attendanceEstimates(row: AnyRecord): number {
  return firstNumber(row, ["estimates_attended"]);
}

function attendanceClosedEstimates(row: AnyRecord): number {
  return firstNumber(row, ["closed_estimates"]);
}

function estimateCloseRateDisplay(estimates: number, closed: number): string {
  if (estimates <= 0) return "—";
  return `${((closed / estimates) * 100).toFixed(1)}%`;
}

function firstVisitCloseRateDisplay(row: AnyRecord): string {
  const closed = firstNumber(row, ["first_visit_closed", "first_visit_closes"]);
  const opportunities = firstNumber(row, ["first_visit_opportunities", "first_visit_estimates"]);
  if (opportunities <= 0) return "Unavailable";
  return `${((closed / opportunities) * 100).toFixed(1)}%`;
}

function employeeHours(row: AnyRecord): number {
  return firstNumber(row, [
    "hours_worked",
    "employee_hours",
    "hours",
    "total_hours",
    "clocked_hours",
    "labor_hours",
  ]);
}

function employeeRph(row: AnyRecord): number {
  return firstNumber(row, [
    "revenue_per_hour",
    "employee_rph",
    "rph",
    "current_rph",
  ]);
}

function employeeAverageJob(row: AnyRecord, metrics?: AnyRecord | null): number {
  const reportedAverage = firstNumber(row, [
    "average_job_size",
    "average_job",
    "avg_job_size",
  ]);
  if (reportedAverage > 0) return reportedAverage;

  const jobs = employeeJobs(row, metrics);
  return jobs > 0 ? employeeRevenue(row) / jobs : 0;
}

function hourlyPay(row: AnyRecord): number {
  return firstNumber(row, [
    "hourly_pay",
    "base_pay",
    "regular_pay",
    "wage_pay",
    "labor_pay",
    "hours_pay",
  ]);
}

function tipPay(row: AnyRecord): number {
  return firstNumber(row, [
    "tip",
    "employee_tips",
    "tips_earned",
    "tip_pay",
    "tips",
    "allocated_tips",
    "tip_share",
    "daily_tips",
  ]);
}

function bonusPay(row: AnyRecord): number {
  const totalBonusValue = firstNumber(row, [
    "total_bonus",
    "bonus",
    "daily_bonus",
    "bonus_pay",
    "employee_bonus",
    "profit_bonus",
    "profit_sharing_bonus",
  ]);

  if (totalBonusValue > 0) return totalBonusValue;

  return revenueBonus(row) + manualBonus(row) + otherBonus(row);
}

function revenueBonus(row: AnyRecord): number {
  const direct = firstNumber(row, ["revenue_bonus", "revenueBonus"]);
  if (direct > 0) return direct;

  if (
    row.total_bonus !== undefined ||
    row.totalBonus !== undefined ||
    row.manual_bonus !== undefined ||
    row.manualBonus !== undefined ||
    row.other_bonus !== undefined ||
    row.otherBonus !== undefined
  ) {
    return 0;
  }

  return firstNumber(row, ["bonus", "daily_bonus", "profit_bonus", "profit_sharing_bonus", "employee_bonus", "bonus_pay"]);
}

function manualBonus(row: AnyRecord): number {
  return firstNumber(row, ["manual_bonus", "manualBonus"]);
}

function otherBonus(row: AnyRecord): number {
  return firstNumber(row, ["other_bonus", "otherBonus"]);
}

function totalBonuses(row: AnyRecord): number {
  const total = firstNumber(row, ["total_bonus", "totalBonus", "bonus", "daily_bonus", "bonus_pay"]);
  return total > 0 ? total : revenueBonus(row) + manualBonus(row) + otherBonus(row);
}

function totalPayWithBonuses(row: AnyRecord, supplementalPay = 0): number {
  return hourlyPay(row) + tipPay(row) + totalBonuses(row) + supplementalPay;
}

function driverScoreDisplay(row: AnyRecord): string {
  const display = String(row.driver_score_display || row.driverScoreDisplay || "").trim();
  if (display) return display;

  const raw = row.driver_score ?? row.driverScore ?? row.opscenter_driving_score;
  if (raw === undefined || raw === null || raw === "") return "Unavailable";

  const score = Number(raw);
  return Number.isFinite(score) ? score.toFixed(1) : "Unavailable";
}

function driverScoreTone(row: AnyRecord): "good" | "warning" | "muted" {
  const status = String(row.driver_score_status || row.driverScoreStatus || row.confidence_status || "").trim().toLowerCase();
  const display = driverScoreDisplay(row);
  if (display === "Insufficient driving data" || status === "insufficient data" || status === "partial" || status === "conflicting") {
    return "warning";
  }
  if (display === "Unavailable") return "muted";
  return "good";
}

function driverScoreStatus(row: AnyRecord): string {
  return String(row.driver_score_status || row.driverScoreStatus || row.confidence_status || "").trim();
}

function driverScoreSource(row: AnyRecord): string {
  return String(row.driver_score_source || row.driverScoreSource || row.score_source || "").trim();
}

function dateInPayPeriod(date: string, periodStart: string, periodEnd: string): boolean {
  return date >= periodStart && date <= periodEnd;
}

type PeriodRow = {
  name: string;
  trucks: Set<string>;
  revenue: number;
  jobRevenueWorked: number;
  jobs: number;
  hours: number;
  hourlyPay: number;
  tips: number;
  revenueBonus: number;
  manualBonus: number;
  otherBonus: number;
  totalBonuses: number;
  supplementalPay: number;
  totalPay: number;
  bonus: number;
  attendedAppointmentKeys: Set<string>;
  completedAppointmentKeys: Set<string>;
  estimateAppointmentKeys: Set<string>;
  closedEstimateAppointmentKeys: Set<string>;
  unclosedEstimateAppointmentKeys: Set<string>;
};


function currentPayPeriodRowsWithToday(
  periodRows: PeriodRow[],
  todayRows: AnyRecord[],
  todayMetrics: AnyRecord | null,
  clockRows: ClockRow[],
  timesheetRateRows: TimesheetRateRow[],
  date: string,
  periodStart: string,
  periodEnd: string,
): PeriodRow[] {
  const byName = new Map<string, PeriodRow>();

  for (const row of periodRows) {
    byName.set(normalizeEmployeeKey(row.name), {
      ...row,
      trucks: new Set(row.trucks),
      attendedAppointmentKeys: new Set(row.attendedAppointmentKeys),
      completedAppointmentKeys: new Set(row.completedAppointmentKeys),
      estimateAppointmentKeys: new Set(row.estimateAppointmentKeys),
      closedEstimateAppointmentKeys: new Set(row.closedEstimateAppointmentKeys),
      unclosedEstimateAppointmentKeys: new Set(row.unclosedEstimateAppointmentKeys),
    });
  }

  for (const todayRow of todayRows) {
    const name = employeeName(todayRow);
    if (!name || name === "Unknown") continue;

    const key = normalizeEmployeeKey(name);
    const clockRow = clockRowForEmployee(name, clockRows);
    const timesheetRate =
      timesheetRateForEmployee(clockRow?.name || name, timesheetRateRows) ||
      timesheetRateForEmployee(name, timesheetRateRows) ||
      firstNumber(todayRow, ["hourly_rate"]) ||
      0;

    const liveHours = liveClockHours(date, clockRow?.timeIn || "", clockRow?.timeOut || "");
    const liveHourlyPay = liveHours * timesheetRate;

    const existing = byName.get(key) || {
      name,
      trucks: new Set<string>(),
      revenue: 0,
      jobRevenueWorked: 0,
      jobs: 0,
      hours: 0,
      hourlyPay: 0,
      tips: 0,
      revenueBonus: 0,
      manualBonus: 0,
      otherBonus: 0,
      totalBonuses: 0,
      supplementalPay: 0,
      totalPay: 0,
      bonus: 0,
      attendedAppointmentKeys: new Set<string>(),
      completedAppointmentKeys: new Set<string>(),
      estimateAppointmentKeys: new Set<string>(),
      closedEstimateAppointmentKeys: new Set<string>(),
      unclosedEstimateAppointmentKeys: new Set<string>(),
    };

    const truck = employeeTruck(todayRow);
    if (truck && truck !== "Unassigned") {
      for (const part of String(truck).split(",")) {
        const clean = part.trim();
        if (clean) existing.trucks.add(clean);
      }
    }

    const todayRevenue = employeeRevenue(todayRow);
    const todayJobRevenueWorked = employeeJobRevenueWorked(todayRow, todayMetrics);
    const todayJobs = employeeJobs(todayRow, {});
    const todayTips = tipPay(todayRow);
    const todayRevenueBonus = revenueBonus(todayRow);
    const todayManualBonus = manualBonus(todayRow);
    const todayOtherBonus = otherBonus(todayRow);
    const todayBonus = totalBonuses(todayRow);
    const todaySupplementalPay = firstNumber(todayRow, ["supplemental_daily_pay", "supplemental_pay"]);
    const employeeKey = normalizeEmployeeKey(name);
    if (dateInPayPeriod(date, periodStart, periodEnd)) {
      for (const appointmentId of Array.isArray(todayRow.attended_appointment_ids)
        ? todayRow.attended_appointment_ids
        : []) {
        existing.attendedAppointmentKeys.add(`${date}|${appointmentId}|${employeeKey}`);
      }
      for (const appointmentId of Array.isArray(todayRow.completed_appointment_ids)
        ? todayRow.completed_appointment_ids
        : []) {
        existing.completedAppointmentKeys.add(`${date}|${appointmentId}|${employeeKey}`);
      }
      for (const appointmentId of Array.isArray(todayRow.estimate_appointment_ids)
        ? todayRow.estimate_appointment_ids : []) {
        existing.estimateAppointmentKeys.add(`${date}|${appointmentId}|${employeeKey}`);
      }
      for (const appointmentId of Array.isArray(todayRow.closed_estimate_appointment_ids)
        ? todayRow.closed_estimate_appointment_ids : []) {
        existing.closedEstimateAppointmentKeys.add(`${date}|${appointmentId}|${employeeKey}`);
      }
      for (const appointmentId of Array.isArray(todayRow.unclosed_estimate_appointment_ids)
        ? todayRow.unclosed_estimate_appointment_ids : []) {
        existing.unclosedEstimateAppointmentKeys.add(`${date}|${appointmentId}|${employeeKey}`);
      }
    }

    // Remove today's stale/zero hourly pay effect by adding live pay owed so far.
    existing.revenue += todayRevenue;
    existing.jobRevenueWorked += todayJobRevenueWorked;
    existing.jobs += todayJobs;
    existing.hours += liveHours;
    existing.hourlyPay += liveHourlyPay;
    existing.tips += todayTips;
    existing.revenueBonus += todayRevenueBonus;
    existing.manualBonus += todayManualBonus;
    existing.otherBonus += todayOtherBonus;
    existing.totalBonuses += todayBonus;
    existing.supplementalPay += todaySupplementalPay;
    existing.bonus = existing.totalBonuses;
    existing.totalPay = existing.hourlyPay + existing.tips + existing.totalBonuses + existing.supplementalPay;

    byName.set(key, existing);
  }

  return Array.from(byName.values()).sort((a, b) => b.totalPay - a.totalPay);
}

function listDatesInclusive(start: string, end: string): string[] {
  const dates: string[] = [];
  const current = new Date(`${start}T00:00:00Z`);
  const final = new Date(`${end}T00:00:00Z`);

  while (current <= final) {
    dates.push(current.toISOString().slice(0, 10));
    current.setUTCDate(current.getUTCDate() + 1);
  }

  return dates;
}

function workWeekStart(date: string): string {
  const parsed = new Date(`${date}T12:00:00Z`);
  const daysSinceMonday = (parsed.getUTCDay() + 6) % 7;
  parsed.setUTCDate(parsed.getUTCDate() - daysSinceMonday);
  return parsed.toISOString().slice(0, 10);
}

function weeklyHoursBeforeDate(date: string): Map<string, number> {
  const totals = new Map<string, number>();
  const start = workWeekStart(date);
  if (start >= date) return totals;

  const priorDay = new Date(`${date}T12:00:00Z`);
  priorDay.setUTCDate(priorDay.getUTCDate() - 1);
  const end = priorDay.toISOString().slice(0, 10);

  for (const day of listDatesInclusive(start, end)) {
    const dayMetrics = readMetrics(day);
    if (!dayMetrics) continue;
    const rows = Array.isArray(dayMetrics.payroll_records) && dayMetrics.payroll_records.length
      ? dayMetrics.payroll_records
      : crewRows(dayMetrics);

    for (const row of rows) {
      const name = employeeName(row);
      if (!name || name === "Unknown") continue;
      const key = normalizeEmployeeKey(name);
      const hours = firstNumber(row, ["hours_worked", "hours", "labor_hours", "worked_hours"]);
      totals.set(key, (totals.get(key) || 0) + hours);
    }
  }

  return totals;
}

function dailyNumber(row: AnyRecord | null | undefined, keys: string[]): number | null {
  if (!row) return null;
  for (const key of keys) {
    const value = row?.[key];
    if (value !== undefined && value !== null && value !== "") {
      const n = Number(value);
      if (Number.isFinite(n)) return n;
    }
  }
  return null;
}

function findDailyEmployeeRow(metricsForDate: AnyRecord | null, name: string): AnyRecord | null {
  if (!metricsForDate || !name) return null;
  const target = normalizeEmployeeKey(name);

  const sources = [
    metricsForDate.payroll_records,
    metricsForDate.employee_leaderboard,
    metricsForDate.employees,
    metricsForDate.crew,
  ];

  for (const source of sources) {
    if (!Array.isArray(source)) continue;

    const found = source.find((row: AnyRecord) => normalizeEmployeeKey(employeeName(row)) === target);
    if (found) return found;
  }

  return null;
}

function dailyRoleDisplay(row: AnyRecord | null, fallback: string): string {
  if (!row) return fallback;
  const roles = Array.isArray(row.credited_roles) ? row.credited_roles.map((role: unknown) => String(role || "").trim().toLowerCase()).filter(Boolean) : [];
  const hasDriver = roles.includes("driver");
  const hasNavigator = roles.includes("navigator");
  if (hasDriver && hasNavigator) return "Driver / Navigator";
  if (hasDriver) return "Driver";
  if (hasNavigator) return "Navigator";

  const driverName = String(row.driver_name || row.driver || "").trim();
  const navigatorName = String(row.navigator_name || row.navigator || "").trim();
  if (driverName && navigatorName) return "Driver / Navigator";
  if (driverName) return "Driver";
  if (navigatorName) return "Navigator";

  return fallback;
}

function dailyClockInDisplay(row: AnyRecord | null): string {
  if (!row) return "Not Worked";
  const clockIn = String(row.clock_in || row.time_in || row.clock_in_display || row.timeIn || "").trim();
  if (clockIn) return clockIn;
  if (isSalaryEmployee(row, employeeName(row))) return "Unavailable";
  return "Unavailable";
}

function dailyClockOutDisplay(row: AnyRecord | null): string {
  if (!row) return "Not Worked";
  const clockOut = String(row.clock_out || row.time_out || row.clock_out_display || row.timeOut || "").trim();
  if (clockOut) return clockOut;
  if (String(row.is_clocked_in || "").toLowerCase() === "true" || String(row.shift_status || "").toLowerCase().includes("clocked in")) {
    return "On Shift";
  }
  if (isSalaryEmployee(row, employeeName(row))) return "Unavailable";
  return "Unavailable";
}

function dailyHoursDisplay(row: AnyRecord | null): string {
  if (!row) return "Not Worked";
  const hours = firstNumber(row, ["hours_worked", "hours", "labor_hours", "worked_hours"]);
  if (!Number.isFinite(hours)) return isSalaryEmployee(row, employeeName(row)) ? "Inferred" : "Unavailable";
  const label = String(row.hours_basis || row.hoursBasis || "").toLowerCase().includes("inferred") || isSalaryEmployee(row, employeeName(row));
  return label ? `Inferred ${hours.toFixed(2)} hrs` : `${hours.toFixed(2)} hrs`;
}

function buildPeriodEmployeeViews(
  periodRows: PeriodRow[],
  periodStart: string,
  periodEnd: string,
  selectedDate: string,
  todayDate: string,
  todayRows: AnyRecord[],
): CrewPayPeriodEmployeeView[] {
  const metricsByDate = new Map<string, AnyRecord | null>();
  for (const date of listDatesInclusive(periodStart, periodEnd)) {
    metricsByDate.set(date, readMetrics(date));
  }
  const todayMetrics = {
    payroll_records: todayRows,
    employee_leaderboard: todayRows,
  };

  return periodRows.map((row) => {
    const estimatesClosedAsJobs = row.closedEstimateAppointmentKeys.size;
    const summary: CrewPayPeriodSummaryRow = {
      name: row.name,
      trucks: Array.from(row.trucks),
      revenue: row.revenue,
      jobRevenueWorked: row.jobRevenueWorked,
      jobs: row.jobs,
      hours: row.hours,
      hourlyPay: row.hourlyPay,
      tips: row.tips,
      revenueBonus: row.revenueBonus,
      manualBonus: row.manualBonus,
      otherBonus: row.otherBonus,
      totalBonuses: row.totalBonuses,
      bonus: row.totalBonuses,
      supplementalPay: row.supplementalPay,
      totalPay: row.totalPay,
      estimates: row.estimateAppointmentKeys.size,
      estimatesClosedAsJobs,
    };

    const days = listDatesInclusive(periodStart, periodEnd).map((date) => {
      const metricsForDate = metricsByDate.get(date) || null;
      const dayRow =
        findDailyEmployeeRow(metricsForDate, row.name) ||
        (date === todayDate ? findDailyEmployeeRow(todayMetrics, row.name) : null);
      const worked = Boolean(
        dayRow &&
          (
            firstNumber(dayRow, ["hours_worked", "hours", "labor_hours", "worked_hours"]) > 0 ||
            firstNumber(dayRow, ["hourly_pay", "base_pay", "regular_pay", "wage_pay"]) > 0 ||
            firstNumber(dayRow, ["total_pay", "total_daily_pay", "employee_total_earnings"]) > 0 ||
            firstNumber(dayRow, ["jobs_completed", "credited_jobs", "jobs", "job_count", "completed_jobs"]) > 0 ||
            firstNumber(dayRow, ["estimates_attended", "closed_estimates"]) > 0 ||
            (Array.isArray(dayRow.estimate_appointment_ids) && dayRow.estimate_appointment_ids.length > 0) ||
            (Array.isArray(dayRow.closed_estimate_appointment_ids) && dayRow.closed_estimate_appointment_ids.length > 0) ||
            (Array.isArray(dayRow.unclosed_estimate_appointment_ids) && dayRow.unclosed_estimate_appointment_ids.length > 0) ||
            String(dayRow.clock_in || dayRow.time_in || "").trim() ||
            String(dayRow.clock_out || dayRow.time_out || "").trim() ||
            Boolean(dayRow.is_salary)
          ),
      );
      const dayRecord = dayRow || {};
      const salary = worked ? isSalaryEmployee(dayRecord, employeeName(dayRecord)) : false;
      const clockIn = dailyClockInDisplay(worked ? dayRow : null);
      const clockOut = dailyClockOutDisplay(worked ? dayRow : null);
      const hours = worked ? firstNumber(dayRecord, ["hours_worked", "hours", "labor_hours", "worked_hours"]) : null;
      const role = worked ? dailyRoleDisplay(dayRecord, "Unassigned") : "Not Worked";
      const truck = worked ? textOrUnavailable(employeeTruck(dayRecord)) : "Not Worked";
      const jobs = worked ? dailyNumber(dayRecord, ["jobs_completed", "completed_jobs", "credited_jobs", "jobs", "job_count"]) : null;
      const estimates = worked ? dailyNumber(dayRecord, ["estimates_attended", "estimates", "estimate_count"]) : null;
      const estimatesClosedAsJobs = worked
        ? dailyNumber(dayRecord, ["closed_estimates"]) ?? (Array.isArray(dayRecord.closed_estimate_appointment_ids) ? dayRecord.closed_estimate_appointment_ids.length : null)
        : null;
      const revenue = worked ? employeeRevenue(dayRecord) : null;
      const jobRevenueWorked = worked ? employeeJobRevenueWorked(dayRecord, metricsForDate) : null;
      const tips = worked ? dailyNumber(dayRecord, ["tip", "employee_tips", "tips_earned", "tip_pay", "tips"]) : null;
      const revenueBonusValue = worked ? revenueBonus(dayRecord) : null;
      const manualBonusValue = worked ? manualBonus(dayRecord) : null;
      const otherBonusValue = worked ? otherBonus(dayRecord) : null;
      const bonus = worked ? totalBonuses(dayRecord) : null;
      const averageJobSize = worked && jobs && jobs > 0 && jobRevenueWorked != null ? jobRevenueWorked / jobs : null;
      const rph = worked && hours && hours > 0 && revenue != null ? revenue / hours : null;
      const hourlyRate = worked ? dailyNumber(dayRecord, ["hourly_rate"]) : null;
      const regularPay = worked ? dailyNumber(dayRecord, ["hourly_pay", "base_pay", "regular_pay", "wage_pay"]) : null;
      const supplementalPay = worked ? dailyNumber(dayRecord, ["supplemental_daily_pay", "supplemental_pay"]) : null;
      const totalPay = worked ? dailyNumber(dayRecord, ["total_pay", "total_daily_pay", "employee_total_earnings"]) : null;
      const firstVisitCloseRate = worked ? firstVisitCloseRateDisplay(dayRecord) : "Not Worked";
      const estimateCloseRate = worked ? estimateCloseRateDisplay(
        dailyNumber(dayRecord, ["estimates_attended"]) || 0,
        dailyNumber(dayRecord, ["closed_estimates"]) || 0,
      ) : "Not Worked";
      const driverScore = worked ? driverScoreDisplay(dayRecord) : "Not Worked";
      const driverScoreSourceValue = worked ? driverScoreSource(dayRecord) : "";
      const driverScoreStatusValue = worked ? driverScoreStatus(dayRecord) : "";
      const speedingEvents = worked ? dailyNumber(dayRecord, ["driver_speeding_events", "speeding_events", "speeding"]) : null;
      const harshBrakingEvents = worked ? dailyNumber(dayRecord, ["driver_hard_braking_events", "driver_harsh_braking_events", "harsh_braking_events"]) : null;

      return {
        date,
        selected: date === selectedDate,
        today: date === todayDate,
        worked,
        salary,
        hoursWorked: hours,
        clockInDisplay: clockIn,
        clockOutDisplay: clockOut,
        hoursDisplay: dailyHoursDisplay(worked ? dayRecord : null),
        roleDisplay: role,
        truckDisplay: truck,
        jobs,
        estimates,
        estimatesClosedAsJobs,
        revenue,
        jobRevenueWorked,
        revenueBonus: revenueBonusValue,
        manualBonus: manualBonusValue,
        otherBonus: otherBonusValue,
        totalBonuses: bonus,
        averageJobSize,
        rph,
        hourlyRate,
        regularPay,
        tips,
        bonus,
        supplementalPay,
        totalPay,
        firstVisitCloseRateDisplay: firstVisitCloseRate,
        estimateCloseRateDisplay: estimateCloseRate,
        driverScoreDisplay: driverScore,
        driverScoreSource: driverScoreSourceValue,
        driverScoreStatus: driverScoreStatusValue,
        speedingEvents,
        harshBrakingEvents,
        isOpenShift: Boolean(
          worked && !salary && clockIn !== "Not Worked" && clockOut === "On Shift",
        ),
      };
    }).filter((day) => day.worked) as CrewPayPeriodDayRow[];

    return {
      name: row.name,
      summary,
      days,
    };
  });
}

function liveClockHours(date: string, clockIn: string, clockOut: string): number {
  if (!clockIn) return 0;

  const start = parseClockForCrewPage(date, clockIn);
  if (!start) return 0;

  const end = clockOut ? parseClockForCrewPage(date, clockOut) : new Date();
  if (!end) return 0;

  const diffMs = end.getTime() - start.getTime();
  if (diffMs <= 0) return 0;

  return diffMs / 1000 / 60 / 60;
}

function parseClockForCrewPage(date: string, time: string): Date | null {
  const raw = String(time || "").trim();
  if (!raw) return null;

  const match = raw.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!match) return null;

  let hour = Number(match[1]);
  const minute = Number(match[2]);
  const ampm = match[3].toUpperCase();

  if (ampm === "PM" && hour !== 12) hour += 12;
  if (ampm === "AM" && hour === 12) hour = 0;

  const d = new Date(`${date}T00:00:00`);
  d.setHours(hour, minute, 0, 0);
  return d;
}


function periodRowsForRange(periodStart: string, periodEnd: string, excludeDate?: string): PeriodRow[] {
  const byName = new Map<string, PeriodRow>();

  const blankRow = (name: string): PeriodRow => ({
    name,
    trucks: new Set<string>(),
    revenue: 0,
    jobRevenueWorked: 0,
    jobs: 0,
    hours: 0,
    hourlyPay: 0,
    tips: 0,
    revenueBonus: 0,
    manualBonus: 0,
    otherBonus: 0,
    totalBonuses: 0,
    supplementalPay: 0,
    bonus: 0,
    totalPay: 0,
    attendedAppointmentKeys: new Set<string>(),
    completedAppointmentKeys: new Set<string>(),
    estimateAppointmentKeys: new Set<string>(),
    closedEstimateAppointmentKeys: new Set<string>(),
    unclosedEstimateAppointmentKeys: new Set<string>(),
  });

  const getRow = (name: string): PeriodRow => {
    const key = normalizeEmployeeKey(name);
    const existing = byName.get(key);
    if (existing) return existing;

    const created = blankRow(name);
    byName.set(key, created);
    return created;
  };

  for (const date of listDatesInclusive(periodStart, periodEnd)) {
    if (excludeDate && date === excludeDate) continue;
    const metricsForDate = readMetrics(date);
    if (!metricsForDate) continue;

    // Production rows are reconciled against the authoritative credited revenue map.
    const leaderboardRows = crewRows(metricsForDate);

    for (const row of leaderboardRows) {
      const name = employeeName(row);
      if (!name || name === "Unknown") continue;

      const existing = getRow(name);

      const truckValue = row.trucks || row.truck || "";
      if (Array.isArray(truckValue)) {
        for (const truck of truckValue) {
          const clean = String(truck || "").trim();
          if (clean) existing.trucks.add(clean);
        }
      } else {
        for (const truck of String(truckValue || "").split(",")) {
          const clean = truck.trim();
          if (clean) existing.trucks.add(clean);
        }
      }

      existing.revenue += firstNumber(row, [
        "revenue_generated",
        "employee_revenue",
        "revenue",
        "period_revenue",
      ]);
      existing.jobRevenueWorked += employeeJobRevenueWorked(row, metricsForDate);

      existing.jobs += firstNumber(row, [
        "jobs_completed",
        "credited_jobs",
        "jobs",
        "job_count",
        "completed_jobs",
      ]);

      const employeeKey = normalizeEmployeeKey(name);
      for (const appointmentId of Array.isArray(row.attended_appointment_ids)
        ? row.attended_appointment_ids
        : []) {
        existing.attendedAppointmentKeys.add(`${date}|${appointmentId}|${employeeKey}`);
      }
      for (const appointmentId of Array.isArray(row.completed_appointment_ids)
        ? row.completed_appointment_ids
        : []) {
        existing.completedAppointmentKeys.add(`${date}|${appointmentId}|${employeeKey}`);
      }
      for (const appointmentId of Array.isArray(row.estimate_appointment_ids)
        ? row.estimate_appointment_ids : []) {
        existing.estimateAppointmentKeys.add(`${date}|${appointmentId}|${employeeKey}`);
      }
      for (const appointmentId of Array.isArray(row.closed_estimate_appointment_ids)
        ? row.closed_estimate_appointment_ids : []) {
        existing.closedEstimateAppointmentKeys.add(`${date}|${appointmentId}|${employeeKey}`);
      }
      for (const appointmentId of Array.isArray(row.unclosed_estimate_appointment_ids)
        ? row.unclosed_estimate_appointment_ids : []) {
        existing.unclosedEstimateAppointmentKeys.add(`${date}|${appointmentId}|${employeeKey}`);
      }

      existing.hours += firstNumber(row, [
        "hours_worked",
        "hours",
        "labor_hours",
        "worked_hours",
      ]);
    }

    // payroll_records is authoritative for pay.
    const payrollRows = Array.isArray(metricsForDate.payroll_records)
      ? metricsForDate.payroll_records
      : [];

    for (const row of payrollRows) {
      const name = employeeName(row);
      if (!name || name === "Unknown") continue;

      const existing = getRow(name);

      const payrollHours = firstNumber(row, [
        "hours_worked",
        "hours",
        "labor_hours",
        "worked_hours",
      ]);

      // Only use payroll hours if leaderboard did not already provide hours for this employee/date.
      // This avoids double-counting hours.
      if (existing.hours <= 0 && payrollHours > 0) {
        existing.hours += payrollHours;
      }

      const rowHourlyPay = firstNumber(row, [
        "hourly_pay",
        "hourlyPay",
        "base_pay",
        "regular_pay",
      ]);

      const rowTips = firstNumber(row, [
        "tip",
        "tips",
        "tip_pay",
        "tipPay",
      ]);

      const revenueBonusValue = firstNumber(row, ["revenue_bonus", "revenueBonus"]);
      const manualBonusValue = firstNumber(row, ["manual_bonus", "manualBonus"]);
      const otherBonusValue = firstNumber(row, ["other_bonus", "otherBonus"]);
      const rowSupplementalPay = firstNumber(row, ["supplemental_daily_pay", "supplemental_pay"]);
      const totalBonusValue = firstNumber(row, [
        "total_bonus",
        "totalBonus",
        "bonus",
        "bonus_pay",
        "profit_bonus",
      ]);
      const rowTotalPay = firstNumber(row, ["total_pay", "total_daily_pay", "employee_total_earnings"]);

      existing.hourlyPay += rowHourlyPay;
      existing.tips += rowTips;
      existing.revenueBonus += revenueBonusValue;
      existing.manualBonus += manualBonusValue;
      existing.otherBonus += otherBonusValue;
      existing.totalBonuses += totalBonusValue > 0 ? totalBonusValue : revenueBonusValue + manualBonusValue + otherBonusValue;
      existing.bonus = existing.totalBonuses;
      existing.supplementalPay += rowSupplementalPay;
      existing.totalPay += rowTotalPay > 0 ? rowTotalPay : rowHourlyPay + rowTips + (totalBonusValue > 0 ? totalBonusValue : revenueBonusValue + manualBonusValue + otherBonusValue) + rowSupplementalPay;
    }
  }

  return Array.from(byName.values()).sort((a, b) => b.totalPay - a.totalPay);
}

function currentPayPeriodRows(periodStart: string, periodEnd: string, excludeDate?: string): PeriodRow[] {
  return periodRowsForRange(periodStart, periodEnd, excludeDate);
}

function renderMonthlyCrewPage({
  date,
  metrics,
  crew,
  requestedSection,
}: {
  date: string;
  metrics: AnyRecord | null;
  crew: AnyRecord[];
  requestedSection: string;
}) {
  const section = ["overview", "breakdown"].includes(requestedSection) ? requestedSection : "overview";
  const todayDate = chicagoTodayIso();
  const month = buildMonthlyRange(date);
  const monthlySummary = buildMonthlySummary(date);
  const monthlyRows = periodRowsForRange(month.monthStart, month.monthEnd);
  const monthlyViews = buildPeriodEmployeeViews(monthlyRows, month.monthStart, month.monthEnd, date, todayDate, crew);
  const monthWorkWeeks = monthlyViews.flatMap((employee) =>
    summarizeWorkWeeks(employee.days, month.monthStart, month.monthEnd),
  );

  const allocatedCrewRevenue = monthlyRows.reduce((sum, row) => sum + row.revenue, 0);
  const totalRevenue = monthlySummary.grossRevenue;
  const revenueAllocationVariance = Math.round((totalRevenue - allocatedCrewRevenue) * 100) / 100;
  const totalHours = monthlyRows.reduce((sum, row) => sum + row.hours, 0);
  const regularHours = monthWorkWeeks.reduce((sum, week) => sum + week.totals.regularHours, 0);
  const overtimeHours = monthWorkWeeks.reduce((sum, week) => sum + week.totals.overtimeHours, 0);
  const hourlyPay = monthlyRows.reduce((sum, row) => sum + row.hourlyPay, 0);
  const overtimePremium = monthWorkWeeks.reduce((sum, week) => sum + week.totals.overtimePremium, 0);
  const hourlyLaborCost = hourlyPay + overtimePremium;
  const tips = monthlyRows.reduce((sum, row) => sum + row.tips, 0);
  const automatedBonuses = monthlyRows.reduce((sum, row) => sum + row.revenueBonus, 0);
  const manualBonuses = monthlyRows.reduce((sum, row) => sum + row.manualBonus, 0);
  const totalBonuses = monthlyRows.reduce((sum, row) => sum + row.totalBonuses, 0);
  const totalPayroll = monthlyRows.reduce(
    (sum, row) => sum + row.hourlyPay + row.totalBonuses + row.supplementalPay,
    0,
  ) + overtimePremium;
  const payrollPercent = totalRevenue > 0 ? (totalPayroll / totalRevenue) * 100 : 0;
  const revenuePerLaborHour = totalHours > 0 ? totalRevenue / totalHours : 0;
  const jobsCompleted = monthlySummary.completedJobs;
  const employeeJobCredits = monthlyRows.reduce((sum, row) => sum + row.jobs, 0);
  const averageJobSize = jobsCompleted > 0 ? totalRevenue / jobsCompleted : 0;
  const drivingScores = monthlyViews
    .flatMap((employee) => employee.days)
    .map((day) => Number(String(day.driverScoreDisplay || "").match(/-?\d+(?:\.\d+)?/)?.[0] || NaN))
    .filter((value) => Number.isFinite(value));
  const averageDrivingScore = drivingScores.length ? drivingScores.reduce((sum, value) => sum + value, 0) / drivingScores.length : null;
  const workdayCount = new Set(monthlyViews.flatMap((employee) => employee.days.map((day) => day.date))).size;
  const employeeShiftCount = monthlyViews.reduce((sum, employee) => sum + employee.days.length, 0);

  return (
    <div className="ops-dashboard ops-crew-dashboard">
      <PageHeader
        title="Crew"
        subtitle={`Monthly summary for ${month.monthDisplay} · ${month.warningLabel} · Data through ${month.dataThroughLabel}`}
        date={date}
        showDateSelector={false}
        dateLabel="Month"
        lastUpdated={(readMetrics(month.dataThroughDate)?.payroll_as_of || readMetrics(month.dataThroughDate)?.generated_at || metrics?.payroll_as_of || metrics?.generated_at) as string | undefined}
        controls={
          <OpsMonthSelector months={monthOptions()} selectedMonthKey={month.monthKey} />
        }
        sections={[
          { label: "Daily crew", href: `/crew?date=${date}` },
          { label: "Monthly overview", href: `/crew?date=${date}&view=monthly&section=overview`, active: section === "overview" },
          { label: "Crew breakdown", href: `/crew?date=${date}&view=monthly&section=breakdown`, active: section === "breakdown" },
        ]}
      />

      {section === "overview" ? <div className="ops-crew-kpi-row" id="crew-overview">
        <div className="ops-card ops-kpi-card ops-crew-kpi-card">
          <div className="ops-card-title">Crew Revenue</div>
          <div className="ops-kpi-value">{money(totalRevenue)}</div>
          <div className={`ops-kpi-sub ${Math.abs(revenueAllocationVariance) > 0.01 ? "ops-kpi-sub-warn" : ""}`}>
            {revenueAllocationVariance > 0.01
              ? `${money(allocatedCrewRevenue)} allocated · ${money(revenueAllocationVariance)} unassigned`
              : revenueAllocationVariance < -0.01
                ? `${money(allocatedCrewRevenue)} allocated · ${money(Math.abs(revenueAllocationVariance))} overallocated`
                : "Fully allocated to crew"}
          </div>
        </div>
        <div className="ops-card ops-kpi-card ops-crew-kpi-card">
          <div className="ops-card-title">Regular Hours</div>
          <div className="ops-kpi-value">{regularHours.toFixed(2)} hrs</div>
        </div>
        <div className="ops-card ops-kpi-card ops-crew-kpi-card">
          <div className="ops-card-title">Overtime Hours</div>
          <div className="ops-kpi-value">{overtimeHours.toFixed(2)} hrs</div>
        </div>
        <div className="ops-card ops-kpi-card ops-crew-kpi-card">
          <div className="ops-card-title">Hourly Labor Cost</div>
          <div className="ops-kpi-value">{money(hourlyLaborCost)}</div>
          <div className="ops-kpi-sub">
            {money(hourlyPay)} regular + {money(overtimePremium)} OT additional
          </div>
        </div>
        <div className="ops-card ops-kpi-card ops-crew-kpi-card">
          <div className="ops-card-title">Tips</div>
          <div className="ops-kpi-value">{money(tips)}</div>
        </div>
        <div className="ops-card ops-kpi-card ops-crew-kpi-card">
          <div className="ops-card-title">Automated Bonuses</div>
          <div className="ops-kpi-value">{money(automatedBonuses)}</div>
        </div>
        <div className="ops-card ops-kpi-card ops-crew-kpi-card">
          <div className="ops-card-title">Manual Bonuses</div>
          <div className="ops-kpi-value">{money(manualBonuses)}</div>
        </div>
        <div className="ops-card ops-kpi-card ops-crew-kpi-card">
          <div className="ops-card-title">Total Bonuses</div>
          <div className="ops-kpi-value">{money(totalBonuses)}</div>
        </div>
        <div className="ops-card ops-kpi-card ops-crew-kpi-card">
          <div className="ops-card-title">Total Payroll</div>
          <div className="ops-kpi-value">{money(totalPayroll)}</div>
        </div>
        <div className="ops-card ops-kpi-card ops-crew-kpi-card">
          <div className="ops-card-title">Payroll % of Revenue</div>
          <div className="ops-kpi-value">{payrollPercent.toFixed(2)}%</div>
        </div>
        <div className="ops-card ops-kpi-card ops-crew-kpi-card">
          <div className="ops-card-title">Revenue per Labor Hour</div>
          <div className="ops-kpi-value">{money(revenuePerLaborHour)}</div>
        </div>
        <div className="ops-card ops-kpi-card ops-crew-kpi-card">
          <div className="ops-card-title">Jobs Completed</div>
          <div className="ops-kpi-value">{jobsCompleted}</div>
          {monthlySummary.authority && monthlySummary.authority.jobDelta !== 0 ? (
            <div className="ops-kpi-sub ops-kpi-sub-warn">
              {monthlySummary.itemizedCompletedJobs} itemized · {monthlySummary.authority.jobDelta} awaiting itemization
            </div>
          ) : null}
        </div>
        <div className="ops-card ops-kpi-card ops-crew-kpi-card">
          <div className="ops-card-title">Average Job Size</div>
          <div className="ops-kpi-value">{money(averageJobSize)}</div>
        </div>
        <div className="ops-card ops-kpi-card ops-crew-kpi-card">
          <div className="ops-card-title">Average Driving Score</div>
          <div className="ops-kpi-value">{averageDrivingScore == null ? "—" : averageDrivingScore.toFixed(1)}</div>
        </div>
        <div className="ops-card ops-kpi-card ops-crew-kpi-card">
          <div className="ops-card-title">Workdays</div>
          <div className="ops-kpi-value">{workdayCount}</div>
        </div>
        <div className="ops-card ops-kpi-card ops-crew-kpi-card">
          <div className="ops-card-title">Employee Shifts</div>
          <div className="ops-kpi-value">{employeeShiftCount}</div>
        </div>
      </div> : null}

      {section === "breakdown" ? <div className="ops-card ops-crew-section ops-crew-section-period" id="crew-breakdown">
        <div className="ops-card-header compact">
          <div>
            <div className="ops-section-title-row">
              <div className="ops-section-title">Monthly Crew Breakdown</div>
              <span className="ops-section-badge ops-section-badge-period">
                {month.monthDisplay}
              </span>
            </div>
            <div className="ops-muted">
              Daily work rows are grouped by payroll week and only include worked dates.
            </div>
          </div>
        </div>

        <div className="ops-period-summary ops-period-summary-compact">
          <div><span>Total Hours</span><strong>{totalHours.toFixed(2)} hrs</strong></div>
          <div><span>Jobs</span><strong>{jobsCompleted}</strong></div>
          <div><span>Employee Job Credits</span><strong>{employeeJobCredits}</strong></div>
          <div><span>Revenue</span><strong>{money(totalRevenue)}</strong></div>
          <div><span>Tips</span><strong>{money(tips)}</strong></div>
          <div><span>Bonuses</span><strong>{money(totalBonuses)}</strong></div>
          <div><span>Payroll Cost</span><strong>{money(totalPayroll)}</strong></div>
        </div>

        {monthlyViews.length ? (
          <CrewPayPeriodCards
            employees={monthlyViews}
            periodStart={month.monthStart}
            periodEnd={month.monthEnd}
          />
        ) : (
          <div className="ops-muted">No monthly workdays recorded for this month.</div>
        )}
      </div> : null}
    </div>
  );
}


type ClockRow = {
  name: string;
  timeIn: string;
  timeOut: string;
  trucks: string;
  hours: string;
  missingPunch: string;
  pay: string;
};


function moneyNumber(value: unknown): number {
  const cleaned = String(value || "").replace(/[^0-9.-]/g, "");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : 0;
}

function splitCsvLine(line: string): string[] {
  const values: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    const next = line[i + 1];

    if (ch === '"' && inQuotes && next === '"') {
      current += '"';
      i++;
      continue;
    }

    if (ch === '"') {
      inQuotes = !inQuotes;
      continue;
    }

    if (ch === "," && !inQuotes) {
      values.push(current);
      current = "";
      continue;
    }

    current += ch;
  }

  values.push(current);
  return values.map((x) => x.trim());
}


type TimesheetRateRow = {
  name: string;
  hourlyRate: number;
};

function readTimesheetRateRows(date: string): TimesheetRateRow[] {
  const filePath = path.join(
    process.cwd(),
    "data",
    "history",
    "junkware",
    `junkware_employee_rates_${date}.csv`
  );

  if (!fs.existsSync(filePath)) return [];

  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return [];

  const headers = splitCsvLine(lines[0]).map((x) => x.trim());

  return lines.slice(1).map((line) => {
    const values = splitCsvLine(line);
    const row: AnyRecord = {};

    headers.forEach((header, index) => {
      row[header] = values[index] || "";
    });

    return {
      name: String(row.name || ""),
      hourlyRate: moneyNumber(row.hourly_rate || row.hourly_rate_raw || 0),
    };
  }).filter((row) => row.name && row.hourlyRate > 0);
}

function timesheetRateForEmployee(name: string, rateRows: TimesheetRateRow[]): number {
  const target = normalizeEmployeeKey(name);

  const found = rateRows.find((row) => {
    return normalizeEmployeeKey(row.name) === target;
  });

  return found ? found.hourlyRate : 0;
}

function readEmployeeClockRows(date: string): ClockRow[] {
  const filePath = path.join(
    process.cwd(),
    "data",
    "history",
    "junkware",
    `junkware_employees_${date}_summary.csv`
  );

  if (!fs.existsSync(filePath)) return [];

  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return [];

  const headers = splitCsvLine(lines[0]).map((x) => x.trim());

  return lines.slice(1).map((line) => {
    const values = splitCsvLine(line);
    const row: AnyRecord = {};

    headers.forEach((header, index) => {
      row[header] = values[index] || "";
    });

    return {
      name: String(row.name || row.employee || row.employee_name || "Unknown"),
      timeIn: String(row.time_in || row.clock_in || row.timeIn || ""),
      timeOut: String(row.time_out || row.clock_out || row.timeOut || ""),
      trucks: String(row.trucks || row.truck || ""),
      hours: String(row.hours || ""),
      missingPunch: String(row.missing_punch || ""),
      pay: String(row.pay || ""),
    };
  });
}


function normalizeEmployeeKey(name: string): string {
  const raw = String(name || "").trim().toLowerCase();

  if (!raw.includes(",")) return raw;

  const parts = raw.split(",").map((x) => x.trim()).filter(Boolean);
  if (parts.length === 2) return `${parts[1]} ${parts[0]}`.toLowerCase();

  return raw;
}

function clockRowForEmployee(name: string, clockRows: ClockRow[]): ClockRow | undefined {
  const key = normalizeEmployeeKey(name);

  return clockRows.find((row) => {
    const rowKey = normalizeEmployeeKey(row.name);
    const directKey = String(row.name || "").trim().toLowerCase();

    return rowKey === key || directKey === key;
  });
}

const SALARIED_EMPLOYEES = new Set([
  "Robert McLaughlin",
  "Eugene Dabezies",
  "Branden Dozier",
]);

function normalizeView(value: unknown): "daily" | "monthly" {
  return String(value || "").toLowerCase() === "monthly" ? "monthly" : "daily";
}

function isSalaryEmployee(row: AnyRecord, name: string): boolean {
  return Boolean(row.is_salary) || SALARIED_EMPLOYEES.has(name);
}

function textOrUnavailable(value: unknown): string {
  const text = String(value || "").trim();
  return text || "Unavailable";
}

function moneyOrUnavailableWhenZero(value: unknown, denominator: number): string {
  if (denominator <= 0) return "Unavailable";
  if (value === undefined || value === null || value === "") return "Unavailable";
  const n = Number(value);
  return Number.isFinite(n) ? money(n) : "Unavailable";
}

function crewRole(row: AnyRecord): string {
  const driverTrucks = Array.isArray(row.driver_trucks) ? row.driver_trucks : [];
  if (driverTrucks.length > 0) return "Driver";
  const truck = employeeTruck(row);
  if (truck !== "Unassigned" && truck !== "Unavailable") return "Navigator";
  return "Unassigned";
}

function driverLabel(row: AnyRecord): string {
  const driverTrucks = Array.isArray(row.driver_trucks)
    ? row.driver_trucks.map((truck: unknown) => String(truck || "").trim()).filter(Boolean)
    : [];
  return driverTrucks.length ? driverTrucks.join(", ") : "Unassigned";
}

function navigatorLabel(row: AnyRecord): string {
  return textOrUnavailable(
    row.navigator ||
      row.navigator_name ||
      row.navigator_display_name ||
      row.navigator_assignment ||
      row.navigator_role
  );
}

type CrewMetricItem = {
  label: string;
  value: ReactNode;
  subvalue?: ReactNode;
  tone?: "default" | "good" | "warning" | "muted";
};

function CrewMetric({ label, value, subvalue, tone = "default" }: CrewMetricItem) {
  return (
    <div className={`ops-crew-metric ${tone !== "default" ? `ops-crew-metric-${tone}` : ""}`}>
      <span className="ops-crew-metric-label">{label}</span>
      <div className="ops-crew-metric-value">{value}</div>
      {subvalue ? <span className="ops-crew-metric-subvalue">{subvalue}</span> : null}
    </div>
  );
}

type CrewDetailFieldItem = {
  label: string;
  value: ReactNode;
  subvalue?: ReactNode;
  tone?: "default" | "good" | "muted" | "warning";
};

function CrewDetailField({ label, value, subvalue, tone = "default" }: CrewDetailFieldItem) {
  return (
    <div className={`ops-crew-detail-row ${tone !== "default" ? `ops-crew-detail-row-${tone}` : ""}`}>
      <span className="ops-crew-detail-label">{label}</span>
      <div className="ops-crew-detail-value-wrap">
        <div className="ops-crew-detail-value">{value}</div>
        {subvalue ? <span className="ops-crew-detail-subvalue">{subvalue}</span> : null}
      </div>
    </div>
  );
}

function todayStatusChip(clockIn: string, clockOut: string, isSalary: boolean): { label: string; tone: "green" | "yellow" | "muted" } {
  if (!clockIn) return { label: "Unavailable", tone: "muted" };
  if (isSalary) return { label: "Salary", tone: "yellow" };
  if (!clockOut) return { label: "On Shift", tone: "yellow" };
  return { label: "Clocked Out", tone: "green" };
}


export default async function CrewPage({
  searchParams,
}: {
  searchParams?: Promise<AnyRecord>;
}) {
  const params = searchParams ? await searchParams : undefined;
  const date = resolveDate(params);
  const view = normalizeView(params?.view);
  const requestedSection = String(params?.section || "crew").toLowerCase();
  const metrics = readMetrics(date);
  const todayDate = chicagoTodayIso();
  const isCurrentDay = date === todayDate;
  const dailyFleet = buildFleetDailyRecord(date);
  const sharedScores = new Map<string, AnyRecord>();
  for (const scoreRow of [...(dailyFleet?.employeeScoreRows || []), ...(dailyFleet?.navigatorScoreRows || [])]) {
    sharedScores.set(normalizeEmployeeKey(employeeName(scoreRow)), scoreRow);
  }
  const crew = crewRows(metrics).map((row) => {
    const sharedScore = sharedScores.get(normalizeEmployeeKey(employeeName(row)));
    return sharedScore ? { ...row, ...sharedScore, employee_name: employeeName(row) } : row;
  }).sort((a, b) => employeeName(a).localeCompare(employeeName(b), "en", { sensitivity: "base" }));
  const clockRows = readEmployeeClockRows(date);
  const timesheetRateRows = readTimesheetRateRows(date);
  const priorWeeklyHours = weeklyHoursBeforeDate(date);

  if (view === "monthly") {
    return renderMonthlyCrewPage({
      date,
      metrics,
      crew,
      requestedSection,
    });
  }
  const section = ["call-in", "crew", "pay-period"].includes(requestedSection)
    ? requestedSection
    : "crew";

  const callInPlan = buildCrewCallInPlan(date);

  const livePayrollByEmployee = new Map<string, LivePayrollRecord>();
  for (const row of crew) {
    const name = employeeName(row);
    const employeeClockRow = clockRowForEmployee(name, clockRows);
    const clockIn = employeeClockRow?.timeIn || row.clock_in || row.time_in || "";
    const clockOut = employeeClockRow?.timeOut || row.clock_out || row.time_out || "";
    const hourlyRate =
      timesheetRateForEmployee(employeeClockRow?.name || name, timesheetRateRows) ||
      timesheetRateForEmployee(name, timesheetRateRows) ||
      firstNumber(row, ["hourly_rate"]) ||
      null;
    livePayrollByEmployee.set(normalizeEmployeeKey(name), {
      clockIn,
      clockOut,
      hourlyRate,
      totalBonus: bonusPay(row),
      tips: tipPay(row),
      supplementalPay: firstNumber(row, ["supplemental_daily_pay", "supplemental_pay"]),
      isSalary: isSalaryEmployee(row, name),
      weeklyHoursBeforeShift: priorWeeklyHours.get(normalizeEmployeeKey(name)) || 0,
    });
  }
  const livePayrollRecords = Array.from(livePayrollByEmployee.values());
  const rankedCrew = [...crew].sort((a, b) =>
    employeeRevenue(b) - employeeRevenue(a) ||
    employeeJobs(b, metrics) - employeeJobs(a, metrics) ||
    employeeRph(b) - employeeRph(a) ||
    employeeName(a).localeCompare(employeeName(b), "en", { sensitivity: "base" })
  );
  const hasLeaderboardResults = rankedCrew.some(
    (row) => employeeRevenue(row) > 0 || employeeJobs(row, metrics) > 0,
  );

  const totalTips = crew.reduce((sum, row) => sum + tipPay(row), 0);
  const totalBonus = crew.reduce((sum, row) => sum + bonusPay(row), 0);
  const allocatedCrewRevenue = crew.reduce((sum, row) => sum + employeeRevenue(row), 0);
  const hasAuthoritativeRevenue = metrics?.total_revenue !== undefined && metrics?.total_revenue !== null;
  const totalRevenue = hasAuthoritativeRevenue
    ? Number(metrics?.total_revenue || 0)
    : allocatedCrewRevenue;
  const revenueAllocationVariance = Math.round((totalRevenue - allocatedCrewRevenue) * 100) / 100;
  const avgRph =
    crew.length > 0
      ? crew.reduce((sum, row) => sum + employeeRph(row), 0) / crew.length
      : 0;

  const currentPeriod = payPeriodForDate(date);
  const basePeriodRows = currentPayPeriodRows(currentPeriod.start, currentPeriod.end, date);
  const basePeriodHourlyPay = basePeriodRows.reduce((sum, row) => sum + row.hourlyPay, 0);
  const basePeriodTips = basePeriodRows.reduce((sum, row) => sum + row.tips, 0);
  const periodRows = currentPayPeriodRowsWithToday(
    basePeriodRows,
    crew,
    metrics,
    clockRows,
    timesheetRateRows,
    date,
    currentPeriod.start,
    currentPeriod.end,
  );
  const periodEmployeeViews = buildPeriodEmployeeViews(
    periodRows,
    currentPeriod.start,
    currentPeriod.end,
    date,
    todayDate,
    crew,
  );
  const basePeriodWorkWeeks = periodEmployeeViews.flatMap((employee) =>
    summarizeWorkWeeks(
      employee.days.filter((day) => day.date !== date),
      currentPeriod.start,
      currentPeriod.end,
    ),
  );
  const basePeriodOvertimePremium = basePeriodWorkWeeks.reduce(
    (sum, week) => sum + week.totals.overtimePremium,
    0,
  );
  const basePeriodSupplementalPay = basePeriodRows.reduce((sum, row) => sum + row.supplementalPay, 0);
  const basePeriodBonus = basePeriodRows.reduce((sum, row) => sum + row.bonus, 0);
  const basePayrollExpense =
    basePeriodHourlyPay +
    basePeriodOvertimePremium +
    basePeriodBonus +
    basePeriodSupplementalPay;
  const periodBonus = periodRows.reduce((sum, row) => sum + row.bonus, 0);
  const periodTips = periodRows.reduce((sum, row) => sum + row.tips, 0);

  return (
    <div className="ops-dashboard ops-crew-dashboard">
      {isCurrentDay ? <CrewDataRefresh enabled /> : null}
      <PageHeader
        title="Crew"
        subtitle="Individual revenue, assignment clarity, hourly pay, tips, bonuses, and total earnings"
        date={date}
        lastUpdated={metrics?.payroll_as_of || metrics?.generated_at}
        sections={[
          { label: "Call-in plan", href: `/crew?date=${date}&section=call-in`, active: section === "call-in" },
          { label: "Today’s crew", href: `/crew?date=${date}&section=crew`, active: section === "crew", badge: crew.length || undefined },
          { label: "Pay period", href: `/crew?date=${date}&section=pay-period`, active: section === "pay-period" },
          { label: "Monthly", href: `/crew?date=${date}&view=monthly` },
        ]}
      />

      {section === "crew" ? <div className="ops-crew-kpi-row" id="crew-summary">
        <div className="ops-card ops-kpi-card ops-crew-kpi-card">
          <div className="ops-card-title">Crew Count</div>
          <div className="ops-kpi-value">{crew.length}</div>
        </div>

        <div className="ops-card ops-kpi-card ops-crew-kpi-card">
          <div className="ops-card-title">Crew Revenue</div>
          <div className="ops-kpi-value">{money(totalRevenue)}</div>
          <div className={`ops-kpi-sub ${Math.abs(revenueAllocationVariance) > 0.01 ? "ops-kpi-sub-warn" : ""}`}>
            {revenueAllocationVariance > 0.01
              ? `${money(allocatedCrewRevenue)} allocated · ${money(revenueAllocationVariance)} unassigned`
              : revenueAllocationVariance < -0.01
                ? `${money(allocatedCrewRevenue)} allocated · ${money(Math.abs(revenueAllocationVariance))} overallocated`
                : "Fully allocated to crew"}
          </div>
        </div>

        <div className="ops-card ops-kpi-card ops-crew-kpi-card">
          <div className="ops-card-title">Average RPH</div>
          <div className="ops-kpi-value">{money(avgRph)}</div>
        </div>

        <div className="ops-card ops-kpi-card ops-crew-kpi-card">
          <div className="ops-card-title">Employee Total Earnings</div>
          <div className="ops-kpi-value">
            <LivePayrollValue date={date} records={livePayrollRecords} field="earnings" />
          </div>
        </div>
      </div> : null}

      {section === "crew" ? <section className="ops-card ops-daily-leaderboard" id="crew-leaderboard">
        <div className="ops-card-header compact">
          <div>
            <div className="ops-section-title">Daily Crew Leaderboard</div>
            <div className="ops-muted">
              Ranked by credited revenue, with completed jobs and revenue per hour breaking ties.
            </div>
          </div>
          <div className="ops-daily-leaderboard-actions">
            <span className={`ops-daily-leaderboard-state ${hasLeaderboardResults ? "is-live" : "is-pending"}`}>
              {hasLeaderboardResults ? `${rankedCrew.length} ranked` : "Awaiting results"}
            </span>
          </div>
        </div>

        <div className="ops-daily-leaderboard-table-wrap">
          <table className="ops-table ops-daily-leaderboard-table">
            <thead>
              <tr>
                <th aria-label="Rank">Rank</th>
                <th>Crew member</th>
                <th>Truck</th>
                <th>Jobs</th>
                <th>Revenue</th>
                <th>Revenue / hr</th>
                <th>Average job</th>
                <th>Daily earnings</th>
              </tr>
            </thead>
            <tbody>
              {rankedCrew.map((row, idx) => {
                const rank = idx + 1;
                const name = employeeName(row);
                const rowClassName = hasLeaderboardResults && rank <= 3 ? `is-rank-${rank}` : undefined;
                const payrollRecord = livePayrollByEmployee.get(normalizeEmployeeKey(name));

                return (
                  <tr className={rowClassName} key={`${name}-${idx}`}>
                    <td className="ops-daily-leaderboard-rank-cell">
                      <span
                        className="ops-daily-leaderboard-rank"
                        aria-label={hasLeaderboardResults ? `Rank ${rank}` : "Not yet ranked"}
                      >
                        {hasLeaderboardResults ? String(rank).padStart(2, "0") : "—"}
                      </span>
                    </td>
                    <td className="ops-daily-leaderboard-person">
                      <strong>{name}</strong>
                      <small>{String(row.shift_status || row.clock_out_display || "Daily crew")}</small>
                    </td>
                    <td>{employeeTruck(row)}</td>
                    <td className="ops-daily-leaderboard-jobs">{employeeJobs(row, metrics)}</td>
                    <td className="ops-money ops-daily-leaderboard-revenue">{money(employeeRevenue(row))}</td>
                    <td className="ops-money">{money(employeeRph(row))}</td>
                    <td className="ops-money">{money(employeeAverageJob(row, metrics))}</td>
                    <td className="ops-money ops-pay-total">
                      {payrollRecord ? (
                        <LivePayrollValue date={date} records={[payrollRecord]} field="earnings" />
                      ) : (
                        money(totalPayWithBonuses(row, firstNumber(row, ["supplemental_daily_pay", "supplemental_pay"])))
                      )}
                    </td>
                  </tr>
                );
              })}

              {rankedCrew.length === 0 ? (
                <tr>
                  <td colSpan={8} className="ops-muted">No crew data available for this date.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section> : null}

      {section === "call-in" ? <CrewCallInPlan plan={callInPlan} id="crew-call-in" /> : null}

      {section === "crew" ? <div className="ops-card ops-crew-section ops-crew-section-live" id="crew-today">
        <div className="ops-card-header compact">
          <div>
            <div className="ops-section-title-row">
              <div className="ops-section-title">Today’s Crew Performance</div>
              <span className="ops-section-badge ops-section-badge-live">LIVE</span>
            </div>
            <div className="ops-muted">
              Select an employee to review attendance, production, earnings, and driving details.
            </div>
            <div className="ops-table-note">
              Last source refresh: {sourceRefreshLabel(metrics?.payroll_as_of || metrics?.generated_at)} · Data refreshes every five minutes.
            </div>
          </div>
        </div>

        <div className="ops-crew-card-grid">
          {crew.length ? (
            crew.map((row, idx) => {
              const name = employeeName(row);
              const revenue = employeeRevenue(row);
              const jobRevenueWorked = employeeJobRevenueWorked(row, metrics);
              const jobs = employeeJobs(row, metrics);
              const employeeClockRow = clockRowForEmployee(name, clockRows);
              const employeeHourlyRate =
                timesheetRateForEmployee(employeeClockRow?.name || name, timesheetRateRows) ||
                timesheetRateForEmployee(name, timesheetRateRows) ||
                firstNumber(row, ["hourly_rate"]) ||
                0;
              const sourceClockIn = employeeClockRow?.timeIn || row.clock_in || row.time_in || "";
              const sourceClockOut = employeeClockRow?.timeOut || row.clock_out || row.time_out || "";
              const isSalary = isSalaryEmployee(row, name);
              const status = todayStatusChip(sourceClockIn, sourceClockOut, isSalary);
              const avgJob = jobs > 0 ? jobRevenueWorked / jobs : null;
              const rph = employeeHours(row) > 0 ? employeeRph(row) : null;
              const estimatesClosedAsJobs = attendanceClosedEstimates(row);
              const estimateCloseRate = estimateCloseRateDisplay(attendanceEstimates(row), estimatesClosedAsJobs);
              const supplementalPay = firstNumber(row, ["supplemental_daily_pay"]);
              const supplementalVisible = supplementalPay > 0;
              const manualBonusEntries = manualBonusEntriesForEmployee(date, name);
              const manualBonusTotal = manualBonusForEmployee(date, name);
              const livePayrollRecord: LivePayrollRecord = {
                clockIn: sourceClockIn,
                clockOut: sourceClockOut,
                hourlyRate: employeeHourlyRate || null,
                totalBonus: bonusPay(row),
                tips: tipPay(row),
                supplementalPay,
                isSalary,
                weeklyHoursBeforeShift: priorWeeklyHours.get(normalizeEmployeeKey(name)) || 0,
              };

              return (
                <details key={`${name}-${idx}`} className="ops-card ops-crew-employee-card ops-crew-today-employee-card">
                  <summary className="ops-crew-employee-summary">
                    <div className="ops-crew-employee-summary-grid">
                      <div className="ops-crew-summary-field ops-crew-summary-field-employee">
                        <span className="ops-crew-summary-label">Employee</span>
                        <div className="ops-crew-summary-main">
                          <div className="ops-crew-employee-name">{name}</div>
                          <div className="ops-crew-employee-subtitle">
                            {crewRole(row)} · {textOrUnavailable(employeeTruck(row))}
                          </div>
                        </div>
                      </div>

                      <div className="ops-crew-summary-field">
                        <span className="ops-crew-summary-label">Time</span>
                          <div className="ops-crew-summary-main">
                            <div className="ops-crew-summary-value">
                            <LiveClockTime
                              date={date}
                              clockIn={sourceClockIn}
                              clockOut={sourceClockOut}
                            />
                          </div>
                          <div className={`ops-crew-status-chip ops-crew-status-${status.tone}`}>{status.label}</div>
                        </div>
                      </div>

                      <div className="ops-crew-summary-field">
                        <span className="ops-crew-summary-label">Production</span>
                        <div className="ops-crew-summary-main">
                          <div className="ops-crew-summary-value">{jobs}</div>
                          <div className="ops-crew-summary-subvalue ops-nowrap">
                            {money(jobRevenueWorked)} worked · {money(revenue)} credited
                          </div>
                        </div>
                      </div>

                      <div className="ops-crew-summary-field">
                        <span className="ops-crew-summary-label">Hourly Labor Cost</span>
                        <div className="ops-crew-summary-main">
                          <div className="ops-crew-summary-value">
                            <LivePayrollValue date={date} records={[livePayrollRecord]} field="labor" />
                          </div>
                          <div className="ops-crew-summary-subvalue">
                            <LivePayrollValue date={date} records={[livePayrollRecord]} field="regular" showIncompleteNote={false} /> regular +{" "}
                            <LivePayrollValue date={date} records={[livePayrollRecord]} field="overtime" showIncompleteNote={false} /> OT additional
                          </div>
                        </div>
                      </div>

                      <div className="ops-crew-summary-field">
                        <span className="ops-crew-summary-label">Tips</span>
                        <div className="ops-crew-summary-main">
                          <div className="ops-crew-summary-value ops-nowrap">{money(tipPay(row))}</div>
                        </div>
                      </div>

                      <div className="ops-crew-summary-field">
                        <span className="ops-crew-summary-label">Bonuses</span>
                        <div className="ops-crew-summary-main">
                          <div className="ops-crew-summary-value ops-nowrap">{money(bonusPay(row))}</div>
                        </div>
                      </div>

                      <div className="ops-crew-summary-field ops-crew-summary-field-good">
                        <span className="ops-crew-summary-label">Total Pay</span>
                        <div className="ops-crew-summary-main">
                          <div className="ops-crew-summary-value">
                            <LivePayrollValue
                              date={date}
                              records={[livePayrollRecord]}
                              field="earnings"
                            />
                          </div>
                        </div>
                      </div>
                    </div>
                    <span className="ops-crew-chevron" aria-hidden="true">▸</span>
                  </summary>

                  <div className="ops-crew-employee-details">
                    <div className="ops-crew-detail-section">
                      <div className="ops-crew-detail-section-title">Attendance</div>
                      <div className="ops-crew-detail-rows ops-crew-detail-rows-2">
                        <CrewDetailField label="Clock In" value={textOrUnavailable(sourceClockIn)} />
                        <CrewDetailField
                          label="Clock Out"
                          value={sourceClockOut || "On Shift"}
                          tone={sourceClockOut ? "good" : "warning"}
                        />
                        <CrewDetailField
                          label="Hours"
                          value={
                            <LiveClockTime
                              date={date}
                              clockIn={sourceClockIn}
                              clockOut={sourceClockOut}
                            />
                          }
                        />
                        <CrewDetailField
                          label="Shift Status"
                          value={status.label}
                          tone={status.tone === "green" ? "good" : status.tone === "yellow" ? "warning" : "muted"}
                        />
                        <CrewDetailField
                          label="Assignment Confidence"
                          value={String(row.assignment_confidence || row.assignmentConfidence || "Unavailable").trim() || "Unavailable"}
                        />
                      </div>
                    </div>

                    <div className="ops-crew-detail-section">
                      <div className="ops-crew-detail-section-title">Production</div>
                      <div className="ops-crew-detail-rows ops-crew-detail-rows-2">
                        <CrewDetailField label="Jobs" value={jobs} />
                        <CrewDetailField label="Job Revenue Worked" value={money(jobRevenueWorked)} />
                        <CrewDetailField label="Credited Revenue" value={money(revenue)} />
                        <CrewDetailField
                          label="Estimates Closed as Jobs"
                          value={estimatesClosedAsJobs}
                          subvalue={estimateCloseRate === "—" ? "Close rate —" : `Close rate ${estimateCloseRate}`}
                        />
                        <CrewDetailField
                          label="Average Job Size"
                          value={jobs > 0 ? money(avgJob as number) : "Unavailable"}
                        />
                        <CrewDetailField
                          label="RPH"
                          value={moneyOrUnavailableWhenZero(rph, employeeHours(row))}
                        />
                      </div>
                    </div>

                      <div className="ops-crew-detail-section">
                        <div className="ops-crew-detail-section-title">Earnings</div>
                        <div className="ops-crew-detail-rows ops-crew-detail-rows-2">
                          <CrewDetailField label="Revenue Bonus" value={money(revenueBonus(row))} />
                          <CrewDetailField
                            label="Manual Bonus"
                            value={money(manualBonusTotal)}
                            subvalue={manualBonusEntries.length ? `${manualBonusEntries.length} entries` : "No manual bonus"}
                          />
                          <CrewDetailField label="Hourly Rate" value={money(employeeHourlyRate)} />
                          <CrewDetailField
                            label="Hourly Labor Cost"
                            value={<LivePayrollValue date={date} records={[livePayrollRecord]} field="labor" />}
                            subvalue={
                              <>
                                <LivePayrollValue date={date} records={[livePayrollRecord]} field="regular" showIncompleteNote={false} /> regular +{" "}
                                <LivePayrollValue date={date} records={[livePayrollRecord]} field="overtime" showIncompleteNote={false} /> OT additional
                              </>
                            }
                            tone="warning"
                          />
                          <CrewDetailField label="Tips" value={money(tipPay(row))} />
                          <CrewDetailField label="Other Bonus" value={money(otherBonus(row))} />
                          <CrewDetailField label="Total Bonuses" value={money(bonusPay(row))} />
                          {supplementalVisible ? (
                            <CrewDetailField label="Supplemental Pay" value={money(supplementalPay)} />
                          ) : null}
                          <CrewDetailField
                            label="Total Pay"
                            value={<LivePayrollValue date={date} records={[livePayrollRecord]} field="earnings" />}
                            tone="good"
                          />
                        </div>
                        <div className="ops-crew-manual-bonus-editor-wrap">
                          <ManualBonusEditor
                            date={date}
                            employeeName={name}
                            entries={manualBonusEntries}
                            totalAmount={manualBonusTotal}
                          />
                        </div>
                      </div>

                    <div className="ops-crew-detail-section">
                      <div className="ops-crew-detail-section-title">Driving</div>
                      <div className="ops-crew-detail-rows ops-crew-detail-rows-2">
                        <CrewDetailField
                          label="Driver Score"
                          value={driverScoreDisplay(row)}
                          subvalue={
                            [driverScoreStatus(row), driverScoreSource(row), String(row.driver_score_warning || row.driverScoreWarning || "").trim()]
                              .filter(Boolean)
                              .join(" · ") || undefined
                          }
                          tone={driverScoreTone(row)}
                        />
                      </div>
                    </div>
                  </div>
                </details>
              );
            })
          ) : (
            <div className="ops-muted">No crew data available.</div>
          )}
        </div>
      </div> : null}

      {section === "pay-period" ? <div className="ops-card ops-crew-section ops-crew-section-period" id="crew-pay-period">
        <div className="ops-card-header compact">
          <div>
            <div className="ops-section-title-row">
              <div className="ops-section-title">Current Pay Period</div>
              <span className="ops-section-badge ops-section-badge-period">
                {currentPeriod.start} → {currentPeriod.end}
              </span>
            </div>
            <div className="ops-muted">
              {currentPeriod.start} through {currentPeriod.end}. Aggregated from available daily metrics files.
            </div>
          </div>
        </div>

        <div className="ops-period-summary ops-period-summary-compact">
          <div>
            <span>Hourly Labor Cost</span>
            <strong>
              <LivePayrollValue
                date={date}
                records={livePayrollRecords}
                field="labor"
                baseAmount={basePeriodHourlyPay + basePeriodOvertimePremium}
                showIncompleteNote={false}
              />
            </strong>
            <small className="ops-muted">
              <LivePayrollValue
                date={date}
                records={livePayrollRecords}
                field="regular"
                baseAmount={basePeriodHourlyPay}
                showIncompleteNote={false}
              /> regular +{" "}
              <LivePayrollValue
                date={date}
                records={livePayrollRecords}
                field="overtime"
                baseAmount={basePeriodOvertimePremium}
                showIncompleteNote={false}
              /> OT additional
            </small>
          </div>
          <div>
            <span>Bonuses</span>
            <strong>{money(periodBonus)}</strong>
          </div>
          <div>
            <span>Payroll Expense</span>
            <strong>
              <LivePayrollValue
                date={date}
                records={livePayrollRecords}
                field="total"
                baseAmount={basePayrollExpense}
                showIncompleteNote={false}
              />
            </strong>
          </div>
          <div>
            <span>Tips</span>
            <strong>{money(periodTips)}</strong>
          </div>
          <div>
            <span>Employee Total Earnings</span>
            <strong>
              <LivePayrollValue
                date={date}
                records={livePayrollRecords}
                field="earnings"
                baseAmount={basePayrollExpense + basePeriodTips}
              />
            </strong>
          </div>
        </div>

        {periodEmployeeViews.length ? (
          <CrewPayPeriodCards
            employees={periodEmployeeViews}
            periodStart={currentPeriod.start}
            periodEnd={currentPeriod.end}
          />
        ) : (
          <div className="ops-muted">No daily metrics files found inside the current pay period.</div>
        )}
      </div> : null}
    </div>
  );
}
