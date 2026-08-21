import fs from "fs";
import path from "path";
import { completedJobs, type AnyRecord } from "@/lib/opsData";
import { chicagoDateKey } from "@/lib/report-dates";

export type FinalNumbersSummary = {
  date: string;
  generatedAt: string;
  crewCount: number;
  appointmentCount: number;
  completedJobCount: number;
  estimateCount: number;
  addOnCount: number;
  cancelCount: number;
  unclosedCount: number;
  revenue: number;
  tips: number;
  crewHours: number;
  averageJob: number;
  revenuePerCrewHour: number;
  laborPercent: number;
};

export type FinalNumbersEvaluation = {
  ready: boolean;
  reasons: string[];
  summary: FinalNumbersSummary | null;
};

function finiteNumber(value: unknown): number {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function rowClockIn(row: AnyRecord): string {
  return String(row?.clock_in || row?.time_in || "").trim();
}

function rowClockOut(row: AnyRecord): string {
  return String(row?.clock_out || row?.time_out || "").trim();
}

function isAttendanceRow(row: AnyRecord): boolean {
  const shiftStatus = String(row?.shift_status || "").toLowerCase();
  return Boolean(
    rowClockIn(row)
    || rowClockOut(row)
    || finiteNumber(row?.hours_worked ?? row?.hours) > 0
    || row?.is_clocked_in
    || /on shift|clocked out|missing clock/.test(shiftStatus),
  );
}

function isClockedOut(row: AnyRecord): boolean {
  const shiftStatus = String(row?.shift_status || "").toLowerCase();
  return Boolean(rowClockOut(row))
    && !row?.is_clocked_in
    && (shiftStatus.includes("clocked out") || !shiftStatus);
}

function appointmentStatus(row: AnyRecord): string {
  return String(row?.job_status || row?.status || row?.final_status || "").trim().toLowerCase();
}

function isTerminalAppointment(row: AnyRecord): boolean {
  return /complete|closed|cancel/.test(appointmentStatus(row));
}

function isCompletedJob(row: AnyRecord): boolean {
  const type = String(row?.appointment_type || row?.type || "").toLowerCase();
  return !type.includes("estimate") && /complete|closed/.test(appointmentStatus(row));
}

function junkwareInputsAreVerified(metrics: AnyRecord): boolean {
  const attendance = metrics?.attendance_input;
  const inputs = metrics?.inputs;
  const missing: string[] = Array.isArray(inputs?.missing) ? inputs.missing.map(String) : [];
  const required = [inputs?.junkware_raw, inputs?.junkware_completed_summary, inputs?.junkware_employee_summary];
  return attendance?.available === true
    && attendance?.verified === true
    && required.every((value) => String(value || "").trim())
    && !missing.some((value) => value.toLowerCase().includes("junkware"));
}

export function readJunkwareCancelCount(metrics: AnyRecord | null): number | null {
  const relativePath = String(metrics?.inputs?.junkware_raw || "").replace(/^\/+/, "");
  if (!relativePath) return null;

  const roots = [
    process.cwd(),
    path.join(process.cwd(), "..", "opsbot"),
    path.join(process.env.HOME || "", ".openclaw", "workspace", "opsbot"),
  ];

  for (const root of roots) {
    try {
      const payload = JSON.parse(fs.readFileSync(path.join(root, relativePath), "utf8"));
      if (!Array.isArray(payload?.cancelled)) return null;
      const identities = new Set(
        payload.cancelled.map((row: AnyRecord, index: number) =>
          String(row?.appt_id || row?.appointment_id || row?.job_id || `row:${index}`),
        ),
      );
      return identities.size;
    } catch {
      // Try the next supported OpsCenter data root.
    }
  }

  return null;
}

export function evaluateFinalNumbers(
  metrics: AnyRecord | null,
  date: string,
  options?: { now?: Date; maxAgeMinutes?: number; addOnCount?: number; cancelCount?: number | null },
): FinalNumbersEvaluation {
  const reasons: string[] = [];
  const now = options?.now || new Date();
  const maxAgeMinutes = Math.max(1, finiteNumber(options?.maxAgeMinutes) || 20);

  if (!metrics) {
    return { ready: false, reasons: ["Daily metrics are unavailable."], summary: null };
  }

  if (String(metrics?.date || "") !== date) reasons.push("The daily metrics date does not match the alert date.");
  if (date !== chicagoDateKey(now)) reasons.push("Final numbers only post for the current Chicago business date.");
  if (!junkwareInputsAreVerified(metrics)) reasons.push("JunkWare schedule and attendance inputs are not fully verified.");

  const generatedAt = String(metrics?.generated_at || metrics?.payroll_as_of || "").trim();
  const generatedTime = Date.parse(generatedAt);
  if (!generatedAt || !Number.isFinite(generatedTime)) {
    reasons.push("The daily metrics snapshot has no valid generated timestamp.");
  } else {
    const ageMinutes = (now.getTime() - generatedTime) / 60_000;
    if (ageMinutes > maxAgeMinutes) reasons.push(`The daily metrics snapshot is older than ${maxAgeMinutes} minutes.`);
    if (ageMinutes < -5) reasons.push("The daily metrics snapshot timestamp is in the future.");
  }

  const rawCrewRows = Array.isArray(metrics?.employee_leaderboard)
    ? metrics.employee_leaderboard
    : Array.isArray(metrics?.payroll_records)
      ? metrics.payroll_records
      : [];
  const crewRows = rawCrewRows.filter((row: AnyRecord) => isAttendanceRow(row));
  if (!crewRows.length) reasons.push("No worked crew shifts are available yet.");
  const openShifts = crewRows.filter((row: AnyRecord) => !isClockedOut(row));
  if (openShifts.length) reasons.push(`${openShifts.length} crew shift${openShifts.length === 1 ? " is" : "s are"} not clocked out.`);

  const appointments = Array.isArray(metrics?.appointments) ? metrics.appointments : [];
  if (!appointments.length) reasons.push("No appointments are available for the day.");
  const openAppointments = appointments.filter((row: AnyRecord) => !isTerminalAppointment(row));
  if (openAppointments.length) reasons.push(`${openAppointments.length} appointment${openAppointments.length === 1 ? " is" : "s are"} not closed out.`);

  const completedJobRows = appointments.filter((row: AnyRecord) => isCompletedJob(row));
  const estimateCount = appointments.filter((row: AnyRecord) =>
    String(row?.appointment_type || row?.type || "").toLowerCase().includes("estimate"),
  ).length;
  const completedJobCount = completedJobs(metrics) || completedJobRows.length;
  const addOnCount = Math.max(0, Math.round(finiteNumber(options?.addOnCount)));
  const cancelCount = options?.cancelCount;
  const revenue = finiteNumber(metrics?.total_revenue ?? metrics?.gross_revenue ?? metrics?.sales);
  const tips = finiteNumber(metrics?.total_tips ?? metrics?.tips);
  const payrollValue = metrics?.total_payroll ?? metrics?.payroll;
  const payroll = finiteNumber(payrollValue);
  const crewHours = crewRows.reduce(
    (sum: number, row: AnyRecord) => sum + finiteNumber(row?.hours_worked ?? row?.hours),
    0,
  );

  if (completedJobCount < 1) reasons.push("No completed jobs are available for the final summary.");
  if (cancelCount == null || !Number.isFinite(cancelCount) || cancelCount < 0) reasons.push("JunkWare cancellation totals are unavailable.");
  if (revenue < 0) reasons.push("Daily revenue is invalid.");
  if (crewHours <= 0) reasons.push("Crew hours are unavailable for the final summary.");
  if (payrollValue == null || payroll < 0) reasons.push("Final payroll is unavailable for the labor percentage.");

  if (reasons.length) return { ready: false, reasons, summary: null };

  return {
    ready: true,
    reasons: [],
    summary: {
      date,
      generatedAt,
      crewCount: crewRows.length,
      appointmentCount: appointments.length,
      completedJobCount,
      estimateCount,
      addOnCount,
      cancelCount: cancelCount || 0,
      unclosedCount: openAppointments.length,
      revenue,
      tips,
      crewHours,
      averageJob: completedJobCount > 0 ? revenue / completedJobCount : 0,
      revenuePerCrewHour: crewHours > 0 ? revenue / crewHours : 0,
      laborPercent: Number.isFinite(Number(metrics?.payroll_percentage_of_revenue))
        ? Number(metrics.payroll_percentage_of_revenue)
        : revenue > 0
          ? (payroll / revenue) * 100
          : 0,
    },
  };
}
