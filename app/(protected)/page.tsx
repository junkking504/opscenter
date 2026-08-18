import PageHeader from "@/components/PageHeader";
import OperatingInbox from "@/components/OperatingInbox";
import { resolveKernelDatabaseConfig } from "@/lib/platform/persistence/config";
import CommandBrief, {
  type CommandBriefMetric,
  type CommandBriefSignal,
} from "@/components/CommandBrief";
import OpsMonthSelector from "@/components/OpsMonthSelector";
import OperatingPulse, {
  type OperatingAction,
  type OperatingPulseItem,
  type OperatingStatus,
} from "@/components/OperatingPulse";
import {
  AnyRecord,
  availableDates,
  completedJobs,
  crewRows,
  employeeJobRevenueWorked,
  money,
  readMetrics,
  resolveDate,
  truckRows,
} from "@/lib/opsData";
import { buildMonthlySummary, monthOptions } from "@/lib/monthly-summary";
import { buildFleetDailyRecord } from "@/lib/fleet-history";
import { buildSearchKingsView } from "@/lib/searchkings";
import {
  dailyRevenueTarget,
  monthlyRevenueTarget,
  operatingTargets,
} from "@/lib/operating-targets";
import { readSlackDailyDigest } from "@/lib/slack-digest";
import { dailyCrewSnapshot, readCrewClockRows } from "@/lib/crew-attendance";

// This dashboard reads metrics directly from files that are refreshed
// throughout the day. Never reuse a rendered snapshot across requests.
export const dynamic = "force-dynamic";

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

