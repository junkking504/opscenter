import type { AnyRecord } from "@/lib/opsData";

type ClockRecord = {
  timeIn?: unknown;
};

/**
 * A crew member belongs in the daily crew view only when the selected day's
 * JunkWare attendance has an actual clock-in. Roster-only and inferred rows
 * can still be useful for payroll reconciliation, but they are not proof that
 * the employee worked that day.
 */
export function hasClockedInToday(row: AnyRecord, attendance?: ClockRecord): boolean {
  return [
    attendance?.timeIn,
    row?.clock_in,
    row?.time_in,
    row?.clockIn,
    row?.timeIn,
    row?.clock_in_display,
  ].some((value) => String(value || "").trim().length > 0);
}
