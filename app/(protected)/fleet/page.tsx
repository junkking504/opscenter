import Link from "next/link";
import { Fragment } from "react";
import "./maintenance.css";
import InlineDriverToggle from "@/components/InlineDriverToggle";
import FleetMapClient from "@/components/FleetMapClient";
import FleetTruckLink from "@/components/FleetTruckLink";
import PageHeader from "@/components/PageHeader";
import OpsMonthSelector from "@/components/OpsMonthSelector";
import FleetMaintenanceRecords from "@/components/FleetMaintenanceRecords";
import FleetMaintenanceChecklists from "@/components/FleetMaintenanceChecklists";
import FleetControlCenter from "@/components/FleetControlCenter";
import FleetServicePlanner from "@/components/FleetServicePlanner";
import FleetReportsPanel from "@/components/FleetReportsPanel";
import { AnyRecord, money, readMetrics, resolveDate, truckRows } from "@/lib/opsData";
import { buildFleetDailyRecord, buildFleetMonthlySummary, FleetSortDirection, FleetSortKey } from "@/lib/fleet-history";
import { buildFleetMapPayload } from "@/lib/fleet-map";
import { readFleetMaintenanceStore } from "@/lib/fleet-maintenance";
import { readFleetChecklistStore } from "@/lib/fleet-checklists";
import { readFleetChecklistTemplateStore } from "@/lib/fleet-checklist-templates";
import { readFleetIssueStore } from "@/lib/fleet-issues";
import { readLatestLinxupVehicleInventory } from "@/lib/linxup-vehicle-inventory";
import { monthOptions } from "@/lib/monthly-summary";
import { DRIVING_SCORE_ALERT_RULES, DRIVING_SCORE_COMPENSATION_COPY, drivingScoreCompensationLabel } from "@/lib/driving-score-policy";

function truckDriverScoreRows(metrics: AnyRecord | null): AnyRecord[] {
  const rows = metrics?.truck_driver_scores || metrics?.truck_driver_scores_by_truck || [];
  return Array.isArray(rows) ? rows : [];
}

function mergeFleetTruckRows(financialRows: AnyRecord[], scoreRows: AnyRecord[]): AnyRecord[] {
  const rowsByTruck = new Map<string, AnyRecord>();

  for (const row of financialRows) {
    const truck = normalizeTruckLabel(row.truck);
    if (!truck) continue;
    rowsByTruck.set(truck, {
      ...row,
      truck,
      milesDriven: null,
      driveMinutes: null,
      idleMinutes: null,
      hasGpsActivity: false,
    });
  }

  for (const scoreRow of scoreRows) {
    const truck = normalizeTruckLabel(scoreRow.truck);
    if (!truck || !/^Truck#\s*\d+$/i.test(truck)) continue;
    const existing = rowsByTruck.get(truck) || {
      truck,
      revenue: 0,
      jobs: 0,
      expenses: 0,
      laborHours: 0,
      net: 0,
      averageJobSize: 0,
    };
    const milesDriven = Number(scoreRow.miles_driven);
    const driveMinutes = Number(scoreRow.drive_minutes ?? scoreRow.drive_time_minutes);
    const idleMinutes = Number(scoreRow.idle_minutes ?? scoreRow.idle_time_minutes);

    rowsByTruck.set(truck, {
      ...existing,
      milesDriven: Number.isFinite(milesDriven) ? milesDriven : null,
      driveMinutes: Number.isFinite(driveMinutes) ? driveMinutes : null,
      idleMinutes: Number.isFinite(idleMinutes) ? idleMinutes : null,
      hasGpsActivity:
        Boolean(scoreRow.has_activity) ||
        (Number.isFinite(milesDriven) && milesDriven > 0) ||
        (Number.isFinite(driveMinutes) && driveMinutes > 0) ||
        (Number.isFinite(idleMinutes) && idleMinutes > 0),
    });
  }

  return Array.from(rowsByTruck.values()).sort((a, b) =>
    String(a.truck).localeCompare(String(b.truck), undefined, { numeric: true })
  );
}

type FleetView = "daily" | "monthly" | "maintenance";

function normalizeFleetView(value: unknown): FleetView {
  const raw = String(value || "").toLowerCase();
  if (raw === "maintenance") return "maintenance";
  return raw === "monthly" || raw === "july" ? "monthly" : "daily";
}

function normalizeSortKey(value: unknown): FleetSortKey {
  const key = String(value || "").trim();
  if (key === "revenue" || key === "jobs" || key === "miles" || key === "driverScore") return key;
  return "date";
}

function normalizeSortDirection(value: unknown): FleetSortDirection {
  const raw = String(value || "").toLowerCase();
  if (raw === "desc" || raw === "asc") return raw;
  return "asc";
}

type FleetMonthlySection = "daily" | "drivers" | "trucks" | "quality";

function normalizeMonthlySection(value: unknown): FleetMonthlySection {
  const raw = String(value || "").toLowerCase();
  if (raw === "drivers" || raw === "trucks" || raw === "quality") return raw;
  return "daily";
}

function defaultSortDirection(key: FleetSortKey): FleetSortDirection {
  return key === "date" ? "asc" : "desc";
}

function buildFleetHref({
  view,
  date,
  sort,
  dir,
}: {
  view: FleetView;
  date?: string;
  sort?: FleetSortKey;
  dir?: FleetSortDirection;
}) {
  const params = new URLSearchParams();
  params.set("view", view);
  if (date) params.set("date", date);
  if (sort) params.set("sort", sort);
  if (dir) params.set("dir", dir);
  return `/fleet?${params.toString()}`;
}

function normalizeTruckLabel(value: unknown): string {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const match = raw.match(/(\d+)/);
  return match ? `Truck# ${match[1]}` : raw.replace(/\s+/g, " ");
}

function truckParam(value: unknown): string {
  const raw = String(value || "").trim();
  const match = raw.match(/(\d+)/);
  return match ? match[1] : raw;
}

function formatMinutes(value: number | null): string {
  if (value == null || Number.isNaN(value)) return "—";
  const total = Math.round(value);
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  if (hours <= 0) return `${minutes} min`;
  return `${hours}h ${minutes}m`;
}

function formatScore(value: number | null): string {
  if (value == null || Number.isNaN(value)) return "—";
  return value.toFixed(1);
}

function formatMaybeNumber(value: number | null, digits = 0): string {
  if (value == null || Number.isNaN(value)) return "—";
  return digits > 0 ? value.toFixed(digits) : String(Math.round(value));
}

function formatMileage(value: unknown): string {
  if (value === null || value === undefined || value === "") return "Unavailable";
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) return "Unavailable";
  return `${numeric.toFixed(2)} mi`;
}

