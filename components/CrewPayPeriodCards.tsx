"use client";

import { useMemo, useState } from "react";
import { calculateWeeklyOvertime } from "@/lib/overtime";

export type CrewPayPeriodSummaryRow = {
  name: string;
  trucks: string[];
  revenue: number;
  jobRevenueWorked: number;
  jobs: number;
  hours: number;
  hourlyPay: number;
  tips: number;
  revenueBonus: number;
  manualBonus: number;
  otherBonus: number;
  bonus: number;
  totalBonuses: number;
  supplementalPay: number;
  totalPay: number;
  estimates: number;
  estimatesClosedAsJobs: number;
};

export type CrewPayPeriodDayRow = {
  date: string;
  selected: boolean;
  today: boolean;
  worked: boolean;
  salary: boolean;
  hoursWorked?: number | null;
  clockInDisplay: string;
  clockOutDisplay: string;
  hoursDisplay: string;
  roleDisplay: string;
  truckDisplay: string;
  jobs: number | null;
  estimates: number | null;
  estimatesClosedAsJobs: number | null;
  revenue: number | null;
  jobRevenueWorked: number | null;
  averageJobSize: number | null;
  rph: number | null;
  hourlyRate: number | null;
  regularPay: number | null;
  tips: number | null;
  revenueBonus: number | null;
  manualBonus: number | null;
  otherBonus: number | null;
  bonus: number | null;
  totalBonuses: number | null;
  supplementalPay: number | null;
  totalPay: number | null;
  firstVisitCloseRateDisplay: string;
  estimateCloseRateDisplay: string;
  driverScoreDisplay: string;
  driverScoreSource: string;
  driverScoreStatus: string;
  speedingEvents: number | null;
  harshBrakingEvents: number | null;
  isOpenShift: boolean;
};

export type CrewPayPeriodEmployeeView = {
  name: string;
  summary: CrewPayPeriodSummaryRow;
  days: CrewPayPeriodDayRow[];
};

type DerivedCrewPayPeriodDayRow = CrewPayPeriodDayRow & {
  hoursWorked: number;
  regularHours: number;
  overtimeHours: number;
  basePay: number;
  straightTimePay: number;
  regularPayDisplay: number;
  overtimePremiumDisplay: number;
  overtimePayDisplay: number;
  hourlyLaborCostDisplay: number;
  totalPayDisplay: number;
};

type CrewPayPeriodWorkWeek = {
  start: string;
  end: string;
  label: string;
  days: DerivedCrewPayPeriodDayRow[];
  totals: {
    regularHours: number;
    overtimeHours: number;
    totalHours: number;
    jobs: number;
    estimatesClosedAsJobs: number;
    revenue: number;
    jobRevenueWorked: number;
    straightTimePay: number;
    regularPay: number;
    overtimePay: number;
    overtimePremium: number;
    hourlyLaborCost: number;
    tips: number;
    revenueBonus: number;
    manualBonus: number;
    otherBonus: number;
    bonuses: number;
    supplementalPay: number;
    totalPay: number;
  };
};

