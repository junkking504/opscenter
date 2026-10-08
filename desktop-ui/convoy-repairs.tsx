import { TruckLevelGauges } from './convoy-gauges';
import { useState } from "react";
import {
  ArrowRight,
  ClipboardCheck,
  Truck,
  Wrench,
  Search,
  X,
  ChevronRight,
  ExternalLink,
} from "lucide-react";
import { Button } from "./components/ui/button";
import { sameTruck, truckCondition, duplicateRepair } from "./lib/convoy-presentation";
import type {
  DesktopFleetSnapshot,
  DesktopFleetTruck,
  FleetIssueRow,
} from "./lib/people-fleet-contract";
import type { FleetRecord } from "./convoy-views";

type Props = {
  snapshot: DesktopFleetSnapshot;
  trucks: DesktopFleetTruck[];
  truckId: string;
  onTruck: (id: string) => void;
  open: (record: FleetRecord) => void;
};
type Filter = "all" | "attention" | "stop" | "missing";
const label = (value: string) => value.replace(/Truck\s*#\s*/, "Truck ");
const severityLabel = (value: string) =>
  ({ out_of_service: "Out of service", repair_soon: "Repair soon", monitor: "Monitor" })[value] ||
  value.replaceAll("_", " ");
const updated = (value: string) =>
  value
    ? new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T12:00:00` : value).toLocaleDateString(
        "en-US",
        { month: "short", day: "numeric", year: "numeric", timeZone: "America/Chicago" },
      )
    : "Not recorded";

export function ConvoyRepairs({ snapshot, trucks, truckId, onTruck, open }: Props) {
  const [filter, setFilter] = useState<Filter>("all"),
    [query, setQuery] = useState("");
  const activeFor = (truck: DesktopFleetTruck) =>
    snapshot.issues.filter(
      (issue) => sameTruck(issue.truck, truck.id) && issue.status !== "resolved",
    );
  const attention = (truck: DesktopFleetTruck) =>
    truck.readiness !== "Ready" || activeFor(truck).length > 0;
  const matches = (truck: DesktopFleetTruck, choice: Filter) =>
    choice === "all" ||
    (choice === "attention"
      ? attention(truck)
      : choice === "stop"
        ? truck.readiness === "Out of service"
        : truck.checklist === "Missing");
  const filters: Array<[Filter, string]> = [
    ["all", "All conditions"],
    ["attention", "Needs attention"],
    ["stop", "Out of service"],
    ["missing", "Missing inspection"],
  ];
  const searchMatches = (truck: DesktopFleetTruck) =>
    [
      label(truck.label),
      truck.vehicle,
      truck.inspectionSource,
      ...(truck.inspectionFindings || []).map((f) => `${f.label} ${f.notes}`),
      ...snapshot.issues
        .filter((i) => sameTruck(i.truck, truck.id))
        .flatMap((i) => [i.title, i.description, i.owner, i.resolution]),
    ]
      .join(" ")
      .toLowerCase()
      .includes(query.trim().toLowerCase());
  const scoped = trucks.filter((t) => !truckId || t.id === truckId);
  const shown = scoped
    .filter((t) => matches(t, filter) && searchMatches(t))
    .sort(
      (a, b) =>
        Number(b.readiness === "Out of service") - Number(a.readiness === "Out of service") ||
        Number(attention(b)) - Number(attention(a)),
    );
  const reset = () => {
    setFilter("all");
    setQuery("");
  };
  function repairRow(issue: FleetIssueRow, truck: DesktopFleetTruck) {
    return (
      <details className="convoy-work-row" key={issue.issueId}>
        <summary>
          <Wrench size={16} />
          <span>
            <strong>{issue.title}</strong>
            <small>
              {issue.owner || "Shop / contact not recorded"} · Updated {updated(issue.updatedAt)}
            </small>
          </span>
          <span
            className={`convoy-status ${issue.status === "resolved" ? "ready" : issue.severity === "out_of_service" ? "stop" : "attention"}`}
          >
            {issue.status === "resolved" ? "Resolved" : severityLabel(issue.severity)}
          </span>
          <ChevronRight size={16} className="convoy-disclosure" />
        </summary>
        <div className="convoy-work-row-body">
          <p>{issue.description || "No description recorded."}</p>
          <dl className="convoy-work-facts">
            <div>
              <dt>Status</dt>
              <dd>
                {issue.status === "in_progress"
                  ? "Work in progress"
                  : issue.status === "resolved"
                    ? "Resolved"
                    : "Open"}
              </dd>
            </div>
            <div>
              <dt>Planned date</dt>
              <dd>{updated(issue.dueDate)}</dd>
            </div>
            <div>
              <dt>Recorded cost</dt>
              <dd>
                {issue.cost === null
                  ? "Not recorded"
                  : issue.cost.toLocaleString("en-US", { style: "currency", currency: "USD" })}
              </dd>
            </div>
          </dl>
          {issue.resolution && (
            <p>
              <strong>Resolution: </strong>
              {issue.resolution}
            </p>
          )}
          {duplicateRepair(issue, snapshot.issues) && (
            <p className="convoy-source-alert">
              Similar repair also recorded. Check both before closing.
            </p>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              open({
                kind: "issue",
                truck,
                issue,
                mode: issue.status === "resolved" ? undefined : "edit",
              })
            }
          >
            {issue.status === "resolved" ? "View repair" : "Update repair"}
            <ArrowRight size={14} />
          </Button>
        </div>
      </details>
    );
  }
  return (
    <section
      className="convoy-record-browser convoy-inspection-library"
      aria-label="Inspections and repairs by truck"
    >
      <aside className="convoy-record-navigation">
        <h2>Trucks</h2>
        <nav className="convoy-record-trucks" aria-label="Filter inspections by truck">
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
                {
                  snapshot.issues.filter(
                    (i) => i.status !== "resolved" && (!t.id || sameTruck(i.truck, t.id)),
                  ).length
                }
              </span>
            </button>
          ))}
        </nav>
        <p className="convoy-library-hint">
          Counts show active repairs. Choose a truck to review its inspection and work.
        </p>
        <div className="convoy-record-categories">
          <h2>Condition</h2>
          <nav aria-label="Filter trucks by condition">
            {filters.map(([key, text]) => (
              <button key={key} aria-pressed={filter === key} onClick={() => setFilter(key)}>
                <span>{text}</span>
                <span>{scoped.filter((t) => matches(t, key) && searchMatches(t)).length}</span>
              </button>
            ))}
          </nav>
        </div>
      </aside>
      <div className="convoy-journal">
        <header className="convoy-journal-header">
          <div>
            <h2>{truckId ? label(truckId) : "Fleet inspections"}</h2>
            <span>{updated(snapshot.date)}</span>
          </div>
          <a
            className="convoy-library-link"
            href={`/fleet-inspections?date=${encodeURIComponent(snapshot.date)}`}
            target="_blank"
            rel="noreferrer"
          >
            Phone reports
            <ExternalLink size={14} />
          </a>
        </header>
        <div className="convoy-journal-tools">
          <label className="convoy-journal-search">
            <Search size={18} />
            <input
              aria-label="Search inspections and repairs"
              placeholder="Search truck, finding, repair or shop"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            {query && (
              <button aria-label="Clear inspection search" onClick={() => setQuery("")}>
                <X size={16} />
              </button>
            )}
          </label>
          <label className="convoy-mobile-filter">
            Condition
            <select value={filter} onChange={(e) => setFilter(e.target.value as Filter)}>
              {filters.map(([key, text]) => (
                <option key={key} value={key}>
                  {text}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="convoy-library-results">
          <span role="status">
            {shown.length} {shown.length === 1 ? "truck" : "trucks"} · Inspections for this day ·
            Active repairs across dates
          </span>
          {(query || filter !== "all") && <button onClick={reset}>Clear filters</button>}
        </div>
        {shown.map((t) => {
          const active = activeFor(t),
            resolved = snapshot.issues.filter(
              (i) => sameTruck(i.truck, t.id) && i.status === "resolved",
            );
          return (
            <details
              className="convoy-inspection-visit"
              key={`${truckId}:${t.id}`}
              open={truckId === t.id || undefined}
            >
              <summary>
                <span className="convoy-visit-icon">
                  <Truck size={21} />
                </span>
                <span className="convoy-visit-label">
                  <strong>{label(t.label)}</strong>
                  <span>
                    Inspection: {t.checklist} · {active.length} active{" "}
                    {active.length === 1 ? "repair" : "repairs"}
                  </span>
                  <span className="convoy-visit-metadata">
                    {t.inspectionFindings?.[0]?.notes ||
                      active[0]?.title ||
                      (t.checklist === "Missing"
                        ? "Inspection needed for this day"
                        : "Open inspection details")}
                  </span>
                </span>
                <span
                  className={`convoy-status ${t.readiness === "Out of service" ? "stop" : t.readiness === "Ready" ? "ready" : "attention"}`}
                >
                  {truckCondition(t)}
                </span>
                <ChevronRight size={18} className="convoy-disclosure" />
              </summary>
              <div className="convoy-inspection-body"><section className="convoy-inspection-levels"><div className="convoy-level-group"><h3>Daily inspection readings</h3><TruckLevelGauges truck={t} inspection/></div><div className="convoy-level-group"><h3>Latest truck levels</h3><TruckLevelGauges truck={t}/></div><small>Latest levels include subsequent pickups, verified unloads and fuel purchases.</small></section>
                <section
                  className="convoy-inspection-review"
                  aria-label={`${label(t.label)} inspection`}
                >
                  <h3>
                    <ClipboardCheck size={17} />
                    Inspection · {updated(snapshot.date)}
                  </h3>
                  {t.checklist === "Missing" ? (
                    <p>No completed inspection recorded for this day.</p>
                  ) : t.inspectionFindings?.length ? (
                    <dl className="convoy-work-sections">
                      {t.inspectionFindings.map((f, index) => (
                        <div key={index}>
                          <dt>{f.label}</dt>
                          <dd>{f.notes}</dd>
                        </div>
                      ))}
                    </dl>
                  ) : (
                    <p>
                      {t.checklist === "Complete"
                        ? "No issues recorded in this inspection."
                        : "Open the original report to review the inspection result."}
                    </p>
                  )}
                  {t.inspectionSource && <small>{t.inspectionSource}</small>}
                  <div className="convoy-visit-links">
                    {t.inspectionHref && (
                      <a
                        className="convoy-library-link"
                        href={t.inspectionHref}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Inspection & photos
                        <ExternalLink size={14} />
                      </a>
                    )}
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => open({ kind: "checklist", truck: t })}
                    >
                      {t.checklist === "Missing" ? "Complete checklist" : "Open checklist"}
                    </Button>
                  </div>
                </section>
                <div className="convoy-heading">
                  <h3>
                    Active repairs <span className="convoy-count">{active.length}</span>
                  </h3>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={!snapshot.canWrite}
                    onClick={() => open({ kind: "issue", truck: t })}
                  >
                    <Wrench size={15} />
                    Add repair
                  </Button>
                </div>
                {active.length ? (
                  [...active]
                    .sort(
                      (a, b) =>
                        Number(b.severity === "out_of_service") -
                        Number(a.severity === "out_of_service"),
                    )
                    .map((i) => repairRow(i, t))
                ) : (
                  <p className="convoy-repair-caption">
                    {t.readiness === "Unavailable"
                      ? "Repair records unavailable. Check source details."
                      : t.checklist === "Problem reported"
                        ? "No active repair recorded. Review the inspection findings and add a repair if needed."
                        : "No active repairs recorded."}
                  </p>
                )}
                <details className="convoy-resolved-list">
                  <summary>Resolved repairs ({resolved.length})</summary>
                  {resolved.length ? (
                    resolved.map((i) => repairRow(i, t))
                  ) : (
                    <p>No resolved repairs recorded.</p>
                  )}
                </details>
              </div>
            </details>
          );
        })}
        {!shown.length && (
          <div className="convoy-repair-empty">
            <ClipboardCheck size={24} />
            <strong>No matching trucks</strong>
            <p>Choose another truck or clear the filters.</p>
            <Button
              variant="outline"
              onClick={() => {
                onTruck("");
                reset();
              }}
            >
              Show all trucks
            </Button>
          </div>
        )}
        {snapshot.issues.some((i) => !trucks.some((t) => sameTruck(t.id, i.truck))) && (
          <p className="convoy-source-alert">
            Some repairs cannot be matched to a truck in this day’s fleet.
          </p>
        )}
        <footer className="convoy-journal-footer">
          Review findings before changing repair status. A completed inspection does not close an
          active repair.
        </footer>
      </div>
    </section>
  );
}