function formatOptionalCount(value: unknown): string {
  if (value === null || value === undefined || value === "") return "Unavailable";
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "Unavailable";
  return String(Math.round(numeric));
}

function driverScoreDisplay(row: AnyRecord): string {
  const display = String(row.driver_score_display || row.driverScoreDisplay || "").trim();
  if (display) return display;

  const raw = row.driver_score ?? row.driverScore ?? row.opscenter_driving_score ?? row.averageDriverScore;
  if (raw === undefined || raw === null || raw === "") return "Unavailable";

  const score = Number(raw);
  return Number.isFinite(score) ? score.toFixed(1) : "Unavailable";
}

function driverScoreStatus(row: AnyRecord): string {
  return String(row.driver_score_status || row.driverScoreStatus || row.confidence_status || "").trim();
}

function driverScoreSource(row: AnyRecord): string {
  return String(row.driver_score_source || row.driverScoreSource || row.score_source || "").trim();
}

function todayChicago(): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function renderMaintenancePage({
  date,
  sortKey,
  sortDirection,
  requestedSection,
}: {
  date: string;
  sortKey: FleetSortKey;
  sortDirection: FleetSortDirection;
  requestedSection: string;
}) {
  const section = ["overview", "checklists", "service", "reports", "records"].includes(requestedSection)
    ? requestedSection
    : "overview";
  const store = readFleetMaintenanceStore();
  const checklistStore = readFleetChecklistStore();
  const templateStore = readFleetChecklistTemplateStore();
  const issueStore = readFleetIssueStore();
  const linxupInventory = readLatestLinxupVehicleInventory();
  const truckOptions = Array.from(new Set([
    ...linxupInventory.vehicles.map((vehicle) => vehicle.truck),
    ...store.records.map((record) => record.truck),
    ...checklistStore.entries.map((entry) => entry.truck),
  ]))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const lastUpdated = [store.updatedAt, checklistStore.updatedAt, templateStore.updatedAt, issueStore.updatedAt, linxupInventory.retrievedAt].filter(Boolean).sort().at(-1) || "";

  return (
    <div className="ops-dashboard ops-maintenance-page">
      <PageHeader
        title="Fleet Maintenance"
        subtitle="Service history, repair costs, and upcoming maintenance for every truck"
        date={date}
        showDateSelector={false}
        lastUpdated={lastUpdated}
        sections={[
          { label: "Live fleet", href: buildFleetHref({ view: "daily", date }) },
          { label: "Maintenance overview", href: `/fleet?date=${date}&view=maintenance&section=overview`, active: section === "overview" },
          { label: "Checklists", href: `/fleet?date=${date}&view=maintenance&section=checklists`, active: section === "checklists" },
          { label: "Service planner", href: `/fleet?date=${date}&view=maintenance&section=service`, active: section === "service" },
          { label: "Reports", href: `/fleet?date=${date}&view=maintenance&section=reports`, active: section === "reports" },
          { label: "Records", href: `/fleet?date=${date}&view=maintenance&section=records`, active: section === "records" },
          { label: "Monthly", href: buildFleetHref({ view: "monthly", date, sort: sortKey, dir: sortDirection }) },
        ]}
      />
      <div id="fleet-maintenance-overview" className={section === "overview" ? "" : "ops-section-hidden"}><FleetControlCenter
          truckOptions={truckOptions}
          initialEntries={checklistStore.entries}
          initialIssues={issueStore.issues}
          customizations={templateStore.customizations}
          today={todayChicago()}
        /></div>
      <div id="fleet-checklists" className={section === "checklists" ? "" : "ops-section-hidden"}><FleetMaintenanceChecklists
          initialEntries={checklistStore.entries}
          truckOptions={truckOptions}
          today={todayChicago()}
          linxupInventory={linxupInventory}
          initialCustomizations={templateStore.customizations}
        /></div>
      <div id="fleet-service" className={section === "service" ? "" : "ops-section-hidden"}><FleetServicePlanner initialRecords={store.records} truckOptions={truckOptions} inventory={linxupInventory} today={todayChicago()} /></div>
      <div id="fleet-reports" className={section === "reports" ? "" : "ops-section-hidden"}><FleetReportsPanel entries={checklistStore.entries} issues={issueStore.issues} records={store.records} today={todayChicago()} /></div>
      <div id="fleet-records" className={section === "records" ? "" : "ops-section-hidden"}><FleetMaintenanceRecords
          initialRecords={store.records}
          truckOptions={truckOptions}
          today={todayChicago()}
          linxupInventory={linxupInventory}
        /></div>
    </div>
  );
}

function sortHeaderHref(
  currentSort: FleetSortKey,
  currentDir: FleetSortDirection,
  nextSort: FleetSortKey,
  date: string,
) {
  const nextDir =
    currentSort === nextSort
      ? currentDir === "asc"
        ? "desc"
        : "asc"
      : defaultSortDirection(nextSort);

  return buildFleetHref({ view: "monthly", date, sort: nextSort, dir: nextDir });
}

