import { ConvoyGauge } from './convoy-gauges';
import { serviceGauge } from './lib/convoy-gauges';
import { useState } from "react";
import { Search, X, Wrench, CalendarDays, ChevronRight, ArrowRight, Plus } from "lucide-react";
import { Button } from "./components/ui/button";
import { sameTruck } from "./lib/convoy-presentation";
import { Mileage, plansFor, fleetDate, type DashboardProps } from "./convoy-dashboard";
import { fleetServiceTypes } from "../lib/fleet-service-plan";
const label = (value: string) => value.replace(/Truck\s*#\s*/, "Truck ");
const miles = (value: number | null | undefined) =>
  value == null ? "Not recorded" : `${value.toLocaleString("en-US")} mi`;
const statusLabel: Record<string, string> = {
  baseline: "Needs last service",
  unset: "Set an interval",
  due: "Due now",
  soon: "Due soon",
  unknown: "Check mileage",
  current: "Within targets",
};
type Filter = "all" | "due" | "setup" | "mileage";
const filters: Array<[Filter, string]> = [
  ["all", "All targets"],
  ["due", "Due now / soon"],
  ["setup", "Needs setup"],
  ["mileage", "Check mileage"],
];

export function ConvoyService({
  snapshot,
  trucks,
  truckId,
  onTruck,
  open,
  now,
  onView,
}: DashboardProps) {
  const [query, setQuery] = useState(""),
    [filter, setFilter] = useState<Filter>("all"),
    [tab, setTab] = useState<"plan" | "scheduled">("plan"),
    [optional, setOptional] = useState(false),
    [pastOnly, setPastOnly] = useState(false);
  const allPlans = trucks.flatMap((truck) => {
    const all = plansFor(snapshot, truck, now),
      tracked = all.filter((p) => p.interval?.enabled || p.nextDate || p.nextMiles !== null);
    return (
      optional ? all : tracked.length ? tracked : all.filter((p) => p.serviceType === "Oil change")
    ).map((plan) => ({ truck, plan }));
  });
  const matches = (status: string, choice: Filter) =>
    choice === "all" ||
    (choice === "due"
      ? ["due", "soon"].includes(status)
      : choice === "setup"
        ? ["baseline", "unset"].includes(status)
        : status === "unknown");
  const queried = allPlans.filter(({ truck, plan }) =>
    `${label(truck.label)} ${plan.serviceType}`.toLowerCase().includes(query.trim().toLowerCase()),
  );
  const scoped = queried.filter(({ truck }) => !truckId || truck.id === truckId);
  const plans = scoped.filter(({ plan }) => matches(plan.status, filter));
  const scheduled = snapshot.maintenance
    .filter(
      (r) =>
        r.status === "scheduled" &&
        trucks.some((t) => sameTruck(t.id, r.truck)) &&
        (!truckId || sameTruck(r.truck, truckId)) &&
        `${label(r.truck)} ${r.serviceType} ${r.vendor} ${r.description}`
          .toLowerCase()
          .includes(query.trim().toLowerCase()),
    )
    .sort((a, b) => a.serviceDate.localeCompare(b.serviceDate));
  const visits = scheduled.filter((r) => !pastOnly || r.serviceDate < snapshot.date);
  const selected = trucks.find((t) => t.id === truckId);
  const reset = () => {
    setQuery("");
    setFilter("all");
    setPastOnly(false);
  };
  return (
    <section
      className="convoy-record-browser convoy-maintenance-library"
      aria-label="Maintenance plans and scheduled visits"
    >
      <aside className="convoy-record-navigation">
        <h2>Trucks</h2>
        <nav className="convoy-record-trucks" aria-label="Filter maintenance by truck">
          {[{ id: "", label: "All trucks" }, ...trucks].map((t) => (
            <button
              key={t.id}
              aria-pressed={truckId === t.id}
              onClick={() => {
                onTruck(t.id);
                reset();
              }}
            >
              <span>{label(t.label)}</span>
              <span>
                {tab === "plan"
                  ? queried.filter(
                      (r) => (!t.id || r.truck.id === t.id) && matches(r.plan.status, filter),
                    ).length
                  : snapshot.maintenance.filter(
                      (r) => r.status === "scheduled" && (!t.id || sameTruck(r.truck, t.id)),
                    ).length}
              </span>
            </button>
          ))}
        </nav>
        <p className="convoy-library-hint">
          Counts show {tab === "plan" ? "service targets" : "scheduled visits"}. Choose a truck to
          manage its maintenance.
        </p>
        {tab === "plan" && (
          <div className="convoy-record-categories">
            <h2>Service status</h2>
            <nav aria-label="Filter service targets">
              {filters.map(([key, text]) => (
                <button key={key} aria-pressed={filter === key} onClick={() => setFilter(key)}>
                  <span>{text}</span>
                  <span>{scoped.filter(({ plan }) => matches(plan.status, key)).length}</span>
                </button>
              ))}
            </nav>
          </div>
        )}
      </aside>
      <div className="convoy-journal">
        <header className="convoy-journal-header">
          <div>
            <h2>{selected ? `${label(selected.label)} maintenance` : "Fleet maintenance"}</h2>
            <span>Planning for {fleetDate(snapshot.date)}</span>
          </div>
          {selected && (
            <Button
              size="sm"
              variant="outline"
              disabled={!snapshot.canWrite}
              onClick={() =>
                open({
                  kind: "interval",
                  truck: selected,
                  serviceType: "Other",
                  interval: snapshot.intervals?.find(
                    (i) => sameTruck(i.truck, selected.id) && i.serviceType === "Other",
                  ),
                })
              }
            >
              <Plus size={15} />
              Add interval
            </Button>
          )}
        </header>
        <div
          className="convoy-detail-switch convoy-library-switch"
          role="group"
          aria-label="Maintenance view"
        >
          <button
            aria-pressed={tab === "plan"}
            onClick={() => {
              setTab("plan");
              reset();
            }}
          >
            <Wrench size={16} />
            Service plan
          </button>
          <button
            aria-pressed={tab === "scheduled"}
            onClick={() => {
              setTab("scheduled");
              reset();
            }}
          >
            <CalendarDays size={16} />
            Scheduled visits
          </button>
          <button onClick={() => onView?.("reports")}>
            <ArrowRight size={16} />
            Completed work
          </button>
        </div>
        <div className="convoy-journal-tools">
          <label className="convoy-journal-search">
            <Search size={18} />
            <input
              aria-label="Search maintenance"
              placeholder={
                tab === "plan" ? "Search truck or service type" : "Search truck, service or shop"
              }
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            {query && (
              <button aria-label="Clear maintenance search" onClick={() => setQuery("")}>
                <X size={16} />
              </button>
            )}
          </label>
          {tab === "plan" ? (
            <label className="convoy-mobile-filter">
              Status
              <select value={filter} onChange={(e) => setFilter(e.target.value as Filter)}>
                {filters.map(([key, text]) => (
                  <option key={key} value={key}>
                    {text}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <Button
              variant="outline"
              disabled={!snapshot.canWrite || !trucks.length}
              onClick={() =>
                open({
                  kind: "maintenance",
                  truck: selected || trucks[0],
                  initialStatus: "scheduled",
                })
              }
            >
              Schedule service
            </Button>
          )}
        </div>
        <div className="convoy-library-results">
          <span role="status">
            {tab === "plan"
              ? `${plans.length} service ${plans.length === 1 ? "target" : "targets"} · ${optional ? "All categories" : "Tracked maintenance"}`
              : `${visits.length} scheduled ${visits.length === 1 ? "visit" : "visits"} · Completion recorded separately`}
          </span>
          {(query || filter !== "all" || pastOnly) && (
            <button onClick={reset}>Clear filters</button>
          )}
        </div>
        {tab === "plan" ? (
          <>
            {plans.map(({ truck, plan: p }, index) => (
              <div key={`${truck.id}:${p.serviceType}`}>
                {(index === 0 || plans[index - 1].truck.id !== truck.id) && (
                  <h3 className="convoy-journal-month">{label(truck.label)}</h3>
                )}
                <details className="convoy-inspection-visit convoy-service-visit">
                  <summary>
                    <span className="convoy-visit-icon">
                      <Wrench size={20} />
                    </span>
                    <span className="convoy-visit-label">
                      <strong>
                        {p.serviceType === "Oil change" ? "Oil & filter" : p.serviceType}
                      </strong>
                      <span>
                        {p.interval?.enabled
                          ? [
                              p.interval.miles
                                ? `Every ${p.interval.miles.toLocaleString()} miles`
                                : "",
                              p.interval.months ? `${p.interval.months} months` : "",
                            ]
                              .filter(Boolean)
                              .join(" or ")
                          : p.interval
                            ? "Interval paused"
                            : "Interval not set"}
                      </span>
                      <span className="convoy-visit-metadata">
                        {p.nextMiles !== null
                          ? `Next: ${miles(p.nextMiles)}`
                          : p.nextDate
                            ? `Next: ${fleetDate(p.nextDate)}`
                            : p.completed
                              ? "Set the next service target"
                              : "Add the last completed service"}
                        {p.nextMiles !== null && p.nextDate ? ` or ${fleetDate(p.nextDate)}` : ""}
                      </span>
                    </span>
                    <span className={`convoy-badge ${p.status === "current" ? "" : "warning"}`}>
                      {statusLabel[p.status]}
                    </span>
                    <ChevronRight className="convoy-disclosure" size={18} />
                  </summary>
                  <div className="convoy-service-gauge"><ConvoyGauge label="Service interval used" percent={serviceGauge(p)} tone={p.status === "due" ? "danger" : p.status === "current" ? "good" : "warning"} ends={["Serviced","Due"]}/></div>
                  <div className="convoy-inspection-body">
                    <dl className="convoy-work-facts">
                      <div>
                        <dt>Last completed</dt>
                        <dd>
                          {p.completed ? fleetDate(p.completed.serviceDate) : "Not recorded"}
                          <small>
                            {p.completed?.odometer != null
                              ? miles(p.completed.odometer)
                              : "Mileage not recorded"}
                          </small>
                        </dd>
                      </div>
                      <div>
                        <dt>Next target</dt>
                        <dd>
                          {p.nextMiles !== null ? miles(p.nextMiles) : "Mileage not set"}
                          <small>{p.nextDate ? fleetDate(p.nextDate) : "Date not set"}</small>
                        </dd>
                      </div>
                      <div>
                        <dt>Mileage to target</dt>
                        <dd>
                          {p.milesRemaining !== null
                            ? `${Math.abs(Math.round(p.milesRemaining)).toLocaleString()} mi ${p.milesRemaining < 0 ? "past target" : "remaining"}`
                            : "Needs verified reading"}
                          {p.milesRemaining !== null && p.mileageAsOf && (
                            <small>At inspection {fleetDate(p.mileageAsOf)}</small>
                          )}
                        </dd>
                      </div>
                    </dl>
                    <div className="convoy-plan-reading">
                      <h4>{label(truck.label)} · latest reported mileage</h4>
                      <Mileage truck={truck} now={now} detail records={snapshot.maintenance} />
                    </div>
                    {p.incomplete && p.completed && (
                      <p className="convoy-repair-caption">
                        Mileage status unverified. A known date or earlier reading may already
                        establish that service is due.
                      </p>
                    )}
                    {p.scheduled && (
                      <p className="convoy-repair-caption">
                        Scheduled {fleetDate(p.scheduled.serviceDate)} · completion not recorded
                      </p>
                    )}
                    <div className="convoy-visit-links">
                      <Button
                        variant="outline"
                        disabled={!snapshot.canWrite}
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
                      </Button>
                      {p.completed && (
                        <Button
                          variant="ghost"
                          disabled={!snapshot.canWrite}
                          onClick={() =>
                            open({
                              kind: "maintenance",
                              truck,
                              serviceType: p.serviceType,
                              initialStatus: "completed",
                            })
                          }
                        >
                          Record completed service
                        </Button>
                      )}
                      {fleetServiceTypes.includes(
                        p.serviceType as (typeof fleetServiceTypes)[number],
                      ) ? (
                        <Button
                          variant="ghost"
                          disabled={!snapshot.canWrite}
                          onClick={() =>
                            open({
                              kind: "interval",
                              truck,
                              serviceType: p.serviceType,
                              interval: snapshot.intervals?.find(
                                (i) =>
                                  sameTruck(i.truck, truck.id) && i.serviceType === p.serviceType,
                              ),
                            })
                          }
                        >
                          {p.interval ? "Edit interval" : "Set up interval"}
                        </Button>
                      ) : (
                        <Button
                          variant="ghost"
                          onClick={() =>
                            open({
                              kind: "maintenance",
                              truck,
                              record: snapshot.maintenance.find(
                                (r) =>
                                  sameTruck(r.truck, truck.id) && r.serviceType === p.serviceType,
                              ),
                            })
                          }
                        >
                          Review service type
                        </Button>
                      )}
                    </div>
                  </div>
                </details>
              </div>
            ))}
            {!plans.length && (
              <div className="convoy-repair-empty">
                <Wrench size={24} />
                <strong>No matching service targets</strong>
                <p>Choose another truck or clear the filters.</p>
                <Button variant="outline" onClick={reset}>
                  Clear filters
                </Button>
              </div>
            )}
            <footer className="convoy-journal-footer">
              <Button
                variant="ghost"
                aria-pressed={optional}
                onClick={() => setOptional(!optional)}
              >
                {optional
                  ? "Show tracked maintenance only"
                  : "Other service history & optional intervals"}
              </Button>
              <p>
                Targets use recorded service dates and mileage. Service is due at whichever limit
                comes first. Missing history stays unknown.
              </p>
            </footer>
          </>
        ) : (
          <>
            <label className="convoy-past-filter">
              <input
                type="checkbox"
                checked={pastOnly}
                onChange={(e) => setPastOnly(e.target.checked)}
              />
              Only visits with a scheduled date in the past (
              {scheduled.filter((r) => r.serviceDate < snapshot.date).length})
            </label>
            {visits.map((r) => {
              const truck = trucks.find((t) => sameTruck(t.id, r.truck))!;
              return (
                <details key={r.recordId} className="convoy-inspection-visit">
                  <summary>
                    <span className="convoy-visit-icon">
                      <CalendarDays size={20} />
                    </span>
                    <span className="convoy-visit-label">
                      <strong>
                        {label(truck.label)} · {r.serviceType}
                      </strong>
                      <span>
                        {fleetDate(r.serviceDate)} · {r.vendor || "Shop not recorded"}
                      </span>
                    </span>
                    <span
                      className={`convoy-badge ${r.serviceDate < snapshot.date ? "warning" : ""}`}
                    >
                      {r.serviceDate < snapshot.date ? "Review completion" : "Scheduled"}
                    </span>
                    <ChevronRight size={18} className="convoy-disclosure" />
                  </summary>
                  <div className="convoy-inspection-body">
                    <p>{r.description || "No work description recorded."}</p>
                    <p className="convoy-repair-caption">
                      Service mileage: {miles(r.odometer)}
                      {r.serviceDate < snapshot.date
                        ? " · Scheduled date passed; completion not recorded."
                        : ""}
                    </p>
                    <div className="convoy-visit-links">
                      <Button
                        variant="outline"
                        onClick={() => open({ kind: "maintenance", truck, record: r })}
                      >
                        Review service record
                        <ArrowRight size={14} />
                      </Button>
                    </div>
                  </div>
                </details>
              );
            })}
            {!visits.length && (
              <div className="convoy-repair-empty">
                <CalendarDays size={24} />
                <strong>
                  {query || pastOnly
                    ? "No matching scheduled visits"
                    : "No scheduled work recorded"}
                </strong>
                <p>
                  {query || pastOnly
                    ? "Clear the filters to see other visits."
                    : "Use Schedule service when a shop visit is booked."}
                </p>
              </div>
            )}
            <footer className="convoy-journal-footer">
              A scheduled visit stays pending until its completion is recorded. Completed visits and
              original invoices are in Records & invoices.
            </footer>
          </>
        )}
      </div>
    </section>
  );
}
