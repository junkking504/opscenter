import { BarChart } from "@/components/BarChart";
import { MetricCard } from "@/components/MetricCard";
import { JobsMap } from "@/components/JobsMap";
import { Panel } from "@/components/Panel";
import { Shell } from "@/components/Shell";
import { getDailyMetrics, money, number, numericEntries, totalRecordValues } from "@/lib/metrics";
import { reportDateLabel, resolveReportDate } from "@/lib/report-dates";
import type { Appointment } from "@/types/metrics";

function statusBadge(status: string, type: string) {
  const s = status.toLowerCase();
  const t = type.toLowerCase();
  if (t === "estimate")
    return <span className="inline-flex rounded-full bg-warn/10 px-2 py-0.5 text-xs font-medium text-warn">Estimate</span>;
  if (s.startsWith("completed"))
    return <span className="inline-flex rounded-full bg-good/10 px-2 py-0.5 text-xs font-medium text-good">Completed</span>;
  if (s === "confirmed")
    return <span className="inline-flex rounded-full bg-accent/10 px-2 py-0.5 text-xs font-medium text-accent">Confirmed</span>;
  if (s === "on route" || s === "en route")
    return <span className="inline-flex rounded-full bg-brand/10 px-2 py-0.5 text-xs font-medium text-brand">On Route</span>;
  return <span className="inline-flex rounded-full border border-line px-2 py-0.5 text-xs text-muted">{status || "—"}</span>;
}

function durationFromStatus(status: string): string {
  const match = status.match(/(\d+)\s*min/i);
  return match ? `${match[1]} min` : "—";
}

export default async function JobsPage({ searchParams }: { searchParams?: { date?: string | string[] } }) {
  const selectedDate = resolveReportDate(searchParams?.date);
  const { metrics, lastUpdated } = await getDailyMetrics(selectedDate);
  const dataStatus = metrics ? (metrics.provisional ? "Provisional" : "Final") : "Provisional";
  const jobsByTruck = numericEntries(metrics?.jobs_by_truck);
  const jobsByMarket = numericEntries(metrics?.jobs_by_market).map(
    ([label, v]) => [label.replace("Junk King ", ""), v] as [string, number]
  );
  const totalJobs = totalRecordValues(metrics?.jobs_by_truck);
  const totalRevenue = metrics?.total_revenue ?? 0;
  const avgTicket = totalJobs > 0 ? totalRevenue / totalJobs : 0;
  const reportDate = selectedDate ?? metrics?.date;

  const appointments: Appointment[] = metrics?.appointments ?? [];
  const jobs = appointments.filter((a) => a.appointment_type?.toLowerCase() !== "estimate");
  const estimates = appointments.filter((a) => a.appointment_type?.toLowerCase() === "estimate");

  return (
    <Shell dataStatus={dataStatus} lastUpdated={lastUpdated} selectedDate={reportDate}>
      <div className="mb-6">
        <h2 className="text-xl font-semibold">Jobs</h2>
        <p className="mt-1 text-sm text-muted">
          All appointments for {reportDate ? reportDateLabel(reportDate) : "today"}.
        </p>
      </div>

      {/* Summary cards */}
      <div className="grid gap-4 sm:grid-cols-4 mb-6">
        <MetricCard label="Jobs" value={number(totalJobs)} sublabel="Estimates excluded" />
        <MetricCard label="Estimates" value={number(estimates.length)} sublabel="Not counted in revenue" />
        <MetricCard label="Total Revenue" value={money(totalRevenue)} sublabel="Job revenue, all markets" />
        <MetricCard label="Avg Ticket" value={money(avgTicket)} sublabel="Revenue per job" />
      </div>

      <div className="mb-6">
        <JobsMap appointments={appointments} />
      </div>

      {/* Appointment detail table */}
      <div className="mb-6">
        <Panel title={`Appointments — ${appointments.length} total`}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-muted border-b border-line">
                  <th className="pb-2 pr-4 font-medium">JK #</th>
                  <th className="pb-2 pr-4 font-medium">Customer</th>
                  <th className="pb-2 pr-4 font-medium">Market</th>
                  <th className="pb-2 pr-4 font-medium">Truck</th>
                  <th className="pb-2 pr-4 font-medium text-right">Revenue</th>
                  <th className="pb-2 pr-4 font-medium">Payment</th>
                  <th className="pb-2 pr-4 font-medium">Duration</th>
                  <th className="pb-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {appointments.map((a, i) => (
                  <tr key={a.job_id ?? i} className="border-b border-line last:border-0 hover:bg-panel/50">
                    <td className="py-2.5 pr-4 font-mono text-xs text-muted">{a.job_id || "—"}</td>
                    <td className="py-2.5 pr-4 font-medium">{a.customer_name || "—"}</td>
                    <td className="py-2.5 pr-4 text-muted">{a.market?.replace("Junk King ", "") || "—"}</td>
                    <td className="py-2.5 pr-4 text-muted">{a.truck || "—"}</td>
                    <td className="py-2.5 pr-4 tabular-nums text-right">
                      {a.appointment_type?.toLowerCase() === "estimate"
                        ? <span className="text-muted">—</span>
                        : <span className="font-medium">{a.revenue || "—"}</span>}
                    </td>
                    <td className="py-2.5 pr-4 text-xs">
                      {a.payment_type === "Credit Card" && <span className="text-accent">💳 CC</span>}
                      {a.payment_type === "Cash" && <span className="text-good">💵 Cash</span>}
                      {a.payment_type === "Billed" && <span className="text-warn">📋 Billed</span>}
                      {a.payment_type === "Check" && <span className="text-ink">✏️ Check</span>}
                      {(!a.payment_type || (a.payment_type !== "Credit Card" && a.payment_type !== "Cash" && a.payment_type !== "Billed" && a.payment_type !== "Check")) && <span className="text-muted">{a.payment_type || "—"}</span>}
                    </td>
                    <td className="py-2.5 pr-4 text-muted text-xs tabular-nums">
                      {durationFromStatus(a.job_status ?? "")}
                    </td>
                    <td className="py-2.5">{statusBadge(a.job_status ?? "", a.appointment_type ?? "")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-xs text-muted">Estimates are excluded from revenue totals · Duration extracted from Junkware status field · Load size &amp; other charges require per-job detail scrape</p>
        </Panel>
      </div>

      {/* Charts */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Jobs by Truck">
          <BarChart labels={jobsByTruck.map(([l]) => l)} values={jobsByTruck.map(([, v]) => v)} />
        </Panel>
        <Panel title="Jobs by Market">
          <BarChart labels={jobsByMarket.map(([l]) => l)} values={jobsByMarket.map(([, v]) => v)} />
        </Panel>
      </div>
    </Shell>
  );
}
