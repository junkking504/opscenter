import fs from "fs";
import path from "path";
import { unstable_noStore as noStore } from "next/cache";
import { readMetrics, type AnyRecord } from "@/lib/opsData";
import { chicagoClockToDate } from "@/lib/live-pay";
import { isClosedAppointment, isEstimateAppointment, shouldFlagMissingPaymentType } from "@/lib/job-audit-rules";
import { money } from "@/lib/money";

export type ExceptionSeverity = "critical" | "warning" | "info";
export type ExceptionCategory = "Crew" | "Jobs" | "Fleet" | "Finance";
export type ExceptionEntityType = "employee" | "job" | "truck" | "finance";

export type OperationalException = {
  id: string;
  rule: string;
  category: ExceptionCategory;
  severity: ExceptionSeverity;
  entityType: ExceptionEntityType;
  entityId: string;
  entityLabel: string;
  title: string;
  reason: string;
  source: string;
  timestamp: string;
  href?: string;
};

export type OperationalExceptionsReport = {
  date: string;
  asOf: string;
  asOfLabel: string;
  total: number;
  counts: {
    severity: Record<ExceptionSeverity, number>;
    category: Record<ExceptionCategory, number>;
  };
  exceptions: OperationalException[];
};

const SALARIED_EMPLOYEES = new Set(["Robert McLaughlin", "Eugene Dabezies", "Branden Dozier"]);
const ALLOWED_RATE_STATUSES = new Set(["verified_current", "verified", "approved_fallback", "verified_fallback", "fallback_verified", "fallback_approved", "approved"]);

function roots(): string[] {
  return [
    process.cwd(),
    path.join(process.cwd(), "..", "opsbot"),
    path.join(process.env.HOME || "", ".openclaw", "workspace", "opsbot"),
  ];
}

function resolveHistoryPath(relativePath: string): string | null {
  const clean = String(relativePath || "").replace(/^\/+/, "");
  if (!clean) return null;

  for (const root of roots()) {
    const candidate = path.join(root, clean);
    if (fs.existsSync(candidate)) return candidate;
  }

  return null;
}

function readJsonFile<T = AnyRecord>(relativePath: string): T | null {
  const resolved = resolveHistoryPath(relativePath);
  if (!resolved) return null;

  try {
    return JSON.parse(fs.readFileSync(resolved, "utf8")) as T;
  } catch {
    return null;
  }
}

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

function formatTimestamp(value: Date | string | null | undefined): string {
  if (!value) return "Unavailable";

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "Unavailable";

  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(date);
}

function chicagoNow(): Date {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(new Date());

  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return new Date(
    Number(values.year),
    Number(values.month) - 1,
    Number(values.day),
    Number(values.hour),
    Number(values.minute),
    Number(values.second),
  );
}

function num(value: unknown): number {
  if (value === undefined || value === null || value === "") return 0;
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const cleaned = String(value).replace(/[^0-9.-]/g, "");
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : 0;
}

function moneyToNumber(value: unknown): number {
  return num(value);
}

function normalizeTruckLabel(value: unknown): string {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const normalized = raw.replace(/\s+/g, " ");
  if (/^virtual truck$/i.test(normalized)) return "Virtual Truck";
  if (/^unassigned$/i.test(normalized)) return "Unassigned";
  const match = normalized.match(/(\d+)/);
  return match ? `Truck# ${match[1]}` : normalized;
}

function normalizeEmployeeName(value: unknown): string {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const comma = raw.split(",").map((part) => part.trim()).filter(Boolean);
  if (comma.length === 2) return `${comma[1]} ${comma[0]}`;
  return raw.replace(/\s+/g, " ");
}

function normalizeEmployeeKey(value: unknown): string {
  return normalizeEmployeeName(value).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

// Delegates to the one canonical formatter (`@/lib/money`) instead of
// reimplementing it — see the 2026-08-21 data-consistency audit. Keeps the
// local `num()` normalization (handles strings like "$1,234.56") since that
// behavior is specific to this file's inputs, not part of the formatter.
function formatMoney(value: unknown): string {
  return money(num(value));
}

function parseAppointmentWindow(date: string, value: unknown): { start: Date | null; end: Date | null } | null {
  const raw = String(value || "").trim();
  if (!raw) return null;

  const match = raw.match(/(\d{1,2}:\d{2}\s*[AP]M)\s*(?:-|–|—|to)\s*(\d{1,2}:\d{2}\s*[AP]M)/i);
  if (!match) return null;

  const start = chicagoClockToDate(date, match[1]);
  const end = chicagoClockToDate(date, match[2]);
  return { start, end };
}

function addException(
  exceptions: OperationalException[],
  seen: Set<string>,
  exception: OperationalException,
): void {
  const key = `${exception.category}|${exception.rule}|${exception.entityType}|${exception.entityId}`;
  if (seen.has(key)) return;
  seen.add(key);
  exceptions.push(exception);
}

function rowName(row: AnyRecord): string {
  return String(row?.name || row?.employee || row?.employee_name || "Unknown");
}

function rowTruck(row: AnyRecord): string {
  return normalizeTruckLabel(row?.truck || row?.trucks || row?.assigned_truck || row?.truck_name || "");
}

function rowRateStatus(row: AnyRecord): string {
  return String(row?.rate_status || row?.hourly_rate_status || row?.status || "").trim();
}

function rowRateSource(row: AnyRecord): string {
  return String(row?.rate_source || row?.hourly_rate_source || "").trim();
}

function rowClockIn(row: AnyRecord): string {
  return String(row?.clock_in || row?.time_in || row?.clockIn || row?.timeIn || "").trim();
}

function rowClockOut(row: AnyRecord): string {
  return String(row?.clock_out || row?.time_out || row?.clockOut || row?.timeOut || "").trim();
}

function isCompletedStatus(value: unknown): boolean {
  const raw = String(value || "").toLowerCase();
  return raw.includes("completed") || raw.includes("closed") || raw.includes("paid");
}

function isCanceledStatus(value: unknown): boolean {
  const raw = String(value || "").toLowerCase();
  return raw.includes("cancel");
}

function currentMetrics(date: string): AnyRecord {
  return readMetrics(date) || {};
}

function appointmentById(apps: AnyRecord[]): Map<string, AnyRecord> {
  const map = new Map<string, AnyRecord>();
  for (const appt of apps) {
    const apptId = String(appt?.appt_id || appt?.appointment_id || appt?.appointmentId || "").trim();
    if (apptId) map.set(apptId, appt);
  }
  return map;
}

function completedAppointmentIdsFromAttendance(metrics: AnyRecord): Set<string> {
  const ids = new Set<string>();
  for (const row of Array.isArray(metrics?.attendance_employee_metrics) ? metrics.attendance_employee_metrics : []) {
    for (const id of Array.isArray(row?.completed_appointment_ids) ? row.completed_appointment_ids : []) {
      ids.add(String(id));
    }
  }
  return ids;
}

function crewNameMap(metrics: AnyRecord): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  const sources: Array<unknown[]> = [
    Array.isArray(metrics?.employee_leaderboard) ? metrics.employee_leaderboard.map((row: AnyRecord) => rowName(row)) : [],
    Array.isArray(metrics?.attendance_employee_metrics) ? metrics.attendance_employee_metrics.map((row: AnyRecord) => String(row?.employee || "")) : [],
    Array.isArray(metrics?.crew_credit_audit)
      ? metrics.crew_credit_audit.flatMap((entry: AnyRecord) => (Array.isArray(entry?.credited_people) ? entry.credited_people.map((person: AnyRecord) => String(person?.name || "")) : []))
      : [],
    metrics?.driver_score_by_employee ? Object.keys(metrics.driver_score_by_employee) : [],
  ];

  for (const names of sources) {
    for (const raw of names) {
      const canonical = normalizeEmployeeKey(raw);
      if (!canonical || !raw) continue;
      if (!map.has(canonical)) map.set(canonical, new Set());
      map.get(canonical)!.add(String(raw).trim());
    }
  }

  return map;
}

