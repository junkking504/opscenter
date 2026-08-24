import { headers } from "next/headers";
import { redirect } from "next/navigation";
import Link from "next/link";
import type { Viewport } from "next";
import { CREW_IDENTITY_HEADER } from "@/lib/crew-auth";
import { readCrewJobNotesForEmployee, type CrewJobNote } from "@/lib/job-crew-notes";
import { chicagoDateKey } from "@/lib/report-dates";
import {
  type CrewPerformanceRange,
  type CrewPerformanceStats,
  type CrewPayDay,
  type CrewPayTotals,
  getCrewPayPortalData,
  monthlyLeaderboardSummary,
} from "@/lib/crew-pay-portal";
import styles from "./my-pay.module.css";

export const dynamic = "force-dynamic";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#eceeeb",
  colorScheme: "light",
};

type PortalView = "daily" | "pay-period" | "leaderboard";

type Props = {
  searchParams?: Promise<{ period?: string; view?: string }>;
};

const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const hours = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

function overtimePremium(hoursWorked: number, hourlyRate: number | null): number {
  if (!Number.isFinite(hoursWorked) || hoursWorked <= 0) return 0;
  if (!Number.isFinite(Number(hourlyRate)) || !hourlyRate || hourlyRate <= 0) return 0;
  return hoursWorked * hourlyRate * 0.5;
}