function renderJulySummaryPage({
  summary,
  sortKey,
  sortDirection,
  section,
}: {
  summary: ReturnType<typeof buildFleetMonthlySummary>;
  sortKey: FleetSortKey;
  sortDirection: FleetSortDirection;
  section: FleetMonthlySection;
}) {
  const latestAvailableDate = summary.dates[summary.dates.length - 1]?.date || "";
  const sourceMark = (value: boolean) => (value ? "✓" : "—");
  const monthKey = latestAvailableDate.slice(0, 7) || "2026-07";
  const summaryDate = latestAvailableDate || "2026-07-01";
  const summaryMetrics = readMetrics(summaryDate);
  const dailyHref = (date: string) => buildFleetHref({ view: "daily", date });
  const sectionHref = (nextSection: FleetMonthlySection) => {
    const params = new URLSearchParams({ view: "monthly", date: summaryDate, section: nextSection });
    if (nextSection === "daily") {
      params.set("sort", sortKey);
      params.set("dir", sortDirection);
    }
    return `/fleet?${params.toString()}`;
  };
  const safetyEvents = [
    summary.totalSpeedingEvents,
    summary.totalSevereSpeedingEvents,
    summary.totalAfterHoursEvents,
  ].reduce<number>((total, value) => total + (value == null ? 0 : Number(value)), 0);
  const gpsIssueDays = summary.dates.filter((row) => row.gpsDataStatus !== "Complete GPS").length;

  return (
    <div className="ops-dashboard ops-fleet-monthly-dashboard">
      <PageHeader
        title="Fleet"
        subtitle={`Monthly summary for ${monthKey} · Data through ${latestAvailableDate || "Unavailable"} with drill-down to daily Fleet views.`}
        date={latestAvailableDate || "2026-07-01"}
        showDateSelector={false}
        lastUpdated={summaryMetrics?.generated_at}
        controls={
          <OpsMonthSelector months={monthOptions()} selectedMonthKey={monthKey} />
        }
        sections={[
          { label: "Live fleet", href: buildFleetHref({ view: "daily", date: latestAvailableDate || "2026-07-01" }) },
          { label: "Daily overview", href: sectionHref("daily"), active: section === "daily" },
          { label: "Drivers", href: sectionHref("drivers"), active: section === "drivers" },
          { label: "Trucks", href: sectionHref("trucks"), active: section === "trucks" },
          { label: "Data quality", href: sectionHref("quality"), active: section === "quality", badge: gpsIssueDays || undefined, attention: Boolean(gpsIssueDays) },
          { label: "Maintenance", href: buildFleetHref({ view: "maintenance", date: latestAvailableDate || "2026-07-01" }) },
        ]}
      />

      <div className="ops-kpi-row ops-july-kpi-row ops-fleet-monthly-kpis" id="fleet-monthly-overview">
        <div className="ops-card ops-kpi-card">
          <div className="ops-card-title">Monthly Revenue</div>
          <div className="ops-kpi-value ops-kpi-accent">{money(summary.totalRevenue)}</div>
        </div>
        <div className="ops-card ops-kpi-card">
          <div className="ops-card-title">Completed Jobs</div>
          <div className="ops-kpi-value">{summary.totalCompletedJobs}</div>
        </div>
        <div className="ops-card ops-kpi-card">
          <div className="ops-card-title">Miles Recorded</div>
          <div className="ops-kpi-value">{summary.totalMilesRecorded == null ? "—" : `${formatMaybeNumber(summary.totalMilesRecorded, 2)} mi`}</div>
          <div className="ops-kpi-sub">GPS coverage: {summary.coverageDays} of {summary.dates.length} days</div>
        </div>
        <div className="ops-card ops-kpi-card">
          <div className="ops-card-title">Average Driver Score</div>
          <div className="ops-kpi-value">{summary.averageDriverScore == null ? "Insufficient driving data" : formatScore(summary.averageDriverScore)}</div>
          <div className="ops-kpi-sub">GPS coverage: {summary.coverageDays} of {summary.dates.length} days</div>
        </div>
        <div className="ops-card ops-kpi-card">
          <div className="ops-card-title">Trucks Due for Service</div>
          <div className="ops-kpi-value">{summary.trucksCurrentlyDueForService == null ? "—" : String(summary.trucksCurrentlyDueForService)}</div>
        </div>
        <div className="ops-card ops-kpi-card">
          <div className="ops-card-title">GPS Coverage</div>
          <div className="ops-kpi-value">{summary.coverageDays}/{summary.dates.length}</div>
          <div className="ops-kpi-sub">{gpsIssueDays} day{gpsIssueDays === 1 ? "" : "s"} need attention</div>
        </div>
      </div>

      <details className="ops-card ops-fleet-more-metrics">
        <summary>More monthly metrics</summary>
        <div className="ops-fleet-more-metrics-grid">
          <div><span>Unique trucks used</span><strong>{summary.uniqueTrucksUsed}</strong></div>
          <div><span>Average active trucks</span><strong>{summary.averageDailyActiveTrucks == null ? "—" : summary.averageDailyActiveTrucks.toFixed(2)}</strong></div>
          <div><span>Total drive time</span><strong>{formatMinutes(summary.totalDriveTimeMinutes)}</strong></div>
          <div><span>Total idle time</span><strong>{formatMinutes(summary.totalIdleTimeMinutes)}</strong></div>
          <div><span>Safety events</span><strong>{safetyEvents}</strong></div>
          <div><span>After-hours events</span><strong>{summary.totalAfterHoursEvents == null ? "—" : formatMaybeNumber(summary.totalAfterHoursEvents)}</strong></div>
        </div>
      </details>

      {section === "daily" && <div className="ops-card">
        <div className="ops-card-header compact">
          <div>
            <div className="ops-section-title">Monthly Daily Fleet</div>
            <div className="ops-muted">Click any date to jump to that day’s Fleet view. GPS-derived fields stay blank when the underlying data is unavailable.</div>
          </div>
        </div>

        <div className="ops-wide-table-wrap">
          <table className="ops-table ops-fleet-summary-table">
            <thead>
              <tr>
                <th className="ops-fleet-sticky">
                  <Link href={sortHeaderHref(sortKey, sortDirection, "date", summaryDate)}>Date</Link>
                </th>
                <th>
                  <Link href={sortHeaderHref(sortKey, sortDirection, "revenue", summaryDate)}>Overall Revenue</Link>
                </th>
                <th>Active Trucks</th>
                <th>
                  <Link href={sortHeaderHref(sortKey, sortDirection, "jobs", summaryDate)}>Jobs Completed</Link>
                </th>
                <th>
                  <Link href={sortHeaderHref(sortKey, sortDirection, "miles", summaryDate)}>Total Miles</Link>
                </th>
                <th>
                  <Link href={sortHeaderHref(sortKey, sortDirection, "driverScore", summaryDate)}>Average Driver Score</Link>
                </th>
                <th>Alerts</th>
                <th>GPS Data Status</th>
              </tr>
            </thead>
            <tbody>
              {summary.dates.map((row) => (
                <tr key={row.date}>
                  <td className="ops-fleet-sticky">
                    <Link href={dailyHref(row.date)} className="ops-fleet-date-link">{row.date}</Link>
                  </td>
                  <td className="ops-money">{money(row.revenue)}</td>
                  <td>{row.activeTrucks == null ? "—" : row.activeTrucks}</td>
                  <td>{row.jobsCompleted == null ? "—" : row.jobsCompleted}</td>
                  <td>{row.totalMiles == null ? "—" : `${formatMaybeNumber(row.totalMiles, 2)} mi`}</td>
                  <td>{row.averageDriverScore == null ? "Insufficient driving data" : formatScore(row.averageDriverScore)}</td>
                  <td>{[row.speedingEvents, row.severeSpeedingEvents, row.afterHoursEvents].reduce<number>((total, value) => total + (value == null ? 0 : Number(value)), 0)}</td>
                  <td>{row.gpsDataStatus}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>}

      {section === "drivers" && <div className="ops-card">
        <div className="ops-card-header compact">
          <div>
            <div className="ops-section-title">Month-to-date Driver Performance</div>
            <div className="ops-muted">Navigator-only assignments are excluded. Expand a driver to inspect daily attributed results.</div>
          </div>
        </div>

        <div className="ops-wide-table-wrap">
          <table className="ops-table ops-fleet-summary-table">
            <thead>
              <tr>
                <th>Driver</th>
                <th>Days Assigned as Driver</th>
                <th>Truck(s)</th>
                <th>Miles Driven</th>
                <th>Average Driver Score</th>
                <th>Safety Events</th>
                <th>Data Status</th>
              </tr>
            </thead>
            <tbody>
              {summary.driverRows.map((row) => (
                <tr key={row.name}>
                  <td>
                    <strong>{row.name}</strong>
                    <details className="ops-inline-details">
                      <summary>Daily results</summary>
                      <div className="ops-inline-details-panel">
                        {row.days.map((day) => (
                          <div key={day.date} className="ops-inline-detail-row">
                            <strong>{day.date}</strong>
                            <span>{day.truck}</span>
                            <span>{day.score == null ? "Insufficient driving data" : formatScore(day.score)} · {day.status}</span>
                            <span>{formatMaybeNumber(day.miles, 2)} mi · {day.driveTime} drive · {day.idleTime} idle · HB {formatOptionalCount(day.hardBrakingEvents)}</span>
                          </div>
                        ))}
                      </div>
                    </details>
                  </td>
                  <td>{row.daysAssigned}</td>
                  <td>{row.trucks.join(", ") || "—"}</td>
                  <td>{formatMaybeNumber(row.milesDriven, 2)} mi</td>
                  <td>{row.averageDriverScore == null ? "Insufficient driving data" : formatScore(row.averageDriverScore)}</td>
                  <td>{row.speedingEvents + row.severeSpeedingEvents + row.afterHoursEvents + (row.hardBrakingEvents || 0)}</td>
                  <td>{row.partialOrAmbiguousDays ? `${row.partialOrAmbiguousDays} partial` : `${row.confirmedDays} confirmed`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>}

      {section === "trucks" && <div className="ops-card">
        <div className="ops-card-header compact">
          <div>
            <div className="ops-section-title">Month-to-date Truck Performance</div>
            <div className="ops-muted">Revenue is the only financial metric shown here. Service fields remain blank unless the source has a valid value.</div>
          </div>
        </div>

        <div className="ops-wide-table-wrap">
          <table className="ops-table ops-fleet-summary-table">
            <thead>
              <tr>
                <th>Truck</th>
                <th>Days Used</th>
                <th>Jobs Completed</th>
                <th>Revenue</th>
                <th>Miles</th>
                <th>Average Driver Score</th>
                <th>Safety Events</th>
                <th>Service Status</th>
              </tr>
            </thead>
            <tbody>
              {summary.truckRows.map((row) => (
                <tr key={row.truck}>
                  <td>
                  <FleetTruckLink
                      href={buildFleetHref({
                        view: "daily",
                        date: row.lastGpsDate || latestAvailableDate,
                      }) + `&truck=${encodeURIComponent(truckParam(row.truck))}`}
                      className="ops-fleet-truck-link"
                    >
                      <strong>{row.truck}</strong>
                    </FleetTruckLink>
                    <details className="ops-inline-details">
                      <summary>Daily results</summary>
                      <div className="ops-inline-details-panel">
                        {row.days.map((day) => (
                          <div key={day.date} className="ops-inline-detail-row">
                            <strong>{day.date}</strong>
                            <span>{day.driver}</span>
                            <span>{day.score == null ? "Insufficient driving data" : formatScore(day.score)} · {day.status}</span>
                            <span>{formatMaybeNumber(day.miles, 2)} mi · {formatMinutes(day.driveTime)} drive · {formatMinutes(day.idleTime)} idle · HB {formatOptionalCount(day.hardBrakingEvents)}</span>
                          </div>
                        ))}
                      </div>
                    </details>
                  </td>
                  <td>{row.daysUsed}</td>
                  <td>{row.jobsCompleted}</td>
                  <td className="ops-money">{money(row.revenue)}</td>
                  <td>{formatMaybeNumber(row.miles, 2)} mi</td>
                  <td>{formatScore(row.averageDriverScore)}</td>
                  <td>{formatMaybeNumber(row.safetyEvents)}</td>
                  <td>{row.serviceStatus || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>}

      {section === "quality" && <div className="ops-card">
        <div className="ops-card-header compact">
          <div>
            <div className="ops-section-title">Monthly Fleet Validation Audit</div>
            <div className="ops-muted">Source coverage is reported explicitly. Missing categories remain blank or unavailable.</div>
          </div>
        </div>

        <div className="ops-wide-table-wrap">
          <table className="ops-table ops-fleet-summary-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Revenue</th>
                <th>Jobs</th>
                <th>Trucks Used</th>
                <th>GPS Coverage</th>
                <th>Mileage Coverage</th>
                <th>Alert Coverage</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {summary.sourceAuditRows.map((row) => (
                <tr key={`audit-${row.date}`}>
                  <td>{row.date}</td>
                  <td className="ops-money">{money(row.revenue)}</td>
                  <td>{row.jobsCompleted == null ? "—" : row.jobsCompleted}</td>
                  <td>{row.trucksUsed == null ? "—" : row.trucksUsed}</td>
                  <td>{row.gpsCoverage ? "Covered" : "Unavailable"}</td>
                  <td>{row.mileageCoverage ? "Covered" : "Unavailable"}</td>
                  <td>{row.alertCoverage ? "Covered" : "Unavailable"}</td>
                  <td>{row.gpsDataStatus}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <details className="ops-fleet-source-details">
          <summary>Show source-by-source audit</summary>
          <div className="ops-wide-table-wrap ops-source-matrix">
          <table className="ops-table ops-fleet-summary-table ops-fleet-source-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Appointments</th>
                <th>Completed Jobs</th>
                <th>Revenue</th>
                <th>Krewe Assignments</th>
                <th>Driver Assignments</th>
                <th>Linxup Trips</th>
                <th>Linxup Mileage</th>
                <th>Linxup Alerts</th>
                <th>Driver Scores</th>
                <th>Maintenance Data</th>
              </tr>
            </thead>
            <tbody>
              {summary.sourceAuditRows.map((row) => (
                <tr key={`sources-${row.date}`}>
                  <td>{row.date}</td>
                  <td>{sourceMark(row.sourceFlags.appointments)}</td>
                  <td>{sourceMark(row.sourceFlags.completedJobs)}</td>
                  <td>{sourceMark(row.sourceFlags.revenue)}</td>
                  <td>{sourceMark(row.sourceFlags.crewAssignments)}</td>
                  <td>{sourceMark(row.sourceFlags.driverAssignments)}</td>
                  <td>{sourceMark(row.sourceFlags.linxupTrips)}</td>
                  <td>{sourceMark(row.sourceFlags.linxupMileage)}</td>
                  <td>{sourceMark(row.sourceFlags.linxupAlerts)}</td>
                  <td>{sourceMark(row.sourceFlags.driverScores)}</td>
                  <td>{sourceMark(row.sourceFlags.maintenanceData)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </details>
      </div>}
    </div>
  );
}

type AlertEntry = {
  label: string;
  value: unknown;
  available?: boolean;
  safetyDeduction?: number;
  overallDeduction?: number;
  deductionRule?: string;
};

type AlertDetail = {
  alert_id?: string | null;
  alert_type?: string | null;
  alert_type_normalized?: string | null;
  occurred_at?: string | null;
  truck_number?: string | null;
  vehicle_name?: string | null;
  driver_name?: string | null;
  driver_normalized_name?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  address?: string | null;
  geofence_name?: string | null;
  severity?: string | null;
  video_available?: boolean;
};

function alertEntries(row: AnyRecord): AlertEntry[] {
  if (row.weighted_alert_counts && row.weighted_alert_availability) {
    const counts = row.weighted_alert_counts;
    const available = row.weighted_alert_availability;
    const deductions = row.alert_deductions || {};
    return [
      ...DRIVING_SCORE_ALERT_RULES.map((rule) => ({
        label: rule.label,
        value: counts[rule.key],
        available: available[rule.key] !== false,
        safetyDeduction: Number(deductions[rule.key] || 0),
        overallDeduction: Number(deductions[rule.key] || 0) * 0.9,
        deductionRule: `${rule.perEvent} points per alert, maximum ${rule.dailyCap} per day`,
      })),
    ];
  }

  const alerts = row.driver_alerts && typeof row.driver_alerts === "object" ? row.driver_alerts : null;
  if (!alerts) {
    return [
      { label: "Speeding", value: row.speeding_events, available: true },
      { label: "Severe Speeding", value: row.severe_speeding_events, available: true },
      { label: "Harsh Braking", value: row.hard_braking_events, available: row.hard_braking_events != null },
      { label: "Hard Acceleration", value: row.hard_acceleration_events, available: row.hard_acceleration_events != null },
      { label: "Harsh Cornering", value: row.harsh_cornering_events, available: row.harsh_cornering_events != null },
      { label: "No Seatbelts", value: row.seat_belt_events, available: row.seat_belt_events != null },
      { label: "Tailgating", value: row.tailgating_events, available: row.tailgating_events != null },
      { label: "After-Hours Driving", value: row.after_hours_events, available: true },
    ];
  }

  return Object.values(alerts).map((entry: any) => ({
    label: String(entry?.label || "Alert"),
    value: entry?.value,
    available: Boolean(entry?.available),
  }));
}

function DriverAlertSummary({ entries }: { entries: AlertEntry[] }) {
  const incidents = entries.filter((entry) => entry.available && Number(entry.value) > 0);
  const clearCount = entries.filter((entry) => entry.available && Number(entry.value) === 0).length;
  const unavailableCount = entries.filter((entry) => !entry.available).length;
  const incidentCount = incidents.reduce((sum, entry) => sum + Number(entry.value || 0), 0);

  return (
    <div className="ops-driver-exceptions">
      <div className="ops-driver-exceptions-head">
        <div>
          <span>Safety exceptions</span>
          <strong>{incidentCount > 0 ? `${incidentCount} alert${incidentCount === 1 ? "" : "s"} affecting score` : "No scored alerts"}</strong>
        </div>
        {clearCount > 0 ? <div className="ops-driver-clear-count">{clearCount} categories clear</div> : null}
      </div>

      {incidents.length > 0 ? (
        <div className="ops-driver-exception-list">
          {incidents.map((entry) => {
            const count = Number(entry.value || 0);
            return (
              <div key={entry.label} className="ops-driver-exception-item">
                <div>
                  <strong>{entry.label}</strong>
                  <span>{count} event{count === 1 ? "" : "s"}</span>
                </div>
                {entry.safetyDeduction == null ? null : (
                  <div className="ops-driver-exception-impact">
                    <strong>−{(entry.overallDeduction || 0).toFixed(1)}</strong>
                    <span>overall · −{entry.safetyDeduction.toFixed(0)} safety</span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="ops-driver-all-clear">No safety events reduced this score.</div>
      )}

      {unavailableCount > 0 ? <div className="ops-driver-unavailable">{unavailableCount} unsupported categor{unavailableCount === 1 ? "y" : "ies"} excluded from scoring</div> : null}
    </div>
  );
}

function alertDetailRows(row: AnyRecord): AlertDetail[] {
  return Array.isArray(row.alert_events) ? row.alert_events as AlertDetail[] : [];
}

export default async function FleetPage({
  searchParams,
}: {
  searchParams?: Promise<AnyRecord>;
}) {
  const params = searchParams ? await searchParams : undefined;
  const view = normalizeFleetView(params?.view);
  const sortKey = normalizeSortKey(params?.sort);
  const requestedSortDirection = normalizeSortDirection(params?.dir);
  const sortDirection = String(params?.dir || "").toLowerCase() === "asc" || String(params?.dir || "").toLowerCase() === "desc"
    ? requestedSortDirection
    : defaultSortDirection(sortKey);
  const monthlySection = normalizeMonthlySection(params?.section);
  const requestedSection = String(params?.section || "overview").toLowerCase();
  const date = resolveDate(params);

  if (view === "maintenance") {
    return renderMaintenancePage({ date, sortKey, sortDirection, requestedSection });
  }

  if (view === "monthly") {
    const summary = buildFleetMonthlySummary(date, { sortKey, sortDirection });
    return renderJulySummaryPage({ summary, sortKey, sortDirection, section: monthlySection });
  }

  const metrics = readMetrics(date);
  const dailyRecord = buildFleetDailyRecord(date);
  const truckScoreRows = dailyRecord?.truckScoreRows || truckDriverScoreRows(metrics);
  const trucks = mergeFleetTruckRows(truckRows(metrics), truckScoreRows);
  const driverMap = new Map<string, AnyRecord>();
  for (const row of truckScoreRows) {
    driverMap.set(String(row.truck || "").trim(), row);
  }
  const activeTrucks = trucks.filter(
    (truck) => truck.hasGpsActivity || Number(truck.revenue || 0) > 0 || Number(truck.jobs || 0) > 0
  ).length;
  const totalRevenue = trucks.reduce((sum, t) => sum + Number(t.revenue || 0), 0);
  const totalJobs = trucks.reduce((sum, t) => sum + Number(t.jobs || 0), 0);
  const totalExpenses = trucks.reduce((sum, t) => sum + Number(t.expenses || 0), 0);
  const selectedTruck = params?.truck ? normalizeTruckLabel(params.truck) : "";
  const selectedDriverRow = driverMap.get(selectedTruck);
  const mapPayload = buildFleetMapPayload(date, selectedTruck);
  const section = requestedSection === "performance"
    ? "overview"
    : ["overview", "map", "scores"].includes(requestedSection)
      ? requestedSection
      : "overview";

  return (
    <div className="ops-dashboard">
      <PageHeader
        title="Fleet"
        subtitle="Truck-level revenue, jobs, average job size, and expenses"
        date={date}
        lastUpdated={metrics?.generated_at}
        sections={[
          { label: "Overview", href: `/fleet?date=${date}&section=overview`, active: section === "overview" },
          { label: "Live map", href: `/fleet?date=${date}&section=map`, active: section === "map" },
          { label: "Driving scores", href: `/fleet?date=${date}&section=scores`, active: section === "scores" },
          { label: "Maintenance", href: buildFleetHref({ view: "maintenance", date }) },
          { label: "Monthly", href: buildFleetHref({ view: "monthly", date, sort: sortKey, dir: sortDirection }) },
        ]}
      />

      <div className={section === "overview" ? "ops-kpi-row" : "ops-section-hidden"} id="fleet-overview">
        <div className="ops-card ops-kpi-card">
          <div className="ops-card-title">Active Trucks</div>
          <div className="ops-kpi-value">{activeTrucks}</div>
        </div>

        <div className="ops-card ops-kpi-card">
          <div className="ops-card-title">Truck Revenue</div>
          <div className="ops-kpi-value ops-kpi-accent">{money(totalRevenue)}</div>
        </div>

        <div className="ops-card ops-kpi-card">
          <div className="ops-card-title">Jobs</div>
          <div className="ops-kpi-value">{totalJobs}</div>
        </div>

        <div className="ops-card ops-kpi-card">
          <div className="ops-card-title">Truck Expenses</div>
          <div className="ops-kpi-value">{money(totalExpenses)}</div>
        </div>
      </div>

      {mapPayload && <div id="fleet-map" className={section === "map" ? "" : "ops-section-hidden"}><FleetMapClient payload={mapPayload} /></div>}

      <div className={section === "scores" ? "ops-card" : "ops-section-hidden"} id="fleet-driving-scores">
        <div className="ops-card-header compact">
          <div>
            <div className="ops-section-title">Truck Driving Scores</div>
            <div className="ops-muted">Every truck is scored from its own GPS activity. Driver attribution is supplemental and never suppresses a truck score.</div>
            <div className="ops-driver-scoring-rules">
              {DRIVING_SCORE_ALERT_RULES.map((rule) => `${rule.label}: ${rule.perEvent} points each, maximum ${rule.dailyCap}`).join(" · ")}. Unsupported alerts are excluded. {DRIVING_SCORE_COMPENSATION_COPY}
            </div>
          </div>
        </div>

        <table className="ops-table">
          <thead>
            <tr>
              <th>Truck</th>
              <th>Driver</th>
              <th>Score</th>
              <th>Miles</th>
              <th>Drive Time</th>
              <th>Idle Time</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {trucks.map((truck) => {
              const truckLabel = normalizeTruckLabel(truck.truck);
              const telemetry = driverMap.get(truckLabel) || truck;
              const driveMinutes = Number(telemetry?.drive_minutes ?? telemetry?.drive_time_minutes);
              const idleMinutes = Number(telemetry?.idle_minutes ?? telemetry?.idle_time_minutes);
              const driveTime = Number.isFinite(driveMinutes) ? formatMinutes(driveMinutes) : telemetry?.drive_time || "—";
              const idleTime = Number.isFinite(idleMinutes) ? formatMinutes(idleMinutes) : telemetry?.idle_time || "—";
              const idleScore = Number(telemetry?.idle_score);
              const idlePercentage = Number(telemetry?.idle_percentage);
              const assignedDrivers = Array.isArray(telemetry?.assigned_drivers)
                ? telemetry.assigned_drivers.filter(Boolean)
                : telemetry?.assigned_driver && telemetry.assigned_driver !== "Multiple"
                  ? [telemetry.assigned_driver]
                  : [];
              const driverName = assignedDrivers.length > 0 ? assignedDrivers.join(", ") : "Unassigned";
              const rawScore = telemetry?.opscenter_driving_score ?? telemetry?.driver_score;
              const numericScore = rawScore === null || rawScore === undefined || rawScore === "" ? Number.NaN : Number(rawScore);
              const hasScore = Number.isFinite(numericScore);
              const hasDriving = Number(telemetry?.miles_driven || 0) > 0 || Number(driveMinutes || 0) > 0;
              const scoreTone = Number.isFinite(numericScore)
                ? numericScore >= 80 ? "ops-score-good" : numericScore >= 60 ? "ops-score-warning" : "ops-score-bad"
                : "";
              const driverDetailId = `truck-score-detail-${encodeURIComponent(truckLabel)}`;
              const scoreDisplay = hasScore ? numericScore.toFixed(1) : hasDriving ? "Score unavailable" : "No GPS driving";
              const statusDisplay = hasScore
                ? [driverScoreStatus(telemetry), driverScoreSource(telemetry)].filter(Boolean).join(" · ") || "OpsCenter calculated"
                : hasDriving ? "Driving detected · score unavailable" : "No scorable GPS activity";

              return (
                <Fragment key={truckLabel}>
                  <tr>
                    <td>
                      <InlineDriverToggle name={truckLabel} targetId={driverDetailId} />
                    </td>
                    <td>{driverName}</td>
                    <td className={hasScore ? scoreTone : undefined}>{scoreDisplay}</td>
                    <td>{formatMileage(telemetry?.miles_driven)}</td>
                    <td>{driveTime}</td>
                    <td>{idleTime}</td>
                    <td>{statusDisplay}</td>
                  </tr>
                  <tr id={driverDetailId} className="ops-driver-expanded-row" hidden>
                      <td colSpan={7}>
                        <div className="ops-driver-panel">
                          <div className="ops-driver-panel-heading">
                            <div>
                              <span>Truck driving score</span>
                              <strong>{truckLabel}</strong>
                            </div>
                            <div className={`ops-driver-score-status ${hasScore ? scoreTone : "ops-score-neutral"}`}>
                              {hasScore ? drivingScoreCompensationLabel(numericScore) : "No score"}
                            </div>
                          </div>

                          {!hasScore ? (
                            <div className="ops-driver-empty-state">
                              <div className="ops-driver-empty-copy">
                                <strong>{hasDriving ? "A truck score could not be calculated" : "No scorable GPS driving data"}</strong>
                                <span>{hasDriving ? "GPS activity exists, but the available telemetry is not sufficient to calculate a reliable score." : "The truck’s GPS feed contains no driving distance or driving time for the selected date."}</span>
                              </div>
                              <div className="ops-driver-empty-facts">
                                <div><span>Driver</span><strong>{driverName}</strong></div>
                                <div><span>Miles</span><strong>{formatMileage(telemetry?.miles_driven)}</strong></div>
                                <div><span>Driving</span><strong>{driveTime}</strong></div>
                              </div>
                            </div>
                          ) : (
                            <>
                              <div className="ops-driver-score-overview">
                                <div className="ops-driver-score-primary">
                                  <span>Overall</span>
                                  <strong>{driverScoreDisplay(telemetry)}</strong>
                                  <small>out of 100</small>
                                </div>
                                <div className="ops-driver-score-component">
                                  <span>Safety</span>
                                  <strong>{Number.isFinite(Number(telemetry?.safety_score)) ? Number(telemetry.safety_score).toFixed(1) : "—"}</strong>
                                  <small>90% weight</small>
                                </div>
                                <div className="ops-driver-score-component">
                                  <span>Idling</span>
                                  <strong>{Number.isFinite(idleScore) ? idleScore.toFixed(0) : "—"}</strong>
                                  <small>{Number.isFinite(idlePercentage) ? `${idlePercentage.toFixed(1)}% idle · 10% weight` : "10% weight"}</small>
                                </div>
                                <div className="ops-driver-trip-facts">
                                  <div><span>Driver</span><strong>{driverName}</strong></div>
                                  <div><span>Miles</span><strong>{formatMileage(telemetry?.miles_driven)}</strong></div>
                                  <div><span>Driving</span><strong>{driveTime}</strong></div>
                                </div>
                              </div>

                              <DriverAlertSummary entries={alertEntries(telemetry)} />
                            </>
                          )}
                        </div>
                      </td>
                  </tr>
                </Fragment>
              );
            })}

            {trucks.length === 0 && (
              <tr>
                <td colSpan={7} className="ops-muted">No truck driving data available.</td>
              </tr>
            )}
          </tbody>
        </table>

        {selectedDriverRow && (
          <div className="ops-driver-panel">
            <div className="ops-driver-panel-title">
              Selected Truck: <strong>{selectedTruck}</strong>
            </div>
            <div className="ops-driver-panel-grid">
              <div><span>Assigned Driver</span><strong>{selectedDriverRow.assigned_driver || "—"}</strong></div>
              <div><span>Driver Score</span><strong>{driverScoreDisplay(selectedDriverRow)}</strong></div>
              <div><span>Status</span><strong>{[driverScoreStatus(selectedDriverRow), driverScoreSource(selectedDriverRow)].filter(Boolean).join(" · ") || selectedDriverRow.confidence_status || "—"}</strong></div>
              <div><span>Miles</span><strong>{formatMileage(selectedDriverRow.miles_driven)}</strong></div>
              <div><span>Drive Time</span><strong>{selectedDriverRow.drive_minutes ? `${Number(selectedDriverRow.drive_minutes).toFixed(0)} min` : selectedDriverRow.drive_time || "—"}</strong></div>
              <div><span>Idle Time</span><strong>{selectedDriverRow.idle_minutes ? `${Number(selectedDriverRow.idle_minutes).toFixed(0)} min` : selectedDriverRow.idle_time || "—"}</strong></div>
              <div><span>Harsh Braking</span><strong>{formatOptionalCount(selectedDriverRow.hard_braking_events)}</strong></div>
            </div>

            <div className="ops-driver-alerts">
              <DriverAlertSummary entries={alertEntries(selectedDriverRow)} />
              <details className="ops-alert-details">
                <summary>View alerts {selectedDriverRow.alert_event_count > 0 ? `(${selectedDriverRow.alert_event_count})` : ''}</summary>
                <div className="ops-alert-detail-list">
                  {alertDetailRows(selectedDriverRow).length > 0 ? alertDetailRows(selectedDriverRow).map((alert) => (
                    <div key={alert.alert_id || `${alert.alert_type}-${alert.occurred_at}-${alert.truck_number}`} className="ops-alert-detail-row">
                      <div><span>Time</span><strong>{String(alert.occurred_at || '—')}</strong></div>
                      <div><span>Type</span><strong>{String(alert.alert_type_normalized && alert.alert_type_normalized !== "unknown" ? alert.alert_type_normalized : alert.alert_type || 'unknown')}</strong></div>
                      <div><span>Truck</span><strong>{String(alert.truck_number || '—')}</strong></div>
                      <div><span>Driver</span><strong>{String(alert.driver_name || '—')}</strong></div>
                      <div><span>Location</span><strong>{String(alert.address || alert.geofence_name || '—')}</strong></div>
                      <div><span>Severity</span><strong>{String(alert.severity || '—')}</strong></div>
                      <div><span>Video</span><strong>{alert.video_available ? 'Available' : 'Unavailable'}</strong></div>
                    </div>
                  )) : <div className="ops-muted">No alert detail available.</div>}
                </div>
              </details>
            </div>
          </div>
        )}
      </div>

      <div className={section === "overview" ? "ops-card" : "ops-section-hidden"} id="fleet-truck-performance">
        <div className="ops-card-header compact">
          <div>
            <div className="ops-section-title">Truck Activity</div>
            <div className="ops-muted">All trucks with financial or GPS activity are shown. Employee revenue stays on Krewe.</div>
          </div>
        </div>

        <table className="ops-table">
          <thead>
            <tr>
              <th>Truck</th>
              <th>Jobs</th>
              <th>Revenue</th>
              <th>Avg Job Size</th>
              <th>Expenses</th>
              <th>Net</th>
              <th>Miles</th>
              <th>Drive Time</th>
              <th>Activity</th>
            </tr>
          </thead>
          <tbody>
            {trucks.map((row) => (
              <tr key={row.truck} className={normalizeTruckLabel(row.truck) === selectedTruck ? "ops-row-selected" : ""}>
                <td>
                  <FleetTruckLink href={buildFleetHref({ view: "daily", date, sort: sortKey, dir: sortDirection }) + `&truck=${encodeURIComponent(truckParam(row.truck))}`} className="ops-fleet-truck-link">
                    <strong>{row.truck}</strong>
                  </FleetTruckLink>
                </td>
                <td>{row.jobs}</td>
                <td className="ops-money">{money(row.revenue)}</td>
                <td className="ops-money">{money(row.averageJobSize)}</td>
                <td className="ops-money">{money(row.expenses)}</td>
                <td className="ops-money">{money(row.net)}</td>
                <td>{formatMileage(row.milesDriven)}</td>
                <td>{row.driveMinutes == null ? "Unavailable" : formatMinutes(row.driveMinutes)}</td>
                <td>{row.hasGpsActivity ? "GPS activity" : Number(row.jobs || 0) > 0 ? "Completed work" : "No activity recorded"}</td>
              </tr>
            ))}

            {trucks.length === 0 && (
              <tr>
                <td colSpan={9} className="ops-muted">No truck data available.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