function money(value: number): string {
  return value.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function classNames(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(" ");
}

function parseDateKey(dateKey: string): Date {
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function formatDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function addDays(dateKey: string, days: number): string {
  const date = parseDateKey(dateKey);
  date.setDate(date.getDate() + days);
  return formatDateKey(date);
}

function parseHours(value: string): number {
  const match = String(value || "").match(/(-?\d+(?:\.\d+)?)/);
  if (!match) return 0;
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) ? parsed : 0;
}

function hoursWorked(day: CrewPayPeriodDayRow): number {
  if (typeof day.hoursWorked === "number" && Number.isFinite(day.hoursWorked)) {
    return day.hoursWorked;
  }
  return parseHours(day.hoursDisplay);
}

function basePayFromDay(day: CrewPayPeriodDayRow): number {
  const tips = day.tips ?? 0;
  const bonuses = day.bonus ?? 0;
  const supplementalPay = day.supplementalPay ?? 0;

  if (typeof day.regularPay === "number" && Number.isFinite(day.regularPay)) {
    const regularPay = Math.max(0, day.regularPay);
    if (regularPay > 0 || day.totalPay == null) return regularPay;
  }

  if (typeof day.totalPay === "number" && Number.isFinite(day.totalPay)) {
    return Math.max(0, day.totalPay - tips - bonuses - supplementalPay);
  }

  return 0;
}

export function summarizeWorkWeeks(
  days: CrewPayPeriodDayRow[],
  periodStart: string,
  periodEnd: string,
): CrewPayPeriodWorkWeek[] {
  const starts: string[] = [];
  for (let cursor = periodStart; cursor <= periodEnd; cursor = addDays(cursor, 7)) {
    starts.push(cursor);
  }

  const weeks: CrewPayPeriodWorkWeek[] = [];

  for (let index = 0; index < starts.length; index += 1) {
    const start = starts[index];
    const end = index + 1 < starts.length ? addDays(starts[index + 1], -1) : periodEnd;
    const weekDays = days
      .filter((day) => day.date >= start && day.date <= end)
      .sort((a, b) => a.date.localeCompare(b.date));

    if (!weekDays.length) continue;

    const derivedDays: DerivedCrewPayPeriodDayRow[] = [];
    let regularHoursTotal = 0;
    let overtimeHoursTotal = 0;
    let totalHours = 0;
    let jobsTotal = 0;
    let estimatesClosedTotal = 0;
    let revenueTotal = 0;
    let jobRevenueWorkedTotal = 0;
    let straightTimePayTotal = 0;
    let regularPayTotal = 0;
    let overtimePayTotal = 0;
    let overtimePremiumTotal = 0;
    let hourlyLaborCostTotal = 0;
    let tipsTotal = 0;
    let revenueBonusTotal = 0;
    let manualBonusTotal = 0;
    let otherBonusTotal = 0;
    let bonusesTotal = 0;
    let supplementalPayTotal = 0;
    let totalPayTotal = 0;

    const overtimeAllocations = calculateWeeklyOvertime(
      weekDays.map((day) => ({
        hours: hoursWorked(day),
        hourlyRate: day.hourlyRate ?? 0,
        straightTimePay: basePayFromDay(day),
        isSalary: day.salary,
      })),
    );

    for (const [dayIndex, day] of weekDays.entries()) {
      const workedHours = hoursWorked(day);
      const tips = day.tips ?? 0;
      const revenueBonus = day.revenueBonus ?? 0;
      const manualBonus = day.manualBonus ?? 0;
      const otherBonus = day.otherBonus ?? 0;
      const bonuses = day.totalBonuses ?? day.bonus ?? revenueBonus + manualBonus + otherBonus;
      const supplementalPay = day.supplementalPay ?? 0;
      const basePay = basePayFromDay(day);
      const overtime = overtimeAllocations[dayIndex];
      const regularHours = overtime.regularHours;
      const overtimeHours = overtime.overtimeHours;
      const regularPay = overtime.regularPay;
      const overtimePay = overtime.overtimePay;
      const overtimePremium = overtime.overtimePremium;
      const hourlyLaborCost = overtime.hourlyLaborCost;
      const totalPayDisplay = hourlyLaborCost + tips + bonuses + supplementalPay;

      regularHoursTotal += regularHours;
      overtimeHoursTotal += overtimeHours;
      totalHours += workedHours;
      jobsTotal += day.jobs ?? 0;
      estimatesClosedTotal += day.estimatesClosedAsJobs ?? 0;
      revenueTotal += day.revenue ?? 0;
      jobRevenueWorkedTotal += day.jobRevenueWorked ?? 0;
      straightTimePayTotal += overtime.straightTimePay;
      regularPayTotal += regularPay;
      overtimePayTotal += overtimePay;
      overtimePremiumTotal += overtimePremium;
      hourlyLaborCostTotal += hourlyLaborCost;
      tipsTotal += tips;
      revenueBonusTotal += revenueBonus;
      manualBonusTotal += manualBonus;
      otherBonusTotal += otherBonus;
      bonusesTotal += bonuses;
      supplementalPayTotal += supplementalPay;
      totalPayTotal += totalPayDisplay;

      derivedDays.push({
        ...day,
        hoursWorked: workedHours,
        regularHours,
        overtimeHours,
        basePay,
        straightTimePay: overtime.straightTimePay,
        regularPayDisplay: regularPay,
        overtimePremiumDisplay: overtimePremium,
        overtimePayDisplay: overtimePay,
        hourlyLaborCostDisplay: hourlyLaborCost,
        totalPayDisplay,
      });
    }

    weeks.push({
      start,
      end,
      label: `Week ${weeks.length + 1}: ${start}–${end}`,
      days: derivedDays,
      totals: {
        regularHours: Number(regularHoursTotal.toFixed(2)),
        overtimeHours: Number(overtimeHoursTotal.toFixed(2)),
        totalHours: Number(totalHours.toFixed(2)),
        jobs: jobsTotal,
        estimatesClosedAsJobs: estimatesClosedTotal,
        revenue: Number(revenueTotal.toFixed(2)),
        jobRevenueWorked: Number(jobRevenueWorkedTotal.toFixed(2)),
        straightTimePay: Number(straightTimePayTotal.toFixed(2)),
        regularPay: Number(regularPayTotal.toFixed(2)),
        overtimePay: Number(overtimePayTotal.toFixed(2)),
        overtimePremium: Number(overtimePremiumTotal.toFixed(2)),
        hourlyLaborCost: Number(hourlyLaborCostTotal.toFixed(2)),
        tips: Number(tipsTotal.toFixed(2)),
        revenueBonus: Number(revenueBonusTotal.toFixed(2)),
        manualBonus: Number(manualBonusTotal.toFixed(2)),
        otherBonus: Number(otherBonusTotal.toFixed(2)),
        bonuses: Number(bonusesTotal.toFixed(2)),
        supplementalPay: Number(supplementalPayTotal.toFixed(2)),
        totalPay: Number(totalPayTotal.toFixed(2)),
      },
    });
  }

  return weeks;
}

function summarizePeriodTotals(weeks: CrewPayPeriodWorkWeek[], summary: CrewPayPeriodSummaryRow) {
  if (!weeks.length) {
    return {
      regularHours: Number(summary.hours.toFixed(2)),
      overtimeHours: 0,
      totalHours: Number(summary.hours.toFixed(2)),
      jobs: summary.jobs,
      estimatesClosedAsJobs: summary.estimatesClosedAsJobs,
      revenue: summary.revenue,
      jobRevenueWorked: summary.jobRevenueWorked,
      straightTimePay: summary.hourlyPay,
      regularPay: summary.hourlyPay,
      overtimePay: 0,
      overtimePremium: 0,
      hourlyLaborCost: summary.hourlyPay,
      tips: summary.tips,
      revenueBonus: summary.revenueBonus,
      manualBonus: summary.manualBonus,
      otherBonus: summary.otherBonus,
      bonuses: summary.totalBonuses || summary.bonus,
      supplementalPay: 0,
      totalPay: summary.totalPay,
    };
  }

  return weeks.reduce(
    (acc, week) => {
      acc.regularHours += week.totals.regularHours;
      acc.overtimeHours += week.totals.overtimeHours;
      acc.totalHours += week.totals.totalHours;
      acc.jobs += week.totals.jobs;
      acc.estimatesClosedAsJobs += week.totals.estimatesClosedAsJobs;
      acc.revenue += week.totals.revenue;
      acc.jobRevenueWorked += week.totals.jobRevenueWorked;
      acc.straightTimePay += week.totals.straightTimePay;
      acc.regularPay += week.totals.regularPay;
      acc.overtimePay += week.totals.overtimePay;
      acc.overtimePremium += week.totals.overtimePremium;
      acc.hourlyLaborCost += week.totals.hourlyLaborCost;
      acc.tips += week.totals.tips;
      acc.revenueBonus += week.totals.revenueBonus;
      acc.manualBonus += week.totals.manualBonus;
      acc.otherBonus += week.totals.otherBonus;
      acc.bonuses += week.totals.bonuses;
      acc.supplementalPay += week.totals.supplementalPay;
      acc.totalPay += week.totals.totalPay;
      return acc;
    },
    {
      regularHours: 0,
      overtimeHours: 0,
      totalHours: 0,
      jobs: 0,
      estimatesClosedAsJobs: 0,
      revenue: 0,
      jobRevenueWorked: 0,
      straightTimePay: 0,
      regularPay: 0,
      overtimePay: 0,
      overtimePremium: 0,
      hourlyLaborCost: 0,
      tips: 0,
      revenueBonus: 0,
      manualBonus: 0,
      otherBonus: 0,
      bonuses: 0,
      supplementalPay: 0,
      totalPay: 0,
    },
  );
}

function MetricBlock({
  label,
  value,
  subvalue,
  tone = "default",
}: {
  label: string;
  value: React.ReactNode;
  subvalue?: React.ReactNode;
  tone?: "default" | "good" | "warning" | "muted";
}) {
  return (
    <div className={classNames("ops-crew-week-metric", tone !== "default" && `ops-crew-week-metric-${tone}`)}>
      <span className="ops-crew-week-metric-label">{label}</span>
      <div className="ops-crew-week-metric-main">
        <div className="ops-crew-week-metric-value">{value}</div>
        {subvalue ? <div className="ops-crew-week-metric-subvalue">{subvalue}</div> : null}
      </div>
    </div>
  );
}

function DetailRow({
  label,
  value,
  subvalue,
  tone = "default",
}: {
  label: string;
  value: React.ReactNode;
  subvalue?: React.ReactNode;
  tone?: "default" | "good" | "muted" | "warning";
}) {
  return (
    <div className={classNames("ops-crew-detail-row", tone !== "default" && `ops-crew-detail-row-${tone}`)}>
      <span className="ops-crew-detail-label">{label}</span>
      <div className="ops-crew-detail-value-wrap">
        <div className="ops-crew-detail-value">{value}</div>
        {subvalue ? <span className="ops-crew-detail-subvalue">{subvalue}</span> : null}
      </div>
    </div>
  );
}

export default function CrewPayPeriodCards({
  employees,
  periodStart,
  periodEnd,
}: {
  employees: CrewPayPeriodEmployeeView[];
  periodStart: string;
  periodEnd: string;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);

  const cards = useMemo(
    () => [...employees].sort((a, b) => a.name.localeCompare(b.name, "en", { sensitivity: "base" })),
    [employees],
  );
  return (
    <div className="ops-crew-period-cards">
      {cards.length ? (
        cards.map((employee) => {
          const key = employee.name;
          const isOpen = expanded === key;
          const weeks = summarizeWorkWeeks(employee.days, periodStart, periodEnd);
          const periodTotals = summarizePeriodTotals(weeks, employee.summary);
          const totalHours = periodTotals.totalHours;
          const regularHours = periodTotals.regularHours;
          const overtimeHours = periodTotals.overtimeHours;
          const totalJobs = periodTotals.jobs;
          const periodRevenue = periodTotals.revenue;
          const periodJobRevenueWorked = periodTotals.jobRevenueWorked;
          const totalPay = periodTotals.totalPay;
          const summaryRoleTruck = employee.summary.trucks.length ? employee.summary.trucks.join(", ") : "Unassigned";

          return (
            <article
              key={key}
              className={classNames(
                "ops-card",
                "ops-crew-employee-card",
                "ops-crew-period-employee-card",
                isOpen && "is-expanded",
              )}
            >
              <button
                type="button"
                className="ops-crew-employee-summary"
                onClick={() => setExpanded((current) => (current === key ? null : key))}
                aria-expanded={isOpen}
              >
                <div className="ops-crew-employee-summary-grid">
                  <div className="ops-crew-summary-field ops-crew-summary-field-employee">
                    <span className="ops-crew-summary-label">Employee</span>
                    <div className="ops-crew-summary-main">
                      <div className="ops-crew-employee-name">{employee.name}</div>
                      <div className="ops-crew-employee-subtitle">{summaryRoleTruck}</div>
                    </div>
                  </div>

                  <div className="ops-crew-summary-field">
                    <span className="ops-crew-summary-label">Time</span>
                    <div className="ops-crew-summary-main">
                      <div className="ops-crew-summary-value">{`${totalHours.toFixed(2)} hrs`}</div>
                      <div className="ops-crew-summary-subvalue ops-nowrap">
                        {`Regular ${regularHours.toFixed(2)} hrs · OT ${overtimeHours.toFixed(2)} hrs`}
                      </div>
                    </div>
                  </div>

                  <div className="ops-crew-summary-field">
                    <span className="ops-crew-summary-label">Production</span>
                    <div className="ops-crew-summary-main">
                      <div className="ops-crew-summary-value">{totalJobs}</div>
                      <div className="ops-crew-summary-subvalue ops-nowrap">
                        {money(periodJobRevenueWorked)} worked · {money(periodRevenue)} credited
                      </div>
                    </div>
                  </div>

                  <div className="ops-crew-summary-field">
                    <span className="ops-crew-summary-label">Hourly Labor Cost</span>
                    <div className="ops-crew-summary-main">
                      <div className="ops-crew-summary-value ops-nowrap">{money(periodTotals.hourlyLaborCost)}</div>
                      <div className="ops-crew-summary-subvalue ops-nowrap">
                        {`${money(periodTotals.straightTimePay)} regular + ${money(periodTotals.overtimePremium)} OT additional`}
                      </div>
                    </div>
                  </div>

                  <div className="ops-crew-summary-field">
                    <span className="ops-crew-summary-label">Tips</span>
                    <div className="ops-crew-summary-main">
                      <div className="ops-crew-summary-value ops-nowrap">{money(periodTotals.tips)}</div>
                    </div>
                  </div>

                  <div className="ops-crew-summary-field">
                    <span className="ops-crew-summary-label">Bonuses</span>
                    <div className="ops-crew-summary-main">
                      <div className="ops-crew-summary-value ops-nowrap">{money(periodTotals.bonuses)}</div>
                    </div>
                  </div>

                  <div className="ops-crew-summary-field ops-crew-summary-field-good">
                    <span className="ops-crew-summary-label">Total Pay</span>
                    <div className="ops-crew-summary-main">
                      <div className="ops-crew-summary-value">{money(totalPay)}</div>
                    </div>
                  </div>
                </div>
                <div className="ops-crew-card-head-right">
                  <span className="ops-crew-period-badge">{periodStart}–{periodEnd}</span>
                  <span className={classNames("ops-crew-chevron", isOpen && "is-open")} aria-hidden="true">▸</span>
                </div>
              </button>

              <div className="ops-crew-card-body">
                {isOpen ? (
                  <div className="ops-crew-period-details">
                    {weeks.length ? (
                      <div className="ops-crew-card-subsection ops-crew-period-grand-total-section">
                        <div className="ops-crew-card-subsection-title">Employee pay period totals</div>
                        <div className="ops-crew-week-total-grid">
                          <MetricBlock label="Regular Hours" value={`${periodTotals.regularHours.toFixed(2)} hrs`} />
                          <MetricBlock label="Overtime Hours" value={`${periodTotals.overtimeHours.toFixed(2)} hrs`} />
                          <MetricBlock label="Total Hours" value={`${periodTotals.totalHours.toFixed(2)} hrs`} />
                          <MetricBlock label="Jobs" value={periodTotals.jobs} />
                          <MetricBlock label="Estimates Closed as Jobs" value={periodTotals.estimatesClosedAsJobs} />
                          <MetricBlock label="Job Revenue Worked" value={money(periodTotals.jobRevenueWorked)} />
                          <MetricBlock label="Credited Revenue" value={money(periodTotals.revenue)} />
                          <MetricBlock
                            label="Hourly Labor Cost"
                            value={money(periodTotals.hourlyLaborCost)}
                            subvalue={`${money(periodTotals.straightTimePay)} regular + ${money(periodTotals.overtimePremium)} OT additional`}
                            tone={periodTotals.overtimePremium > 0 ? "warning" : "default"}
                          />
                          <MetricBlock label="Tips" value={money(periodTotals.tips)} />
                          <MetricBlock label="Bonuses" value={money(periodTotals.bonuses)} />
                          <MetricBlock label="Supplemental Pay" value={money(periodTotals.supplementalPay)} />
                          <MetricBlock label="Total Pay" value={money(periodTotals.totalPay)} tone="good" />
                        </div>
                      </div>
                    ) : null}
                    {weeks.length ? (
                      <div className="ops-crew-period-week-list">
                        {weeks.map((week) => (
                          <details key={week.start} className="ops-crew-period-week-card">
                            <summary className="ops-crew-period-week-head">
                              <div>
                                <div className="ops-crew-period-week-title">{week.label}</div>
                                <div className="ops-crew-period-week-subtitle">{`${week.days.length} worked day${week.days.length === 1 ? "" : "s"}`}</div>
                              </div>
                              <div className="ops-crew-period-week-preview">
                                <span>{week.totals.totalHours.toFixed(2)} hrs</span>
                                <span>{week.totals.jobs} jobs</span>
                                <span>{money(week.totals.jobRevenueWorked)} worked</span>
                                <strong>{money(week.totals.totalPay)} pay</strong>
                              </div>
                              <span className="ops-crew-period-week-badge">View daily totals</span>
                              <span className="ops-crew-chevron" aria-hidden="true">▸</span>
                            </summary>

                            <div className="ops-crew-period-week-days">
                              <div className="ops-crew-period-day-list">
                                {week.days.map((day) => {
                                const dayPeriodStatus =
                                  day.today
                                    ? "Today"
                                    : day.selected
                                      ? "Selected"
                                      : day.isOpenShift
                                        ? "On Shift"
                                        : day.salary
                                          ? "Salary"
                                          : "Clocked Out";

                                return (
                                  <details
                                    key={day.date}
                                    className={classNames("ops-crew-period-day-card", day.selected && "is-selected", day.today && "is-today")}
                                    open={day.selected || day.today}
                                  >
                                    <summary className="ops-crew-period-day-summary">
                                      <div className="ops-crew-period-day-summary-grid">
                                        <div className="ops-crew-period-day-summary-cell">
                                          <span className="ops-crew-period-day-summary-label">Date</span>
                                          <span className="ops-crew-period-day-summary-value">{day.date}</span>
                                          <span className="ops-crew-period-day-summary-subvalue">{dayPeriodStatus}</span>
                                        </div>
                                        <div className="ops-crew-period-day-summary-cell">
                                          <span className="ops-crew-period-day-summary-label">Clock In</span>
                                          <span className="ops-crew-period-day-summary-value">{day.clockInDisplay}</span>
                                        </div>
                                        <div className="ops-crew-period-day-summary-cell">
                                          <span className="ops-crew-period-day-summary-label">Clock Out</span>
                                          <span className="ops-crew-period-day-summary-value">{day.clockOutDisplay}</span>
                                        </div>
                                        <div className="ops-crew-period-day-summary-cell">
                                          <span className="ops-crew-period-day-summary-label">Hours</span>
                                          <span className="ops-crew-period-day-summary-value">{day.hoursDisplay}</span>
                                        </div>
                                        <div className="ops-crew-period-day-summary-cell">
                                          <span className="ops-crew-period-day-summary-label">Role</span>
                                          <span className="ops-crew-period-day-summary-value">{day.roleDisplay}</span>
                                        </div>
                                        <div className="ops-crew-period-day-summary-cell">
                                          <span className="ops-crew-period-day-summary-label">Truck</span>
                                          <span className="ops-crew-period-day-summary-value">{day.truckDisplay}</span>
                                        </div>
                                        <div className="ops-crew-period-day-summary-cell">
                                          <span className="ops-crew-period-day-summary-label">Jobs</span>
                                          <span className="ops-crew-period-day-summary-value">{day.jobs == null ? "Unavailable" : day.jobs}</span>
                                        </div>
                                        <div className="ops-crew-period-day-summary-cell">
                                          <span className="ops-crew-period-day-summary-label">Job Revenue Worked</span>
                                          <span className="ops-crew-period-day-summary-value">{day.jobRevenueWorked == null ? "Unavailable" : money(day.jobRevenueWorked)}</span>
                                        </div>
                                        <div className="ops-crew-period-day-summary-cell">
                                          <span className="ops-crew-period-day-summary-label">Tips</span>
                                          <span className="ops-crew-period-day-summary-value">{day.tips == null ? "Unavailable" : money(day.tips)}</span>
                                        </div>
                                        <div className="ops-crew-period-day-summary-cell">
                                          <span className="ops-crew-period-day-summary-label">Bonuses</span>
                                          <span className="ops-crew-period-day-summary-value">{day.totalBonuses == null ? "Unavailable" : money(day.totalBonuses)}</span>
                                        </div>
                                        <div className="ops-crew-period-day-summary-cell ops-crew-period-day-summary-pay">
                                          <span className="ops-crew-period-day-summary-label">Total Pay</span>
                                          <span className="ops-crew-period-day-summary-value">{day.totalPayDisplay == null ? "Unavailable" : money(day.totalPayDisplay)}</span>
                                        </div>
                                      </div>
                                      <span className="ops-crew-period-day-more">More details</span>
                                      <span className="ops-crew-chevron" aria-hidden="true">▸</span>
                                    </summary>

                                    <div className="ops-crew-period-day-card-body">
                                      <div className="ops-crew-detail-section">
                                        <div className="ops-crew-detail-section-title">Attendance</div>
                                        <div className="ops-crew-detail-rows ops-crew-detail-rows-2">
                                          <DetailRow label="Clock In" value={day.clockInDisplay} />
                                          <DetailRow label="Clock Out" value={day.clockOutDisplay} />
                                          <DetailRow label="Hours" value={day.hoursDisplay} />
                                          <DetailRow label="Role" value={day.roleDisplay} />
                                          <DetailRow label="Truck" value={day.truckDisplay} />
                                        </div>
                                      </div>

                                      <div className="ops-crew-detail-section">
                                        <div className="ops-crew-detail-section-title">Production</div>
                                        <div className="ops-crew-detail-rows ops-crew-detail-rows-2">
                                          <DetailRow label="Jobs" value={day.jobs == null ? "Unavailable" : day.jobs} />
                                          <DetailRow label="Job Revenue Worked" value={day.jobRevenueWorked == null ? "Unavailable" : money(day.jobRevenueWorked)} />
                                          <DetailRow label="Credited Revenue" value={day.revenue == null ? "Unavailable" : money(day.revenue)} />
                                          <DetailRow
                                            label="Estimates Closed as Jobs"
                                            value={day.estimatesClosedAsJobs == null ? "Unavailable" : day.estimatesClosedAsJobs}
                                            subvalue={day.estimateCloseRateDisplay === "—" ? "Close rate —" : `Close rate ${day.estimateCloseRateDisplay}`}
                                          />
                                          <DetailRow label="Average Job Size" value={day.averageJobSize == null ? "Unavailable" : money(day.averageJobSize)} />
                                          <DetailRow label="RPH" value={day.rph == null ? "Unavailable" : money(day.rph)} />
                                        </div>
                                      </div>

                                      <div className="ops-crew-detail-section">
                                        <div className="ops-crew-detail-section-title">Earnings</div>
                                        <div className="ops-crew-detail-rows ops-crew-detail-rows-2">
                                          <DetailRow label="Revenue Bonus" value={day.revenueBonus == null ? "Unavailable" : money(day.revenueBonus)} />
                                          <DetailRow label="Manual Bonus" value={day.manualBonus == null ? "Unavailable" : money(day.manualBonus)} />
                                          <DetailRow label="Other Bonus" value={day.otherBonus == null ? "Unavailable" : money(day.otherBonus)} />
                                          <DetailRow label="Total Bonuses" value={day.totalBonuses == null ? "Unavailable" : money(day.totalBonuses)} />
                                          <DetailRow label="Hourly Rate" value={day.hourlyRate == null ? "Unavailable" : money(day.hourlyRate)} />
                                          <DetailRow
                                            label="Hourly Labor Cost"
                                            value={money(day.hourlyLaborCostDisplay)}
                                            subvalue={`${money(day.straightTimePay)} regular + ${money(day.overtimePremiumDisplay)} OT additional`}
                                            tone={day.overtimePremiumDisplay > 0 ? "warning" : "default"}
                                          />
                                          <DetailRow label="Supplemental Pay" value={day.supplementalPay == null ? "Unavailable" : money(day.supplementalPay)} />
                                          <DetailRow label="Tips" value={day.tips == null ? "Unavailable" : money(day.tips)} />
                                          <DetailRow label="Total Pay" value={money(day.totalPayDisplay)} tone="good" />
                                        </div>
                                      </div>

                                      <div className="ops-crew-detail-section">
                                        <div className="ops-crew-detail-section-title">Driving</div>
                                        <div className="ops-crew-detail-rows ops-crew-detail-rows-2">
                                          <DetailRow
                                            label="Driving Score"
                                            value={day.driverScoreDisplay}
                                            subvalue={[day.driverScoreStatus, day.driverScoreSource].filter(Boolean).join(" · ") || undefined}
                                          />
                                        </div>
                                      </div>
                                    </div>
                                  </details>
                                );
                                })}
                              </div>
                            </div>

                            <div className="ops-crew-card-subsection">
                              <div className="ops-crew-card-subsection-title">Weekly totals</div>
                              <div className="ops-crew-week-total-grid">
                                <MetricBlock label="Regular Hours" value={`${week.totals.regularHours.toFixed(2)} hrs`} />
                                <MetricBlock label="Overtime Hours" value={`${week.totals.overtimeHours.toFixed(2)} hrs`} />
                                <MetricBlock label="Total Hours" value={`${week.totals.totalHours.toFixed(2)} hrs`} />
                                <MetricBlock label="Jobs" value={week.totals.jobs} />
                                <MetricBlock label="Estimates Closed as Jobs" value={week.totals.estimatesClosedAsJobs} />
                                <MetricBlock label="Job Revenue Worked" value={money(week.totals.jobRevenueWorked)} />
                                <MetricBlock label="Credited Revenue" value={money(week.totals.revenue)} />
                                <MetricBlock
                                  label="Hourly Labor Cost"
                                  value={money(week.totals.hourlyLaborCost)}
                                  subvalue={`${money(week.totals.straightTimePay)} regular + ${money(week.totals.overtimePremium)} OT additional`}
                                  tone={week.totals.overtimePremium > 0 ? "warning" : "default"}
                                />
                                <MetricBlock label="Tips" value={money(week.totals.tips)} />
                                <MetricBlock label="Bonuses" value={money(week.totals.bonuses)} />
                                <MetricBlock label="Supplemental Pay" value={money(week.totals.supplementalPay)} />
                                <MetricBlock label="Total Pay" value={money(week.totals.totalPay)} tone="good" />
                              </div>
                            </div>
                          </details>
                        ))}
                      </div>
                    ) : (
                      <div className="ops-muted">No worked days recorded for this pay period.</div>
                    )}

                  </div>
                ) : null}
              </div>
            </article>
          );
        })
      ) : (
        <div className="ops-muted">No daily metrics files found inside the current pay period.</div>
      )}
    </div>
  );
}
