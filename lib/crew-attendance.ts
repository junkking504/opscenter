import type { AnyRecord } from "@/lib/opsData";

type ClockRecord = {
  timeIn?: unknown;
};

function hasValue(value: unknown): boolean {
  return String(value || "").trim().length > 0;
}

function hasAttributedJob(row: AnyRecord): boolean {
  const jobCounts = [
    row?.appointments_attended,
    row?.completed_jobs,
    row?.jobs_completed,
    row?.credited_jobs_count,
  ];
  if (jobCounts.some((value) => Number(value) > 0)) return true;

  return [
    row?.attended_appointment_ids,
    row?.completed_appointment_ids,
    row?.credited_jobs,
    row?.truck_revenue_breakdown,
  ].some((value) => Array.isArray(value) && value.length > 0);
}

/**
 * Daily crew means employees with a recorded clock-in or explicit job
 * attribution. Roster-only rows and revenue alone do not establish that an
 * employee worked; job IDs/counts do, including for salaried crew with no
 * hourly-pay record.
 */
export function workedOrAttributedToJobToday(row: AnyRecord, attendance?: ClockRecord): boolean {
  const hasClockIn = [
    attendance?.timeIn,
    row?.clock_in,
    row?.time_in,
    row?.clockIn,
    row?.timeIn,
    row?.clock_in_display,
  ].some(hasValue);

  return hasClockIn || hasAttributedJob(row);
}