function getLocationPayload(date: string): AnyRecord | null {
  const rel = path.join("data", "history", "linxup", `linxup_location_${date}.json`);
  return readJsonFile<AnyRecord>(rel);
}

function getAppointmentVisits(date: string): AnyRecord[] {
  const rel = path.join("data", "history", "linxup", "appointment_visits", `linxup_appointment_visits_${date}.json`);
  const payload = readJsonFile<AnyRecord>(rel);
  return Array.isArray(payload?.visits) ? payload.visits : [];
}

function getTruckPointMap(locationPayload: AnyRecord | null): Map<string, AnyRecord[]> {
  const map = new Map<string, AnyRecord[]>();
  for (const point of Array.isArray(locationPayload?.points) ? locationPayload.points : []) {
    const truck = normalizeTruckLabel(point?.truck_number || point?.truck || point?.truckNumber);
    if (!truck) continue;
    if (!map.has(truck)) map.set(truck, []);
    map.get(truck)!.push(point);
  }
  for (const points of map.values()) {
    points.sort((a, b) => String(a?.timestamp || "").localeCompare(String(b?.timestamp || "")));
  }
  return map;
}

function latestGpsTimestamp(points: AnyRecord[]): string | null {
  if (!points.length) return null;
  return String(points[points.length - 1]?.timestamp || null) || null;
}

function hasRealTruckLabel(value: unknown): boolean {
  const raw = String(value || "").trim();
  if (!raw) return false;
  return /truck\s*#?\s*\d+/i.test(raw) || /^truck\s*\d+/i.test(raw);
}