function metricNumber(value: unknown): number | null {
  if (value === undefined || value === null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function employeeName(row: AnyRecord): string {
  return row.name || row.employee || row.employee_name || "Unknown";
}

function employeeTruck(row: AnyRecord): string {
  const truck = row.truck || row.trucks || row.assigned_truck || row.truck_name;
  if (Array.isArray(truck)) return truck.filter(Boolean).join(", ") || "Unassigned";
  return String(truck || "").trim() || "Unassigned";
}

function employeeRevenue(row: AnyRecord): number {
  return firstNumber(row, [
    "revenue_generated",
    "employee_revenue",
    "revenue",
    "credited_revenue",
    "total_revenue",
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

function employeeJobs(row: AnyRecord): number {
  return firstNumber(row, [
    "jobs_completed",
    "completed_jobs",
    "jobs",
  ]);
}

function employeeAverageJob(row: AnyRecord, metrics?: AnyRecord | null): number {
  const jobs = employeeJobs(row);
  return jobs > 0 ? employeeJobRevenueWorked(row, metrics) / jobs : 0;
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
  return firstNumber(row, [
    "profit_bonus",
    "profit_sharing_bonus",
    "employee_bonus",
    "bonus_pay",
    "daily_bonus",
    "bonus",
  ]);
}

function totalPay(row: AnyRecord): number {
  return hourlyPay(row) + tipPay(row) + bonusPay(row);
}

function normalizeView(value: unknown): "daily" | "monthly" {
  return String(value || "").toLowerCase() === "monthly" ? "monthly" : "daily";
}

function toNumber(value: unknown): number {
  const n = Number(value || 0);
  return Number.isFinite(n) ? n : 0;
}

const DASHBOARD_TERRITORIES = [
  "New Orleans",
  "Jefferson Parish",
  "Northshore",
  "Baton Rouge",
] as const;

type DashboardTerritory = (typeof DASHBOARD_TERRITORIES)[number];

function normalizeDashboardTerritory(value: unknown): DashboardTerritory | null {
  const normalized = String(value || "")
    .trim()
    .replace(/^junk\s+king\s+/i, "")
    .trim()
    .toLowerCase();

  if (normalized.includes("new orleans") || normalized === "no") return "New Orleans";
  if (normalized.includes("jefferson parish") || normalized === "jp") return "Jefferson Parish";
  if (normalized.includes("northshore") || normalized.includes("north shore")) return "Northshore";
  if (normalized.includes("baton rouge") || normalized === "br") return "Baton Rouge";

  // The legacy "Unknown territory" completed jobs in the published records are
  // Ponchatoula jobs, and their truck records already attribute them to Northshore.
  if (!normalized || normalized.includes("unknown")) return "Northshore";

  return null;
}

function sumTerritory(
  records: AnyRecord[],
  fallbackMetricKey: string,
  truckMetricKey: "sales" | "jobs",
): Map<string, number> {
  const totals = new Map<string, number>();

  for (const record of records) {
    const truckRows = Array.isArray(record?.truck_record_financial_rows)
      ? record.truck_record_financial_rows
      : [];

    if (truckRows.length > 0) {
      for (const row of truckRows) {
        const amount = toNumber(row?.[truckMetricKey]);
        if (!amount) continue;
        const territory = normalizeDashboardTerritory(row?.market);
        if (!territory) continue;
        totals.set(territory, (totals.get(territory) || 0) + amount);
      }
      continue;
    }

    const values = record?.[fallbackMetricKey];
    if (!values || typeof values !== "object") continue;

    for (const [rawTerritory, raw] of Object.entries(values as Record<string, unknown>)) {
      const amount = toNumber(raw);
      if (!amount) continue;
      const territory = normalizeDashboardTerritory(rawTerritory);
      if (!territory) continue;
      totals.set(territory, (totals.get(territory) || 0) + amount);
    }
  }

  return totals;
}

function monthComparisonLabel(current: number, previous: number): string {
  if (!Number.isFinite(current) || !Number.isFinite(previous) || previous === 0) return "Comparison unavailable";
  const delta = current - previous;
  const pct = (delta / previous) * 100;
  const sign = delta >= 0 ? "+" : "−";
  return `${sign}${money(Math.abs(delta))} · ${sign}${Math.abs(pct).toFixed(1)}%`;
}

function minimumStatus(value: number, target: number): OperatingStatus {
  if (value >= target) return "on-track";
  if (value >= target * 0.9) return "watch";
  return "off-track";
}

function maximumStatus(value: number, target: number): OperatingStatus {
  if (value <= target) return "on-track";
  if (value <= target * 1.15) return "watch";
  return "off-track";
}

function signedPercent(value: number): string {
  const sign = value >= 0 ? "+" : "−";
  return `${sign}${Math.abs(value).toFixed(1)}%`;
}

function shortMonthDay(date: string): string {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
  });
}

function renderMonthlyDashboard(date: string, requestedSection: string) {
  const section = ["overview", "territory", "comparison"].includes(requestedSection)
    ? requestedSection
    : "overview";
  const monthlySummary = buildMonthlySummary(date);
  const { range, entries, authority: monthlyAuthority } = monthlySummary;
  const previousAnchor = new Date(`${range.monthStart}T12:00:00Z`);
  previousAnchor.setUTCMonth(previousAnchor.getUTCMonth() - 1);
  const previousSummary = buildMonthlySummary(previousAnchor.toISOString().slice(0, 10));
  const previousEntries = previousSummary.entries;

  const grossRevenue = monthlySummary.grossRevenue;
  const completed = monthlySummary.completedJobs;
  const totalPayroll = entries.reduce((sum, entry) => sum + toNumber(entry.metrics.total_payroll ?? entry.metrics.payroll), 0);
  const totalOperatingProfit = entries.reduce((sum, entry) => sum + toNumber(entry.metrics.net_profit), 0);
  const averageJobSize = completed > 0 ? grossRevenue / completed : 0;
  const payrollPercentage = grossRevenue > 0 ? (totalPayroll / grossRevenue) * 100 : 0;
  const operatingMargin = grossRevenue > 0 ? (totalOperatingProfit / grossRevenue) * 100 : 0;
  const fleetRecords = range.dates.map((monthDate) => buildFleetDailyRecord(monthDate)).filter(Boolean);
  const activeTruckDays = fleetRecords.reduce((sum, record) => sum + Number(record?.activeTrucks || 0), 0);
  const territoryRevenue = sumTerritory(
    entries.map((entry) => entry.metrics),
    "revenue_by_market",
    "sales",
  );
  const territoryJobs = sumTerritory(
    entries.map((entry) => entry.metrics),
    "jobs_by_market",
    "jobs",
  );
  const territoryRows = DASHBOARD_TERRITORIES.filter(
    (territory) => territoryRevenue.has(territory) || territoryJobs.has(territory),
  );
  const latestData = entries[entries.length - 1]?.metrics || null;
  const previousGrossRevenue = previousSummary.grossRevenue;
  const previousJobs = previousSummary.completedJobs;
  const previousPayroll = previousEntries.reduce((sum, entry) => sum + toNumber(entry.metrics.total_payroll ?? entry.metrics.payroll), 0);
  const previousOperatingProfit = previousEntries.reduce((sum, entry) => sum + toNumber(entry.metrics.net_profit), 0);
  const [monthYear, monthNumber] = range.monthKey.split("-").map(Number);
  const calendarDaysInMonth = new Date(Date.UTC(monthYear, monthNumber, 0)).getUTCDate();
  const configuredMonthlyTarget = monthlyRevenueTarget();
  const revenueTarget = configuredMonthlyTarget > 0 ? configuredMonthlyTarget : previousGrossRevenue;
  const projectedRevenue = range.isCurrentMonth && entries.length > 0
    ? (grossRevenue / entries.length) * calendarDaysInMonth
    : grossRevenue;
  const projectedRevenueVariance = revenueTarget > 0 ? ((projectedRevenue - revenueTarget) / revenueTarget) * 100 : 0;
  const monthlyPulseItems: OperatingPulseItem[] = [
    {
      label: "Revenue performance",
      value: money(grossRevenue),
      valueLabel: range.isCurrentMonth
        ? `Actual through ${shortMonthDay(range.dataThroughDate)}`
        : "Actual month total",
      supportingValues: [
        {
          label: range.isCurrentMonth ? "Trending toward" : "Month-end total",
          value: money(projectedRevenue),
        },
        {
          label: "Last month actual",
          value: money(previousGrossRevenue),
        },
      ],
      target: configuredMonthlyTarget > 0 ? money(revenueTarget) : `${money(revenueTarget)} prior month`,
      detail: `${signedPercent(projectedRevenueVariance)} projected variance at the current published pace.`,
      status: minimumStatus(projectedRevenue, revenueTarget),
    },
    {
      label: "Payroll efficiency",
      value: `${payrollPercentage.toFixed(1)}%`,
      target: previousGrossRevenue > 0 ? `${((previousPayroll / previousGrossRevenue) * 100).toFixed(1)}% prior month` : `≤ ${operatingTargets.maxPayrollPercent.toFixed(0)}%`,
      detail: `${money(totalPayroll)} payroll against ${money(grossRevenue)} gross revenue.`,
      status: maximumStatus(payrollPercentage, operatingTargets.maxPayrollPercent),
    },
    {
      label: "Operating margin",
      value: `${operatingMargin.toFixed(1)}%`,
      target: previousGrossRevenue > 0 ? `${((previousOperatingProfit / previousGrossRevenue) * 100).toFixed(1)}% prior month` : `≥ ${operatingTargets.minOperatingMarginPercent.toFixed(0)}%`,
      detail: `${money(totalOperatingProfit)} estimated operating profit month to date.`,
      status: minimumStatus(operatingMargin, operatingTargets.minOperatingMarginPercent),
    },
    {
      label: "Average job size",
      value: money(averageJobSize),
      target: `≥ ${money(operatingTargets.averageJobSize)}`,
      detail: `${completed} completed job${completed === 1 ? "" : "s"} contributing to this month's production.`,
      status: minimumStatus(averageJobSize, operatingTargets.averageJobSize),
    },
  ];
  const monthlyActions: OperatingAction[] = [];
  if (projectedRevenue < revenueTarget) {
    monthlyActions.push({
      title: "Close the revenue run-rate gap",
      detail: `${money(revenueTarget - projectedRevenue)} projected monthly shortfall at the current pace.`,
      status: minimumStatus(projectedRevenue, revenueTarget),
      href: `/jobs?date=${date}`,
    });
  }
  if (payrollPercentage > operatingTargets.maxPayrollPercent) {
    monthlyActions.push({
      title: "Correct payroll leverage",
      detail: `${(payrollPercentage - operatingTargets.maxPayrollPercent).toFixed(1)} points above the operating ceiling.`,
      status: maximumStatus(payrollPercentage, operatingTargets.maxPayrollPercent),
      href: `/crew?date=${date}`,
    });
  }
  if (monthlyActions.length < 3) {
    if (averageJobSize < operatingTargets.averageJobSize) {
      monthlyActions.push({
        title: "Raise average job value",
        detail: `${money(averageJobSize)} current average versus ${money(operatingTargets.averageJobSize)} target.`,
        status: minimumStatus(averageJobSize, operatingTargets.averageJobSize),
        href: `/jobs?date=${date}`,
      });
    }
  }
  if (monthlyActions.length < 3) {
    monthlyActions.push({
      title: "Protect operating margin",
      detail: `${operatingMargin.toFixed(1)}% current margin versus ${operatingTargets.minOperatingMarginPercent.toFixed(0)}% minimum.`,
      status: minimumStatus(operatingMargin, operatingTargets.minOperatingMarginPercent),
      href: `/finance?date=${date}`,
    });
  }

  return (
    <div className="ops-dashboard ops-monthly-dashboard">
      <PageHeader
        title="Dashboard"
        subtitle={`Monthly summary for ${range.monthDisplay} · ${range.warningLabel} · Data through ${range.dataThroughLabel}`}
        date={date}
        showDateSelector={false}
        dateLabel="Month"
        lastUpdated={monthlyAuthority?.verifiedAt || latestData?.generated_at}
        controls={
          <OpsMonthSelector months={monthOptions()} selectedMonthKey={range.monthKey} />
        }
        sections={[
          { label: "Overview", href: `/?date=${date}&view=monthly&section=overview`, active: section === "overview" },
          { label: "Territory", href: `/?date=${date}&view=monthly&section=territory`, active: section === "territory" },
          { label: "Comparison", href: `/?date=${date}&view=monthly&section=comparison`, active: section === "comparison" },
          { label: "Daily", href: `/?date=${date}` },
        ]}
      />

      {section === "overview" ? <>
        <OperatingPulse
          id="command-overview"
          title="Monthly performance against plan"
          subtitle="Forward-looking pace, labor efficiency, profitability, and job economics."
          targetSummary={configuredMonthlyTarget > 0
            ? `${money(configuredMonthlyTarget)} configured monthly target`
            : `${money(previousGrossRevenue)} previous-month revenue baseline`}
          items={monthlyPulseItems}
          actions={monthlyActions.slice(0, 3)}
        />

        <div className="ops-kpi-row">
        <div className="ops-card ops-kpi-card">
          <div className="ops-card-title">Gross Revenue</div>
          <div className="ops-kpi-value ops-kpi-accent">{money(grossRevenue)}</div>
          {monthlyAuthority && (
            <div className={`ops-kpi-sub ${monthlyAuthority.revenueDelta !== 0 ? "ops-kpi-sub-warn" : ""}`}>
              {monthlyAuthority.revenueDelta !== 0
                ? `${money(monthlyAuthority.itemizedRevenue)} itemized · ${money(monthlyAuthority.revenueDelta)} awaiting itemization`
                : "Reconciled to JunkWare Dashboard"}
            </div>
          )}
        </div>
        <div className="ops-card ops-kpi-card">
          <div className="ops-card-title">Completed Jobs</div>
          <div className="ops-kpi-value">{completed}</div>
          {monthlyAuthority && monthlyAuthority.jobDelta !== 0 && (
            <div className="ops-kpi-sub ops-kpi-sub-warn">
              {monthlyAuthority.itemizedJobs} itemized · {monthlyAuthority.jobDelta} awaiting itemization
            </div>
          )}
        </div>
        <div className="ops-card ops-kpi-card">
          <div className="ops-card-title">Estimated Operating Profit</div>
          <div className="ops-kpi-value ops-kpi-good">{money(totalOperatingProfit)}</div>
        </div>
        <div className="ops-card ops-kpi-card">
          <div className="ops-card-title">Active Truck Days</div>
          <div className="ops-kpi-value">{activeTruckDays}</div>
        </div>
        </div>
      </> : null}

      {section !== "overview" ? <div className="ops-dashboard-main">
        {section === "territory" ? <div className="ops-card" id="command-territory">
          <div className="ops-card-header compact">
            <div>
              <div className="ops-section-title">Revenue by Territory</div>
              <div className="ops-muted">Aggregated from published daily records for the selected month.</div>
            </div>
          </div>
          <table className="ops-table">
            <thead>
              <tr>
                <th>Territory</th>
                <th>Revenue</th>
                <th>Jobs</th>
              </tr>
            </thead>
            <tbody>
              {territoryRows.map((territory) => (
                <tr key={territory}>
                  <td><strong>{territory}</strong></td>
                  <td className="ops-money">{money(territoryRevenue.get(territory) || 0)}</td>
                  <td>{territoryJobs.get(territory) || 0}</td>
                </tr>
              ))}
              {territoryRevenue.size === 0 && territoryJobs.size === 0 && (
                <tr><td colSpan={3} className="ops-muted">No territory data available for this month.</td></tr>
              )}
            </tbody>
          </table>
        </div> : null}

        {section === "comparison" ? <div className="ops-card" id="command-comparison">
          <div className="ops-card-header compact">
            <div>
              <div className="ops-section-title">Month Comparison</div>
              <div className="ops-muted">Compared with the previous calendar month when data is available.</div>
            </div>
          </div>
          <div className="ops-summary-list">
            <div><span>Revenue vs previous month</span><strong>{monthComparisonLabel(grossRevenue, previousGrossRevenue)}</strong></div>
            <div><span>Jobs vs previous month</span><strong>{monthComparisonLabel(completed, previousJobs)}</strong></div>
            <div><span>Payroll vs previous month</span><strong>{monthComparisonLabel(totalPayroll, previousPayroll)}</strong></div>
          </div>
        </div> : null}
      </div> : null}
    </div>
  );
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams?: Promise<AnyRecord>;
}) {
  const params = searchParams ? await searchParams : undefined;
  const kernelDatabase = resolveKernelDatabaseConfig();
  const date = resolveDate(params);
  const view = normalizeView(params?.view);
  const requestedSection = String(params?.section || "overview").toLowerCase();
  if (view === "monthly") {
    return renderMonthlyDashboard(date, requestedSection);
  }
  const section = ["overview", "crew", "fleet"].includes(requestedSection)
    ? requestedSection
    : "overview";
  const metrics = readMetrics(date);
  const marketing = buildSearchKingsView();
  const slackDigest = section === "overview" ? await readSlackDailyDigest(date) : null;

  const clockRows = readCrewClockRows(date);
  const dailyCrew = dailyCrewSnapshot(crewRows(metrics), clockRows);
  const crew = dailyCrew.crew;
  const trucks = truckRows(metrics);

  const grossRevenue = Number(metrics?.total_revenue || metrics?.gross_revenue || 0);
  const payrollRevenue = metricNumber(metrics?.total_revenue ?? metrics?.gross_revenue);
  const jobs = completedJobs(metrics);

  const authoritativePayroll = metricNumber(metrics?.total_payroll ?? metrics?.payroll);
  const computedPayroll = crew.reduce((sum, row) => sum + totalPay(row), 0);
  const totalPayroll = authoritativePayroll ?? computedPayroll;
  const configuredDailyTarget = dailyRevenueTarget();
  const recentDailyMetrics = availableDates()
    .filter((availableDate) => availableDate < date)
    .sort((a, b) => b.localeCompare(a))
    .slice(0, 28)
    .map((availableDate) => readMetrics(availableDate))
    .filter((row): row is AnyRecord => Boolean(row));
  const recentRevenueBaseline = recentDailyMetrics.length
    ? recentDailyMetrics.reduce((sum, row) => sum + toNumber(row.total_revenue ?? row.gross_revenue), 0) / recentDailyMetrics.length
    : 0;
  const dailyRevenuePlan = configuredDailyTarget > 0 ? configuredDailyTarget : recentRevenueBaseline;
  const dailyPayrollPercentage = grossRevenue > 0 ? (totalPayroll / grossRevenue) * 100 : 0;
  const dailyOperatingProfit = toNumber(metrics?.net_profit);
  const dailyOperatingMargin = grossRevenue > 0 ? (dailyOperatingProfit / grossRevenue) * 100 : 0;
  const dailyAverageJob = jobs > 0 ? grossRevenue / jobs : 0;
  const dailyAverageJobGoal = jobs > 0 && dailyRevenuePlan > 0 ? dailyRevenuePlan / jobs : null;
  const dailyJobsAtPlan = dailyRevenuePlan > 0 ? dailyRevenuePlan / operatingTargets.averageJobSize : 0;
  const dailyPayrollBudgetAtPlan = dailyRevenuePlan * (operatingTargets.maxPayrollPercent / 100);
  const dailyOperatingProfitAtPlan = dailyRevenuePlan * (operatingTargets.minOperatingMarginPercent / 100);
  const activeTruckCount = trucks.filter((truck) => Number(truck.revenue || 0) > 0).length;
  const dailyRevenuePerTruck = activeTruckCount > 0 ? grossRevenue / activeTruckCount : 0;
  const dailyProfitPerJob = jobs > 0 ? dailyOperatingProfit / jobs : 0;
  const dailyRevenueVariance = dailyRevenuePlan > 0 ? ((grossRevenue - dailyRevenuePlan) / dailyRevenuePlan) * 100 : 0;
  const dailyPulseItems: OperatingPulseItem[] = [
    {
      label: "Revenue performance",
      value: money(grossRevenue),
      target: configuredDailyTarget > 0 ? money(dailyRevenuePlan) : `${money(dailyRevenuePlan)} recent average`,
      detail: `${signedPercent(dailyRevenueVariance)} versus ${configuredDailyTarget > 0 ? "the configured daily target" : "the recent 28-day published baseline"}.`,
      status: minimumStatus(grossRevenue, dailyRevenuePlan),
    },
    {
      label: "Payroll efficiency",
      value: `${dailyPayrollPercentage.toFixed(1)}%`,
      target: `≤ ${operatingTargets.maxPayrollPercent.toFixed(0)}% · ${money(dailyPayrollBudgetAtPlan)} at daily goal`,
      detail: `${money(totalPayroll)} payroll deployed against today's revenue.`,
      status: maximumStatus(dailyPayrollPercentage, operatingTargets.maxPayrollPercent),
    },
    {
      label: "Operating margin",
      value: `${dailyOperatingMargin.toFixed(1)}%`,
      target: `≥ ${operatingTargets.minOperatingMarginPercent.toFixed(0)}% · ${money(dailyOperatingProfitAtPlan)} at daily goal`,
      detail: `${money(dailyOperatingProfit)} estimated operating profit for today.`,
      status: minimumStatus(dailyOperatingMargin, operatingTargets.minOperatingMarginPercent),
    },
    {
      label: "Average job size",
      value: money(dailyAverageJob),
      target: dailyAverageJobGoal == null
        ? "Waiting for completed jobs"
        : `≥ ${money(dailyAverageJobGoal)} for ${jobs} completed job${jobs === 1 ? "" : "s"}`,
      detail: dailyAverageJobGoal == null
        ? "The AJS goal will be calculated after the first completed job."
        : `${money(dailyRevenuePlan)} daily revenue goal divided by ${jobs} completed job${jobs === 1 ? "" : "s"}.`,
      status: dailyAverageJobGoal == null ? "watch" : minimumStatus(dailyAverageJob, dailyAverageJobGoal),
    },
  ];
  const dailyRevenueStatus = dailyPulseItems[0].status;
  const dailyRevenueRemaining = Math.max(0, dailyRevenuePlan - grossRevenue);
  const commandBriefMetrics: CommandBriefMetric[] = [
    {
      label: "Revenue pace",
      value: money(grossRevenue),
      detail: `${money(dailyRevenueRemaining)} remaining to plan`,
      status: dailyRevenueStatus,
      href: `/jobs?date=${date}`,
    },
    {
      label: "Payroll load",
      value: `${dailyPayrollPercentage.toFixed(1)}%`,
      detail: `${money(totalPayroll)} deployed · target ≤ ${operatingTargets.maxPayrollPercent.toFixed(0)}%`,
      status: dailyPulseItems[1].status,
      href: `/crew?date=${date}`,
    },
    {
      label: "Operating margin",
      value: `${dailyOperatingMargin.toFixed(1)}%`,
      detail: `${money(dailyOperatingProfit)} estimated profit`,
      status: dailyPulseItems[2].status,
      href: `/finance?date=${date}`,
    },
    {
      label: "Active trucks",
      value: String(activeTruckCount),
      detail: `${money(dailyRevenuePerTruck)} revenue per active truck`,
      status: activeTruckCount > 0 ? "on-track" : "watch",
      href: `/fleet?date=${date}`,
    },
  ];
  const commandBriefSignals: CommandBriefSignal[] = [
    {
      title: "Revenue performance",
      detail: dailyPulseItems[0].detail,
      status: dailyPulseItems[0].status,
      href: `/jobs?date=${date}`,
    },
    {
      title: "Payroll efficiency",
      detail: dailyPulseItems[1].detail,
      status: dailyPulseItems[1].status,
      href: `/crew?date=${date}`,
    },
    {
      title: "Operating margin",
      detail: dailyPulseItems[2].detail,
      status: dailyPulseItems[2].status,
      href: `/finance?date=${date}`,
    },
    {
      title: "Average job size",
      detail: dailyPulseItems[3].detail,
      status: dailyPulseItems[3].status,
      href: `/jobs?date=${date}`,
    },
  ];
  if (marketing.available && marketing.lostLeads + marketing.needsFollowUp > 0) {
    commandBriefSignals.push({
      title: "Lost-lead recovery",
      detail: `${marketing.needsFollowUp} qualified call${marketing.needsFollowUp === 1 ? "" : "s"} need follow-up · ${marketing.lostLeads} lost · ${money(marketing.estimatedLostRevenue)} potential revenue`,
      status: marketing.lostLeads > 0 ? "off-track" : "watch",
      href: "/marketing?section=lost-leads",
    });
  }

  const rankedCrew = [...crew]
    .sort((a, b) =>
      employeeRevenue(b) - employeeRevenue(a) ||
      employeeJobs(b) - employeeJobs(a) ||
      employeeRph(b) - employeeRph(a) ||
      employeeName(a).localeCompare(employeeName(b))
    )
    .slice(0, 8);
  const hasLeaderboardResults = rankedCrew.some((row) => employeeRevenue(row) > 0 || employeeJobs(row) > 0);

  const topTrucks = [...trucks]
    .sort((a, b) => Number(b.revenue || 0) - Number(a.revenue || 0))
    .slice(0, 8);

  return (
    <div className="ops-dashboard ops-daily-dashboard">
      <PageHeader
        title="Daily Command"
        compact
        subtitle={`${shortMonthDay(date)} · ${jobs} completed job${jobs === 1 ? "" : "s"} · ${activeTruckCount} active truck${activeTruckCount === 1 ? "" : "s"}`}
        date={date}
        lastUpdated={metrics?.generated_at}
        sections={[
          { label: "Overview", href: `/?date=${date}&section=overview`, active: section === "overview" },
          { label: "Crew Snapshot", href: `/?date=${date}&section=crew`, active: section === "crew" },
          { label: "Fleet Snapshot", href: `/?date=${date}&section=fleet`, active: section === "fleet" },
          { label: "Monthly", href: `/?date=${date}&view=monthly` },
        ]}
      />

      {section === "overview" ? <>
        <CommandBrief
          metrics={commandBriefMetrics}
          signals={commandBriefSignals}
          date={date}
          slackDigest={slackDigest!}
        />

        {kernelDatabase.status === "ready" ? (
          <OperatingInbox date={date} variant="command" />
        ) : null}

        {!metrics && (
        <div className="ops-card ops-alert-card">
          <div className="ops-section-title">No metrics found for {date}</div>
          <div className="ops-muted">
            OpsCenter is running, but it could not find a daily metrics file for this date.
          </div>
        </div>
        )}

        <section className="ops-supporting-metrics" aria-labelledby="supporting-metrics-title">
          <div className="ops-supporting-metrics-heading">
            <div>
              <div className="ops-operating-kicker"><span /> Daily output</div>
              <h2 id="supporting-metrics-title">Supporting Metrics</h2>
            </div>
            <p>The command view owns the headline numbers; these measures explain throughput and capacity.</p>
          </div>

          <div className="ops-daily-kpi-grid" aria-label="Supporting daily metrics">
            <a className="ops-card ops-daily-kpi-card" href={`/jobs?date=${date}`}>
              <div className="ops-card-title">Completed jobs</div>
              <div className="ops-kpi-value">{jobs}</div>
              <div className="ops-kpi-sub">Goal {dailyJobsAtPlan.toFixed(1)}/day at {money(operatingTargets.averageJobSize)} average <span aria-hidden="true">→</span></div>
            </a>

            <a className="ops-card ops-daily-kpi-card" href={`/fleet?date=${date}`}>
              <div className="ops-card-title">Active trucks</div>
              <div className="ops-kpi-value">{activeTruckCount}</div>
              <div className="ops-kpi-sub">Producing revenue today <span aria-hidden="true">→</span></div>
            </a>

            <a className="ops-card ops-daily-kpi-card" href={`/fleet?date=${date}`}>
              <div className="ops-card-title">Revenue / active truck</div>
              <div className="ops-kpi-value">{money(dailyRevenuePerTruck)}</div>
              <div className="ops-kpi-sub">Across {activeTruckCount} producing truck{activeTruckCount === 1 ? "" : "s"} <span aria-hidden="true">→</span></div>
            </a>

            <a className="ops-card ops-daily-kpi-card" href={`/finance?date=${date}`}>
              <div className="ops-card-title">Profit / completed job</div>
              <div className="ops-kpi-value ops-kpi-good">{money(dailyProfitPerJob)}</div>
              <div className="ops-kpi-sub">Estimated after operating costs <span aria-hidden="true">→</span></div>
            </a>
          </div>
        </section>
      </> : null}

      {section === "crew" ? <section className="ops-card ops-daily-leaderboard" id="command-crew">
        <div className="ops-card-header compact">
          <div>
            <div className="ops-section-title">Daily Crew Leaderboard</div>
            <div className="ops-muted">
              Ranked by revenue, with completed jobs and revenue per hour breaking ties. Daily earnings includes hourly pay, tips, and bonus.
            </div>
          </div>
          <div className="ops-daily-leaderboard-actions">
            <span className={`ops-daily-leaderboard-state ${hasLeaderboardResults ? "is-live" : "is-pending"}`}>
              {hasLeaderboardResults
                ? `${dailyCrew.rankedCount} ranked${rankedCrew.length < dailyCrew.rankedCount ? ` · top ${rankedCrew.length} shown` : ""}`
                : "Awaiting results"}
            </span>
            <a className="ops-mini-link" href={`/crew?date=${date}`}>Full Crew View</a>
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
                const rowClassName = hasLeaderboardResults && rank <= 3 ? `is-rank-${rank}` : undefined;

                return (
                  <tr className={rowClassName} key={`${employeeName(row)}-${idx}`}>
                    <td className="ops-daily-leaderboard-rank-cell">
                      <span
                        className="ops-daily-leaderboard-rank"
                        aria-label={hasLeaderboardResults ? `Rank ${rank}` : "Not yet ranked"}
                      >
                        {hasLeaderboardResults ? String(rank).padStart(2, "0") : "—"}
                      </span>
                    </td>
                    <td className="ops-daily-leaderboard-person">
                      <strong>{employeeName(row)}</strong>
                      <small>{String(row.shift_status || row.clock_out_display || "Daily crew")}</small>
                    </td>
                    <td>{employeeTruck(row)}</td>
                    <td className="ops-daily-leaderboard-jobs">{employeeJobs(row)}</td>
                    <td className="ops-money ops-daily-leaderboard-revenue">{money(employeeRevenue(row))}</td>
                    <td className="ops-money">{money(employeeRph(row))}</td>
                    <td className="ops-money">{money(employeeAverageJob(row, metrics))}</td>
                    <td className="ops-money ops-pay-total">{money(totalPay(row))}</td>
                  </tr>
                );
              })}

              {rankedCrew.length === 0 && (
                <tr>
                  <td colSpan={8} className="ops-muted">No crew data available for this date.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section> : null}

      {section === "fleet" ? <div className="ops-card" id="command-fleet">
        <div className="ops-card-header compact">
          <div>
            <div className="ops-section-title">Fleet Snapshot</div>
            <div className="ops-muted">
              Truck revenue, jobs, average job size, expenses, and net.
            </div>
          </div>
          <a className="ops-mini-link" href={`/fleet?date=${date}`}>Full Fleet View</a>
        </div>

        <table className="ops-table">
          <thead>
            <tr>
              <th>Truck</th>
              <th>Jobs</th>
              <th>Revenue</th>
              <th>Avg Job Size</th>
              <th>Expenses</th>
              <th>Net</th>
            </tr>
          </thead>
          <tbody>
            {topTrucks.map((row) => (
              <tr key={row.truck}>
                <td><strong>{row.truck}</strong></td>
                <td>{row.jobs}</td>
                <td className="ops-money">{money(row.revenue)}</td>
                <td className="ops-money">{money(row.averageJobSize)}</td>
                <td className="ops-money">{money(row.expenses)}</td>
                <td className="ops-money">{money(row.net)}</td>
              </tr>
            ))}

            {topTrucks.length === 0 && (
              <tr>
                <td colSpan={6} className="ops-muted">No fleet data available.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div> : null}
    </div>
  );
}
