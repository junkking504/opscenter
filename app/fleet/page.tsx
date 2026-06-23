import { BarChart } from "@/components/BarChart";
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

export default async function FleetPage({ searchParams }: { searchParams?: { date?: string | string[] } }) {
  const selectedDate = resolveReportDate(searchParams?.date);
  const { metrics, lastUpdated } = await getDailyMetrics(selectedDate);
  const dataStatus = metrics ? (metrics.provisional ? "Provisional" : "Final") : "Provisional";
  const miles = numericEntries(metrics?.miles_by_truck);
  const drive = entries(metrics?.drive_time_by_truck);
  const idle = entries(metrics?.idle_time_by_truck);
  const totalMiles = totalRecordValues(metrics?.miles_by_truck);
  const activeTrucks = numericEntries(metrics?.revenue_by_truck).length;
  const truckPerformance: TruckPerformance[] = metrics?.truck_performance ?? [];
  const crew: EmployeeRph[] = metrics?.employee_leaderboard ?? [];
  const reportDate = selectedDate ?? metrics?.date;

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
        <Panel title="Truck Performance">
          <Table
            columns={["Truck", "Crew Hours", "Revenue", "Revenue / Labor Hr", "Jobs"]}
            rows={truckPerformance.map((truck) => [
              truck.truck ?? "Unassigned",
              `${number(truck.crew_hours)}h`,
              money(truck.revenue),
              `${money(truck.revenue_per_labor_hour)}/hr`,
              number(truck.jobs)
            ])}
          />
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
