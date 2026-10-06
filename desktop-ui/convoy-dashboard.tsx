import { useState } from "react";
import { ArrowRight, Truck, Search, Wrench, ChevronLeft } from "lucide-react";
import { Button } from "./components/ui/button";
import { sameTruck, recordedValue, truckLoadLabel } from "./lib/convoy-presentation";
import { fleetServiceTypes, mileageQuality, servicePlan } from "../lib/fleet-service-plan";
import type {
  DesktopFleetSnapshot,
  DesktopFleetTruck,
  FleetView,
} from "./lib/people-fleet-contract";
import type { FleetRecord } from "./convoy-views";
import { ConvoyHistory } from "./convoy-views";
export type DashboardProps = {
  snapshot: DesktopFleetSnapshot;
  trucks: DesktopFleetTruck[];
  truckId: string;
  onTruck: (id: string) => void;
  open: (record: FleetRecord) => void;
  onView?: (view: FleetView) => void;
  now: number;
};
export const fleetDate = (date: string) =>
  date
    ? new Date(`${date.slice(0, 10)}T12:00:00`).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      })
    : "Not recorded";
const miles = (value: number | null | undefined) =>
  value == null ? "Unavailable" : `${Math.round(value).toLocaleString("en-US")} mi`;
const label = (truck: DesktopFleetTruck) => truck.label.replace("Truck#", "Truck");
const stamp = (value: string | undefined) =>
  value && Number.isFinite(Date.parse(value))
    ? new Date(value).toLocaleString("en-US", {
        timeZone: "America/Chicago",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      }) + " CT"
    : "No report time";
const recordsFor = (s: DesktopFleetSnapshot, t: DesktopFleetTruck) =>
  s.maintenance.filter((r) => sameTruck(r.truck, t.id));
const intervalsFor = (s: DesktopFleetSnapshot, t: DesktopFleetTruck) =>
  (s.intervals || []).filter((r) => sameTruck(r.truck, t.id));