function crewExceptions(metrics: AnyRecord, date: string): OperationalException[] {
  const exceptions: OperationalException[] = [];
  const seen = new Set<string>();
  const crewRows = Array.isArray(metrics?.employee_leaderboard) ? metrics.employee_leaderboard : [];
  const attendanceRows = Array.isArray(metrics?.attendance_employee_metrics) ? metrics.attendance_employee_metrics : [];
  const attendanceByName = new Map<string, AnyRecord>();
  for (const row of attendanceRows) {
    const key = normalizeEmployeeKey(row?.employee);
    if (key) attendanceByName.set(key, row);
  }
  const namesSeen = crewNameMap(metrics);

  for (const row of crewRows) {
    const name = rowName(row);
    const key = normalizeEmployeeKey(name);
    const hours = num(row?.hours_worked ?? row?.hours);
    const hourlyPay = num(row?.hourly_pay);
    const tips = num(row?.tip ?? row?.tips);
    const dailyBonus = num(row?.daily_bonus ?? row?.bonus ?? row?.total_bonus);
    const supplemental = num(row?.supplemental_daily_pay);
    const totalPay = num(row?.total_pay);
    const expected = SALARIED_EMPLOYEES.has(name)
      ? dailyBonus + tips + supplemental
      : hourlyPay + tips + dailyBonus + supplemental;
    const truck = rowTruck(row);
    const clockIn = rowClockIn(row);
    const clockOut = rowClockOut(row);
    const isSalary = Boolean(row?.is_salary) || SALARIED_EMPLOYEES.has(name);
    const rateStatus = rowRateStatus(row).toLowerCase();
    const rateSource = rowRateSource(row).toLowerCase();
    const hourlyRate = row?.hourly_rate;
    const jobs = num(row?.jobs_completed ?? row?.jobs);
    const revenue = num(row?.individual_revenue ?? row?.revenue_generated ?? row?.revenue);

    if (!isSalary && row?.is_clocked_in) {
      if (!truck || truck === "Unassigned") {
        addException(exceptions, seen, {
          id: `crew-${key}-clocked-in-unassigned`,
          rule: "employee_clocked_in_but_not_assigned_to_truck",
          category: "Crew",
          severity: "critical",
          entityType: "employee",
          entityId: key || name,
          entityLabel: name,
          title: "Clocked in without a truck",
          reason: `${name} is clocked in but the current truck assignment is ${truck || "missing"}.`,
          source: `daily_metrics.employee_leaderboard[${name}]`,
          timestamp: row?.payroll_as_of || row?.generated_at || row?.clock_in || metrics?.payroll_as_of || metrics?.generated_at || chicagoNow().toISOString(),
          href: `/crew/${encodeURIComponent(name)}?date=${date}`,
        });
      }
    }

    if (!isSalary && hours > 0 && (!hourlyRate || !Number.isFinite(Number(hourlyRate)))) {
      addException(exceptions, seen, {
        id: `crew-${key}-missing-rate`,
        rule: "active_hourly_employee_missing_verified_or_fallback_rate",
        category: "Crew",
        severity: "critical",
        entityType: "employee",
        entityId: key || name,
        entityLabel: name,
        title: "Missing verified hourly rate",
        reason: `${name} has worked ${hours.toFixed(2)} hours but the current hourly rate is missing.`,
        source: `daily_metrics.employee_leaderboard[${name}]`,
        timestamp: row?.payroll_as_of || row?.generated_at || metrics?.payroll_as_of || metrics?.generated_at || chicagoNow().toISOString(),
        href: `/crew/${encodeURIComponent(name)}?date=${date}`,
      });
    } else if (!isSalary && hours > 0 && !ALLOWED_RATE_STATUSES.has(rateStatus) && !ALLOWED_RATE_STATUSES.has(rateSource)) {
      addException(exceptions, seen, {
        id: `crew-${key}-fallback-rate`,
        rule: "active_hourly_employee_missing_verified_or_fallback_rate",
        category: "Crew",
        severity: "warning",
        entityType: "employee",
        entityId: key || name,
        entityLabel: name,
        title: "Hourly rate is not verified",
        reason: `${name} has a rate value, but the recorded rate status is ${rowRateStatus(row) || "missing"}.`,
        source: `daily_metrics.employee_leaderboard[${name}]`,
        timestamp: row?.payroll_as_of || row?.generated_at || metrics?.payroll_as_of || metrics?.generated_at || chicagoNow().toISOString(),
        href: `/crew/${encodeURIComponent(name)}?date=${date}`,
      });
    }

    if (!isSalary && hours > 0 && hourlyPay <= 0) {
      addException(exceptions, seen, {
        id: `crew-${key}-zero-hourly-pay`,
        rule: "employee_with_hours_but_zero_hourly_pay",
        category: "Crew",
        severity: "critical",
        entityType: "employee",
        entityId: key || name,
        entityLabel: name,
        title: "Hours recorded with zero hourly pay",
        reason: `${name} logged ${hours.toFixed(2)} hours but hourly pay is ${formatMoney(hourlyPay)}.`,
        source: `daily_metrics.employee_leaderboard[${name}]`,
        timestamp: row?.payroll_as_of || row?.generated_at || metrics?.payroll_as_of || metrics?.generated_at || chicagoNow().toISOString(),
        href: `/crew/${encodeURIComponent(name)}?date=${date}`,
      });
    }

    if (jobs > 0 && revenue <= 0) {
      addException(exceptions, seen, {
        id: `crew-${key}-zero-revenue`,
        rule: "employee_with_jobs_but_zero_credited_revenue",
        category: "Crew",
        severity: "warning",
        entityType: "employee",
        entityId: key || name,
        entityLabel: name,
        title: "Jobs credited with no revenue",
        reason: `${name} has ${jobs.toFixed(0)} credited jobs but no credited revenue.`,
        source: `daily_metrics.employee_leaderboard[${name}]`,
        timestamp: row?.payroll_as_of || row?.generated_at || metrics?.payroll_as_of || metrics?.generated_at || chicagoNow().toISOString(),
        href: `/crew/${encodeURIComponent(name)}?date=${date}`,
      });
    }

    if ((row?.is_clocked_in || String(row?.shift_status || "").toLowerCase().includes("on shift")) && !clockOut) {
      addException(exceptions, seen, {
        id: `crew-${key}-missing-clock-out`,
        rule: "missing_clock_out",
        category: "Crew",
        severity: "warning",
        entityType: "employee",
        entityId: key || name,
        entityLabel: name,
        title: "Missing clock-out",
        reason: `${name} has a clock-in of ${clockIn || "Unavailable"} but no clock-out has been captured.`,
        source: `daily_metrics.employee_leaderboard[${name}]`,
        timestamp: row?.payroll_as_of || row?.generated_at || clockIn || metrics?.payroll_as_of || metrics?.generated_at || chicagoNow().toISOString(),
        href: `/crew/${encodeURIComponent(name)}?date=${date}`,
      });
    }

    if (Math.abs(totalPay - expected) > 0.01) {
      addException(exceptions, seen, {
        id: `crew-${key}-earnings-mismatch`,
        rule: "stored_total_earnings_does_not_match_formula",
        category: "Crew",
        severity: "critical",
        entityType: "employee",
        entityId: key || name,
        entityLabel: name,
        title: "Stored total earnings mismatch",
        reason: `${name} stores ${formatMoney(totalPay)} but the authoritative formula resolves to ${formatMoney(expected)}.`,
        source: `daily_metrics.employee_leaderboard[${name}]`,
        timestamp: row?.payroll_as_of || row?.generated_at || metrics?.payroll_as_of || metrics?.generated_at || chicagoNow().toISOString(),
        href: `/crew/${encodeURIComponent(name)}?date=${date}`,
      });
    }

    if (isSalary && (num(row?.hourly_pay) > 0 || num(row?.hourly_rate) > 0)) {
      addException(exceptions, seen, {
        id: `crew-${key}-salary-as-hourly`,
        rule: "salaried_employee_incorrectly_treated_as_hourly",
        category: "Crew",
        severity: "critical",
        entityType: "employee",
        entityId: key || name,
        entityLabel: name,
        title: "Salaried employee treated as hourly",
        reason: `${name} is salaried but still has hourly pay or an hourly rate value recorded.`,
        source: `daily_metrics.employee_leaderboard[${name}]`,
        timestamp: row?.payroll_as_of || row?.generated_at || metrics?.payroll_as_of || metrics?.generated_at || chicagoNow().toISOString(),
        href: `/crew/${encodeURIComponent(name)}?date=${date}`,
      });
    }

    const variants = namesSeen.get(key);
    if (variants && variants.size > 1) {
      addException(exceptions, seen, {
        id: `crew-${key}-name-conflict`,
        rule: "duplicate_or_conflicting_employee_name_matches",
        category: "Crew",
        severity: "warning",
        entityType: "employee",
        entityId: key || name,
        entityLabel: name,
        title: "Conflicting employee name matches",
        reason: `${name} appears under multiple raw spellings: ${Array.from(variants).join(" / ")}.`,
        source: `daily_metrics.employee_leaderboard`,
        timestamp: row?.payroll_as_of || row?.generated_at || metrics?.payroll_as_of || metrics?.generated_at || chicagoNow().toISOString(),
        href: `/crew/${encodeURIComponent(name)}?date=${date}`,
      });
    }

    // Keep the rule available even when no exception is generated; that is intentional.
    void attendanceByName.get(key);
  }

  const attendanceNames = new Set(attendanceRows.map((row) => normalizeEmployeeKey(row?.employee)));
  for (const job of Array.isArray(metrics?.crew_credit_audit) ? metrics.crew_credit_audit : []) {
    const jobId = String(job?.job_id || job?.jk_number || job?.appointment_id || "");
    for (const person of Array.isArray(job?.credited_people) ? job.credited_people : []) {
      const name = String(person?.name || "").trim();
      const key = normalizeEmployeeKey(name);
      if (!name || !key || attendanceNames.has(key)) continue;
      addException(exceptions, seen, {
        id: `crew-${key}-missing-attendance-${jobId}`,
        rule: "employee_assigned_to_job_but_missing_from_attendance",
        category: "Crew",
        severity: "critical",
        entityType: "employee",
        entityId: key || name,
        entityLabel: name,
        title: "Credited on a job but missing from attendance",
        reason: `${name} is credited on ${jobId || "a job"} but is missing from the attendance roster.`,
        source: `daily_metrics.crew_credit_audit`,
        timestamp: metrics?.generated_at || metrics?.payroll_as_of || chicagoNow().toISOString(),
        href: `/crew/${encodeURIComponent(name)}?date=${date}`,
      });
    }
  }

  return exceptions;
}

