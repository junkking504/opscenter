import fs from "fs";
import path from "path";
import { applyManualBonusesToMetrics } from "@/lib/manual-bonuses";
import { addDays, chicagoDateKey } from "@/lib/report-dates";

export type AnyRecord = Record<string, any>;

export function money(value: unknown): string {
  const n = Number(value || 0);
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function num(value: unknown): string {
  return Number(value || 0).toLocaleString("en-US");
}

export function todayIso(): string {
  return chicagoDateKey();
}

export function metricsDirs(): string[] {
  return [
    path.join(process.cwd(), "data", "history", "daily_metrics"),
    path.join(process.cwd(), "..", "opsbot", "data", "history", "daily_metrics"),
    path.join(
      process.env.HOME || "",
      ".openclaw",
      "workspace",
      "opsbot",
      "data",
      "history",
      "daily_metrics"
    ),
  ];
}

export function availableDates(): string[] {
  const found = new Set<string>();

  for (const dir of metricsDirs()) {
    try {
      if (!fs.existsSync(dir)) continue;

      for (const file of fs.readdirSync(dir)) {
        const match = file.match(/^daily_metrics_(\d{4}-\d{2}-\d{2})\.json$/);
        if (match) found.add(match[1]);
      }
    } catch {}
  }

  const dates = Array.from(found).sort().reverse();
  return dates.length ? dates : [todayIso()];
}

export function resolveDate(searchParams?: AnyRecord, options?: { allowTomorrow?: boolean }): string {
  const dates = availableDates();
  const raw = searchParams?.date;
  if (typeof raw === "string" && /^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    if (dates.includes(raw)) return raw;
    if (options?.allowTomorrow && raw === addDays(chicagoDateKey(), 1)) return raw;
  }
  return dates[0] || todayIso();
}

function applyAppointmentAssignmentOverrides(metrics: AnyRecord | null, date: string): AnyRecord | null {
  if (!metrics) return null;
  const overrideFile = path.join(process.cwd(), "data", "driver-assignment-overrides.json");
  try {
    if (!fs.existsSync(overrideFile)) return metrics;
    const overrides = JSON.parse(fs.readFileSync(overrideFile, "utf8"));
    const dateOverrides = overrides?.[date];
    if (!dateOverrides || !Array.isArray(metrics?.appointments)) return metrics;

    const excludedAppointmentIds = new Set<string>();
    for (const override of Object.values(dateOverrides) as AnyRecord[]) {
      for (const appointmentId of override?.excluded_appointment_ids || []) {
        excludedAppointmentIds.add(String(appointmentId));
      }
    }
    if (excludedAppointmentIds.size === 0) return metrics;

    return {
      ...metrics,
      appointments: metrics.appointments.map((appointment: AnyRecord) => {
        const appointmentId = String(appointment?.appt_id || appointment?.appointment_id || "");
        if (!excludedAppointmentIds.has(appointmentId)) return appointment;
        return {
          ...appointment,
          truck: "",
          assigned_truck: "",
          truck_number: "",
          truck_assignment_status: "Manual - unassigned",
        };
      }),
    };
  } catch {
    return metrics;
  }
}

function applyStandingDriverAttributionRules(metrics: AnyRecord | null): AnyRecord | null {
  if (!metrics || !Array.isArray(metrics.appointments)) return metrics;

  const appointments = metrics.appointments.map((appointment: AnyRecord) => {
    const address = String(appointment?.service_address || appointment?.address || "").toLowerCase();
    const driver = String(
      appointment?.driver_normalized_name || appointment?.driver_name || appointment?.driver || ""
    ).toLowerCase();
    const isAmazonMattress = address.includes("amazon") && address.includes("mattress");
    const isRobbie = driver.includes("robert mclaughlin") || driver.includes("mclaughlin, robert");
    if (!isAmazonMattress || !isRobbie) return appointment;

    return {
      ...appointment,
      driver: "",
      driver_name: "",
      driver_normalized_name: "",
      driver_assignment_excluded: true,
      driver_assignment_exclusion_reason: "Amazon Mattress closeout by Robert McLaughlin is not a truck-driving assignment.",
    };
  });

  return { ...metrics, appointments };
}

export function readMetrics(date: string): AnyRecord | null {
  for (const dir of metricsDirs()) {
    const file = path.join(dir, `daily_metrics_${date}.json`);
    try {
      if (fs.existsSync(file)) {
        const metrics = JSON.parse(fs.readFileSync(file, "utf8"));
        return applyAppointmentAssignmentOverrides(
          applyStandingDriverAttributionRules(applyManualBonusesToMetrics(metrics, date)),
          date
        );
      }
    } catch {}
  }

  return null;
}

export function crewRows(metrics: AnyRecord | null): AnyRecord[] {
  const rows =
    metrics?.employee_leaderboard ||
    metrics?.employees ||
    metrics?.crew ||
    [];

  const sourceRows = Array.isArray(rows) ? rows : [];
  const creditedRevenue = metrics?.credited_revenue_by_employee;
  if (!creditedRevenue || typeof creditedRevenue !== "object" || Array.isArray(creditedRevenue)) {
    return sourceRows;
  }

  const normalizeName = (value: unknown): string => {
    const raw = String(value || "").trim();
    const parts = raw.split(",").map((part) => part.trim()).filter(Boolean);
    const display = parts.length === 2 ? `${parts[1]} ${parts[0]}` : raw;
    return display.replace(/\s+/g, " ").trim().toLowerCase();
  };

  const credits = new Map<string, { name: string; revenue: number }>();
  for (const [name, rawRevenue] of Object.entries(creditedRevenue)) {
    const normalizedName = normalizeName(name);
    const revenue = Number(rawRevenue);
    if (!normalizedName || !Number.isFinite(revenue)) continue;
    credits.set(normalizedName, { name, revenue });
  }

  const seen = new Set<string>();
  const reconciledRows = sourceRows.map((row) => {
    const name = row?.name || row?.employee_name || row?.employee || row?.crew_member || "";
    const normalizedName = normalizeName(name);
    if (normalizedName) seen.add(normalizedName);

    const credit = credits.get(normalizedName);
    if (!credit) return row;

    return {
      ...row,
      revenue_generated: credit.revenue,
      individual_revenue: credit.revenue,
      credited_revenue: credit.revenue,
    };
  });

  for (const [normalizedName, credit] of credits) {
    if (seen.has(normalizedName)) continue;
    reconciledRows.push({
      name: credit.name,
      revenue_generated: credit.revenue,
      individual_revenue: credit.revenue,
      credited_revenue: credit.revenue,
      jobs_completed: 0,
      truck: "Unassigned",
      trucks: [],
    });
  }

  return reconciledRows;
}

function normalizedEmployeeName(value: unknown): string {
  const raw = String(value || "").trim();
  const parts = raw.split(",").map((part) => part.trim()).filter(Boolean);
  const display = parts.length === 2 ? `${parts[1]} ${parts[0]}` : raw;
  return display.replace(/\s+/g, " ").trim().toLowerCase();
}

/**
 * Full value of the unique completed jobs an employee worked on. Unlike
 * credited revenue, this is not divided between the people on the crew.
 */
export function employeeJobRevenueWorked(row: AnyRecord, metrics?: AnyRecord | null): number {
  const employee = normalizedEmployeeName(
    row?.name || row?.employee_name || row?.employee || row?.crew_member || "",
  );
  const audit = Array.isArray(metrics?.crew_credit_audit) ? metrics.crew_credit_audit : [];
  if (employee && audit.length) {
    const seenJobs = new Set<string>();
    let total = 0;
    for (const job of audit) {
      const creditedPeople = Array.isArray(job?.credited_people) ? job.credited_people : [];
      const credited = creditedPeople.some(
        (person: AnyRecord) => normalizedEmployeeName(person?.name) === employee,
      );
      if (!credited) continue;
      const key = String(job?.job_id || job?.appt_id || `${job?.truck || ""}|${job?.revenue || ""}`);
      if (seenJobs.has(key)) continue;
      seenJobs.add(key);
      total += Number(job?.revenue || 0);
    }
    if (seenJobs.size > 0) return Math.round(total * 100) / 100;
  }

  const breakdown = Array.isArray(row?.truck_revenue_breakdown) ? row.truck_revenue_breakdown : [];
  if (breakdown.length) {
    const seenJobs = new Set<string>();
    let total = 0;
    for (const job of breakdown) {
      const key = String(job?.job_id || job?.appt_id || `${job?.truck || ""}|${job?.job_revenue || ""}`);
      if (seenJobs.has(key)) continue;
      seenJobs.add(key);
      total += Number(job?.job_revenue ?? job?.revenue ?? 0);
    }
    return Math.round(total * 100) / 100;
  }

  return Number(
    row?.individual_revenue ?? row?.revenue_generated ?? row?.credited_revenue ?? row?.revenue ?? 0,
  ) || 0;
}

export function truckRows(metrics: AnyRecord | null): AnyRecord[] {
  const revenueByTruck = metrics?.revenue_by_truck || {};
  const jobsByTruck = metrics?.jobs_by_truck || {};
  const expensesByTruck = metrics?.expenses_by_truck || {};
  const laborHoursByTruck = metrics?.labor_hours_by_truck || {};

  const trucks = new Set<string>([
    ...Object.keys(revenueByTruck),
    ...Object.keys(jobsByTruck),
    ...Object.keys(expensesByTruck),
    ...Object.keys(laborHoursByTruck),
  ]);

  return Array.from(trucks)
    .sort()
    .map((truck) => {
      const revenue = Number(revenueByTruck[truck] || 0);
      const jobs = Number(jobsByTruck[truck] || 0);
      const expenses = Number(
        expensesByTruck?.[truck]?.total ||
        expensesByTruck?.[truck]?.total_expenses ||
        expensesByTruck?.[truck] ||
        0
      );

      return {
        truck,
        revenue,
        jobs,
        expenses,
        laborHours: Number(laborHoursByTruck[truck] || 0),
        net: revenue - expenses,
        averageJobSize: jobs > 0 ? revenue / jobs : 0,
      };
    });
}

export function marketRows(metrics: AnyRecord | null): AnyRecord[] {
  const byMarket = metrics?.revenue_by_market || {};
  return Object.keys(byMarket)
    .sort()
    .map((market) => ({
      market,
      revenue: Number(byMarket[market] || 0),
    }));
}

export function completedJobs(metrics: AnyRecord | null): number {
  const direct = metrics?.completed_jobs ?? metrics?.jobs_completed;
  if (direct !== undefined) return Number(direct || 0);

  return Object.values(metrics?.jobs_by_truck || {}).reduce(
    (sum: number, v: any) => sum + Number(v || 0),
    0
  );
}
