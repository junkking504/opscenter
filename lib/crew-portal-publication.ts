import { appliedPayrollCorrectionsForDate } from "@/lib/applied-payroll-corrections";
import {
  payrollSyncForCorrection,
  sameShift,
  type PayrollSync,
} from "@/lib/junkware-payroll-sync";
import { calculateLivePay } from "@/lib/live-pay";
import {
  normalizePayrollEmployeeKey,
  type PayrollCorrection,
} from "@/lib/payroll-corrections";

type AnyRecord = Record<string, any>;

function rowName(row: AnyRecord): string {
  return String(row.name || row.employee || row.employee_name || "").trim();
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

function round(value: number, digits: number): number {
  const scale = 10 ** digits;
  return Math.round((value + Number.EPSILON) * scale) / scale;
}

function correctedPayrollRow(
  source: AnyRecord,
  date: string,
  correction: PayrollCorrection,
  sync: PayrollSync | null,
): AnyRecord {
  const row = { ...source };
  const calculation = correction.clockOut
    ? calculateLivePay({
        date,
        clockIn: correction.clockIn,
        clockOut: correction.clockOut,
        hourlyRate: correction.hourlyRate,
      })
    : null;
  const verifiedAfter = sync?.status === "verified"
    && sync.verifiedAt
    && Date.parse(sync.verifiedAt) >= Date.parse(correction.updatedAt)
    && sameShift(sync.after, correction)
    && sync.after
    && sync.after.hours !== null
    && Number.isFinite(sync.after.hours)
    && sync.after.labor !== null
    && Number.isFinite(sync.after.labor)
      ? sync.after
      : null;
  const hours = verifiedAfter
    ? verifiedAfter.hours!
    : calculation?.valid && calculation.workedHours !== null
      ? round(calculation.workedHours, 4)
      : 0;
  const straightPay = round(hours * correction.hourlyRate, 2);
  const labor = verifiedAfter ? verifiedAfter.labor! : straightPay;

  // Publish only the employee-facing shift and pay projection. Correction
  // reasons, manager identity, audit IDs, and synchronization receipts stay in
  // the private operational stores and never cross the Crew Portal handoff.
  row.clock_in = correction.clockIn;
  row.clock_out = correction.clockOut;
  row.hours_worked = hours;
  row.hourly_rate = correction.hourlyRate;
  row.shift_status = correction.clockOut ? "Clocked Out" : "On Shift";
  row.pay_is_final = Boolean(correction.clockOut && calculation?.valid && verifiedAfter);
  row.crew_pay_needs_review = !verifiedAfter || Boolean(correction.clockOut && !calculation?.valid);

  if (!row.is_salary) {
    const tips = firstNumber(row, ["tips", "tip"]);
    const bonuses = firstNumber(row, ["total_bonus", "bonus", "bonuses", "daily_bonus"]);
    const supplemental = firstNumber(row, ["supplemental_daily_pay", "supplemental_pay"]);
    const regularHours = verifiedAfter?.regularHours ?? hours;
    const overtimeHours = verifiedAfter?.overtimeHours ?? 0;
    const regularPay = round(regularHours * correction.hourlyRate, 2);
    const overtimePay = round(Math.max(0, labor - regularPay), 2);
    row.regular_hours = regularHours;
    row.overtime_hours = overtimeHours;
    row.hourly_pay = labor;
    row.regular_pay = regularPay;
    row.overtime_pay = overtimePay;
    row.total_pay = round(labor + tips + bonuses + supplemental, 2);
  }

  return row;
}

/**
 * Overlay applicable OpsCenter time corrections immediately before Crew Portal
 * publication. Existing source/performance fields survive unchanged, while a
 * correction-only missed shift receives a private payroll row. The portal then
 * reallocates regular/overtime hours across the employee's complete workweek.
 */
export function applyPayrollCorrectionsToCrewMetrics(
  metrics: AnyRecord,
  date: string,
  corrections: Record<string, PayrollCorrection> = appliedPayrollCorrectionsForDate(date),
  syncForCorrection: (correction: PayrollCorrection) => PayrollSync | null = payrollSyncForCorrection,
): AnyRecord {
  const corrected = { ...metrics };
  const payrollRows = Array.isArray(metrics.payroll_records)
    ? metrics.payroll_records.map((row: AnyRecord) => ({ ...row }))
    : [];
  const leaderboardRows = Array.isArray(metrics.employee_leaderboard)
    ? metrics.employee_leaderboard.map((row: AnyRecord) => ({ ...row }))
    : [];

  for (const correction of Object.values(corrections)) {
    const employeeKey = normalizePayrollEmployeeKey(correction.employeeName);
    const matches = (row: AnyRecord) => normalizePayrollEmployeeKey(rowName(row)) === employeeKey;
    const payrollIndex = payrollRows.findIndex(matches);
    const leaderboardIndex = leaderboardRows.findIndex(matches);
    const source = payrollIndex >= 0
      ? payrollRows[payrollIndex]
      : leaderboardIndex >= 0
        ? leaderboardRows[leaderboardIndex]
        : { name: correction.employeeName, is_salary: false };
    const sync = syncForCorrection(correction);
    const projected = correctedPayrollRow(source, date, correction, sync);

    if (payrollIndex >= 0) payrollRows[payrollIndex] = projected;
    else payrollRows.push(projected);

    // Keep an existing leaderboard row's performance attributes intact while
    // replacing its stale private payroll fields. Do not add missed shifts to
    // the shared performance roster solely because a correction exists.
    if (leaderboardIndex >= 0) {
      leaderboardRows[leaderboardIndex] = correctedPayrollRow(
        leaderboardRows[leaderboardIndex],
        date,
        correction,
        sync,
      );
    }
  }

  corrected.payroll_records = payrollRows;
  if (Array.isArray(metrics.employee_leaderboard)) corrected.employee_leaderboard = leaderboardRows;
  return corrected;
}