function jobsExceptions(metrics: AnyRecord, date: string): OperationalException[] {
  const exceptions: OperationalException[] = [];
  const seen = new Set<string>();
  const appointments = Array.isArray(metrics?.appointments) ? metrics.appointments : [];
  const apptById = appointmentById(appointments);
  const completedIds = completedAppointmentIdsFromAttendance(metrics);
  const now = chicagoNow();
  const duplicateApptIds = new Map<string, AnyRecord[]>();
  const duplicateJkNumbers = new Map<string, AnyRecord[]>();

  for (const appt of appointments) {
    const apptId = String(appt?.appt_id || appt?.appointment_id || "").trim();
    const jkNumber = String(appt?.job_id || appt?.jk_number || "").trim();
    if (apptId) {
      if (!duplicateApptIds.has(apptId)) duplicateApptIds.set(apptId, []);
      duplicateApptIds.get(apptId)!.push(appt);
    }
    if (jkNumber) {
      if (!duplicateJkNumbers.has(jkNumber)) duplicateJkNumbers.set(jkNumber, []);
      duplicateJkNumbers.get(jkNumber)!.push(appt);
    }

    const appointmentType = String(appt?.appointment_type || appt?.type || "").trim();
    const status = String(appt?.job_status || appt?.status || "").trim();
    const truck = normalizeTruckLabel(appt?.truck || appt?.assigned_truck || "");
    const driver = String(appt?.driver || "").trim();
    const navigator = String(appt?.navigator || "").trim();
    const customerName = String(appt?.customer_name || appt?.customerName || "").trim();
    const address = String(appt?.service_address || appt?.address || appt?.customerAddress || "").trim();
    const phone = String(appt?.customer_phone || appt?.phone || appt?.customerPhone || "").trim();
    const time = String(appt?.appointment_time || appt?.scheduled_time || "").trim();
    const revenue = moneyToNumber(appt?.revenue || appt?.payment_amount);
    const paymentType = String(appt?.payment_type || appt?.paymentType || "").trim();
    const completedLike = isCompletedStatus(status);
    const canceled = isCanceledStatus(status);
    const window = parseAppointmentWindow(date, time);

    if (completedLike && /estimate/i.test(appointmentType) && !driver) {
      // Closed estimates are legitimate; only flag a completed estimate if it lacks a crew record entirely.
      // This is intentionally conservative.
    }

    if (completedLike && !/estimate/i.test(appointmentType) && !driver) {
      addException(exceptions, seen, {
        id: `jobs-${apptId || jkNumber}-completed-no-driver`,
        rule: "completed_job_with_no_driver",
        category: "Jobs",
        severity: "critical",
        entityType: "job",
        entityId: apptId || jkNumber || `${jkNumber}-${appointmentType}`,
        entityLabel: jkNumber || apptId || "Appointment",
        title: "Completed job missing driver",
        reason: `${jkNumber || apptId || "Appointment"} is completed but no driver is recorded.`,
        source: `daily_metrics.appointments`,
        timestamp: metrics?.generated_at || chicagoNow().toISOString(),
        href: appt?.appointmentUrl || `/jobs?date=${date}`,
      });
    }

    if (completedLike && !/estimate/i.test(appointmentType) && !navigator) {
      addException(exceptions, seen, {
        id: `jobs-${apptId || jkNumber}-completed-no-navigator`,
        rule: "completed_job_with_no_navigator",
        category: "Jobs",
        severity: "warning",
        entityType: "job",
        entityId: apptId || jkNumber || `${jkNumber}-${appointmentType}`,
        entityLabel: jkNumber || apptId || "Appointment",
        title: "Completed job missing navigator",
        reason: `${jkNumber || apptId || "Appointment"} is completed but no navigator is recorded.`,
        source: `daily_metrics.appointments`,
        timestamp: metrics?.generated_at || chicagoNow().toISOString(),
        href: appt?.appointmentUrl || `/jobs?date=${date}`,
      });
    }

    if (completedLike && truck && /^Virtual Truck$/i.test(truck)) {
      addException(exceptions, seen, {
        id: `jobs-${apptId || jkNumber}-virtual-truck`,
        rule: "completed_job_assigned_to_virtual_truck",
        category: "Jobs",
        severity: "critical",
        entityType: "job",
        entityId: apptId || jkNumber || `${jkNumber}-${appointmentType}`,
        entityLabel: jkNumber || apptId || "Appointment",
        title: "Completed job assigned to Virtual Truck",
        reason: `${jkNumber || apptId || "Appointment"} is completed while still assigned to Virtual Truck.`,
        source: `daily_metrics.appointments`,
        timestamp: metrics?.generated_at || chicagoNow().toISOString(),
        href: appt?.appointmentUrl || `/jobs?date=${date}`,
      });
    }

    if (revenue > 0 && !String(appt?.crew || "").trim() && !driver && !navigator) {
      addException(exceptions, seen, {
        id: `jobs-${apptId || jkNumber}-revenue-no-crew`,
        rule: "job_with_revenue_but_no_credited_crew",
        category: "Jobs",
        severity: "warning",
        entityType: "job",
        entityId: apptId || jkNumber || `${jkNumber}-${appointmentType}`,
        entityLabel: jkNumber || apptId || "Appointment",
        title: "Revenue without credited Krewe",
        reason: `${jkNumber || apptId || "Appointment"} has ${formatMoney(revenue)} in revenue but no credited Krewe is recorded.`,
        source: `daily_metrics.appointments`,
        timestamp: metrics?.generated_at || chicagoNow().toISOString(),
        href: appt?.appointmentUrl || `/jobs?date=${date}`,
      });
    }

    if (time && window?.end && !completedLike && !canceled && window.end.getTime() < now.getTime()) {
      addException(exceptions, seen, {
        id: `jobs-${apptId || jkNumber}-open-past-window`,
        rule: "open_appointment_past_scheduled_window",
        category: "Jobs",
        severity: "warning",
        entityType: "job",
        entityId: apptId || jkNumber || `${jkNumber}-${appointmentType}`,
        entityLabel: jkNumber || apptId || "Appointment",
        title: "Open appointment past scheduled window",
        reason: `${jkNumber || apptId || "Appointment"} was scheduled for ${time} and is still open after its window closed.`,
        source: `daily_metrics.appointments`,
        timestamp: window.end.toISOString(),
        href: appt?.appointmentUrl || `/jobs?date=${date}`,
      });
    }

    if (!customerName || !address || !phone || !time) {
      addException(exceptions, seen, {
        id: `jobs-${apptId || jkNumber}-missing-customer-fields`,
        rule: "missing_customer_information",
        category: "Jobs",
        severity: "critical",
        entityType: "job",
        entityId: apptId || jkNumber || `${jkNumber}-${appointmentType}`,
        entityLabel: jkNumber || apptId || "Appointment",
        title: "Missing customer or schedule fields",
        reason: `${jkNumber || apptId || "Appointment"} is missing ${[
          !customerName ? "customer name" : null,
          !address ? "address" : null,
          !phone ? "phone" : null,
          !time ? "appointment time" : null,
        ].filter(Boolean).join(", ")}.`,
        source: `daily_metrics.appointments`,
        timestamp: metrics?.generated_at || chicagoNow().toISOString(),
        href: appt?.appointmentUrl || `/jobs?date=${date}`,
      });
    }

    if (shouldFlagMissingPaymentType({ appointmentType, status, paymentAmount: revenue, paymentType })) {
      addException(exceptions, seen, {
        id: `jobs-${apptId || jkNumber}-payment-type-missing`,
        rule: "payment_amount_present_but_payment_type_missing",
        category: "Jobs",
        severity: "warning",
        entityType: "job",
        entityId: apptId || jkNumber || `${jkNumber}-${appointmentType}`,
        entityLabel: jkNumber || apptId || "Appointment",
        title: "Payment type missing",
        reason: `${jkNumber || apptId || "Appointment"} has a payment amount but no payment type.`,
        source: `daily_metrics.appointments`,
        timestamp: metrics?.generated_at || chicagoNow().toISOString(),
        href: appt?.appointmentUrl || `/jobs?date=${date}`,
      });
    }

    if (!completedLike && completedIds.has(apptId) && !/estimate/i.test(appointmentType)) {
      addException(exceptions, seen, {
        id: `jobs-${apptId || jkNumber}-counted-completed`,
        rule: "estimate_or_open_job_incorrectly_counted_as_completed",
        category: "Jobs",
        severity: "critical",
        entityType: "job",
        entityId: apptId || jkNumber || `${jkNumber}-${appointmentType}`,
        entityLabel: jkNumber || apptId || "Appointment",
        title: "Open job counted as completed",
        reason: `${jkNumber || apptId || "Appointment"} appears in completed appointment IDs even though it is not completed.`,
        source: `daily_metrics.attendance_employee_metrics`,
        timestamp: metrics?.generated_at || chicagoNow().toISOString(),
        href: appt?.appointmentUrl || `/jobs?date=${date}`,
      });
    }
  }

  for (const [id, rows] of duplicateApptIds.entries()) {
    if (rows.length > 1) {
      addException(exceptions, seen, {
        id: `jobs-duplicate-appt-${id}`,
        rule: "duplicate_appointment_id",
        category: "Jobs",
        severity: "critical",
        entityType: "job",
        entityId: id,
        entityLabel: id,
        title: "Duplicate appointment ID",
        reason: `${id} appears ${rows.length} times in today's appointment roster.`,
        source: `daily_metrics.appointments`,
        timestamp: metrics?.generated_at || chicagoNow().toISOString(),
        href: `/jobs?date=${date}`,
      });
    }
  }

  for (const [jk, rows] of duplicateJkNumbers.entries()) {
    if (rows.length > 1) {
      addException(exceptions, seen, {
        id: `jobs-duplicate-jk-${jk}`,
        rule: "duplicate_jk_number",
        category: "Jobs",
        severity: "critical",
        entityType: "job",
        entityId: jk,
        entityLabel: jk,
        title: "Duplicate JK number",
        reason: `${jk} appears ${rows.length} times in today's appointment roster.`,
        source: `daily_metrics.appointments`,
        timestamp: metrics?.generated_at || chicagoNow().toISOString(),
        href: `/jobs?date=${date}`,
      });
    }
  }

  return exceptions;
}

