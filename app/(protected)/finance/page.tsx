import Link from "next/link";
import PageHeader from "@/components/PageHeader";
import CrewDataRefresh from "@/components/CrewDataRefresh";
import OpsMonthSelector from "@/components/OpsMonthSelector";
import PaymentReconciliationPanel from "@/components/PaymentReconciliationPanel";
import ResaleInventory from "@/components/ResaleInventory";
import {
  AnyRecord,
  money,
  readMetrics,
  resolveDate,
} from "@/lib/opsData";
import { buildFinanceTrendSummary, buildMonthlySummary, monthOptions } from "@/lib/monthly-summary";
import {
  buildDailyPaymentReconciliation,
  buildMonthlyPaymentReconciliation,
} from "@/lib/payment-reconciliation";
import { buildSearchKingsView } from "@/lib/searchkings";
import { readResaleStore } from "@/lib/resale-items";
import { readCrewExpenseRecords } from "@/lib/whatsapp-crew-expenses";
import { jobScheduleHref } from "@/lib/related-record-links";

export const dynamic = "force-dynamic";

function normalizeView(value: unknown): "daily" | "monthly" {
  return String(value || "").toLowerCase() === "monthly" ? "monthly" : "daily";
}

function financeHref(date: string, view: "daily" | "monthly", section = "overview"): string {
  return `/finance?date=${encodeURIComponent(date)}&view=${view}&section=${section}`;
}

function FinanceModeSwitch({ date, view }: { date: string; view: "daily" | "monthly" }) {
  return (
    <nav className="ops-view-toggle ops-finance-mode-switch" aria-label="Finance time scope">
      <Link href={financeHref(date, "daily")} className={view === "daily" ? "active" : ""} aria-current={view === "daily" ? "page" : undefined}>
        Daily close
      </Link>
      <Link href={financeHref(date, "monthly")} className={view === "monthly" ? "active" : ""} aria-current={view === "monthly" ? "page" : undefined}>
        Month to date
      </Link>
    </nav>
  );
}

function toNumber(value: unknown): number {
  return Number(value || 0);
}

function percent(value: number): string {
  return `${value.toFixed(2)}%`;
}

function signedMoney(value: number): string {
  const sign = value > 0 ? "+" : value < 0 ? "−" : "";
  return `${sign}${money(Math.abs(value))}`;
}

function changePercent(current: number, previous: number): string {
  if (previous === 0) return "—";
  const value = ((current - previous) / Math.abs(previous)) * 100;
  return `${value > 0 ? "+" : ""}${percent(value)}`;
}

