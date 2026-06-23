import { MetricCard } from "@/components/MetricCard";
import { Panel } from "@/components/Panel";
import { Shell } from "@/components/Shell";
import { Table } from "@/components/Table";
import { getDailyMetrics, money } from "@/lib/metrics";
import { reportDateLabel, resolveReportDate } from "@/lib/report-dates";
import type { Appointment, TruckExpenses } from "@/types/metrics";

function toMoneyNumber(value?: string): number {
  const parsed = Number(String(value ?? "").replace(/[$,]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function totalsByPaymentType(appointments?: Appointment[]) {
  const totals = { "Credit Card": 0, Cash: 0, Check: 0, Other: 0 };
  for (const appt of appointments ?? []) {
    if ((appt.appointment_type ?? "").toLowerCase() === "estimate") continue;
    const amount = toMoneyNumber(appt.revenue);
    const paymentType = (appt.payment_type ?? "").trim();
    if (!amount) continue;
    if (paymentType === "Credit Card") totals["Credit Card"] += amount;
    else if (paymentType === "Cash") totals.Cash += amount;
    else if (paymentType === "Check") totals.Check += amount;
    else totals.Other += amount;
  }
  return totals;
}

function totalTipsFromAppointments(appointments?: Appointment[]): number {
  return (appointments ?? []).reduce((sum, a) => sum + toMoneyNumber(a.tip), 0);
}

function expenseRow(label: string, value: number) {
  if (value === 0) return null;
  return (
    <tr className="border-b border-line/50 last:border-0">
      <td className="py-2 pr-4 text-muted">{label}</td>
      <td className="py-2 tabular-nums text-right text-red-400 font-semibold">− {money(value)}</td>
    </tr>
  );
}

export default async function FinancePage({ searchParams }: { searchParams?: { date?: string | string[] } }) {
  const selectedDate = resolveReportDate(searchParams?.date);
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

  const unmatched = metrics.unmatched_payments ?? [];
  const paymentTotals = totalsByPaymentType(metrics.appointments);

  const totalTips = metrics.total_tips ?? totalTipsFromAppointments(metrics.appointments);
  const totalExpenses = metrics.total_expenses ?? 0;
  const expensesByTruck: Record<string, TruckExpenses> = metrics.expenses_by_truck ?? {};

  // Aggregate expense columns for the summary table
  const expenseTotals = Object.values(expensesByTruck).reduce(
    (acc: { dumps: number; gas: number; recycling: number; other: number }, e) => ({
      dumps: acc.dumps + (e.dumps ?? 0),
      gas: acc.gas + (e.gas ?? 0),
      recycling: acc.recycling + (e.recycling ?? 0),
      other: acc.other + (e.other ?? 0),
    }),
    { dumps: 0, gas: 0, recycling: 0, other: 0 }
  );

  const hasExpenses = totalExpenses > 0;
  const hasTips = totalTips > 0;
  // Trucks with any non-zero expense
  const trucksWithExpenses = Object.entries(expensesByTruck).filter(([, e]) => (e.total ?? 0) > 0);

  return (
    <Shell dataStatus={dataStatus} lastUpdated={lastUpdated} selectedDate={reportDate}>
      <div className="mb-6">
        <h2 className="text-xl font-semibold">Finance</h2>
        <p className="mt-1 text-sm text-muted">
          Revenue, tips, expenses, and collection status for {reportDate ? reportDateLabel(reportDate) : "today"}.
        </p>
      </div>

      {/* Revenue waterfall */}
      <div className="grid gap-4 sm:grid-cols-3 mb-6">
        <MetricCard
          label="Gross Revenue"
          value={money(metrics?.total_revenue)}
          sublabel="All jobs, estimates excluded"
        />
        <MetricCard
          label="Tips"
          value={money(totalTips)}
          highlight={hasTips ? "positive" : "neutral"}
          sublabel="Gratuity collected"
        />
        <MetricCard
          label="CC Fees (3%)"
          value={`− ${money(metrics?.cc_fees)}`}
          highlight="negative"
          sublabel="Credit card processing"
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-3 mb-6">
        <MetricCard
          label="Total Expenses"
          value={hasExpenses ? `− ${money(totalExpenses)}` : money(0)}
          highlight={hasExpenses ? "negative" : "neutral"}
          sublabel="Dumps, gas, recycling, other"
        />
        <MetricCard
          label="Net Revenue"
          value={money(metrics?.net_revenue)}
          highlight="positive"
          sublabel="After CC fees"
        />
        <MetricCard
          label="Net Operating"
          value={money((metrics?.net_revenue ?? 0) + totalTips - totalExpenses)}
          highlight="positive"
          sublabel="Net rev + tips − expenses"
        />
      </div>

      {/* Collection status */}
      <div className="grid gap-4 sm:grid-cols-2 mb-6">
        <MetricCard
          label="Collected Today (QBO)"
          value={money(metrics?.total_payments_collected)}
          sublabel="Sales receipts marked Paid"
        />
        <MetricCard
          label="Not Yet Collected"
          value={money(metrics?.revenue_not_yet_collected)}
          highlight={metrics?.revenue_not_yet_collected && metrics.revenue_not_yet_collected > 0 ? "warn" : "neutral"}
          sublabel="Booked but not in QBO"
        />
      </div>

      <div className="mb-6">
        <Panel title="Payments by Type">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <MetricCard label="Credit Card" value={money(paymentTotals["Credit Card"])} sublabel="Card jobs today" />
            <MetricCard label="Cash" value={money(paymentTotals.Cash)} sublabel="Cash jobs today" />
            <MetricCard label="Checks" value={money(paymentTotals.Check)} sublabel="Check jobs today" />
            <MetricCard label="Other" value={money(paymentTotals.Other)} sublabel="Billed / unclassified" />
          </div>
        </Panel>
      </div>

      {/* Expenses breakdown */}
      <div className="mb-6">
        <Panel title="Expenses by Truck">
          {hasExpenses ? (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-muted border-b border-line">
                  <th className="pb-2 pr-4 font-medium">Truck</th>
                  <th className="pb-2 pr-4 font-medium text-right">Dumps</th>
                  <th className="pb-2 pr-4 font-medium text-right">Gas</th>
                  <th className="pb-2 pr-4 font-medium text-right">Recycling</th>
                  <th className="pb-2 pr-4 font-medium text-right">Other</th>
                  <th className="pb-2 font-medium text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {trucksWithExpenses.map(([truck, e]) => (
                  <tr key={truck} className="border-b border-line/50 last:border-0">
                    <td className="py-2 pr-4 font-medium">{truck}</td>
                    <td className="py-2 pr-4 tabular-nums text-right text-muted">{(e.dumps ?? 0) > 0 ? money(e.dumps) : "—"}</td>
                    <td className="py-2 pr-4 tabular-nums text-right text-muted">{(e.gas ?? 0) > 0 ? money(e.gas) : "—"}</td>
                    <td className="py-2 pr-4 tabular-nums text-right text-muted">{(e.recycling ?? 0) > 0 ? money(e.recycling) : "—"}</td>
                    <td className="py-2 pr-4 tabular-nums text-right text-muted">{(e.other ?? 0) > 0 ? money(e.other) : "—"}</td>
                    <td className="py-2 tabular-nums text-right font-semibold text-red-400">− {money(e.total)}</td>
                  </tr>
                ))}
                <tr className="border-t-2 border-line">
                  <td className="py-2 pr-4 font-semibold text-muted">Total</td>
                  <td className="py-2 pr-4 tabular-nums text-right">{expenseTotals.dumps > 0 ? money(expenseTotals.dumps) : "—"}</td>
                  <td className="py-2 pr-4 tabular-nums text-right">{expenseTotals.gas > 0 ? money(expenseTotals.gas) : "—"}</td>
                  <td className="py-2 pr-4 tabular-nums text-right">{expenseTotals.recycling > 0 ? money(expenseTotals.recycling) : "—"}</td>
                  <td className="py-2 pr-4 tabular-nums text-right">{expenseTotals.other > 0 ? money(expenseTotals.other) : "—"}</td>
                  <td className="py-2 tabular-nums text-right font-bold text-red-400">− {money(totalExpenses)}</td>
                </tr>
              </tbody>
            </table>
          ) : (
            <p className="text-sm text-muted">No expenses recorded for this date — dump, gas, recycling, and other fields are blank in Junkware truck records.</p>
          )}
        </Panel>
      </div>

      {/* Tips breakdown by appointment */}
      {hasTips && (
        <div className="mb-6">
          <Panel title="Tips by Job">
            <Table
              columns={["Job #", "Customer", "Truck", "Revenue", "Tip", "Payment"]}
              rows={(metrics?.appointments ?? [])
                .filter((a) => toMoneyNumber(a.tip) > 0)
                .map((a) => [
                  a.job_id ?? "—",
                  a.customer_name ?? "—",
                  a.truck ?? "—",
                  a.revenue ?? "—",
                  money(toMoneyNumber(a.tip)),
                  a.payment_type ?? "—",
                ])}
            />
          </Panel>
        </div>
      )}

      {/* Revenue by market */}
      <div className="mb-6">
        <Panel title="Revenue by Market">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-muted border-b border-line">
                <th className="pb-2 pr-4 font-medium">Market</th>
                <th className="pb-2 font-medium text-right">Revenue</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(metrics?.revenue_by_market ?? {}).map(([market, rev]) => (
                <tr key={market} className="border-b border-line/50 last:border-0">
                  <td className="py-2 pr-4">{market}</td>
                  <td className="py-2 tabular-nums text-right font-semibold">{money(rev as number)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      </div>

      {/* Unmatched payments */}
      {unmatched.length > 0 && (
        <Panel title="Unmatched Payments — Needs Review">
          <Table
            columns={["Invoice #", "Customer", "Amount"]}
            rows={(unmatched as { invoice_number?: string; customer_name?: string; payment_amount?: number }[]).map(
              (p) => [p.invoice_number ?? "—", p.customer_name ?? "—", money(p.payment_amount ?? 0)]
            )}
          />
        </Panel>
      )}
    </Shell>
  );
}