function junkwarePhotoExceptions(date: string): OperationalException[] {
  const payload = readJsonFile<AnyRecord>(path.join("data", "history", "junkware", `junkware_${date}_raw.json`));
  const completedRows = Array.isArray(payload?.completed) ? payload.completed : [];
  const closedEstimateRows = (Array.isArray(payload?.appointments) ? payload.appointments : []).filter((row: AnyRecord) => {
    const appointmentType = String(row?.final_appointment_type || row?.appointment_type || "");
    const status = String(row?.final_status || row?.job_status || row?.status || "");
    return isEstimateAppointment(appointmentType) && isClosedAppointment(status);
  });
  const exceptions: OperationalException[] = [];
  const seen = new Set<string>();

  for (const row of [...completedRows, ...closedEstimateRows]) {
    if (!row || typeof row !== "object" || !Object.prototype.hasOwnProperty.call(row, "photos")) continue;
    const photos = Array.isArray(row?.photos) ? row.photos : [];
    if (photos.length) continue;

    const apptId = String(row?.appt_id || row?.appointment_id || "").trim();
    const jkNumber = String(row?.job_id || row?.jk_number || "").trim();
    const reference = jkNumber || apptId || "Appointment";
    const cardReference = reference.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase();
    addException(exceptions, seen, {
      id: `jobs-${apptId || jkNumber}-completed-no-photos`,
      rule: "completed_job_with_no_closeout_photos",
      category: "Jobs",
      severity: "warning",
      entityType: "job",
      entityId: apptId || jkNumber || reference,
      entityLabel: jkNumber || apptId || "Appointment",
      title: "Closed Appointment Missing Photos",
      reason: `${reference} is closed, but JunkWare has no uploaded appointment photos.`,
      source: `data/history/junkware/junkware_${date}_raw.json`,
      timestamp: String(row?.collection_timestamp || payload?.collection_timestamp || chicagoNow().toISOString()),
      href: `/jobs?date=${date}#job-${cardReference}`,
    });
  }

  return exceptions;
}

