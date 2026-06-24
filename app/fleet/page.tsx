import {
  const metrics = await getDailyMetrics();
 BarChart } from "@/components/BarChart";
import { MetricCard } from "@/components/MetricCard";
import { Panel } from "@/components/Panel";
import { Shell } from "@/components/Shell";
import { Table } from "@/components/Table";
import { entries, getDailyMetrics, money, number, numericEntries, totalRecordValues } from "@/lib/metrics";
import { reportDateLabel, resolveReportDate } from "@/lib/report-dates";
import type { EmployeeRph, TruckPerformance } from "@/types/metrics";

function truckListLabel(trucks?: string[] | string) {
  if (Array.isArray(trucks)) return trucks.length ? trucks.join(", ") : "Unassigned";
  return trucks || "Unassigned";
}

function clockOutLabel(employee: EmployeeRph) {
  if (employee.shift_status === "On Shift") return "On Shift";
  return employee.time_out || employee.clock_out_display || "Missing";
}

type PageProps = {
  searchParams?: Promise<{ date?: string | string[] }>;
};

export default async function FleetPage({ searchParams }: PageProps) {
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

  const miles = numericEntries(metrics.miles_by_truck);
  const drive = entries(metrics.drive_time_by_truck);
  const idle = entries(metrics.idle_time_by_truck);
  const totalMiles = totalRecordValues(metrics.miles_by_truck);
  const activeTrucks = numericEntries(metrics.revenue_by_truck).length;
  const truckPerformance: TruckPerformance[] = metrics.truck_performance ?? [];
  const crew: EmployeeRph[] = metrics.employee_leaderboard ?? [];

  return (
    <Shell dataStatus={dataStatus} lastUpdated={lastUpdated} selectedDate={reportDate}>
      <div className="mb-6">
        <h2 className="text-xl font-semibold">Fleet</h2>
        <p className="mt-1 text-sm text-muted">
          Truck movement and time summaries for {reportDate ? reportDateLabel(reportDate) : "today"}.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3 mb-6">
        <MetricCard label="Active Trucks" value={number(activeTrucks)} sublabel="Generating revenue today" />
        <MetricCard label="Total Miles" value={`${number(totalMiles)} mi`} sublabel="All trucks combined" />
        <MetricCard label="Trucks Tracked" value={number(miles.length)} sublabel="Reporting GPS data" />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Truck Performance — Current vs Verified RPH">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-muted border-b border-line">
                <th className="pb-2 pr-4 font-medium">Truck</th>
                <th className="pb-2 pr-4 font-medium">Crew Hrs</th>
                <th className="pb-2 pr-4 font-medium">Revenue</th>
                <th className="pb-2 pr-4 font-medium">Jobs</th>
                <th className="pb-2 pr-4 font-medium">Current RPH</th>
                <th className="pb-2 pr-4 font-medium">Verified RPH</th>
                <th className="pb-2 font-medium">Diff %</th>
              </tr>
            </thead>
            <tbody>
              {truckPerformance.map((truck) => {
                const truckName = truck.truck ?? "Unassigned";
                const current = truck.revenue_per_labor_hour ?? metrics?.rph_by_truck?.[truckName] ?? null;
                const verifiedRaw =
                  truck.rph_verified ?? metrics?.rph_verified_by_truck?.[truckName] ?? null;
                const hasBoth =
                  typeof current === "number" && current > 0 && typeof verifiedRaw === "number";
                const diffPct = hasBoth ? ((verifiedRaw - current) / current) * 100 : null;
                const flagged = diffPct !== null && Math.abs(diffPct) > 10;
                return (
                  <tr
                    key={truckName}
                    className={`border-b border-line/50 last:border-0 ${flagged ? "bg-warn/10" : ""}`}
                  >
                    <td className="py-2.5 pr-4 font-medium">{truckName}</td>
                    <td className="py-2.5 pr-4 tabular-nums">{number(truck.crew_hours)}h</td>
                    <td className="py-2.5 pr-4 tabular-nums">{money(truck.revenue)}</td>
                    <td className="py-2.5 pr-4 tabular-nums">{number(truck.jobs)}</td>
                    <td className="py-2.5 pr-4 tabular-nums">
                      {typeof current === "number" ? `${money(current)}/hr` : <span className="text-muted">—</span>}
                    </td>
                    <td className="py-2.5 pr-4 tabular-nums">
                      {typeof verifiedRaw === "number" ? (
                        <span className={flagged ? "font-semibold text-warn" : ""}>{money(verifiedRaw)}/hr</span>
                      ) : (
                        <span className="text-muted">—</span>
                      )}
                    </td>
                    <td className="py-2.5 tabular-nums">
                      {diffPct !== null ? (
                        <span className={`inline-flex items-center gap-1 font-semibold ${flagged ? "text-warn" : "text-muted"}`}>
                          {diffPct > 0 ? "+" : ""}
                          {diffPct.toFixed(1)}%{flagged && " ⚠"}
                        </span>
                      ) : (
                        <span className="text-muted">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="mt-3 text-xs text-muted">
            Current RPH = revenue per labor hour (all clocked crew). Verified RPH = revenue per
            verified-crew labor hour. Rows where the two differ by more than 10% are highlighted.
          </p>
        </Panel>
        <Panel title="Miles by Truck">
          <BarChart labels={miles.map(([l]) => l)} values={miles.map(([, v]) => v)} format="miles" />
        </Panel>
        <Panel title="Drive Time by Truck">
          <Table columns={["Truck", "Drive Time"]} rows={drive.map(([truck, value]) => [truck, value])} />
        </Panel>
        <Panel title="Idle Time by Truck">
          <Table columns={["Truck", "Idle Time"]} rows={idle.map(([truck, value]) => [truck, value])} />
        </Panel>
      </div>

      <div className="mt-4 grid gap-4">
        {truckPerformance.map((truck) => {
          const truckName = truck.truck ?? "Unassigned";
          const members = crew.filter((employee) =>
            employee.trucks?.length ? employee.trucks.includes(truckName) : employee.truck === truckName
          );
          if (!members.length) return null;
          return (
            <Panel key={truckName} title={`${truckName} Crew`}>
              <Table
                columns={["Crew Member", "Clock In", "Clock Out", "Hours", "Revenue", "Revenue / Hr", "Trucks"]}
                rows={members.map((employee) => [
                  employee.name ?? "",
                  employee.time_in || "Missing",
                  clockOutLabel(employee),
                  `${number(employee.hours_worked ?? employee.hours)}h`,
                  money(employee.revenue_generated ?? employee.truck_revenue),
                  `${money(employee.revenue_per_hour ?? employee.rph)}/hr`,
                  truckListLabel(employee.trucks ?? employee.truck)
                ])}
              />
            </Panel>
          );
        })}
      </div>
    </Shell>
  );
}
