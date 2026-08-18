import fs from "fs";
import path from "path";
import type { AnyRecord } from "@/lib/opsData";

export type CrewClockRecord = {
  name: string;
  timeIn: string;
  timeOut?: string;
  trucks?: string;
  hours?: string;
  missingPunch?: string;
  pay?: string;
};

export type DailyCrewSnapshot = {
  crew: AnyRecord[];
  crewCount: number;
  rankedCount: number;
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
export function workedOrAttributedToJobToday(row: AnyRecord, attendance?: { timeIn?: unknown }): boolean {
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

/**
 * The one daily-Crew contract shared by Command and the Crew workspace.
 * A person belongs only when JunkWare records a clock-in or the day's source
 * data explicitly attributes a job to them. `rankedCount` deliberately uses
 * the same eligible set, even when a compact view displays only the top rows.
 */
export function dailyCrewSnapshot(rows: AnyRecord[], clockRows: CrewClockRecord[]): DailyCrewSnapshot {
  const crew = rows.filter((row) =>
    workedOrAttributedToJobToday(
      row,
      crewClockRowForEmployee(String(row.name || row.employee || row.employee_name || ""), clockRows),
    ),
  );
  return { crew, crewCount: crew.length, rankedCount: crew.length };
}

export function normalizeCrewEmployeeKey(name: string): string {
  const raw = String(name || "").trim().toLowerCase();
  if (!raw.includes(",")) return raw;

  const parts = raw.split(",").map((part) => part.trim()).filter(Boolean);
  return parts.length === 2 ? `${parts[1]} ${parts[0]}`.toLowerCase() : raw;
}

function splitCsvLine(line: string): string[] {
  const values: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];
    if (char === '"' && inQuotes && next === '"') {
      current += '"';
      index += 1;
    } else if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === "," && !inQuotes) {
      values.push(current);
      current = "";
    } else {
      current += char;
    }
  }

  values.push(current);
  return values.map((value) => value.trim());
}

/** Read the one JunkWare clock source used to decide who belongs in daily Crew. */
export function readCrewClockRows(date: string): CrewClockRecord[] {
  const filePath = path.join(
    process.cwd(),
    "data",
    "history",
    "junkware",
    `junkware_employees_${date}_summary.csv`,
  );
  if (!fs.existsSync(filePath)) return [];

  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return [];
  const headers = splitCsvLine(lines[0]).map((header) => header.trim());

  return lines.slice(1).map((line) => {
    const values = splitCsvLine(line);
    const row: AnyRecord = {};
    headers.forEach((header, index) => { row[header] = values[index] || ""; });
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

export function crewClockRowForEmployee(name: string, rows: CrewClockRecord[]): CrewClockRecord | undefined {
  const key = normalizeCrewEmployeeKey(name);
  return rows.find((row) => {
    const rowKey = normalizeCrewEmployeeKey(row.name);
    const directKey = String(row.name || "").trim().toLowerCase();
    return rowKey === key || directKey === key;
  });
}