function whatsappPhotoReviewExceptions(date: string): OperationalException[] {
  const configured = String(process.env.WHATSAPP_JOB_PHOTO_STATE_DIR || "").trim();
  const reviewDirectory = configured
    ? path.join(configured, "review")
    : resolveHistoryPath(path.join("data", "integrations", "whatsapp-job-photos", "review"));
  if (!reviewDirectory || !fs.existsSync(reviewDirectory)) return [];
  const exceptions: OperationalException[] = [];
  for (const fileName of fs.readdirSync(reviewDirectory).filter((name) => /^[a-f0-9]{64}\.json$/.test(name)).sort()) {
    try {
      const payload = JSON.parse(fs.readFileSync(path.join(reviewDirectory, fileName), "utf8"));
      const receivedAt = String(payload.receivedAt || payload.outcomeAt || "");
      const parsed = new Date(receivedAt);
      if (Number.isNaN(parsed.getTime())) continue;
      const receivedDate = new Intl.DateTimeFormat("en-CA", {
        timeZone: "America/Chicago",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(parsed);
      if (receivedDate !== date) continue;
      const jkNumber = String(payload.match?.jkNumber || "").trim();
      const reason = String(payload.review?.detail || "WhatsApp photo matching or upload needs operator review.").trim();
      const entityId = jkNumber || `whatsapp-${fileName.slice(0, 12)}`;
      exceptions.push({
        id: `jobs-whatsapp-photo-${fileName.slice(0, 20)}`,
        rule: "whatsapp_job_photo_needs_review",
        category: "Jobs",
        severity: "warning",
        entityType: "job",
        entityId,
        entityLabel: jkNumber || "Unmatched WhatsApp photo",
        title: "WhatsApp job photo needs review",
        reason,
        source: "whatsapp-job-photos.review",
        timestamp: receivedAt,
        href: `/jobs?date=${date}`,
      });
    } catch {
      continue;
    }
  }
  return exceptions;
}

function fleetExceptions(metrics: AnyRecord, date: string): OperationalException[] {
  const exceptions: OperationalException[] = [];
  const seen = new Set<string>();
  const appointments = Array.isArray(metrics?.appointments) ? metrics.appointments : [];
  const truckRows = Array.isArray(metrics?.truck_performance) ? metrics.truck_performance : [];
  const locationPayload = getLocationPayload(date);
  const truckPoints = getTruckPointMap(locationPayload);
  const now = chicagoNow();

  const truckUsage = new Map<string, { appointments: number; revenue: number; hasPerformanceRow: boolean }>();
  const activeTrucks = new Set<string>();

  for (const appt of appointments) {
    const truck = normalizeTruckLabel(appt?.truck || appt?.assigned_truck || "");
    if (!hasRealTruckLabel(truck)) continue;
    if (!truckUsage.has(truck)) truckUsage.set(truck, { appointments: 0, revenue: 0, hasPerformanceRow: false });
    const entry = truckUsage.get(truck)!;
    entry.appointments += 1;
    entry.revenue += moneyToNumber(appt?.revenue || appt?.payment_amount);
    activeTrucks.add(truck);
  }

  for (const row of truckRows) {
    const truck = normalizeTruckLabel(row?.truck);
    if (!hasRealTruckLabel(truck)) continue;
    if (!truckUsage.has(truck)) truckUsage.set(truck, { appointments: 0, revenue: 0, hasPerformanceRow: true });
    truckUsage.get(truck)!.hasPerformanceRow = true;
    activeTrucks.add(truck);
  }

  for (const truck of Array.from(activeTrucks)) {
    const points = truckPoints.get(truck) || [];
    const usage = truckUsage.get(truck);

    if (!points.length && usage && usage.appointments > 0) {
      addException(exceptions, seen, {
        id: `fleet-${truck}-missing-gps`,
        rule: "truck_assigned_to_jobs_but_missing_gps_data",
        category: "Fleet",
        severity: "critical",
        entityType: "truck",
        entityId: truck,
        entityLabel: truck,
        title: "Truck assigned to jobs but missing GPS data",
        reason: `${truck} has ${usage.appointments} appointment(s) today but no Linxup location points were recorded.`,
        source: `data/history/linxup/linxup_location_${date}.json`,
        timestamp: locationPayload?.collection_timestamp || metrics?.generated_at || chicagoNow().toISOString(),
        href: `/fleet?date=${date}&truck=${encodeURIComponent(truck)}`,
      });
    } else if (!points.length && usage && usage.hasPerformanceRow) {
      addException(exceptions, seen, {
        id: `fleet-${truck}-active-no-location`,
        rule: "active_truck_with_no_linxup_location",
        category: "Fleet",
        severity: "critical",
        entityType: "truck",
        entityId: truck,
        entityLabel: truck,
        title: "Active truck with no Linxup location",
        reason: `${truck} is active in daily metrics but no Linxup coordinates were returned.`,
        source: `data/history/linxup/linxup_location_${date}.json`,
        timestamp: locationPayload?.collection_timestamp || metrics?.generated_at || chicagoNow().toISOString(),
        href: `/fleet?date=${date}&truck=${encodeURIComponent(truck)}`,
      });
    }

    if (points.length) {
      const latest = String(points[points.length - 1]?.timestamp || "");
      const latestDate = new Date(latest);
      if (!Number.isNaN(latestDate.getTime())) {
        const ageMinutes = (now.getTime() - latestDate.getTime()) / 60000;
        if (ageMinutes > 20) {
          addException(exceptions, seen, {
            id: `fleet-${truck}-gps-stale`,
            rule: "gps_timestamp_older_than_20_minutes",
            category: "Fleet",
            severity: ageMinutes > 120 ? "critical" : "warning",
            entityType: "truck",
            entityId: truck,
            entityLabel: truck,
            title: "GPS timestamp is stale",
            reason: `${truck} last reported GPS ${formatTimestamp(latestDate)} (${ageMinutes.toFixed(0)} minutes ago).`,
            source: `data/history/linxup/linxup_location_${date}.json`,
            timestamp: latest,
            href: `/fleet?date=${date}&truck=${encodeURIComponent(truck)}`,
          });
        }
      }
    }
  }

  const driverWindows = new Map<string, Array<{ truck: string; start: Date | null; end: Date | null }>>();
  for (const row of truckRows) {
    const truck = normalizeTruckLabel(row?.truck);
    const assignedDrivers = Array.isArray(row?.assigned_drivers)
      ? row.assigned_drivers.map((name: unknown) => String(name || "").trim()).filter(Boolean)
      : String(row?.assigned_driver || "").trim()
        ? [String(row.assigned_driver).trim()]
        : [];
    const windows = Array.isArray(row?.assignment_windows) ? row.assignment_windows : [];
    for (const driver of assignedDrivers) {
      if (!driver) continue;
      if (!driverWindows.has(driver)) driverWindows.set(driver, []);
      if (windows.length) {
        for (const window of windows) {
          const start = window?.start ? new Date(String(window.start)) : null;
          const end = window?.end ? new Date(String(window.end)) : null;
          driverWindows.get(driver)!.push({ truck, start, end });
        }
      }
    }
  }
  for (const [driver, windows] of driverWindows.entries()) {
    for (let i = 0; i < windows.length; i += 1) {
      for (let j = i + 1; j < windows.length; j += 1) {
        const a = windows[i];
        const b = windows[j];
        if (!a.start || !a.end || !b.start || !b.end) continue;
        const overlap = a.start.getTime() < b.end.getTime() && b.start.getTime() < a.end.getTime();
        if (overlap && a.truck !== b.truck) {
          addException(exceptions, seen, {
            id: `fleet-${normalizeEmployeeKey(driver)}-overlap-${i}-${j}`,
            rule: "driver_assigned_to_more_than_one_truck_at_same_time",
            category: "Fleet",
            severity: "warning",
            entityType: "employee",
            entityId: normalizeEmployeeKey(driver) || driver,
            entityLabel: driver,
            title: "Driver assigned to overlapping trucks",
            reason: `${driver} has overlapping assignment windows on ${windows[i].truck} and ${windows[j].truck}.`,
            source: `daily_metrics.truck_performance`,
            timestamp: a.start.toISOString(),
            href: `/fleet?date=${date}&truck=${encodeURIComponent(a.truck)}`,
          });
        }
      }
    }
  }

  const driverScores = Array.isArray(metrics?.employee_driver_scores) ? metrics.employee_driver_scores : [];
  for (const row of driverScores) {
    const truckRevenue = num(row?.revenue);
    const truckJobs = num(row?.jobs_completed);
    const truck = normalizeTruckLabel(row?.truck);
    if (truckRevenue > 0 && truckJobs <= 0) {
      addException(exceptions, seen, {
        id: `fleet-${truck}-revenue-no-jobs`,
        rule: "truck_revenue_exists_without_corresponding_job_records",
        category: "Fleet",
        severity: "warning",
        entityType: "truck",
        entityId: truck,
        entityLabel: truck,
        title: "Truck revenue without job records",
        reason: `${truck} has ${formatMoney(truckRevenue)} in revenue but no corresponding job records are present in the truck score data.`,
        source: `daily_metrics.employee_driver_scores`,
        timestamp: metrics?.generated_at || chicagoNow().toISOString(),
        href: `/fleet?date=${date}&truck=${encodeURIComponent(truck)}`,
      });
    }
  }

  return exceptions;
}

function financeExceptions(metrics: AnyRecord, date: string): OperationalException[] {
  const exceptions: OperationalException[] = [];
  const seen = new Set<string>();
  const revenueByTruck = metrics?.revenue_by_truck && typeof metrics.revenue_by_truck === "object" ? (metrics.revenue_by_truck as Record<string, unknown>) : {};
  const revenueFromJobs = Object.values(revenueByTruck).reduce((sum: number, value) => sum + num(value), 0);
  const totalRevenue = num(metrics?.total_revenue ?? metrics?.sales ?? 0);
  const dump = num(metrics?.dump_expense ?? 0);
  const fuel = num(metrics?.fuel_expense ?? 0);
  const other = num(metrics?.other_expense ?? 0);
  const payroll = num(metrics?.total_payroll ?? metrics?.payroll ?? 0);
  const bonuses = num(metrics?.daily_bonus_payroll ?? metrics?.bonuses ?? 0);
  const junkKingRoyalties = num(metrics?.junk_king_royalties ?? 0);
  const callCenterRoyalties = num(metrics?.call_center_royalties ?? 0);
  const totalExpenses = num(metrics?.total_expenses ?? 0);
  const computedExpenses = dump + fuel + other + payroll + junkKingRoyalties + callCenterRoyalties;
  const payrollPct = totalRevenue > 0 ? (payroll / totalRevenue) * 100 : null;
  const storedPayrollPct = metrics?.payroll_percentage_of_revenue == null ? null : Number(metrics.payroll_percentage_of_revenue);

  if (Math.abs(totalRevenue - revenueFromJobs) > 0.01) {
    addException(exceptions, seen, {
      id: `finance-revenue-mismatch-${date}`,
      rule: "revenue_total_does_not_match_summed_job_revenue",
      category: "Finance",
      severity: "critical",
      entityType: "finance",
      entityId: date,
      entityLabel: date,
      title: "Revenue total does not match job revenue",
      reason: `Daily revenue is ${formatMoney(totalRevenue)} but summed truck revenue is ${formatMoney(revenueFromJobs)}.`,
      source: `daily_metrics.appointments`,
      timestamp: metrics?.generated_at || chicagoNow().toISOString(),
      href: `/finance?date=${date}`,
    });
  }

  if (Math.abs(totalExpenses - computedExpenses) > 0.01) {
    addException(exceptions, seen, {
      id: `finance-expense-mismatch-${date}`,
      rule: "expense_total_does_not_match_summed_expense_categories",
      category: "Finance",
      severity: "critical",
      entityType: "finance",
      entityId: date,
      entityLabel: date,
      title: "Expense total does not match categories",
      reason: `Stored expenses are ${formatMoney(totalExpenses)} but the summed operating categories equal ${formatMoney(computedExpenses)}.`,
      source: `daily_metrics.finance`,
      timestamp: metrics?.generated_at || chicagoNow().toISOString(),
      href: `/finance?date=${date}`,
    });
  }

  if (Math.abs(payroll - num(metrics?.total_payroll ?? metrics?.payroll ?? 0)) > 0.01) {
    addException(exceptions, seen, {
      id: `finance-payroll-total-mismatch-${date}`,
      rule: "payroll_expense_does_not_match_total_payroll",
      category: "Finance",
      severity: "critical",
      entityType: "finance",
      entityId: date,
      entityLabel: date,
      title: "Payroll Expense mismatch",
      reason: `Payroll Expense is ${formatMoney(payroll)} but the authoritative total_payroll is ${formatMoney(num(metrics?.total_payroll ?? metrics?.payroll ?? 0))}.`,
      source: `daily_metrics.total_payroll`,
      timestamp: metrics?.generated_at || chicagoNow().toISOString(),
      href: `/finance?date=${date}`,
    });
  }

  if (payrollPct !== null && storedPayrollPct !== null && Math.abs(storedPayrollPct - payrollPct) > 0.05) {
    addException(exceptions, seen, {
      id: `finance-payroll-percent-mismatch-${date}`,
      rule: "payroll_percentage_differs_from_formula",
      category: "Finance",
      severity: "warning",
      entityType: "finance",
      entityId: date,
      entityLabel: date,
      title: "Payroll percentage mismatch",
      reason: `Stored payroll percentage is ${storedPayrollPct.toFixed(1)}% but the formula resolves to ${payrollPct.toFixed(1)}%.`,
      source: `daily_metrics.payroll_percentage_of_revenue`,
      timestamp: metrics?.generated_at || chicagoNow().toISOString(),
      href: `/finance?date=${date}`,
    });
  }

  if (!Array.isArray(metrics?.truck_record_financial_rows) || !metrics.truck_record_financial_rows.length) {
    if (totalExpenses > 0 || totalRevenue > 0) {
      addException(exceptions, seen, {
        id: `finance-missing-expense-source-${date}`,
        rule: "missing_or_stale_expense_source_data",
        category: "Finance",
        severity: "warning",
        entityType: "finance",
        entityId: date,
        entityLabel: date,
        title: "Expense source data is missing",
        reason: "No truck-record financial rows are available for the selected date.",
        source: `daily_metrics.truck_record_financial_rows`,
        timestamp: metrics?.generated_at || chicagoNow().toISOString(),
        href: `/finance?date=${date}`,
      });
    }
  }

  return exceptions;
}

export function buildOperationalExceptions(date?: string | null): OperationalExceptionsReport {
  noStore();
  const resolvedDate = /^\d{4}-\d{2}-\d{2}$/.test(String(date || "")) ? String(date) : chicagoTodayIso();
  const metrics = currentMetrics(resolvedDate);
  const all: OperationalException[] = [
    ...crewExceptions(metrics, resolvedDate),
    ...jobsExceptions(metrics, resolvedDate),
    ...junkwarePhotoExceptions(resolvedDate),
    ...whatsappPhotoReviewExceptions(resolvedDate),
    ...fleetExceptions(metrics, resolvedDate),
    ...financeExceptions(metrics, resolvedDate),
  ];

  const sorted = all.sort((a, b) => {
    const severityRank: Record<ExceptionSeverity, number> = { critical: 0, warning: 1, info: 2 };
    const categoryRank: Record<ExceptionCategory, number> = { Crew: 0, Jobs: 1, Fleet: 2, Finance: 3 };
    return (
      severityRank[a.severity] - severityRank[b.severity] ||
      categoryRank[a.category] - categoryRank[b.category] ||
      a.title.localeCompare(b.title) ||
      a.entityLabel.localeCompare(b.entityLabel)
    );
  });

  const counts = {
    severity: { critical: 0, warning: 0, info: 0 } as Record<ExceptionSeverity, number>,
    category: { Crew: 0, Jobs: 0, Fleet: 0, Finance: 0 } as Record<ExceptionCategory, number>,
  };
  for (const exception of sorted) {
    counts.severity[exception.severity] += 1;
    counts.category[exception.category] += 1;
  }

  return {
    date: resolvedDate,
    asOf: String(metrics?.generated_at || metrics?.payroll_as_of || chicagoNow().toISOString()),
    asOfLabel: formatTimestamp(metrics?.generated_at || metrics?.payroll_as_of || chicagoNow().toISOString()),
    total: sorted.length,
    counts,
    exceptions: sorted,
  };
}
