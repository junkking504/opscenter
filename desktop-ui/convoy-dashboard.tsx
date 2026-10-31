import { useState } from "react";
import { SectionLayout } from './section-layout';
import { MetricValue } from './metric-value';
import { MonthlyMileage } from './monthly-mileage';
import { ConvoyGauge, TruckLevelGauges, gaugeTime } from './convoy-gauges';
import { serviceGauge } from './lib/convoy-gauges';
import { historyEntries, historyCosts, truckMileageReview } from './lib/convoy-records';
import type { FleetMaintenanceRow } from './lib/people-fleet-contract';
import { ArrowRight, Truck, Wrench, ChevronLeft } from "lucide-react";
import { Button } from "./components/ui/button";
import { sameTruck, recordedValue, truckLoadLabel } from "./lib/convoy-presentation";
import { fleetServiceTypes, servicePlan } from "../lib/fleet-service-plan";
import type {
  DesktopFleetSnapshot,
  DesktopFleetTruck,
  FleetView,
} from "./lib/people-fleet-contract";
import type { FleetRecord } from "./convoy-views";
import { ConvoyHistory } from "./convoy-views";
import { ConvoyLiveBoard } from "./convoy-live-board";
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
export function plansFor(s: DesktopFleetSnapshot, t: DesktopFleetTruck, now: number) {
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
export function truckServiceSummary(snapshot: DesktopFleetSnapshot, truck: DesktopFleetTruck, now: number) {
  const plans = plansFor(snapshot, truck, now).filter(p => p.interval?.enabled || p.nextDate || p.nextMiles !== null);
  const rank: Record<string, number> = {due:0,soon:1,unknown:2,baseline:3,unset:4,current:5};
  const plan = [...plans].sort((a,b) => rank[a.status]-rank[b.status] || (serviceGauge(b) ?? -1)-(serviceGauge(a) ?? -1))[0];
  const detail = plan ? [plan.serviceType, plan.milesRemaining !== null ? `${Math.abs(Math.round(plan.milesRemaining)).toLocaleString()} mi ${plan.milesRemaining <= 0 ? 'past target' : 'remaining'}` : plan.nextMiles !== null ? 'Mileage needs verification' : '', plan.daysRemaining !== null ? `${Math.abs(plan.daysRemaining)} days ${plan.daysRemaining <= 0 ? 'past target' : 'remaining'}` : '', plan.milesRemaining !== null && plan.mileageAsOf ? `Reading ${gaugeTime(plan.mileageAsOf)}` : ''].filter(Boolean).join(' · ') : 'Add completed service and a maintenance interval';
  const status = plan ? ({due:'Due now',soon:'Due soon',unknown:'Verify mileage',baseline:'Set baseline',unset:'Set interval',current:'On track'}[plan.status]) : 'Set up service';
  return {plans, plan, detail, status};
}
function TruckDashboardCard({snapshot, truck, now, onTruck, onView, open}: DashboardProps & {truck: DesktopFleetTruck}) {
  const {plans, plan, detail, status} = truckServiceSummary(snapshot, truck, now);
  return <article className="convoy-truck-dashboard">
    <header><button className="convoy-truck-link" onClick={()=>onTruck(truck.id)}><Truck size={19}/>{label(truck)}<ArrowRight size={14}/></button><Badge tone={truck.readiness === 'In Use, No Inspection' ? 'stop' : truck.readiness === 'Ready' ? 'neutral' : 'warning'}>{truck.readiness}</Badge></header>
    <p className="convoy-truck-activity">{truck.operatingStatus} · Inspection: {truck.checklist}</p>
    <div className="convoy-truck-identification">
      <div><span className="convoy-fact-label">VIN</span><TruckVin truck={truck}/></div>
      <div><span className="convoy-fact-label">Latest mileage</span><Mileage truck={truck} now={now} records={snapshot.maintenance} showReportedAt/></div>
    </div>
    <MonthlyMileage mileage={truck.monthlyMileage} date={snapshot.date}/>
    <div className="convoy-truck-instruments">
      <ConvoyGauge label="Next service" percent={plan ? serviceGauge(plan) : null} value={status} detail={detail} tone={plan?.status === 'due' ? 'danger' : plan?.status === 'current' ? 'good' : 'warning'} ends={['Serviced','Due']}/>
      <TruckLevelGauges truck={truck}/>
    </div>
    <footer><button onClick={()=>{onTruck(truck.id);onView?.('service');}}>Service plan{plans.length ? ` · ${plans.length}` : ''}</button><button onClick={()=>{onTruck(truck.id);onView?.('inspections');}}>Daily inspection</button><button onClick={()=>open({kind:'load',truck})}>Update load</button></footer>
  </article>;
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
      <strong><MetricValue value={value} /></strong>
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
function TruckVin({truck}: {truck: DesktopFleetTruck}) {
  return <div className="convoy-vin"><strong><MetricValue value={truck.vinNeedsVerification ? 'Needs verification' : truck.vin || 'Not recorded'} /></strong><small>{truck.vinNeedsVerification ? 'Check the vehicle record' : truck.vin ? 'LinxUp vehicle record' : 'No VIN in the vehicle record'}</small></div>;
}
export function Mileage({
  truck,
  now,
  detail = false,
  records = [],
  showReportedAt = false,
}: {
  truck: DesktopFleetTruck;
  now: number;
  detail?: boolean;
  records?: FleetMaintenanceRow[];
  showReportedAt?: boolean;
}) {
  const m = truck.mileage,
    review = truckMileageReview(truck,records,now), q = review.quality;
  return (
    <div className="convoy-mileage">
      <strong><MetricValue value={q === "conflict" ? "Needs verification" : miles(m?.value)} /></strong>
      <small>
        {q === "conflict"
          ? review.belowService
            ? `Below recorded service mileage: ${miles(review.latest?.odometer)}`
            : m?.source === "inspection"
            ? m.note
            : m?.duplicate
            ? "Multiple LinxUp vehicle records"
            : `${miles(m?.value)} virtual / ${miles(m?.estimated)} estimated`
          : q === "unavailable"
            ? "No mileage reading"
            : m?.inspectionBaseline ? `Estimated · inspection + GPS travel${m.gpsIncomplete ? " · GPS gaps" : ""}` : m?.source === "inspection" ? `Last inspection · ${stamp(m.reportedAt)}` : `${m?.source} odometer${q === "stale" ? " · stale reading" : q === "estimated" ? " · verify reading" : ""}`}
      </small>
      {showReportedAt && q !== "unavailable" && (m?.source !== "inspection" || q === "conflict") && <small>{m?.reportedAt ? `As of ${stamp(m.reportedAt)}` : "Reading time unavailable"}</small>}
      {m?.inspectionHref && <a href={m.inspectionHref} target="_blank" rel="noreferrer">View inspection</a>}{detail && <><small>Reported {stamp(m?.reportedAt)}</small><details><summary>Reading source</summary><small>{m?.note || (review.belowService ? "This reading is lower than a completed service record. Check the physical odometer." : "Virtual mileage is a tracking-system counter; it may differ from the truck’s odometer.")}</small>{m?.tracking && <small>Original tracking feed: {miles(m.tracking.value)} · {m.tracking.source} · {stamp(m.tracking.reportedAt)}</small>}</details></>}
    </div>
  );
}
export function ServiceIntervals({
  snapshot,
  truck,
  open,
  now,
}: Pick<DashboardProps, "snapshot" | "open" | "now"> & { truck: DesktopFleetTruck }) {
  const [showOptional,setShowOptional] = useState(false);
  const allPlans = plansFor(snapshot, truck, now);
  const tracked = allPlans.filter(p=>p.interval?.enabled || p.nextDate || p.nextMiles!==null);
  const plans = showOptional ? allPlans : tracked.length ? tracked : allPlans.filter(p=>p.serviceType==="Oil change");
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
      <p className="convoy-plan-hint">Showing tracked maintenance. Other service categories are optional.</p>
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
                  <ConvoyGauge label={p.serviceType === "Oil change" ? "Oil & filter" : p.serviceType} percent={serviceGauge(p)} tone={p.status === "due" ? "danger" : p.status === "current" ? "good" : "warning"} ends={["Serviced","Due"]}/>
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
                      {p.milesRemaining < 0 ? "past target" : "remaining"}{p.mileageAsOf && <small>At inspection {fleetDate(p.mileageAsOf)}</small>}
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
      <Button variant="ghost" aria-expanded={showOptional} onClick={()=>setShowOptional(!showOptional)}>{showOptional ? "Show tracked maintenance only" : "Other service history & optional intervals"}</Button>
    </section>
  );
}
function Coverage({ snapshot, trucks, now }: Pick<DashboardProps, "snapshot" | "trucks" | "now">) {
  const count = (q: string) => trucks.filter((t) => truckMileageReview(t,snapshot.maintenance,now).quality === q).length;
  return (
    <details className="convoy-coverage">
      <summary>About fleet mileage</summary>
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
        Missing maintenance history stays unknown. Older inspections can show a target was already passed, but cannot show miles remaining today. Conflicting readings need verification.
      </p>
    </details>
  );
}
export function ConvoyDashboard(props: DashboardProps) {
  const { snapshot, trucks, truckId, onTruck, now } = props;
  const dueItems = trucks.flatMap((t) =>
    plansFor(snapshot, t, now)
      .filter((p) => p.status === "due" || p.status === "soon")
      .map((p) => ({ key: `${t.id}:${p.serviceType}`, truckId: t.id, truck: label(t), serviceType: p.serviceType, status: p.status as "due" | "soon", milesRemaining: p.milesRemaining, daysRemaining: p.daysRemaining })),
  );
  const selected = trucks.find((t) => t.id === truckId);
  return <SectionLayout as="div" group="convoy-dashboard-1" className="convoy-dashboard convoy-compact-overview">
    <div data-layout-id="fleet-live-board" data-layout-label="Fleet Overview"><ConvoyLiveBoard snapshot={snapshot} trucks={trucks} onTruck={onTruck} date={snapshot.date} now={now} dueItems={dueItems} truckId={truckId} selection={selected ? <ConvoyTruckDetail {...props} truck={selected} /> : null} /></div>
    <Coverage snapshot={snapshot} trucks={trucks} now={now} />
  </SectionLayout>;
}

export function ConvoyTruckDetail(props: DashboardProps & { truck: DesktopFleetTruck }) {
  const { snapshot, truck, open, onTruck, now } = props;
  const records = recordsFor(snapshot, truck).filter((r) => r.status === "completed");
  const visits=historyEntries({maintenance:records,issues:[]});
  const costs=historyCosts(visits);
  return (
    <SectionLayout as="div" group="convoy-dashboard-4" className="convoy-dashboard">
      <div data-layout-id="convoy-detail-title" className="convoy-detail-title">
        <Button variant="ghost" onClick={() => onTruck("")}>
          <ChevronLeft size={16} />
          All trucks
        </Button>
        <div>
          <h2>{label(truck)}</h2>
          <p>{recordedValue(truck.vehicle, "Vehicle details not recorded")}</p>
        </div>
        <Badge tone={["Out of service", "In Use, No Inspection"].includes(truck.readiness) ? "stop" : "neutral"}>
          {truck.readiness}
        </Badge>
        <Button variant="outline" onClick={() => open({ kind: "truck", truck })}>
          Operations & inspections
        </Button>
      </div>
      <TruckDashboardCard {...props} truck={truck}/>
      <div data-layout-id="convoy-metrics" className="convoy-metrics">
        <div className="convoy-metric">
          <Mileage truck={truck} now={now} records={snapshot.maintenance}/>
          <span>Latest reported mileage</span>
        </div>
        <Metric
          value={truck.mileage?.reportedAt ? fleetDate(truck.mileage.reportedAt) : "—"}
          title="Last mileage report"
          detail={stamp(truck.mileage?.reportedAt)}
        />
        <Metric
          value={visits.length}
          title="Completed visits"
          detail={records.length ? "Recorded service history" : "Last service not recorded"}
        />
        <Metric
          value={
            costs.total===null?'—':costs.total.toLocaleString('en-US',{style:'currency',currency:'USD',maximumFractionDigits:0})
          }
          title="Recorded service costs"
          detail={costs.missing ? `${costs.missing} visits missing a total` : "Completed work · all dates"}
        />
      </div>
      <SectionLayout as="div" group="convoy-dashboard-5" data-layout-id="convoy-dashboard-grid-2" className="convoy-dashboard-grid">
        <SectionLayout as="div" group="convoy-dashboard-6" data-layout-id="convoy-side-stack" className="convoy-side-stack">
          <ServiceIntervals snapshot={snapshot} truck={truck} open={open} now={now} />
          <section data-layout-id="convoy-dash-panel-2" className="convoy-dash-panel">
            <ConvoyHistory snapshot={snapshot} truck={truck} open={open} />
          </section>
        </SectionLayout>
        <SectionLayout as="aside" group="convoy-dashboard-7" className="convoy-side-stack">
          <section data-layout-id="convoy-dash-panel-3" className="convoy-dash-panel convoy-attention">
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
              Repairs
            </Button>
            <Button variant="outline" disabled={!snapshot.canWrite} onClick={() => open({kind:"issue",truck})}>Report a Problem</Button>
            <Button variant="outline" onClick={() => open({ kind: "load", truck })}>
              Record current load
            </Button>
            <Button
              variant="brand"
              onClick={() => open({ kind: "maintenance", truck, initialStatus: "completed" })}
            >
              Record Service
            </Button>
          </section>
          <Coverage snapshot={snapshot} trucks={[truck]} now={now} />
        </SectionLayout>
      </SectionLayout>
    </SectionLayout>
  );
}
