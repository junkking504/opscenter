import { MetricCard } from "@/components/MetricCard";
import { Shell } from "@/components/Shell";
import { Panel } from "@/components/Panel";
import { getDailyMetrics, money, number } from "@/lib/metrics";
import { reportDateLabel, resolveReportDate } from "@/lib/report-dates";
import type { EmployeeRph } from "@/types/metrics";

const RPH_TARGET = 90;

function truckListLabel(trucks?: string[] | string) {
  if (Array.isArray(trucks)) return trucks.length ? trucks.join(", ") : "Unassigned";
  return trucks || "Unassigned";
}

function rphColor(rph: number) {
  if (rph >= 150) return "text-good";
  if (rph >= RPH_TARGET) return "text-green-300";
  return "text-red-400";
}

function clockOutLabel(employee: EmployeeRph) {
  if (employee.shift_status === "On Shift") return "On Shift";
  return employee.time_out || employee.clock_out_display || "Missing";
}

function StatusBadge({ meets }: { meets: boolean }) {
  return meets
    ? <span className="inline-flex items-center rounded-full bg-good/10 px-2 py-0.5 text-xs font-medium text-good">✓ On target</span>
    : <span className="inline-flex items-center rounded-full bg-red-400/10 px-2 py-0.5 text-xs font-medium text-red-400">✗ Below $90</span>;
}

