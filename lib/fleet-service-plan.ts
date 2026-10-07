/** Shared, provider-free service calculations. No default maintenance intervals. */
export const fleetServiceTypes = [
  "Oil change",
  "Tires",
  "Brakes",
  "Inspection",
  "Engine",
  "Transmission",
  "Electrical",
  "Hydraulics",
  "Body / lift",
  "Other",
] as const;
export type FleetServiceInterval = {
  truck: string;
  serviceType: string;
  miles: number | null;
  months: number | null;
  enabled: boolean;
  updatedAt: string;
};
export type FleetMileage = {
  value: number | null;
  source: string;
  reportedAt: string;
  retrievedAt: string;
  estimated: number | null;
  conflicting: boolean;
  duplicate: boolean;
  inspectionHref?: string;
  inspectionDate?: string;
  note?: string;
  tracking?: { value: number | null; source: string; reportedAt: string };
};
export function mileageQuality(
  reading: FleetMileage | undefined,
  now = Date.now(),
): "unavailable" | "conflict" | "stale" | "estimated" | "current" {
  if (reading?.conflicting || reading?.duplicate) return "conflict";
  if (!reading || reading.value === null) return "unavailable";
  const at = Date.parse(reading.reportedAt),
    fetched = Date.parse(reading.retrievedAt);
  if (
    !Number.isFinite(at) ||
    !Number.isFinite(fetched) ||
    at > now + 300000 ||
    fetched > now + 300000 ||
    now - at > 86400000 ||
    now - fetched > 86400000
  )
    return "stale";
  return reading.source === "estimated" ? "estimated" : "current";
}
export function serviceMonthTarget(date: string, months: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const last = new Date(Date.UTC(y, m - 1 + months + 1, 0));
  return new Date(
    Date.UTC(last.getUTCFullYear(), last.getUTCMonth(), Math.min(d, last.getUTCDate())),
  )
    .toISOString()
    .slice(0, 10);
}
type ServiceRecord = {
  updatedAt?: string;
  recordId: string;
  serviceType: string;
  status: string;
  serviceDate: string;
  odometer: number | null;
  nextServiceDate: string;
  nextServiceOdometer: number | null;
};
export function servicePlan(
  serviceType: string,
  interval: FleetServiceInterval | undefined,
  records: ServiceRecord[],
  reading: FleetMileage | undefined,
  date: string,
  now = Date.now(),
) {
  const completed = records
    .filter(
      (r) => r.serviceType === serviceType && r.status === "completed" && r.serviceDate <= date,
    )
    .sort(
      (a, b) =>
        b.serviceDate.localeCompare(a.serviceDate) ||
        (b.updatedAt || "").localeCompare(a.updatedAt || "") ||
        b.recordId.localeCompare(a.recordId),
    )[0];
  const scheduled = records
    .filter((r) => r.serviceType === serviceType && r.status === "scheduled")
    .sort((a, b) => a.serviceDate.localeCompare(b.serviceDate))[0];
  const rule = interval?.enabled ? interval : undefined;
  const nextDate = completed
    ? completed.nextServiceDate ||
      (rule?.months ? serviceMonthTarget(completed.serviceDate, rule.months) : "")
    : "";
  const nextMiles = completed
    ? (completed.nextServiceOdometer ??
      (rule?.miles && completed.odometer !== null ? completed.odometer + rule.miles : null))
    : null;
  // An older coherent inspection can establish that a target was already passed,
  // but cannot establish miles still remaining today. Exclude observations before
  // the completed service or after the selected planning day.
  const inspectionDate = reading?.inspectionDate || (reading?.reportedAt ? new Date(reading.reportedAt).toLocaleDateString("en-CA", {timeZone:"America/Chicago"}) : "");
  const inspectionAt = reading ? Date.parse(reading.reportedAt) : NaN;
  const inspectionEvidence = reading?.source === "inspection" && !reading.conflicting && !reading.duplicate && reading.value !== null &&
    Number.isFinite(inspectionAt) && inspectionAt <= now && inspectionDate <= date &&
    completed && inspectionDate >= completed.serviceDate && (completed.odometer === null || reading.value >= completed.odometer);
  const usable = mileageQuality(reading, now) === "current" && (completed?.odometer == null || reading!.value! >= completed.odometer) && (reading?.source !== "inspection" || Boolean(inspectionEvidence));
  const inspectedDue = Boolean(inspectionEvidence && nextMiles !== null && reading!.value! >= nextMiles);
  const milesRemaining = nextMiles !== null && (usable || inspectedDue) ? nextMiles - reading!.value! : null;
  const daysRemaining = nextDate
    ? Math.round((Date.parse(nextDate + "T12:00:00Z") - Date.parse(date + "T12:00:00Z")) / 86400000)
    : null;
  const incomplete =
    Boolean(rule?.miles && (nextMiles === null || !usable)) ||
    Boolean(rule?.months && !nextDate) ||
    Boolean(nextMiles !== null && !usable);
  const status = !completed
    ? "baseline"
    : (daysRemaining !== null && daysRemaining <= 0) ||
        (milesRemaining !== null && milesRemaining <= 0)
      ? "due"
      : (daysRemaining !== null && daysRemaining <= 30) ||
          (milesRemaining !== null && milesRemaining <= 1000)
        ? "soon"
        : incomplete
          ? "unknown"
          : !nextDate && nextMiles === null
            ? "unset"
            : "current";
  return {
    serviceType,
    interval,
    completed,
    scheduled,
    nextDate,
    nextMiles,
    milesRemaining,
    mileageAsOf: reading?.source === "inspection" ? reading.reportedAt : undefined,
    daysRemaining,
    status,
    incomplete,
  };
}