const wholeNumber = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const percent = new Intl.NumberFormat("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 1 });

function dateLabel(dateKey: string, options?: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat("en-US", options || { month: "short", day: "numeric" }).format(
    new Date(`${dateKey}T12:00:00Z`),
  );
}

function dateRange(start: string, end: string): string {
  return `${dateLabel(start)} – ${dateLabel(end, { month: "short", day: "numeric", year: "numeric" })}`;
}

function timestampLabel(value: string | null): string {
  if (!value) return "Data refresh unavailable";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "Data refresh unavailable";
  return `Updated ${new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date)}`;
}

function selectedView(value: unknown): PortalView {
  return value === "pay-period" || value === "leaderboard" ? value : "daily";
}

function statusLabel(totals: CrewPayTotals): string {
  if (totals.needsReview) return "Needs review";
  return totals.final ? "Final" : "Estimated";
}

function Status({ final, review, live }: { final: boolean; review?: boolean; live?: boolean }) {
  const label = review ? "Needs review" : final ? "Final" : live ? "Live estimate" : "Estimated";
  const className = review
    ? `${styles.status} ${styles.statusReview}`
    : final
      ? `${styles.status} ${styles.statusFinal}`
      : styles.status;
  return <span className={className}>{label}</span>;
}

function ViewToggle({ view }: { view: PortalView }) {
  const options: Array<{ value: PortalView; label: string; href: string }> = [
    { value: "daily", label: "Daily Performance", href: "/my-pay" },
    { value: "pay-period", label: "Pay Period", href: "/my-pay?view=pay-period" },
    { value: "leaderboard", label: "Leaderboard", href: "/my-pay?view=leaderboard" },
  ];

  return (
    <nav className={styles.viewToggle} aria-label="Employee portal view">
      {options.map((option) => (
        <Link
          key={option.value}
          href={option.href}
          className={`${styles.viewOption} ${view === option.value ? styles.viewOptionActive : ""}`}
          aria-current={view === option.value ? "page" : undefined}
        >
          {option.label}
        </Link>
      ))}
    </nav>
  );
}

function emptyPerformance(name: string): CrewPerformanceStats {
  return {
    name,
    creditedRevenue: 0,
    jobRevenueWorked: 0,
    jobsCompleted: 0,
    averageJobSize: 0,
    estimateCloseRate: null,
    tips: 0,
    bonuses: 0,
  };
}

function employeeStats(range: CrewPerformanceRange, employee: string): CrewPerformanceStats {
  const target = employee.trim().toLocaleLowerCase();
  return range.rows.find((row) => row.name.trim().toLocaleLowerCase() === target) || emptyPerformance(employee);
}

function PerformanceCards({ stats, totalPay }: { stats: CrewPerformanceStats; totalPay?: number }) {
  return (
    <div className={`${styles.performanceGrid} ${totalPay !== undefined ? styles.performanceGridSix : ""}`}>
      <div className={styles.performanceCard}><span>Jobs completed</span><strong>{wholeNumber.format(stats.jobsCompleted)}</strong></div>
      <div className={styles.performanceCard}><span>Job revenue worked</span><strong>{money.format(stats.jobRevenueWorked)}</strong></div>
      <div className={styles.performanceCard}><span>Credited revenue</span><strong>{money.format(stats.creditedRevenue)}</strong></div>
      <div className={styles.performanceCard}><span>Average job size</span><strong>{money.format(stats.averageJobSize)}</strong></div>
      <div className={styles.performanceCard}><span>Estimates closed</span><strong>{stats.estimateCloseRate === null ? "—" : `${percent.format(stats.estimateCloseRate)}%`}</strong></div>
      <div className={styles.performanceCard}><span>Tips</span><strong>{money.format(stats.tips)}</strong></div>
      <div className={styles.performanceCard}><span>Bonuses</span><strong>{money.format(stats.bonuses)}</strong></div>
      {totalPay !== undefined ? (
        <div className={`${styles.performanceCard} ${styles.privatePerformanceCard}`}>
          <span>Total pay · Private</span>
          <strong>{money.format(totalPay)}</strong>
        </div>
      ) : null}
    </div>
  );
}

function CrewMetricsTable({
  rows,
  employee,
  daily = false,
  ranked = false,
  emptyMessage,
}: {
  rows: CrewPerformanceStats[];
  employee: string;
  daily?: boolean;
  ranked?: boolean;
  emptyMessage: string;
}) {
  if (!rows.length) return <div className={styles.empty}>{emptyMessage}</div>;
  const leaderboardMetrics = daily || ranked;

  return (
    <div className={styles.tableWrap}>
      <table
        className={`${styles.table} ${styles.leaderboardTable} ${daily ? styles.dailyMetricsTable : ""} ${ranked ? styles.rankedTable : ""}`}
        aria-label={ranked ? "Monthly crew leaderboard" : "Crew performance metrics"}
      >
        <thead>
          <tr>
            {ranked ? <th>Rank</th> : null}
            <th>Crew member</th>
            <th>Jobs completed</th>
            {leaderboardMetrics ? <th>Average job size</th> : <th>Estimates closed</th>}
            {leaderboardMetrics ? <th>Revenue</th> : null}
            <th>Tips</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => {
            const isYou = row.name.toLocaleLowerCase() === employee.toLocaleLowerCase();
            return (
              <tr key={row.name} className={isYou ? styles.youRow : undefined}>
                {ranked ? <td className={styles.rankCell} data-label="Rank"><span className={styles.rank}>{index + 1}</span></td> : null}
                <td className={styles.crewCell} data-label="Crew member"><span className={styles.crewName}>{row.name}</span>{isYou ? <span className={styles.youBadge}>You</span> : null}</td>
                <td data-label="Jobs completed">{wholeNumber.format(row.jobsCompleted)}</td>
                {leaderboardMetrics ? <td data-label="Average job size">{money.format(row.averageJobSize)}</td> : <td data-label="Estimates closed">{row.estimateCloseRate === null ? "—" : `${percent.format(row.estimateCloseRate)}%`}</td>}
                {leaderboardMetrics ? <td data-label="Revenue">{money.format(row.creditedRevenue)}</td> : null}
                <td data-label="Tips">{money.format(row.tips)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function DailyPerformanceView({ data }: { data: Awaited<ReturnType<typeof getCrewPayPortalData>> }) {
  const yourStats = employeeStats(data.dailyPerformance, data.employee);
  return (
    <>
      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <div>
            <div className={styles.eyebrow}>Private crew access</div>
            <h2>Your Daily Performance</h2>
            <p>{dateLabel(data.dailyPerformance.end, { weekday: "long", month: "long", day: "numeric" })}</p>
          </div>
        </div>
        <PerformanceCards stats={yourStats} />
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <div>
            <div className={styles.eyebrow}>All crewmembers</div>
            <h2>Everyone’s Daily Metrics</h2>
            <p>Today’s clocked-in crew: jobs, average job size, credited revenue, and tips.</p>
          </div>
          <div className={styles.privacyNote}>Crew-visible · Total pay hidden</div>
        </div>
        <div className={styles.leaderboardPanel}>
          <CrewMetricsTable
            rows={data.dailyPerformance.rows}
            employee={data.employee}
            daily
            emptyMessage="No crew performance has been recorded yet today."
          />
        </div>
      </section>
    </>
  );
}

function DailyRows({ days }: { days: CrewPayDay[] }) {
  if (!days.length) return <div className={styles.empty}>No recorded hours or pay in this period.</div>;
  return (
    <div className={styles.tableWrap}>
      <table className={styles.table} aria-label="Daily pay breakdown">
        <thead>
          <tr><th>Date</th><th>Clock</th><th>Regular</th><th>Overtime</th><th>Tips</th><th>Bonuses</th><th>Total pay</th></tr>
        </thead>
        <tbody>
          {[...days].reverse().map((day) => (
            <tr key={day.date}>
              <td className={styles.dateCell} data-label="Date"><div className={styles.datePrimary}>{dateLabel(day.date, { weekday: "short", month: "short", day: "numeric" })}</div><div className={styles.dateSecondary}>{day.needsReview ? "Needs review" : day.isFinal ? "Final" : day.isLive ? "Live estimate" : "Estimated"}</div></td>
              <td data-label="Clock">{day.clockIn || "—"} – {day.clockOut || (day.isLive ? "Now" : "—")}</td>
              <td data-label="Regular">{hours.format(day.regularHours)}h<br /><span className={styles.dateSecondary}>{money.format(day.regularPay)}</span></td>
              <td data-label="Overtime">{hours.format(day.overtimeHours)}h<br /><span className={styles.dateSecondary}>{money.format(overtimePremium(day.overtimeHours, day.hourlyRate))}</span></td>
              <td data-label="Tips">{money.format(day.tips)}</td>
              <td data-label="Bonuses">{money.format(day.bonuses + day.supplementalPay)}</td>
              <td className={styles.pay} data-label="Total pay">{money.format(day.totalPay)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PayPeriodView({ data }: { data: Awaited<ReturnType<typeof getCrewPayPortalData>> }) {
  const period = data.selectedPeriod;
  const viewingHistory = period.start !== data.currentPeriodStart;
  const yourStats = employeeStats(data.payPeriodPerformance, data.employee);
  const periodOvertimeHours = period.totals.overtimeHours;
  const periodOvertimePremium = period.days.reduce(
    (sum, day) => sum + overtimePremium(day.overtimeHours, day.hourlyRate),
    0,
  );
  const periodOvertimePremiumTotal = Number(periodOvertimePremium.toFixed(2));

  return (
    <>
      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <div>
            <div className={styles.eyebrow}>Private to you</div>
            <h2>Your Pay Period</h2>
            <p>{dateRange(period.start, period.end)} · {statusLabel(period.totals)}</p>
          </div>
          {viewingHistory ? <Link className={styles.currentLink} href="/my-pay?view=pay-period">Back to current →</Link> : null}
        </div>
        <PerformanceCards stats={yourStats} totalPay={period.totals.totalPay} />
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <div><div className={styles.eyebrow}>Your private pay detail</div><h2>Pay Breakdown</h2></div>
        </div>
        <div className={styles.panel}>
          <div className={styles.metrics}>
            <div className={styles.metric}><div className={styles.metricLabel}>Total hours</div><div className={styles.metricValue}>{hours.format(period.totals.hours)}</div></div>
            <div className={styles.metric}><div className={styles.metricLabel}>Regular pay</div><div className={styles.metricValue}>{money.format(period.totals.regularPay)}</div></div>
            <div className={styles.metric}><div className={styles.metricLabel}>Overtime hours</div><div className={styles.metricValue}>{hours.format(periodOvertimeHours)}h</div></div>
            <div className={styles.metric}><div className={styles.metricLabel}>Overtime pay</div><div className={styles.metricValue}>{money.format(periodOvertimePremiumTotal)}</div></div>
            <div className={styles.metric}><div className={styles.metricLabel}>Tips + bonuses</div><div className={styles.metricValue}>{money.format(period.totals.tips + period.totals.bonuses + period.totals.supplementalPay)}</div></div>
            <div className={styles.metric}><div className={styles.metricLabel}>Total pay</div><div className={styles.metricValue}>{money.format(period.totals.totalPay)}</div></div>
          </div>
          <DailyRows days={period.days} />
        </div>
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHeader}><div><h2>Pay History</h2><p>Select a previous pay period for its private daily details.</p></div></div>
        <div className={styles.historyList}>
          {data.history.length ? data.history.map((item) => (
            <Link className={styles.historyItem} href={`/my-pay?view=pay-period&period=${item.start}`} key={item.start}>
              <div><div className={styles.historyDates}>{dateRange(item.start, item.end)}</div><Status final={item.final} /></div>
              <div className={styles.historyStat}><strong>{hours.format(item.hours)}h</strong><span>Hours</span></div>
              <div className={styles.historyStat}><strong>{money.format(item.totalPay)}</strong><span>Your pay</span></div>
            </Link>
          )) : <div className={styles.empty}>Previous pay periods will appear here as history accumulates.</div>}
        </div>
      </section>
    </>
  );
}

function MonthlyLeaderboardView({ data }: { data: Awaited<ReturnType<typeof getCrewPayPortalData>> }) {
  const leaderboard = data.monthlyLeaderboard;
  const summary = monthlyLeaderboardSummary(leaderboard);
  return (
    <>
      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <div>
            <div className={styles.eyebrow}>Month to date</div>
            <h2>Monthly Leaderboard</h2>
            <p>{dateLabel(leaderboard.start, { month: "long", year: "numeric" })} · Ranked by jobs completed, then revenue.</p>
          </div>
          <div className={styles.privacyNote}>Crew-visible · Total pay hidden</div>
        </div>
        <div className={styles.monthSummary}>
          <div className={styles.monthSummaryCard}><span>Total jobs</span><strong>{wholeNumber.format(leaderboard.totalJobs)}</strong></div>
          <div className={styles.monthSummaryCard}><span>Total revenue</span><strong>{money.format(leaderboard.totalRevenue)}</strong></div>
          <div className={styles.monthSummaryCard}><span>Average job size</span><strong>{summary.averageJobSize === null ? "—" : money.format(summary.averageJobSize)}</strong></div>
          <div className={styles.monthSummaryCard}><span>Revenue per hour</span><strong>{summary.revenuePerHour === null ? "—" : money.format(summary.revenuePerHour)}</strong></div>
          <div className={styles.monthSummaryCard}><span>Total tips</span><strong>{money.format(leaderboard.totalTips)}</strong></div>
        </div>
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <div><div className={styles.eyebrow}>All crewmembers</div><h2>Month-to-Date Metrics</h2><p>Jobs completed, revenue, average job size, and tips.</p></div>
        </div>
        <div className={styles.leaderboardPanel}>
          <CrewMetricsTable
            rows={leaderboard.rows}
            employee={data.employee}
            ranked
            emptyMessage="No crew performance has been recorded this month."
          />
        </div>
      </section>
    </>
  );
}

function TodayCrewNotes({ notes }: { notes: CrewJobNote[] }) {
  if (!notes.length) return null;
  return (
    <section className={styles.section} aria-label="Today's crew notes">
      <div className={styles.sectionHeader}>
        <div><div className={styles.eyebrow}>Today</div><h2>Crew Notes</h2><p>Instructions from dispatch for jobs assigned to you.</p></div>
        <div className={styles.privacyNote}>Assigned jobs only</div>
      </div>
      <div className={styles.crewNotes}>
        {notes.map((note) => (
          <article className={styles.crewNote} key={note.jobKey}>
            <div className={styles.crewNoteTime}>{note.appointmentTime}</div>
            <div className={styles.crewNoteDetails}><strong>{note.customerName}</strong><span>{note.address} · {note.truck}</span></div>
            <p>{note.body}</p>
          </article>
        ))}
      </div>
    </section>
  );
}

export default async function MyPayPage({ searchParams }: Props) {
  const requestHeaders = await headers();
  const employee = String(requestHeaders.get(CREW_IDENTITY_HEADER) || "").trim();
  if (!employee) redirect("/crew-login?error=not-authenticated");
  const params = await searchParams;
  const view = selectedView(params?.view);
  const data = await getCrewPayPortalData(employee, params?.period);
  const crewNotes = view === "daily" ? readCrewJobNotesForEmployee(employee, chicagoDateKey()) : [];
  const firstName = employee.split(/\s+/)[0] || employee;

  return (
    <div className={styles.page}>
      <header className={styles.topbar}>
        <div className={styles.topbarInner}>
          <div className={styles.brand}><span className={styles.brandMark} /> OpsCenter Crew Portal</div>
          <a className={styles.logout} href="/api/crew/auth/logout">Sign out</a>
        </div>
      </header>

      <main className={styles.main}>
        <div className={styles.hero}>
          <div><div className={styles.eyebrow}>Private crew access</div><h1>Hi, {firstName}.</h1></div>
          <div className={styles.updated}>{timestampLabel(data.lastUpdated)}<br />History available {data.availableFrom ? `from ${dateLabel(data.availableFrom)}` : "when payroll data is recorded"}.</div>
        </div>

        <ViewToggle view={view} />

        {view === "daily" ? <TodayCrewNotes notes={crewNotes} /> : null}
        {view === "daily" ? <DailyPerformanceView data={data} /> : null}
        {view === "pay-period" ? <PayPeriodView data={data} /> : null}
        {view === "leaderboard" ? <MonthlyLeaderboardView data={data} /> : null}

        <div className={styles.notice}>
          Performance, tips, and bonus-day counts are crew-visible. Bonus amounts and total pay are shown only to the signed-in employee. Current and open-shift pay amounts remain estimates until payroll is finalized.
        </div>
      </main>
    </div>
  );
}