export default async function CrewPage({ searchParams }: { searchParams?: { date?: string | string[] } }) {
  const selectedDate = resolveReportDate(searchParams?.date);
  const { metrics, lastUpdated } = await getDailyMetrics(selectedDate);
  const dataStatus = metrics ? (metrics.provisional ? "Provisional" : "Final") : "Provisional";

  const crew: EmployeeRph[] = metrics?.employee_leaderboard ?? [];
  const trucks = [...new Set(crew.map((e) => e.truck ?? "Unassigned"))].sort();
  const assigned = crew.filter((e) => (e.truck ?? "Unassigned") !== "Unassigned").length;
  const unassigned = crew.filter((e) => (e.truck ?? "Unassigned") === "Unassigned").length;
  const reportDate = selectedDate ?? metrics?.date;

  return (
    <Shell dataStatus={dataStatus} lastUpdated={lastUpdated} selectedDate={reportDate}>
      <div className="mb-6">
        <h2 className="text-xl font-semibold">Crew &amp; RPH</h2>
        <p className="mt-1 text-sm text-muted">
          Crew and RPH for {reportDate ? reportDateLabel(reportDate) : "today"} · Target:{" "}
          <span className="font-medium text-ink">${RPH_TARGET}/hr/person.</span>{" "}
          Hours marked <span className="text-warn font-medium">~</span> are interim — crew still clocked in.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3 mb-6">
        <MetricCard label="Clocked In Today" value={number(crew.length)} sublabel="All crew captured today" />
        <MetricCard label="Assigned to Trucks" value={number(assigned)} sublabel="Crew with a truck assignment" />
        <MetricCard label="Unassigned" value={number(unassigned)} sublabel="Crew not tied to a truck" />
      </div>

      {/* Per-truck panels */}
      {trucks.map((truck) => {
        const members = crew.filter((e) => (e.trucks?.length ? e.trucks.includes(truck) : e.truck === truck));
        const truckRev = metrics?.revenue_by_truck?.[truck] ?? members[0]?.truck_revenue ?? 0;
        const truckRph = metrics?.rph_by_truck?.[truck] ?? members[0]?.rph ?? 0;
        const allGood = members.every((e) => e.meets_target);

        return (
          <div key={truck} className="mb-5">
            <Panel
              title={
                <span className="flex items-center gap-3 flex-wrap">
                  <span className="text-ink font-semibold">{truck}</span>
                  <span className="text-muted font-normal normal-case tracking-normal">{money(truckRev)}</span>
                  <span className={`font-semibold normal-case tracking-normal ${rphColor(truckRph)}`}>
                    ${truckRph.toFixed(0)}/hr/person
                  </span>
                  {!allGood && (
                    <span className="ml-auto text-xs text-red-400 font-semibold normal-case tracking-normal">⚠ Below target</span>
                  )}
                </span>
              }
            >
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-muted border-b border-line">
                    <th className="pb-2 pr-4 font-medium">Employee</th>
                    <th className="pb-2 pr-4 font-medium">Clock In</th>
                    <th className="pb-2 pr-4 font-medium">Clock Out</th>
                    <th className="pb-2 pr-4 font-medium">Hours Worked</th>
                    <th className="pb-2 pr-4 font-medium">Trucks</th>
                    <th className="pb-2 pr-4 font-medium">Tips</th>
                    <th className="pb-2 pr-4 font-medium">Revenue / Hr</th>
                    <th className="pb-2 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {members.map((emp) => (
                    <tr key={emp.name} className="border-b border-line/50 last:border-0">
                      <td className="py-2.5 pr-4 font-medium">{emp.name}</td>
                      <td className="py-2.5 pr-4 tabular-nums">{emp.time_in || "—"}</td>
                      <td className="py-2.5 pr-4 tabular-nums text-muted">{clockOutLabel(emp)}</td>
                      <td className="py-2.5 pr-4 tabular-nums">
                        {(emp.hours_worked ?? emp.hours)?.toFixed(2)}h
                        {emp.hours_basis === "interim" && (
                          <span className="ml-1 text-xs text-warn">~</span>
                        )}
                      </td>
                      <td className="py-2.5 pr-4 text-muted">{truckListLabel(emp.trucks ?? emp.truck)}</td>
                      <td className="py-2.5 pr-4 tabular-nums text-good">
                        {(emp.tip ?? 0) > 0 ? money(emp.tip) : <span className="text-muted">—</span>}
                      </td>
                      <td className={`py-2.5 pr-4 tabular-nums font-semibold ${rphColor(emp.rph ?? 0)}`}>
                        {money(emp.revenue_per_hour ?? emp.rph)}/hr
                      </td>
                      <td className="py-2.5">
                        <StatusBadge meets={emp.meets_target ?? false} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Panel>
          </div>
        );
      })}

      {/* Full leaderboard */}
      <Panel title="Full Leaderboard — All Crew">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-muted border-b border-line">
              <th className="pb-2 pr-2 font-medium">#</th>
              <th className="pb-2 pr-4 font-medium">Employee</th>
              <th className="pb-2 pr-4 font-medium">Truck</th>
              <th className="pb-2 pr-4 font-medium">Clock In</th>
              <th className="pb-2 pr-4 font-medium">Clock Out</th>
              <th className="pb-2 pr-4 font-medium">Hours Worked</th>
              <th className="pb-2 pr-4 font-medium">Trucks</th>
              <th className="pb-2 pr-4 font-medium">Revenue</th>
              <th className="pb-2 pr-4 font-medium">Tips</th>
              <th className="pb-2 font-medium">Revenue / Hr</th>
            </tr>
          </thead>
          <tbody>
            {crew.map((emp, i) => (
              <tr key={emp.name} className="border-b border-line/50 last:border-0">
                <td className="py-2.5 pr-2 text-muted font-mono text-xs">{i + 1}</td>
                <td className="py-2.5 pr-4 font-medium">{emp.name}</td>
                <td className="py-2.5 pr-4 text-muted">{emp.truck}</td>
                <td className="py-2.5 pr-4 tabular-nums">{emp.time_in || emp.clock_in || "Missing"}</td>
                <td className="py-2.5 pr-4 tabular-nums text-muted">{clockOutLabel(emp)}</td>
                <td className="py-2.5 pr-4 tabular-nums">
                  {(emp.hours_worked ?? emp.hours)?.toFixed(2)}h
                  {emp.hours_basis === "interim" && <span className="ml-1 text-xs text-warn">~</span>}
                </td>
                <td className="py-2.5 pr-4 text-muted">{truckListLabel(emp.trucks ?? emp.truck)}</td>
                <td className="py-2.5 pr-4 tabular-nums">{money(emp.revenue_generated ?? emp.truck_revenue)}</td>
                <td className="py-2.5 pr-4 tabular-nums text-good">
                  {(emp.tip ?? 0) > 0 ? money(emp.tip) : <span className="text-muted">—</span>}
                </td>
                <td className={`py-2.5 tabular-nums font-semibold ${rphColor(emp.rph ?? 0)}`}>
                  {money(emp.revenue_per_hour ?? emp.rph)}/hr
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-3 text-xs text-muted">~ = interim hours · Target ${RPH_TARGET}/hr/person</p>
      </Panel>
    </Shell>
  );
}