function previousMonthKey(value: string): string {
  const date = new Date(`${value}-01T12:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() - 1);
  return date.toISOString().slice(0, 7);
}

const FINANCE_TERRITORY_ORDER = [
  "Baton Rouge",
  "Jefferson Parish",
  "New Orleans",
  "Northshore",
  "Unknown territory",
];

function normalizeFinanceTerritory(value: unknown): string {
  const raw = String(value || "").trim();
  const normalized = raw.replace(/^junk\s+king\s+/i, "").trim();
  const lower = normalized.toLowerCase();

  if (!normalized || lower.includes("unknown")) return "Unknown territory";
  if (lower.includes("baton rouge") || lower === "br") return "Baton Rouge";
  if (lower.includes("jefferson parish") || lower === "jp") return "Jefferson Parish";
  if (lower.includes("new orleans") || lower === "no") return "New Orleans";
  if (lower.includes("northshore") || lower.includes("north shore")) return "Northshore";
  return normalized;
}

function financeTerritoryRank(territory: string): number {
  const rank = FINANCE_TERRITORY_ORDER.indexOf(territory);
  return rank === -1 ? FINANCE_TERRITORY_ORDER.length - 1 : rank;
}

function sumValues(entries: AnyRecord[], keys: string[]): number {
  return entries.reduce((sum, entry) => {
    for (const key of keys) {
      const value = entry?.[key];
      if (value !== undefined && value !== null && value !== "") {
        const n = Number(value);
        if (Number.isFinite(n)) return sum + n;
      }
    }
    return sum;
  }, 0);
}

function appointmentPaymentTotals(entries: AnyRecord[]): {
  cash: number;
  check: number;
  billed: number;
  card: number | null;
} {
  const cash = entries.reduce((sum, entry) => {
    const appointments = Array.isArray(entry?.appointments) ? entry.appointments : [];
    return sum + appointments.reduce((inner, appointment) => {
      const paymentType = String(appointment?.payment_type || appointment?.paymentType || "").toLowerCase();
      const amount = Number(appointment?.payment_amount || appointment?.paymentAmount || appointment?.amount || 0);
      if (!Number.isFinite(amount)) return inner;
      if (paymentType.includes("cash")) return inner + amount;
      return inner;
    }, 0);
  }, 0);

  const check = entries.reduce((sum, entry) => {
    const appointments = Array.isArray(entry?.appointments) ? entry.appointments : [];
    return sum + appointments.reduce((inner, appointment) => {
      const paymentType = String(appointment?.payment_type || appointment?.paymentType || "").toLowerCase();
      const amount = Number(appointment?.payment_amount || appointment?.paymentAmount || appointment?.amount || 0);
      if (!Number.isFinite(amount)) return inner;
      if (paymentType.includes("check")) return inner + amount;
      return inner;
    }, 0);
  }, 0);

  const billed = entries.reduce((sum, entry) => {
    const appointments = Array.isArray(entry?.appointments) ? entry.appointments : [];
    return sum + appointments.reduce((inner, appointment) => {
      const paymentType = String(appointment?.payment_type || appointment?.paymentType || "").toLowerCase();
      const amount = Number(appointment?.payment_amount || appointment?.paymentAmount || appointment?.amount || 0);
      if (!Number.isFinite(amount)) return inner;
      if (paymentType.includes("bill")) return inner + amount;
      return inner;
    }, 0);
  }, 0);

  return { cash, check, billed, card: null };
}

function renderMonthlyFinancePage(date: string, metrics: AnyRecord | null, requestedSection: string) {
  const section = ["overview", "reconciliation", "expenses", "territory", "trend", "resale"].includes(requestedSection)
    ? requestedSection
    : "overview";
  const monthlySummary = buildMonthlySummary(date);
  const { range, entries, authority: monthlyAuthority } = monthlySummary;
  const summaryMetrics = readMetrics(range.dataThroughDate);
  const sales = monthlySummary.grossRevenue;
  const bonuses = sumValues(entries.map((entry) => entry.metrics), ["bonuses", "daily_bonus_payroll"]);
  const regularPay = sumValues(entries.map((entry) => entry.metrics), ["regular_payroll"]);
  const payroll = sumValues(entries.map((entry) => entry.metrics), ["total_payroll", "payroll"]) || regularPay + bonuses;
  const dumpExpense = sumValues(entries.map((entry) => entry.metrics), ["dump_expense"]);
  const fuelExpense = sumValues(entries.map((entry) => entry.metrics), ["fuel_expense"]);
  const recyclingExpense = sumValues(entries.map((entry) => entry.metrics), ["recycling_expense"]);
  const otherExpense = sumValues(entries.map((entry) => entry.metrics), ["other_expense"]);
  const junkKingRoyalties = sumValues(entries.map((entry) => entry.metrics), ["junk_king_royalties"]);
  const callCenterRoyalties = sumValues(entries.map((entry) => entry.metrics), ["call_center_royalties"]);
  const totalOperatingExpenses = sumValues(entries.map((entry) => entry.metrics), ["total_expenses"]);
  const estimatedOperatingProfit = sumValues(entries.map((entry) => entry.metrics), ["net_profit"]);
  const operatingMargin = sales > 0 ? (estimatedOperatingProfit / sales) * 100 : 0;
  const paymentTotals = appointmentPaymentTotals(entries.map((entry) => entry.metrics));
  const paymentReconciliation = buildMonthlyPaymentReconciliation(range.dates);
  const marketing = buildSearchKingsView(range.monthKey);
  const financeTrend = buildFinanceTrendSummary(date);
  const previousMonth = financeTrend.previousMonth;
  const monthRevenueChange = previousMonth ? sales - previousMonth.grossRevenue : null;
  const monthProfitChange = previousMonth
    ? estimatedOperatingProfit - previousMonth.estimatedOperatingProfit
    : null;
  const monthJobsChange = previousMonth ? monthlySummary.completedJobs - previousMonth.completedJobs : null;
  const ytdMargin = financeTrend.yearToDate.grossRevenue > 0
    ? (financeTrend.yearToDate.estimatedOperatingProfit / financeTrend.yearToDate.grossRevenue) * 100
    : 0;
  const showTrend = section === "trend";

  const revenueByTerritory = new Map<string, number>();
  const expenseByCategory = new Map<string, number>();
  const dailyTrend = entries.map((entry) => ({
    date: entry.date,
    revenue: Number(entry.metrics.total_revenue || entry.metrics.gross_revenue || entry.metrics.sales || 0),
    expenses: Number(entry.metrics.total_expenses || 0),
  }));

  for (const entry of entries) {
    const revenueByMarket = entry.metrics.revenue_by_market || {};
    for (const [territory, value] of Object.entries(revenueByMarket)) {
      const amount = Number(value || 0);
      const normalizedTerritory = normalizeFinanceTerritory(territory);
      revenueByTerritory.set(
        normalizedTerritory,
        (revenueByTerritory.get(normalizedTerritory) || 0) + amount
      );
    }

    const truckExpenses = entry.metrics.truck_record_financial_summary || {};
    expenseByCategory.set("Payroll", (expenseByCategory.get("Payroll") || 0) + Number(entry.metrics.total_payroll || entry.metrics.payroll || 0));
    expenseByCategory.set("Dump Expense", (expenseByCategory.get("Dump Expense") || 0) + Number(entry.metrics.dump_expense || truckExpenses.dump_expense || 0));
    expenseByCategory.set("Fuel Expense", (expenseByCategory.get("Fuel Expense") || 0) + Number(entry.metrics.fuel_expense || truckExpenses.fuel_expense || 0));
    expenseByCategory.set("Recycling Expense", (expenseByCategory.get("Recycling Expense") || 0) + Number(entry.metrics.recycling_expense || truckExpenses.recycling_expense || 0));
    expenseByCategory.set("Other Expense", (expenseByCategory.get("Other Expense") || 0) + Number(entry.metrics.other_expense || truckExpenses.other_expense || 0));
  }

  return (
    <div className="ops-dashboard ops-finance-page">
      <PageHeader
        title="Finance"
        subtitle={`Monthly summary for ${range.monthDisplay} · ${range.warningLabel} · Data through ${range.dataThroughLabel}`}
        date={date}
        showDateSelector={false}
        dateLabel="Month"
        lastUpdated={monthlyAuthority?.verifiedAt || summaryMetrics?.generated_at || metrics?.generated_at}
        controls={
          <>
            <FinanceModeSwitch date={date} view="monthly" />
            <OpsMonthSelector months={monthOptions()} selectedMonthKey={range.monthKey} />
          </>
        }
        sections={[
          { label: "P&L summary", href: financeHref(date, "monthly"), active: section === "overview" },
          { label: "Payments & recon", href: financeHref(date, "monthly", "reconciliation"), active: section === "reconciliation" },
          { label: "Costs", href: financeHref(date, "monthly", "expenses"), active: section === "expenses" },
          { label: "Territory", href: financeHref(date, "monthly", "territory"), active: section === "territory" },
          { label: "Trend", href: financeHref(date, "monthly", "trend"), active: section === "trend" },
          { label: "Resale inventory", href: financeHref(date, "monthly", "resale"), active: section === "resale" },
        ]}
      />

      <div className={section === "overview" ? "ops-kpi-row" : "ops-section-hidden"} id="finance-overview">
        <div className="ops-card ops-kpi-card">
          <div className="ops-card-title">Gross Revenue</div>
          <div className="ops-kpi-value ops-kpi-accent">{money(sales)}</div>
          {monthlyAuthority && (
            <div className={`ops-kpi-sub ${monthlyAuthority.revenueDelta !== 0 ? "ops-kpi-sub-warn" : ""}`}>
              {monthlyAuthority.revenueDelta !== 0
                ? `${money(monthlyAuthority.itemizedRevenue)} itemized · ${money(monthlyAuthority.revenueDelta)} awaiting itemization`
                : "Reconciled to JunkWare Dashboard"}
            </div>
          )}
        </div>
        <div className="ops-card ops-kpi-card"><div className="ops-card-title">Estimated Operating Profit</div><div className="ops-kpi-value ops-kpi-good">{money(estimatedOperatingProfit)}</div></div>
        <div className="ops-card ops-kpi-card"><div className="ops-card-title">Operating Margin</div><div className="ops-kpi-value">{percent(operatingMargin)}</div></div>
        <div className="ops-card ops-kpi-card"><div className="ops-card-title">Operating Expenses</div><div className="ops-kpi-value">{money(totalOperatingExpenses)}</div></div>
      </div>

      <div className="ops-dashboard-main ops-finance-layout">
        <div className={section === "resale" ? "" : "ops-section-hidden"} id="finance-resale">
          <ResaleInventory initialItems={readResaleStore().items} />
        </div>

        <div id="finance-reconciliation" className={section === "reconciliation" ? "" : "ops-section-hidden"}><PaymentReconciliationPanel
            view={paymentReconciliation}
            periodLabel={range.monthDisplay}
          /></div>

        <div className={section === "reconciliation" ? "ops-card" : "ops-section-hidden"} id="finance-collections">
          <div className="ops-card-header compact">
            <div>
              <div className="ops-section-title">Collections & Payment Status</div>
              <div className="ops-muted">
                JunkWare remains authoritative for cash, checks, billed payments, and tips. Card verification is shown in the reconciliation panel.
              </div>
            </div>
          </div>

          <div className="ops-summary-list">
            <div><span>Cash collected</span><strong>{money(paymentTotals.cash)}</strong></div>
            <div><span>Card payments reported by JunkWare</span><strong>{money(paymentReconciliation.summary.junkware_total)}</strong></div>
            <div><span>Check payments</span><strong>{money(paymentTotals.check)}</strong></div>
            <div><span>Billed revenue</span><strong>{money(paymentTotals.billed)}</strong></div>
            <div><span>Card processing fees</span><strong>{paymentReconciliation.merchantCenterAvailable ? money(paymentReconciliation.summary.processing_fees) : "Unavailable"}</strong></div>
          </div>
        </div>

        <div className={section === "expenses" ? "ops-card" : "ops-section-hidden"} id="finance-expenses">
          <div className="ops-card-header compact">
            <div>
              <div className="ops-section-title">Expenses by Category</div>
              <div className="ops-muted">Payroll Expense excludes tips. Royalties are computed from Sales.</div>
            </div>
          </div>
          <div className="ops-summary-list">
            <div><span>Payroll Expense</span><strong>{money(payroll)}</strong></div>
            <div><span>Bonuses</span><strong>{money(bonuses)}</strong></div>
            <div><span>Dump Expense</span><strong>{money(dumpExpense)}</strong></div>
            <div><span>Fuel Expense</span><strong>{money(fuelExpense)}</strong></div>
            <div><span>Recycling Expense</span><strong>{money(recyclingExpense)}</strong></div>
            <div><span>Other Operating Expenses</span><strong>{money(otherExpense)}</strong></div>
            <div><span>Junk King Royalties — 8%</span><strong>{money(junkKingRoyalties)}</strong></div>
            <div><span>Call Center Royalties — 5%</span><strong>{money(callCenterRoyalties)}</strong></div>
            <div>
              <span>SearchKings Ad Spend <small className="ops-table-subline">Reported separately; not added again to operating expenses</small></span>
              <strong>{marketing.available ? money(marketing.spend) : "Unavailable"}</strong>
            </div>
            <div><span>Total Operating Expenses</span><strong>{money(totalOperatingExpenses)}</strong></div>
          </div>
        </div>

        <div className={section === "territory" ? "ops-card" : "ops-section-hidden"} id="finance-territory">
          <div className="ops-card-header compact">
            <div>
              <div className="ops-section-title">Revenue by Territory</div>
              <div className="ops-muted">Derived from published daily records for the selected month.</div>
            </div>
          </div>
          <table className="ops-table">
            <thead>
              <tr>
                <th>Territory</th>
                <th>Revenue</th>
              </tr>
            </thead>
            <tbody>
              {Array.from(revenueByTerritory.entries())
                .sort(([territoryA], [territoryB]) =>
                  financeTerritoryRank(territoryA) - financeTerritoryRank(territoryB) ||
                  territoryA.localeCompare(territoryB)
                )
                .map(([territory, value]) => (
                  <tr key={territory}>
                    <td><strong>{territory}</strong></td>
                    <td className="ops-money">{money(value)}</td>
                  </tr>
                ))}
              {revenueByTerritory.size === 0 && (
                <tr><td colSpan={2} className="ops-muted">No revenue-by-territory data available.</td></tr>
              )}
            </tbody>
          </table>
        </div>

        <div className={section === "expenses" ? "ops-card" : "ops-section-hidden"}>
          <div className="ops-card-header compact">
            <div>
              <div className="ops-section-title">Expense by Category</div>
              <div className="ops-muted">Current monthly totals from published daily finance records.</div>
            </div>
          </div>
          <table className="ops-table">
            <thead>
              <tr>
                <th>Category</th>
                <th>Amount</th>
              </tr>
            </thead>
            <tbody>
              {Array.from(expenseByCategory.entries()).map(([category, value]) => (
                <tr key={category}>
                  <td><strong>{category}</strong></td>
                  <td className="ops-money">{money(value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className={showTrend ? "ops-card ops-finance-trend-card" : "ops-section-hidden"} id="finance-trend">
          <div className="ops-card-header compact">
            <div>
              <div className="ops-section-title">Financial Trend</div>
              <div className="ops-muted">
                Month-to-month performance and year-to-date totals. Revenue uses the reconciled JunkWare monthly total when available.
              </div>
            </div>
          </div>

          <div className="ops-finance-trend-summary">
            <div>
              <span>{range.monthDisplay} revenue</span>
              <strong>{money(sales)}</strong>
              {previousMonth ? (
                <small className="ops-table-subline">
                  {signedMoney(monthRevenueChange ?? 0)} vs {previousMonth.monthDisplay}
                  {` · ${changePercent(sales, previousMonth.grossRevenue)}`}
                </small>
              ) : <small className="ops-table-subline">No prior published month to compare.</small>}
            </div>
            <div>
              <span>{range.monthDisplay} operating profit</span>
              <strong>{money(estimatedOperatingProfit)}</strong>
              {previousMonth ? (
                <small className="ops-table-subline">
                  {signedMoney(monthProfitChange ?? 0)} vs {previousMonth.monthDisplay}
                  {` · ${changePercent(estimatedOperatingProfit, previousMonth.estimatedOperatingProfit)}`}
                </small>
              ) : <small className="ops-table-subline">No prior published month to compare.</small>}
            </div>
            <div>
              <span>{range.monthDisplay} completed jobs</span>
              <strong>{monthlySummary.completedJobs.toLocaleString("en-US")}</strong>
              {previousMonth ? (
                <small className="ops-table-subline">
                  {monthJobsChange && monthJobsChange > 0 ? "+" : ""}{monthJobsChange ?? 0} vs {previousMonth.monthDisplay}
                  {` · ${changePercent(monthlySummary.completedJobs, previousMonth.completedJobs)}`}
                </small>
              ) : <small className="ops-table-subline">No prior published month to compare.</small>}
            </div>
            <div>
              <span>{financeTrend.yearToDate.year} year to date revenue</span>
              <strong>{money(financeTrend.yearToDate.grossRevenue)}</strong>
              <small className="ops-table-subline">Through {financeTrend.yearToDate.throughMonth}</small>
            </div>
            <div>
              <span>{financeTrend.yearToDate.year} year to date operating profit</span>
              <strong>{money(financeTrend.yearToDate.estimatedOperatingProfit)}</strong>
              <small className="ops-table-subline">{percent(ytdMargin)} margin · {financeTrend.yearToDate.completedJobs.toLocaleString("en-US")} completed jobs</small>
            </div>
          </div>

          <div className="ops-section-spacer" />

          <div className="ops-card-header compact">
            <div>
              <div className="ops-section-title">Monthly Financial Trend</div>
              <div className="ops-muted">Each monthly total is labeled when the month is still in progress or has missing published days.</div>
            </div>
          </div>
          <div className="ops-finance-table-scroll">
            <table className="ops-table">
              <thead>
                <tr><th>Month</th><th>Revenue</th><th>Expenses</th><th>Operating Profit</th><th>Jobs</th></tr>
              </thead>
              <tbody>
                {financeTrend.months.slice().reverse().map((month) => {
                  const previous = financeTrend.months.find((item) => item.monthKey === previousMonthKey(month.monthKey)) ?? null;
                  const revenueChange = previous ? month.grossRevenue - previous.grossRevenue : null;
                  const expenseChange = previous ? month.totalOperatingExpenses - previous.totalOperatingExpenses : null;
                  const profitChange = previous ? month.estimatedOperatingProfit - previous.estimatedOperatingProfit : null;
                  const jobsChange = previous ? month.completedJobs - previous.completedJobs : null;
                  return (
                    <tr key={month.monthKey}>
                      <td>
                        <strong>{month.monthDisplay}</strong>
                        {!month.complete ? <div className="ops-table-subline">Data through {month.dataThroughDate}</div> : null}
                      </td>
                      <td className="ops-money">
                        {money(month.grossRevenue)}
                        <div className="ops-table-subline">{revenueChange === null ? "No prior month" : `${signedMoney(revenueChange)} · ${changePercent(month.grossRevenue, previous!.grossRevenue)}`}</div>
                      </td>
                      <td className="ops-money">
                        {money(month.totalOperatingExpenses)}
                        <div className="ops-table-subline">{expenseChange === null ? "No prior month" : `${signedMoney(expenseChange)} · ${changePercent(month.totalOperatingExpenses, previous!.totalOperatingExpenses)}`}</div>
                      </td>
                      <td className="ops-money">
                        {money(month.estimatedOperatingProfit)}
                        <div className="ops-table-subline">{profitChange === null ? "No prior month" : `${signedMoney(profitChange)} · ${changePercent(month.estimatedOperatingProfit, previous!.estimatedOperatingProfit)}`}</div>
                      </td>
                      <td>
                        {month.completedJobs.toLocaleString("en-US")}
                        <div className="ops-table-subline">{jobsChange === null ? "No prior month" : `${jobsChange > 0 ? "+" : ""}${jobsChange.toLocaleString("en-US")} · ${changePercent(month.completedJobs, previous!.completedJobs)}`}</div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className={section === "trend" ? "" : "ops-section-hidden"}>
            <div className="ops-section-spacer" />

            <div className="ops-card-header compact">
              <div>
                <div className="ops-section-title">Daily Revenue and Expense Trend</div>
                <div className="ops-muted">Daily detail for {range.monthDisplay}; changes are against the prior published day.</div>
              </div>
            </div>
            <div className="ops-finance-table-scroll">
              <table className="ops-table">
                <thead>
                  <tr><th>Date</th><th>Revenue</th><th>Expenses</th></tr>
                </thead>
                <tbody>
                  {dailyTrend.map((row, index) => {
                    const previous = index > 0 ? dailyTrend[index - 1] : null;
                    const revenueChange = previous ? row.revenue - previous.revenue : null;
                    const expenseChange = previous ? row.expenses - previous.expenses : null;
                    return (
                      <tr key={row.date}>
                        <td>{row.date}</td>
                        <td className="ops-money">
                          {money(row.revenue)}
                          <div className="ops-table-subline">{revenueChange === null ? "No prior day" : `${signedMoney(revenueChange)} · ${changePercent(row.revenue, previous!.revenue)}`}</div>
                        </td>
                        <td className="ops-money">
                          {money(row.expenses)}
                          <div className="ops-table-subline">{expenseChange === null ? "No prior day" : `${signedMoney(expenseChange)} · ${changePercent(row.expenses, previous!.expenses)}`}</div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default async function FinancePage({
  searchParams,
}: {
  searchParams?: Promise<AnyRecord>;
}) {
  const params = searchParams ? await searchParams : undefined;
  const date = resolveDate(params);
  const view = normalizeView(params?.view);
  const requestedSection = String(params?.section || "overview").toLowerCase();
  const currentDate = new Date();
  const todayParts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(currentDate);
  const todayValues = Object.fromEntries(todayParts.map((part) => [part.type, part.value]));
  const today = `${todayValues.year}-${todayValues.month}-${todayValues.day}`;
  const yesterdayParts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(currentDate.getTime() - 24 * 60 * 60 * 1000));
  const yesterdayValues = Object.fromEntries(yesterdayParts.map((part) => [part.type, part.value]));
  const yesterday = `${yesterdayValues.year}-${yesterdayValues.month}-${yesterdayValues.day}`;
  const isLivePaymentWindow = date === today || date === yesterday;
  const metrics = readMetrics(date);

  const financeSummary = metrics?.truck_record_financial_summary || {};
  const truckRows = Array.isArray(metrics?.truck_record_financial_rows)
    ? metrics.truck_record_financial_rows
    : [];
  const crewTruckRecords = readCrewExpenseRecords(date);
  const crewTruckRecordCost = crewTruckRecords.reduce((sum, record) => sum + record.cost, 0);

  const sales = toNumber(metrics?.sales ?? financeSummary.sales ?? metrics?.total_revenue ?? metrics?.gross_revenue);
  const tips = toNumber(metrics?.tips ?? financeSummary.tips ?? metrics?.total_tips);
  const bonuses = toNumber(metrics?.bonuses ?? financeSummary.bonuses ?? metrics?.daily_bonus_payroll);
  const regularPay = toNumber(metrics?.regular_payroll);
  const payroll = toNumber(metrics?.payroll ?? financeSummary.payroll ?? regularPay + bonuses);
  const dumpExpense = toNumber(metrics?.dump_expense ?? financeSummary.dump_expense);
  const fuelExpense = toNumber(metrics?.fuel_expense ?? financeSummary.fuel_expense);
  const otherExpense = toNumber(metrics?.other_expense ?? financeSummary.other_expense);
  const junkKingRoyalties = toNumber(
    metrics?.junk_king_royalties ?? financeSummary.junk_king_royalties ?? sales * 0.08
  );
  const callCenterRoyalties = toNumber(
    metrics?.call_center_royalties ?? financeSummary.call_center_royalties ?? sales * 0.05
  );
  const totalExpenses = toNumber(metrics?.total_expenses ?? financeSummary.total_expenses);
  const netProfit = toNumber(metrics?.net_profit ?? financeSummary.net_profit ?? sales - totalExpenses);
  const netMargin = sales > 0 ? (netProfit / sales) * 100 : 0;
  const employeeTotalEarnings = regularPay + bonuses + tips;
  const paymentReconciliation = buildDailyPaymentReconciliation(date);

  if (view === "monthly") {
    return renderMonthlyFinancePage(date, metrics, requestedSection);
  }
  const dailySection = requestedSection === "reconciliation" ? "payments" : requestedSection;
  const section = ["overview", "payments", "expenses", "trucks", "resale"].includes(dailySection)
    ? dailySection
    : "overview";

  return (
    <div className="ops-dashboard ops-finance-page">
      <CrewDataRefresh enabled={isLivePaymentWindow} />
      <PageHeader
        title="Finance"
        subtitle="Daily close from Truck Records, JunkWare payments, and QuickBooks Online"
        date={date}
        lastUpdated={metrics?.generated_at}
        controls={<FinanceModeSwitch date={date} view="daily" />}
        sections={[
          { label: "Daily summary", href: financeHref(date, "daily"), active: section === "overview" },
          { label: "Payments & recon", href: financeHref(date, "daily", "payments"), active: section === "payments" },
          { label: "Company costs", href: financeHref(date, "daily", "expenses"), active: section === "expenses" },
          { label: "Truck records", href: financeHref(date, "daily", "trucks"), active: section === "trucks" },
          { label: "Resale inventory", href: financeHref(date, "daily", "resale"), active: section === "resale" },
        ]}
      />

      <div className={section === "overview" ? "ops-kpi-row" : "ops-section-hidden"} id="finance-overview">
        <div className="ops-card ops-kpi-card">
          <div className="ops-card-title">Sales</div>
          <div className="ops-kpi-value ops-kpi-accent">{money(sales)}</div>
        </div>

        <div className="ops-card ops-kpi-card">
          <div className="ops-card-title">Total Expenses</div>
          <div className="ops-kpi-value">{money(totalExpenses)}</div>
        </div>

        <div className="ops-card ops-kpi-card">
          <div className="ops-card-title">Net Profit</div>
          <div className="ops-kpi-value ops-kpi-good">{money(netProfit)}</div>
        </div>

        <div className="ops-card ops-kpi-card">
          <div className="ops-card-title">Net Margin</div>
          <div className="ops-kpi-value">{percent(netMargin)}</div>
        </div>
      </div>

      <section className={section === "overview" ? "ops-card ops-finance-brief" : "ops-section-hidden"}>
        <div className="ops-finance-brief-heading">
          <div>
            <span className="ops-finance-brief-kicker">Today’s financial brief</span>
            <h2>{netMargin >= 20 ? "Margin is protected" : "Margin needs intervention"}</h2>
            <p>Focus on the cost mix and payment exceptions that can still change today’s result.</p>
          </div>
          <span className={`ops-finance-brief-status${netMargin >= 20 ? " is-good" : " is-warning"}`}>
            {percent(netMargin)} margin
          </span>
        </div>
        <div className="ops-finance-brief-grid">
          <Link href={financeHref(date, "daily", "expenses")}>
            <span>Payroll load</span>
            <strong>{percent(sales > 0 ? payroll / sales * 100 : 0)}</strong>
            <small>{money(payroll)} excluding tips</small>
          </Link>
          <Link href={financeHref(date, "daily", "expenses")}>
            <span>Royalty load</span>
            <strong>{percent(sales > 0 ? (junkKingRoyalties + callCenterRoyalties) / sales * 100 : 0)}</strong>
            <small>{money(junkKingRoyalties + callCenterRoyalties)} combined</small>
          </Link>
          <Link href={financeHref(date, "daily", "trucks")}>
            <span>Truck operating cost</span>
            <strong>{money(dumpExpense + fuelExpense + otherExpense)}</strong>
            <small>Dump, fuel, and other costs</small>
          </Link>
          <Link href={financeHref(date, "daily", "payments")}>
            <span>Payment control</span>
            <strong>Reconcile</strong>
            <small>Compare card payments and exceptions</small>
          </Link>
        </div>
      </section>

      <div className="ops-dashboard-main ops-finance-layout">
        <div className={section === "payments" ? "ops-card ops-finance-payments-card" : "ops-section-hidden"} id="finance-payments">
          <div className="ops-card-header compact">
            <div>
              <div className="ops-section-title">Payments by Job</div>
              <div className="ops-muted">
                Every paid job in JunkWare&apos;s card-payment ledger for {date}. QBO references are shown for verification and unresolved rows remain open.
              </div>
            </div>
          </div>
          <div className="ops-finance-table-scroll">
            <table className="ops-table ops-finance-payments-table">
              <thead>
                <tr>
                  <th>JunkWare</th>
                  <th>Customer</th>
                  <th>Payment</th>
                  <th>Paid</th>
                  <th>Job revenue</th>
                  <th>Tip</th>
                  <th>QuickBooks Online</th>
                  <th>Reconciliation</th>
                </tr>
              </thead>
              <tbody>
                {paymentReconciliation.paymentsByJob.map((payment) => (
                  <tr key={`${payment.jkNumber}-${payment.paidAmount}`}>
                    <td>
                      <Link
                        className="ops-reconciliation-job-link"
                        href={jobScheduleHref(date, payment.jkNumber)}
                        title={`Open ${payment.jkNumber} on the OpsCenter schedule`}
                      >
                        {payment.jkNumber}
                      </Link>
                    </td>
                    <td><strong>{payment.customer}</strong></td>
                    <td>
                      <strong>{payment.paymentMethod}</strong>
                      {payment.cardLastFour ? <small className="ops-table-subline">•••• {payment.cardLastFour}</small> : null}
                    </td>
                    <td className="ops-money">{money(payment.paidAmount)}</td>
                    <td className="ops-money">{payment.revenueAmount === null ? "—" : money(payment.revenueAmount)}</td>
                    <td className="ops-money">{payment.tipAmount === null ? "—" : money(payment.tipAmount)}</td>
                    <td>
                      {payment.qboTransactionId ? (
                        <>
                          <strong>{payment.qboTransactionId}</strong>
                          <small className="ops-table-subline">{[payment.qboTransactionType, payment.qboStatus].filter(Boolean).join(" · ")}</small>
                        </>
                      ) : "—"}
                    </td>
                    <td>
                      <span className={`ops-payment-reconciliation-state ${payment.reconciliation === "Matched" ? "is-matched" : "needs-review"}`}>
                        {payment.reconciliation}
                      </span>
                    </td>
                  </tr>
                ))}
                {paymentReconciliation.paymentsByJob.length === 0 ? (
                  <tr><td colSpan={8} className="ops-muted">No paid jobs are available in the JunkWare card-payment ledger for this date.</td></tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>

        <div className={section === "resale" ? "" : "ops-section-hidden"} id="finance-resale">
          <ResaleInventory initialItems={readResaleStore().items} />
        </div>

        <div id="finance-reconciliation" className={section === "payments" ? "" : "ops-section-hidden"}><PaymentReconciliationPanel
            view={paymentReconciliation}
            periodLabel={date}
          /></div>

        <div className={section === "expenses" ? "ops-card" : "ops-section-hidden"} id="finance-expenses">
          <div className="ops-card-header compact">
            <div>
              <div className="ops-section-title">Company Costs</div>
              <div className="ops-muted">
                Payroll Expense excludes tips. Royalties are computed from Sales.
              </div>
            </div>
          </div>

          <div className="ops-summary-list">
            <div>
              <span>Payroll Expense</span>
              <strong>{money(payroll)}</strong>
            </div>
            <div>
              <span>Bonuses</span>
              <strong>{money(bonuses)}</strong>
            </div>
            <div>
              <span>Dump Expense</span>
              <strong>{money(dumpExpense)}</strong>
            </div>
            <div>
              <span>Fuel Expense</span>
              <strong>{money(fuelExpense)}</strong>
            </div>
            <div>
              <span>Other Expense</span>
              <strong>{money(otherExpense)}</strong>
            </div>
            <div>
              <span>Junk King Royalties — 8%</span>
              <strong>{money(junkKingRoyalties)}</strong>
            </div>
            <div>
              <span>Call Center Royalties — 5%</span>
              <strong>{money(callCenterRoyalties)}</strong>
            </div>
          </div>

          <div className="ops-section-spacer" />

          <div className="ops-card-header compact">
            <div>
              <div className="ops-section-title">Krewe Earnings</div>
              <div className="ops-muted">
                Tips are part of employee earnings but not company payroll expense.
              </div>
            </div>
          </div>

          <div className="ops-summary-list">
            <div>
              <span>Regular Pay</span>
              <strong>{money(regularPay)}</strong>
            </div>
            <div>
              <span>Bonuses</span>
              <strong>{money(bonuses)}</strong>
            </div>
            <div>
              <span>Tips</span>
              <strong>{money(tips)}</strong>
            </div>
            <div>
              <span>Total Employee Earnings</span>
              <strong>{money(employeeTotalEarnings)}</strong>
            </div>
          </div>
        </div>

        <div className={section === "trucks" ? "ops-card ops-finance-truck-card" : "ops-section-hidden"} id="finance-trucks">
          <div className="ops-card-header compact">
            <div>
              <div className="ops-section-title">Truck Financial Records</div>
              <div className="ops-muted">
                These are the authoritative selected-day financial totals from Truck Records.
              </div>
            </div>
          </div>

          <div className="ops-finance-table-scroll">
            <table className="ops-table ops-finance-truck-table">
            <thead>
              <tr>
                <th>Truck</th>
                <th>Sales</th>
                <th>Dump</th>
                <th>Fuel</th>
                <th>Other</th>
                <th>Net Before Payroll and Royalties</th>
              </tr>
            </thead>
            <tbody>
              {truckRows.map((row: AnyRecord) => (
                <tr key={`${row.market || "market"}|${row.truck_key || row.truck}`}>
                  <td>
                    <strong>{row.truck || "Unknown Truck"}</strong>
                    {row.market ? <div className="ops-muted">{row.market}</div> : null}
                  </td>
                  <td className="ops-money">{money(row.sales)}</td>
                  <td className="ops-money">{money(row.dump_expense)}</td>
                  <td className="ops-money">{money(row.fuel_expense)}</td>
                  <td className="ops-money">{money(row.other_expense ?? row.combined_other_expense)}</td>
                  <td className="ops-money">{money(row.net_before_payroll_and_royalties)}</td>
                </tr>
              ))}

              {truckRows.length === 0 && (
                <tr>
                  <td colSpan={6} className="ops-muted">
                    No Truck Records financial data available for this date.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          </div>

          <div className="ops-section-spacer" />

          <div className="ops-card-header compact">
            <div>
              <div className="ops-section-title">Krewe-reported cost detail</div>
              <div className="ops-muted">
                Supporting dump and fuel activity reported to OpsBot · {money(crewTruckRecordCost)} reported
              </div>
            </div>
          </div>

          <div className="ops-finance-table-scroll">
            <table className="ops-table ops-finance-truck-table">
              <thead>
                <tr>
                  <th>Truck</th>
                  <th>Type</th>
                  <th>Location</th>
                  <th>Cost</th>
                  <th>Quantity</th>
                  <th>Time</th>
                </tr>
              </thead>
              <tbody>
                {crewTruckRecords.map((record) => (
                  <tr key={record.messageId}>
                    <td><strong>{record.truck}</strong></td>
                    <td>{record.kind === "dump" ? "Dump" : "Fuel"}</td>
                    <td>{record.location}</td>
                    <td className="ops-money">{money(record.cost)}</td>
                    <td>{record.kind === "dump" ? record.weight || "No weight" : `${record.gallons} gal`}</td>
                    <td>{record.time}</td>
                  </tr>
                ))}
                {crewTruckRecords.length === 0 && (
                  <tr>
                    <td colSpan={6} className="ops-muted">No OpsBot truck expenses reported for this date.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
