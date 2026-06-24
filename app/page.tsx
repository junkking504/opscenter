import {
  const metrics = await getDailyMetrics();
 BarChart } from "@/components/BarChart";
import { MetricCard } from "@/components/MetricCard";
import { Panel } from "@/components/Panel";
import { Shell } from "@/components/Shell";
import { getDailyMetrics, money, number, numericEntries, totalRecordValues } from "@/lib/metrics";
import { reportDateLabel, resolveReportDate } from "@/lib/report-dates";

const RPH_TARGET = 90;

type PageProps = {
  searchParams?: Promise<{ date?: string | string[] }>;
};

function truckListLabel(trucks?: string[] | string) {
  if (Array.isArray(trucks)) return trucks.length ? trucks.join(", ") : "Unassigned";
  return trucks || "Unassigned";
}

function rphBadge(rph: number) {
  if (rph === 0) return <span className="text-muted text-xs">—</span>;
  if (rph >= RPH_TARGET) return <span className="text-good font-semibold">{money(rph)}/hr ✓</span>;
  return <span className="text-red-400 font-semibold">{money(rph)}/hr ✗</span>;
}

export default async function DashboardPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const selectedDate = resolveReportDate(params?.date);
  const { metrics, lastUpdated } = await getDailyMetrics(selectedDate);
  const dataStatus = metrics ? (metrics.provisional ? "Provisional" : "Final") : "Provisional";
  const reportDate = selectedDate ?? metrics?.date;

  if (!metrics) {
    return (
      <Shell dataStatus={dataStatus} lastUpdated={lastUpdated} selectedDate={reportDate}>
        <div className="rounded-lg border border-line bg-panel px-4 py-3 text-sm text-muted">
          No data available for this date.
        </div>
      </Shell>
    );
  }

  const revenueByTruck = numericEntries(metrics.revenue_by_truck);
  const revenueByMarket = numericEntries(metrics.revenue_by_market);
  const jobsCompleted = totalRecordValues(metrics.jobs_by_truck);
  const employeeRph = [...(metrics.employee_leaderboard ?? [])].sort((a, b) => (b.rph ?? 0) - (a.rph ?? 0));

  return (
    <Shell dataStatus={dataStatus} lastUpdated={lastUpdated} selectedDate={reportDate}>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 mb-6">
        <MetricCard label="Gross Revenue" value={money(metrics.total_revenue)} sublabel="All markets, jobs only" />
        <MetricCard label="Net Revenue (after 3% CC)" value={money(metrics.net_revenue)} highlight="positive" sublabel={`CC fees: ${money(metrics.cc_fees)}`} />
        <MetricCard label="Collected Today" value={money(metrics.total_payments_collected)} sublabel={`Uncollected: ${money(metrics.revenue_not_yet_collected)}`} />
        <MetricCard label="Jobs Completed" value={number(jobsCompleted)} sublabel={reportDate ? reportDateLabel(reportDate) : ""} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2 mb-6">
        <Panel title="Revenue by Truck">
          <BarChart labels={revenueByTruck.map(([l]) => l)} values={revenueByTruck.map(([, v]) => v)} format="money" />
        </Panel>
        <Panel title="Revenue by Market">
          <BarChart labels={revenueByMarket.map(([l]) => l)} values={revenueByMarket.map(([, v]) => v)} format="money" />
        </Panel>
      </div>

      <Panel title="Employee RPH Leaderboard">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-muted border-b border-line">
              <th className="pb-2 pr-2 font-medium">#</th>
              <th className="pb-2 pr-4 font-medium">Employee</th>
              <th className="pb-2 pr-4 font-medium">Truck</th>
              <th className="pb-2 pr-4 font-medium">Trucks</th>
              <th className="pb-2 pr-4 font-medium">Clock In</th>
              <th className="pb-2 pr-4 font-medium">Hours</th>
              <th className="pb-2 pr-4 font-medium">Truck Rev</th>
              <th className="pb-2 font-medium">RPH</th>
            </tr>
          </thead>
          <tbody>
            {employeeRph.map((emp, i) => (
              <tr key={emp.name} className="border-b border-line/50 last:border-0">
                <td className="py-2 pr-2 text-muted">{i + 1}</td>
                <td className="py-2 pr-4 font-medium">{emp.name}</td>
                <td className="py-2 pr-4 text-muted">{emp.truck}</td>
                <td className="py-2 pr-4 text-muted">{truckListLabel(emp.trucks ?? emp.truck)}</td>
                <td className="py-2 pr-4 tabular-nums text-muted">{emp.time_in || "—"}</td>
                <td className="py-2 pr-4 tabular-nums">
                  {emp.hours?.toFixed(1)}h
                  {emp.hours_basis === "interim" && <span className="ml-1 text-xs text-warn">~</span>}
                </td>
                <td className="py-2 pr-4 tabular-nums">{money(emp.truck_revenue)}</td>
                <td className="py-2">{rphBadge(emp.rph ?? 0)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-2 text-xs text-muted">~ = interim hours (crew still clocked in) · Target: ${RPH_TARGET}/hr/person</p>
      </Panel>
    </Shell>
  );
}