function plansFor(s: DesktopFleetSnapshot, t: DesktopFleetTruck, now: number) {
  const records = recordsFor(s, t),
    intervals = intervalsFor(s, t);
  const types = [
    ...new Set([
      ...fleetServiceTypes.slice(0, 4),
      ...intervals.map((i) => i.serviceType),
      ...records.map((r) => r.serviceType),
    ]),
  ];
  return types.map((type) =>
    servicePlan(
      type,
      intervals.find((i) => i.serviceType === type),
      records,
      t.mileage,
      s.date,
      now,
    ),
  );
}
function baselineNeeded(s: DesktopFleetSnapshot, t: DesktopFleetTruck, now: number) {
  return plansFor(s, t, now).some((p) => p.status === "baseline" || p.status === "unset");
}
function Badge({ children, tone = "neutral" }: { children: React.ReactNode; tone?: string }) {
  return <span className={`convoy-badge ${tone}`}>{children}</span>;
}
function Metric({
  value,
  title,
  detail,
  onClick,
}: {
  value: React.ReactNode;
  title: string;
  detail: string;
  onClick?: () => void;
}) {
  const content = (
    <>
      <strong>{value}</strong>
      <span>{title}</span>
      <small>{detail}</small>
    </>
  );
  return onClick ? (
    <button className="convoy-metric" onClick={onClick}>
      {content}
    </button>
  ) : (
    <div className="convoy-metric">{content}</div>
  );
}
export function Mileage({
  truck,
  now,
  detail = false,
}: {
  truck: DesktopFleetTruck;
  now: number;
  detail?: boolean;
}) {
  const m = truck.mileage,
    q = mileageQuality(m, now);
  return (
    <div className="convoy-mileage">
      <strong>{q === "conflict" ? "Needs verification" : miles(m?.value)}</strong>
      <small>
        {q === "conflict"
          ? m?.duplicate
            ? "Multiple LinxUp vehicle records"
            : `${miles(m?.value)} virtual / ${miles(m?.estimated)} estimated`
          : q === "unavailable"
            ? "No LinxUp mileage"
            : `${m?.source} odometer${q === "stale" ? " · stale reading" : q === "estimated" ? " · verify reading" : ""}`}
      </small>
      {detail && <small>Reported {stamp(m?.reportedAt)}</small>}
    </div>
  );
}
export function ServiceIntervals({
  snapshot,
  truck,
  open,
  now,
}: Pick<DashboardProps, "snapshot" | "open" | "now"> & { truck: DesktopFleetTruck }) {
  const plans = plansFor(snapshot, truck, now);
  return (
    <section className="convoy-dash-panel">
      <header>
        <div>
          <h2>Preventive maintenance</h2>
          <p>Set miles and/or months. Service is due at whichever limit comes first.</p>
        </div>
        <Button
          variant="outline"
          onClick={() =>
            open({
              kind: "interval",
              truck,
              serviceType: "Other",
              interval: snapshot.intervals?.find(
                (i) => sameTruck(i.truck, truck.id) && i.serviceType === "Other",
              ),
            })
          }
        >
          Add interval
        </Button>
      </header>
      <div className="convoy-table-wrap">
        <table className="convoy-data-table convoy-plan-table">
          <thead>
            <tr>
              <th>Service / interval</th>
              <th>Last completed</th>
              <th>Next target</th>
              <th>Status / action</th>
            </tr>
          </thead>
          <tbody>
            {plans.map((p) => (
              <tr key={p.serviceType}>
                <td>
                  <strong>{p.serviceType === "Oil change" ? "Oil & filter" : p.serviceType}</strong>
                  <small>
                    {p.interval?.enabled
                      ? [
                          p.interval.miles ? `${p.interval.miles.toLocaleString()} miles` : "",
                          p.interval.months ? `${p.interval.months} months` : "",
                        ]
                          .filter(Boolean)
                          .join(" or ")
                      : p.interval
                        ? "Interval paused"
                        : "Interval not set"}
                  </small>
                  <button
                    className="convoy-text-button"
                    onClick={() =>
                      fleetServiceTypes.includes(
                        p.serviceType as (typeof fleetServiceTypes)[number],
                      )
                        ? open({
                            kind: "interval",
                            truck,
                            interval: (snapshot.intervals || []).find(
                              (i) =>
                                sameTruck(i.truck, truck.id) && i.serviceType === p.serviceType,
                            ),
                            serviceType: p.serviceType,
                          })
                        : open({
                            kind: "maintenance",
                            truck,
                            record: recordsFor(snapshot, truck).find(
                              (r) => r.serviceType === p.serviceType,
                            ),
                          })
                    }
                  >
                    {!fleetServiceTypes.includes(
                      p.serviceType as (typeof fleetServiceTypes)[number],
                    )
                      ? "Review service type"
                      : p.interval
                        ? "Edit interval"
                        : "Set up interval"}
                  </button>
                </td>
                <td>
                  {p.completed ? fleetDate(p.completed.serviceDate) : "Not recorded"}
                  <small>{p.completed?.odometer != null ? miles(p.completed.odometer) : ""}</small>
                </td>
                <td>
                  {p.nextDate ? fleetDate(p.nextDate) : "Date not set"}
                  <small>{p.nextMiles !== null ? miles(p.nextMiles) : "Mileage not set"}</small>
                  {p.milesRemaining !== null && (
                    <small>
                      {Math.abs(Math.round(p.milesRemaining)).toLocaleString()} mi{" "}
                      {p.milesRemaining < 0 ? "past target" : "remaining"}
                    </small>
                  )}
                </td>
                <td>
                  <Badge
                    tone={
                      ["due", "soon", "baseline", "unknown", "unset"].includes(p.status)
                        ? "warning"
                        : "neutral"
                    }
                  >
                    {
                      {
                        baseline: "Needs baseline",
                        unset: "Set an interval",
                        due: "Due now",
                        soon: "Due soon",
                        unknown: "Check mileage",
                        current: "Within targets",
                      }[p.status]
                    }
                  </Badge>
                  {p.incomplete && p.completed && <small>Mileage status unverified</small>}
                  <button
                    className="convoy-text-button"
                    onClick={() =>
                      open({
                        kind: "maintenance",
                        truck,
                        serviceType: p.serviceType,
                        initialStatus: p.completed ? "scheduled" : "completed",
                      })
                    }
                  >
                    {p.completed ? "Schedule service" : "Add last service"}
                  </button>
                  {p.scheduled && <small>Scheduled {fleetDate(p.scheduled.serviceDate)}</small>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
function Coverage({ snapshot, trucks, now }: Pick<DashboardProps, "snapshot" | "trucks" | "now">) {
  const count = (q: string) => trucks.filter((t) => mileageQuality(t.mileage, now) === q).length;
  return (
    <section className="convoy-coverage">
      <h2>Fleet data coverage</h2>
      <p>
        {count("current")} usable mileage readings
        <br />
        {count("stale")} stale readings
        <br />
        {count("unavailable")} without mileage
        <br />
        {count("conflict") + count("estimated")} needing verification
      </p>
      <hr />
      <small>Latest LinxUp retrieval: {stamp(snapshot.mileageRetrievedAt)}</small>
      <p>
        Missing maintenance history stays unknown. Stale or conflicting mileage cannot establish
        current service status.
      </p>
    </section>
  );
}
export function ConvoyDashboard(props: DashboardProps) {
  const { snapshot, trucks, truckId, onTruck, open, onView, now } = props;
  const [filter, setFilter] = useState("all"),
    [query, setQuery] = useState("");
  const repairs = snapshot.issues.filter((i) => i.status !== "resolved");
  const stop = trucks.filter((t) =>
    repairs.some((i) => sameTruck(i.truck, t.id) && i.severity === "out_of_service"),
  );
  const review = trucks.filter((t) => mileageQuality(t.mileage, now) !== "current");
  const baseline = trucks.filter((t) => baselineNeeded(snapshot, t, now));
  const scheduled = snapshot.maintenance.filter(
    (r) => r.status === "scheduled" && r.serviceDate < snapshot.date,
  );
  const repairsKnown = !snapshot.warnings.some((w) => w.startsWith("Repair source"));
  const selected = trucks.find((t) => t.id === truckId);
  if (selected) return <ConvoyTruckDetail {...props} truck={selected} />;
  const visible = trucks.filter(
    (t) =>
      (filter === "all" ||
        (filter === "mileage" && review.includes(t)) ||
        (filter === "stop" && stop.includes(t)) ||
        (filter === "repairs" && repairs.some((i) => sameTruck(i.truck, t.id))) ||
        (filter === "baseline" && baseline.includes(t))) &&
      `${t.label} ${t.vehicle}`.toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <div className="convoy-dashboard">
      <div className="convoy-metrics">
        <Metric
          value={trucks.length}
          title="Fleet trucks"
          detail={`${trucks.filter((t) => t.mileage?.value != null).length} have LinxUp mileage`}
          onClick={() => setFilter("all")}
        />
        <Metric
          value={repairsKnown ? stop.length : "—"}
          title="Out of service"
          detail="Recorded on active repairs"
          onClick={() => setFilter("stop")}
        />
        <Metric
          value={repairsKnown ? repairs.length : "—"}
          title="Active repairs"
          detail={`${repairs.filter((i) => i.status === "open").length} open · ${repairs.filter((i) => i.status === "in_progress").length} in progress`}
          onClick={() => setFilter("repairs")}
        />
        <Metric
          value={baseline.length}
          title="Service setup needed"
          detail="Add last service + interval"
          onClick={() => setFilter("baseline")}
        />
      </div>
      <div className="convoy-dashboard-grid">
        <section className="convoy-dash-panel">
          <header>
            <h2>
              {filter === "all"
                ? "All trucks"
                : {
                    mileage: "Mileage review",
                    stop: "Out of service",
                    repairs: "Trucks with repairs",
                    baseline: "Service setup needed",
                  }[filter]}
            </h2>
            <small>Latest LinxUp mileage</small>
          </header>
          <div className="convoy-table-tools">
            <div>
              <button aria-pressed={filter === "all"} onClick={() => setFilter("all")}>
                All trucks <b>{trucks.length}</b>
              </button>
              <button aria-pressed={filter === "mileage"} onClick={() => setFilter("mileage")}>
                Mileage review <b>{review.length}</b>
              </button>
            </div>
            <label className="convoy-search">
              <Search size={15} />
              <input
                aria-label="Search trucks"
                placeholder="Search trucks…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </label>
          </div>
          <div className="convoy-table-wrap">
            <table className="convoy-data-table">
              <thead>
                <tr>
                  <th>Truck</th>
                  <th>LinxUp mileage</th>
                  <th>Reading status</th>
                  <th>Repairs / next action</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((t) => {
                  const issues = repairs.filter((i) => sameTruck(i.truck, t.id)),
                    q = mileageQuality(t.mileage, now);
                  return (
                    <tr key={t.id}>
                      <td>
                        <button className="convoy-truck-link" onClick={() => onTruck(t.id)}>
                          <Truck size={16} />
                          {label(t)}
                          <ArrowRight size={14} />
                        </button>
                      </td>
                      <td>
                        <div className="convoy-overview-mileage">
                          <strong>
                            {q === "conflict" ? "Needs verification" : miles(t.mileage?.value)}
                          </strong>
                          {q === "conflict" ? (
                            <small>
                              {t.mileage?.duplicate
                                ? "Multiple vehicle records"
                                : `${Math.round(t.mileage?.value || 0).toLocaleString()} vs ${t.mileage?.estimated?.toLocaleString() || "unavailable"}`}
                            </small>
                          ) : (
                            <span>{t.mileage?.value != null ? ` · ${t.mileage?.source}` : ""}</span>
                          )}
                        </div>
                      </td>
                      <td>
                        <Badge tone={q === "current" ? "neutral" : "warning"}>
                          {
                            {
                              current: "Reported",
                              stale: "Stale",
                              conflict: "Verify reading",
                              unavailable: "Unavailable",
                              estimated: "Estimated",
                            }[q]
                          }
                        </Badge>
                        <small title={stamp(t.mileage?.reportedAt)}>
                          {t.mileage?.reportedAt
                            ? new Date(t.mileage.reportedAt).toLocaleDateString("en-US", {
                                timeZone: "America/Chicago",
                                month: "short",
                                day: "numeric",
                              })
                            : "No LinxUp report"}
                        </small>
                      </td>
                      <td>
                        <button
                          className="convoy-next-action"
                          onClick={() => {
                            onTruck(t.id);
                            if (issues.length) onView?.("maintenance");
                            else onView?.("service");
                          }}
                        >
                          {issues.length
                            ? `${issues.some((i) => i.severity === "out_of_service") ? "Out of service · " : ""}${issues[0].title}${issues.length > 1 ? ` +${issues.length - 1}` : ""}`
                            : baselineNeeded(snapshot, t, now)
                              ? "Add service baseline"
                              : "View service plan"}
                          <ArrowRight size={14} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {!visible.length && (
              <p className="convoy-empty">
                No trucks match this filter.{" "}
                <button
                  className="convoy-text-button"
                  onClick={() => {
                    setFilter("all");
                    setQuery("");
                  }}
                >
                  Clear filters
                </button>
              </p>
            )}
          </div>
        </section>
        <aside className="convoy-side-stack">
          <section className="convoy-dash-panel convoy-attention">
            <h2>Needs attention</h2>
            <p>Start with the work that needs a decision.</p>
            <button
              onClick={() => {
                setFilter("stop");
                onTruck("");
              }}
            >
              <strong>Out-of-service repairs</strong>
              <span>
                {stop.length
                  ? stop.map(label).join(" · ")
                  : repairsKnown
                    ? "None recorded"
                    : "Repair source unavailable"}
              </span>
              <Badge tone="warning">
                {repairsKnown ? `${stop.length} trucks out of service` : "Review source"}
              </Badge>
            </button>
            <button onClick={() => onView?.("service")}>
              <strong>Review scheduled service</strong>
              <span>
                {scheduled.length
                  ? `${scheduled.length} scheduled visits have passed`
                  : "No past scheduled visits"}
              </span>
              <Badge tone="warning">
                {scheduled.length ? "Completion not recorded" : "View planned work"}
              </Badge>
            </button>
            <button onClick={() => onView?.("service")}>
              <strong>Set preventive maintenance</strong>
              <span>{baseline.length} trucks need service setup</span>
              <Badge tone="warning">Add baseline and interval</Badge>
            </button>
            <Button className="convoy-primary" onClick={() => onView?.("service")}>
              Open service planner <ArrowRight size={15} />
            </Button>
          </section>
          <Coverage snapshot={snapshot} trucks={trucks} now={now} />
        </aside>
      </div>
    </div>
  );
}
export function ConvoyService(props: DashboardProps) {
  const { snapshot, trucks, truckId, onTruck, open, now } = props;
  const [chosen, setChosen] = useState("");
  const [scheduledFilter, setScheduledFilter] = useState(false);
  const scoped = trucks.filter((t) => !truckId || t.id === truckId),
    truck = scoped.find((t) => t.id === chosen) || scoped[0];
  const records = snapshot.maintenance.filter((r) => scoped.some((t) => sameTruck(r.truck, t.id)));
  const scheduled = records
    .filter((r) => r.status === "scheduled")
    .sort((a, b) => a.serviceDate.localeCompare(b.serviceDate));
  const past = scheduled.filter((r) => r.serviceDate < snapshot.date);
  const plans = scoped.flatMap((t) => plansFor(snapshot, t, now));
  const due = plans.filter((p) => p.status === "due").length;
  const anyTargets = plans.some((p) => p.nextDate || p.nextMiles !== null);
  return (
    <div className="convoy-dashboard">
      <div className="convoy-metrics">
        <Metric
          value={past.length}
          title="Visits to review"
          detail="Scheduled date has passed"
          onClick={() => setScheduledFilter(!scheduledFilter)}
        />
        <Metric
          value={records.filter((r) => r.status === "completed").length}
          title="Completed service records"
          detail="Saved maintenance history"
        />
        <Metric
          value={scoped.filter((t) => baselineNeeded(snapshot, t, now)).length}
          title="Trucks needing setup"
          detail="Last service + recurring interval"
        />
        <Metric
          value={anyTargets ? due : "—"}
          title="Service targets reached"
          detail={
            anyTargets ? "Known date or mileage targets" : "Add intervals and service baselines"
          }
        />
      </div>
      <div className="convoy-planning-date">
        <strong>Planning for {fleetDate(snapshot.date)}</strong>
        <span>
          Mileage uses the latest available reading · {fleetDate(snapshot.mileageSourceDate || "")}
        </span>
      </div>
      <div className="convoy-dashboard-grid">
        <div className="convoy-side-stack">
          <section className="convoy-dash-panel">
            <header>
              <h2>{scheduledFilter ? "Visits to review" : "Scheduled work"}</h2>
              <div className="convoy-actions">
                {scheduledFilter && (
                  <Button variant="ghost" onClick={() => setScheduledFilter(false)}>
                    Show all
                  </Button>
                )}
                <Button
                  variant="outline"
                  disabled={!truck || !snapshot.canWrite}
                  onClick={() =>
                    truck && open({ kind: "maintenance", truck, initialStatus: "scheduled" })
                  }
                >
                  Schedule service
                </Button>
              </div>
            </header>
            {(scheduledFilter ? past : scheduled).map((r) => {
              const t = trucks.find((t) => sameTruck(t.id, r.truck))!;
              return (
                <article className="convoy-scheduled" key={r.recordId}>
                  <div>
                    <strong>
                      {label(t)} · {fleetDate(r.serviceDate)}
                    </strong>
                    <h3>{r.serviceType}</h3>
                    <p>
                      {r.vendor ? `Vendor: ${r.vendor}` : "Vendor not recorded"} ·{" "}
                      {r.odometer == null ? "Service mileage not recorded" : miles(r.odometer)}
                    </p>
                    <Badge tone={r.serviceDate < snapshot.date ? "warning" : "neutral"}>
                      {r.serviceDate < snapshot.date
                        ? "Scheduled date passed · completion not recorded"
                        : "Scheduled"}
                    </Badge>
                  </div>
                  <Button
                    variant="outline"
                    onClick={() => open({ kind: "maintenance", truck: t, record: r })}
                  >
                    Review service record
                  </Button>
                </article>
              );
            })}
            {!(scheduledFilter ? past : scheduled).length && (
              <p className="convoy-empty">
                {scheduledFilter
                  ? "No past visits awaiting review."
                  : "No scheduled work recorded. Add a visit when service is booked."}
              </p>
            )}
          </section>
          {truck && (
            <>
              <label className="convoy-planner-truck">
                Preventive maintenance for
                <select
                  value={truck.id}
                  onChange={(e) => {
                    setChosen(e.target.value);
                    if (truckId) onTruck(e.target.value);
                  }}
                >
                  {trucks.map((t) => (
                    <option key={t.id} value={t.id}>
                      {label(t)}
                    </option>
                  ))}
                </select>
              </label>
              <ServiceIntervals snapshot={snapshot} truck={truck} open={open} now={now} />
            </>
          )}
        </div>
        <aside className="convoy-side-stack">
          <section className="convoy-coverage">
            <h2>Start with a known service</h2>
            <ol>
              <li>Add the last completed service</li>
              <li>Record its date and mileage</li>
              <li>Set the recurring interval</li>
            </ol>
            {truck && (
              <>
                <hr />
                <h3>{label(truck)} · latest LinxUp mileage</h3>
                <Mileage truck={truck} now={now} detail />
                <p>Today’s mileage does not replace mileage at the time of a past service.</p>
                <Button
                  className="convoy-primary"
                  onClick={() => {
                    onTruck(truck.id);
                    props.onView?.("overview");
                  }}
                >
                  Open {label(truck)}
                </Button>
              </>
            )}
          </section>
          <p className="convoy-muted">
            Use the truck’s manufacturer or shop guidance to choose intervals. None are assumed
            automatically.
          </p>
        </aside>
      </div>
    </div>
  );
}
export function ConvoyTruckDetail(props: DashboardProps & { truck: DesktopFleetTruck }) {
  const { snapshot, truck, open, onTruck, now } = props;
  const records = recordsFor(snapshot, truck).filter((r) => r.status === "completed");
  return (
    <div className="convoy-dashboard">
      <div className="convoy-detail-title">
        <Button variant="ghost" onClick={() => onTruck("")}>
          <ChevronLeft size={16} />
          All trucks
        </Button>
        <div>
          <h2>{label(truck)}</h2>
          <p>{recordedValue(truck.vehicle, "Vehicle details not recorded")}</p>
        </div>
        <Badge tone={truck.readiness === "Out of service" ? "warning" : "neutral"}>
          {truck.readiness}
        </Badge>
        <Button variant="outline" onClick={() => open({ kind: "truck", truck })}>
          Operations & inspections
        </Button>
      </div>
      <div className="convoy-metrics">
        <div className="convoy-metric">
          <Mileage truck={truck} now={now} />
          <span>Latest LinxUp mileage</span>
        </div>
        <Metric
          value={truck.mileage?.reportedAt ? fleetDate(truck.mileage.reportedAt) : "—"}
          title="Last mileage report"
          detail={stamp(truck.mileage?.reportedAt)}
        />
        <Metric
          value={records.length}
          title="Completed services"
          detail={records.length ? "Recorded service history" : "Last service not recorded"}
        />
        <Metric
          value={
            records.length && records.every((r) => r.cost !== null)
              ? records
                  .reduce((sum, r) => sum + (r.cost || 0), 0)
                  .toLocaleString("en-US", {
                    style: "currency",
                    currency: "USD",
                    maximumFractionDigits: 0,
                  })
              : "—"
          }
          title="Recorded service costs"
          detail="Completed work · all available dates"
        />
      </div>
      <div className="convoy-dashboard-grid">
        <div className="convoy-side-stack">
          <ServiceIntervals snapshot={snapshot} truck={truck} open={open} now={now} />
          <section className="convoy-dash-panel">
            <ConvoyHistory snapshot={snapshot} truck={truck} open={open} />
          </section>
        </div>
        <aside className="convoy-side-stack">
          <section className="convoy-dash-panel convoy-attention">
            <h2>Truck operations</h2>
            <p>Viewing day: {fleetDate(snapshot.date)}</p>
            <dl>
              <dt>Inspection</dt>
              <dd>{truck.checklist}</dd>
              <dt>Load</dt>
              <dd>{truckLoadLabel(truck)}</dd>
              <dt>Activity</dt>
              <dd>{truck.operatingStatus}</dd>
            </dl>
            <Button
              variant="outline"
              onClick={() => {
                onTruck(truck.id);
                props.onView?.("maintenance");
              }}
            >
              <Wrench size={15} />
              Inspections & repairs
            </Button>
            <Button variant="outline" onClick={() => open({ kind: "load", truck })}>
              Record current load
            </Button>
            <Button
              className="convoy-primary"
              onClick={() => open({ kind: "maintenance", truck, initialStatus: "completed" })}
            >
              Record service
            </Button>
          </section>
          <Coverage snapshot={snapshot} trucks={[truck]} now={now} />
        </aside>
      </div>
    </div>
  );
}
