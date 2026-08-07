import Link from "next/link";
import PageHeader from "@/components/PageHeader";
import { getCrewPayPeriodMetrics } from "@/lib/crew-pay-period";
import { money, number } from "@/lib/metrics";
import { resolveReportDate } from "@/lib/report-dates";
import { buildFleetDailyRecord } from "@/lib/fleet-history";

type PageProps = {
  params: Promise<{
    employee: string;
  }>;
  searchParams?: Promise<{
    date?: string;
  }>;
};

function percent(value: number | null): string {
  if (value === null) return "N/A";
  return `${number(value * 100)}%`;
}

function driverGrade(score: number | null): string {
  if (score == null) return "Not graded";
  if (score >= 90) return "A";
  if (score >= 80) return "B";
  if (score >= 70) return "C";
  if (score >= 60) return "D";
  return "F";
}

function minutesText(value: unknown): string {
  const minutes = Math.max(0, Math.round(Number(value || 0)));
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

export default async function CrewMemberPage({ params, searchParams }: PageProps) {
  const resolvedParams = await params;
  const resolvedSearch = await searchParams;

  const employee = decodeURIComponent(resolvedParams.employee);
  const selectedDate = resolveReportDate(resolvedSearch?.date) || new Date().toISOString().slice(0, 10);

  const detail = getCrewPayPeriodMetrics(employee, selectedDate);
  const t = detail.totals;
  const fleet = buildFleetDailyRecord(selectedDate);
  const employeeDriverRow = fleet?.employeeScoreRows.find((row) =>
    String(row.employee_name || row.name || "").toLowerCase() === employee.toLowerCase()
  );
  const assignedTrucks = Array.isArray(employeeDriverRow?.trucks_driven)
    ? employeeDriverRow.trucks_driven
    : [employeeDriverRow?.truck].filter(Boolean);
  const assignedTruckRow = assignedTrucks.length === 1
    ? fleet?.truckScoreRows.find((row) => String(row.truck || "") === String(assignedTrucks[0] || ""))
    : null;
  const useManualTruckScore = Boolean(assignedTruckRow?.assignment_override) &&
    Array.isArray(assignedTruckRow?.assigned_drivers) &&
    assignedTruckRow.assigned_drivers.length === 1 &&
    String(assignedTruckRow.assigned_drivers[0] || "").toLowerCase() === employee.toLowerCase();
  const driverTelemetry = useManualTruckScore ? assignedTruckRow : employeeDriverRow;
  const overallDriverScore = Number.isFinite(Number(driverTelemetry?.opscenter_driving_score))
    ? Number(driverTelemetry?.opscenter_driving_score)
    : null;
  const safetyScore = Number.isFinite(Number(driverTelemetry?.safety_score))
    ? Number(driverTelemetry?.safety_score)
    : null;
  const idleScore = Number.isFinite(Number(driverTelemetry?.idle_score))
    ? Number(driverTelemetry?.idle_score)
    : null;
  const idlePercentage = Number.isFinite(Number(driverTelemetry?.idle_percentage))
    ? Number(driverTelemetry?.idle_percentage)
    : null;
  const alertCounts = driverTelemetry?.weighted_alert_counts || {};
  const alertAvailability = driverTelemetry?.weighted_alert_availability || {};
  const driverAlertRows = [
    ["High Speed", 20, "highSpeed"],
    ["Rapid Acceleration", 3, "rapidAcceleration"],
    ["Harsh Braking", 7, "harshBraking"],
    ["Posted Speed Violation", 25, "postedSpeed"],
    ["Phone Use", 30, "phoneUse"],
    ["Tailgating", 15, "tailgating"],
  ] as const;

  const cards = [
    ["Total Earnings", money(t.totalPay), "Base pay + tips + bonuses"],
    ["Base Pay", money(t.basePay), ""],
    ["Tips", money(t.tips), ""],
    ["Bonuses", money(t.bonuses), ""],
    ["Job Revenue Worked", money(t.jobRevenueWorked), "Full value of completed jobs worked"],
    ["Credited Revenue", money(t.revenue), "Split crew allocation used for RPH and bonuses"],
    ["Jobs Completed", number(t.jobsCompleted), ""],
    ["Average Job Size", money(t.averageJobSize), ""],
    ["RPH", money(t.rph), "Revenue per hour"],
    ["First Visit % Closed", percent(t.firstVisitCloseRate), `${number(t.firstVisitClosed)} / ${number(t.firstVisitOpportunities)}`],
    ["Estimates Closed", number(t.estimatesClosed), `${percent(t.estimateCloseRate)} close rate`],
    ["Estimates Given", number(t.estimatesGiven), ""],
    ["Hours", number(t.hours), ""],
  ];

  return (
    <div className="ops-dashboard ops-employee-page">
      <PageHeader
        title={employee}
        subtitle={`Current pay period: ${detail.periodStart} through ${detail.periodEnd}`}
        date={selectedDate}
        status="Provisional"
        controls={<Link className="ops-refresh-button" href={`/crew?date=${selectedDate}`}>Back to Crew</Link>}
      />

      <section className="ops-card">
        <div className="ops-card-header compact">
          <div>
            <div className="ops-section-title">Driver Score for {selectedDate}</div>
            <div className="ops-muted">Daily GPS and camera performance attributed to this driver.</div>
          </div>
        </div>

        {driverTelemetry && overallDriverScore != null ? (
          <div>
            <div className="ops-employee-score-grid">
              <div><div className="ops-card-title">Overall Score</div><div className="ops-kpi-value">{overallDriverScore.toFixed(1)}</div></div>
              <div><div className="ops-card-title">Grade</div><div className="ops-kpi-value ops-kpi-accent">{driverGrade(overallDriverScore)}</div></div>
              <div><div className="ops-card-title">Safety Score</div><div className="ops-employee-stat-value">{safetyScore?.toFixed(1) ?? "Unavailable"}</div><div className="ops-kpi-sub">90% of overall score</div></div>
              <div><div className="ops-card-title">Idling Score</div><div className="ops-employee-stat-value">{idleScore?.toFixed(0) ?? "Unavailable"}</div><div className="ops-kpi-sub">10% of overall score</div></div>
              <div><div className="ops-card-title">Miles</div><div className="ops-employee-stat-value">{Number(driverTelemetry.miles_driven || 0).toFixed(2)}</div></div>
              <div><div className="ops-card-title">Truck</div><div className="ops-employee-stat-value">{assignedTrucks.join(", ") || "Unavailable"}</div></div>
            </div>

            <div className="ops-employee-driving-summary">
              <div><span className="ops-muted">Driving time</span><strong>{minutesText(driverTelemetry.drive_minutes ?? driverTelemetry.drive_time_minutes)}</strong></div>
              <div><span className="ops-muted">Countable idling</span><strong>{minutesText(driverTelemetry.idle_minutes ?? driverTelemetry.idle_time_minutes)}</strong></div>
              <div><span className="ops-muted">Idle percentage</span><strong>{idlePercentage == null ? "Unavailable" : `${idlePercentage.toFixed(1)}%`}</strong></div>
            </div>

            <div className="ops-wide-table-wrap ops-employee-alert-table">
              <table className="ops-table">
                <thead>
                  <tr>
                    <th className="px-4 py-3">Safety alert</th>
                    <th className="px-4 py-3 text-right">Weight</th>
                    <th className="px-4 py-3 text-right">Alerts</th>
                    <th className="px-4 py-3">Coverage</th>
                  </tr>
                </thead>
                <tbody>
                  {driverAlertRows.map(([label, weight, key]) => {
                    const available = alertAvailability[key] !== false;
                    return (
                      <tr key={key}>
                        <td>{label}</td>
                        <td className="ops-money">{weight}%</td>
                        <td className="ops-money">{available ? Math.round(Number(alertCounts[key] || 0)) : "Unavailable"}</td>
                        <td>{available ? "Tracked" : "Camera does not support this alert"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          <div className="ops-muted">No attributable driving score is available for this employee on this date.</div>
        )}
      </section>

      <section className="ops-kpi-row ops-employee-kpi-row">
        {cards.map(([label, value, sublabel]) => (
          <div key={label} className="ops-card ops-kpi-card">
            <div className="ops-card-title">{label}</div>
            <div className="ops-kpi-value">{value}</div>
            {sublabel ? <div className="ops-kpi-sub">{sublabel}</div> : null}
          </div>
        ))}
      </section>

      <section className="ops-card">
        <div className="ops-card-header compact">
          <div>
            <div className="ops-section-title">Daily Breakdown</div>
            <div className="ops-muted">Activity found in daily metrics for this pay period.</div>
          </div>
        </div>

        <div className="ops-wide-table-wrap">
          <table className="ops-table ops-employee-daily-table">
            <thead>
              <tr>
                <th className="px-5 py-3">Date</th>
                <th className="px-5 py-3 text-right">Pay</th>
                <th className="px-5 py-3 text-right">Tips</th>
                <th className="px-5 py-3 text-right">Bonuses</th>
                <th className="px-5 py-3 text-right">Job Revenue Worked</th>
                <th className="px-5 py-3 text-right">Credited Revenue</th>
                <th className="px-5 py-3 text-right">Jobs</th>
                <th className="px-5 py-3 text-right">Avg Job</th>
                <th className="px-5 py-3 text-right">Hours</th>
                <th className="px-5 py-3 text-right">RPH</th>
                <th className="px-5 py-3 text-right">FV Closed</th>
                <th className="px-5 py-3 text-right">Est. Closed</th>
              </tr>
            </thead>
            <tbody>
              {detail.days.length ? (
                detail.days.map((day) => (
                  <tr key={day.date}>
                    <td>{day.date}</td>
                    <td className="ops-money">{money(day.totalPay)}</td>
                    <td className="ops-money">{money(day.tips)}</td>
                    <td className="ops-money">{money(day.bonuses)}</td>
                    <td className="ops-money">{money(day.jobRevenueWorked)}</td>
                    <td className="ops-money">{money(day.revenue)}</td>
                    <td className="ops-money">{number(day.jobsCompleted)}</td>
                    <td className="ops-money">{money(day.averageJobSize)}</td>
                    <td className="ops-money">{number(day.hours)}</td>
                    <td className="ops-money">{money(day.rph)}</td>
                    <td className="ops-money">
                      {number(day.firstVisitClosed)} / {number(day.firstVisitOpportunities)}
                    </td>
                    <td className="ops-money">{number(day.estimatesClosed)}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td className="ops-muted" colSpan={12}>
                    No activity found for this crew member in this pay period.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
