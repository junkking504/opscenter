import { useEffect, useState } from 'react';
import { AlertTriangle, ArrowRight, ChevronDown, ChevronUp } from 'lucide-react';
import { Button } from './components/ui/button';
import LiveSchedule from './deferred-live-schedule';
import { overviewSummary, dueDetail, fleetDayTotals, gpsReporting, liveGroup, stopLine, truckJobs, type DueItem, type LiveGroup } from './lib/convoy-live';
import { fetchWorkspace } from './lib/workspace-cache';
import type { ScheduleSnapshot } from './lib/schedule-contract';
import { truckServiceSummary } from './convoy-dashboard';
import type { DashboardProps } from './convoy-dashboard';
import './convoy-live-board.css';

const groupLabel: Record<LiveGroup, string> = { moving: 'Driving', idle: 'Idling', parked: 'Parked', offline: 'No GPS', out: 'Out of Service' };
const money = (v: number | null) => v == null ? '—' : v.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const num = (v: number | null) => v == null ? '—' : Math.round(v).toLocaleString('en-US');


function Level({ label, percent }: { label: string; percent: number | null }) {
  const known = percent != null && Number.isFinite(percent);
  return <div className="clb-level" role="img" aria-label={`${label} ${known ? `${Math.round(percent)} percent` : 'not recorded'}`}>
    <span>{label}</span><i><b className={known && percent <= 25 ? 'low' : ''} style={{ width: `${known ? Math.max(0, Math.min(100, percent)) : 0}%` }} /></i><em>{known ? `${Math.round(percent)}%` : '—'}</em>
  </div>;
}

/** One operational board, followed by optional map and service planning context. */
export function ConvoyLiveBoard({ snapshot, trucks, onTruck, date, now, dueItems, truckId, selection }: Pick<DashboardProps, 'snapshot' | 'trucks' | 'onTruck' | 'now' | 'truckId'> & { date: string; dueItems: DueItem[]; selection?: React.ReactNode }) {
  const [mapOpen, setMapOpen] = useState(false);
  const [soonOpen, setSoonOpen] = useState(false);
  const [appointments, setAppointments] = useState<ScheduleSnapshot['appointments'] | null>(null);
  const [scheduleStale, setScheduleStale] = useState(false);
  useEffect(() => {
    // Own cache key: an invalid reply here must never reach the Command map cache.
    const url = `/api/desktop/schedule?date=${date}&load=1`;
    let live = true, controller = new AbortController();
    const load = () => {
      controller.abort();
      const own = controller = new AbortController();
      // A superseded or aborted load must never touch state, so a replaced request cannot raise the stale notice.
      fetchWorkspace<ScheduleSnapshot>(url, own.signal, `convoy-jobs:${date}`).then(body => {
        if (!live || own.signal.aborted) return;
        if (Array.isArray(body.appointments)) { setAppointments(body.appointments); setScheduleStale(false); } else setScheduleStale(true);
      }).catch(() => { if (live && !own.signal.aborted) setScheduleStale(true); });
    };
    setAppointments(null); setScheduleStale(false); load();
    const timer = window.setInterval(load, 60_000);
    return () => { live = false; controller.abort(); window.clearInterval(timer); };
  }, [date]);
  const repairsKnown = !snapshot.warnings.some(w => w.startsWith('Repair source'));
  const totals = fleetDayTotals(trucks);
  const isToday = date === new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(now);
  const {counts, attention, outIds} = overviewSummary(snapshot, trucks, dueItems, isToday);
  const jobs = new Map(trucks.map(t => [t.id, appointments ? truckJobs(appointments, t.id, isToday, now) : null]));
  const stops = appointments ? [...jobs.values()].reduce((a, j) => ({ total: a.total + (j?.total || 0), done: a.done + (j?.done || 0) }), { total: 0, done: 0 }) : null;
  const soon = dueItems.filter(d => d.status === 'soon');
  const tiles = [
    ['Ready', counts.ready, 'Inspected and available'],
    ['Working Now', isToday ? counts.working : '—', isToday ? 'Driving or idling · no red flags' : 'Live activity is available for today'],
    ['Need You', counts.need, 'Inspection missing or service due · excludes out of service'],
    ['Out of Service', repairsKnown ? counts.out : '—', repairsKnown ? 'Active out-of-service condition' : 'Repair source unavailable'],
  ];
  return <div className="clb">
    <div className="clb-tiles">{tiles.map(([title, value, detail]) => <div key={title} className="clb-tile"><strong>{value}</strong><span>{title}</span><small>{detail}</small></div>)}</div>
    <p className="clb-day-totals">{stops ? `${stops.done} / ${stops.total} Stops Done` : `${num(totals.jobs)} Jobs`} · {money(totals.revenue)} Revenue · {num(totals.miles)} Miles Driven · {num(totals.idleMinutes)} Idle Min</p>
    <section className="convoy-dash-panel clb-attention" aria-labelledby="clb-att-title">
      <header><h2 id="clb-att-title">Needs You</h2><small>{attention.length ? `${attention.length} open` : 'All clear'}</small></header>
      {attention.length ? <ul>{attention.map(a => <li key={a.key}><button onClick={() => onTruck(a.truckId)} title={a.detail}>
        <AlertTriangle size={13} /><span><strong>{a.truck} · {a.title}</strong><span className="clb-att-detail"> · {a.detail}</span></span><ArrowRight size={12} />
      </button></li>)}</ul> : <p className="convoy-empty">No recorded red flags.</p>}
    </section>
    {scheduleStale && <p className="clb-stale" role="status">{appointments ? 'Stop progress may be out of date: the schedule could not be refreshed.' : 'Stop progress unavailable: the schedule could not be loaded.'}</p>}
    <section className="convoy-dash-panel clb-live" aria-labelledby="clb-live-title">
      <header><h2 id="clb-live-title">Live Trucks</h2><small>{isToday ? 'Updates about every 30 seconds' : 'Historical Day'}</small></header>
      <div className="clb-board-scroll" role="region" aria-label="Truck Board · Scroll For More Columns" tabIndex={0}>
        <table className="clb-board"><thead><tr>{['Truck / Vehicle','Status','Where / Job','Driver','Stops Done','Load','Fuel','Inspection','Next Service','GPS Age'].map(h => <th key={h} scope="col">{h}</th>)}</tr></thead>
          <tbody>{trucks.map(t => {
            const live = liveGroup(t, outIds.has(t.id));
            const group: LiveGroup = isToday || live === 'out' ? live : 'offline';
            const status = isToday || live === 'out' ? groupLabel[group] : 'Historical Day';
            const job = jobs.get(t.id);
            const service = truckServiceSummary(snapshot,t,now);
            const age = t.gpsAt ? now - Date.parse(t.gpsAt) : NaN;
            const gpsAge = Number.isFinite(age) && age >= 0 ? age < 60_000 ? '<1 min' : age < 3_600_000 ? `${Math.floor(age/60_000)} min` : age < 86_400_000 ? `${Math.floor(age/3_600_000)} hr` : `${Math.floor(age/86_400_000)} days` : 'Not recorded';
            const select = () => onTruck(t.id);
            return <tr key={t.id} className={truckId === t.id ? 'selected' : ''} onClick={select}>
              <td><button className="clb-truck-button" onClick={e => {e.stopPropagation(); select();}} aria-pressed={truckId === t.id}>{t.label.replace('Truck#','Truck')}</button><small>{t.vehicle}</small></td>
              <td><span className={`clb-pill ${group}`}>{status}</span><small>{t.readiness}</small></td>
              <td><span>{isToday ? t.location : 'Historical Record'}</span><small>{t.operatingStatus}{isToday && typeof t.speed === 'number' && t.speed > 0 ? ` · ${Math.round(t.speed)} mph` : ''}</small><small>{job ? stopLine(job, {gps:gpsReporting(t),scheduleFresh:!scheduleStale}) : 'Stops not loaded'}</small></td>
              <td>{t.driver || 'Not assigned'}</td>
              <td>{job ? `${job.done} / ${job.total}` : '—'}<small>{t.jobs == null ? 'Jobs —' : `${t.jobs} jobs`} · {t.miles == null ? 'Miles —' : `${Math.round(t.miles)} mi`}</small></td>
              <td><Level label="Load" percent={t.loadNeedsVerification ? null : t.loadPercent}/><small>{t.loadNeedsVerification ? 'Confirm Load' : t.loadLabel}</small></td>
              <td title={t.fuel?.detail}><Level label="Fuel" percent={t.fuel?.percent ?? null}/><small>{t.fuel ? t.fuel.source === 'purchase' ? 'Assumed Full · Fill-Up' : 'Inspection Reading' : 'Not recorded'}</small></td>
              <td className={t.inspectionStatus === 'In Use, No Inspection' ? 'clb-critical' : ''}>{t.inspectionStatus || 'Unknown'}<small>{t.checklist}</small></td>
              <td title={service.detail}><span className={service.plan?.status === 'due' ? 'clb-critical' : ''}>{service.status}</span><small>{service.plan?.serviceType || t.nextService || 'Service not set'}</small><small>{service.plan ? service.detail : ''}</small></td>
              <td title={t.gpsAt || 'No GPS observation'}>{gpsAge}<small>{t.gpsFreshness}</small></td>
            </tr>;
          })}</tbody>
        </table>
      </div>
    </section>
    {selection}
    <section className="convoy-dash-panel clb-soon" aria-labelledby="clb-soon-title">
      <header><h2 id="clb-soon-title">Service Due Soon <small>({soon.length})</small></h2><Button variant="outline" size="sm" aria-expanded={soonOpen} onClick={() => setSoonOpen(!soonOpen)}>{soonOpen ? 'Hide Service' : 'Show Service'}{soonOpen ? <ChevronUp size={13}/> : <ChevronDown size={13}/>}</Button></header>
      {soonOpen && (soon.length ? <ul>{soon.map(d => <li key={d.key}><button onClick={() => onTruck(d.truckId)}><strong>{d.truck}</strong><span>{d.serviceType}</span><small>{dueDetail(d)}</small><ArrowRight size={12}/></button></li>)}</ul> : <p className="convoy-empty">No service due within 30 days or 1,000 miles.</p>)}
    </section>
    <section className="convoy-dash-panel clb-map" aria-labelledby="clb-map-title">
      <header><h2 id="clb-map-title">Trucks And Appointments Map</h2><Button variant="outline" size="sm" aria-expanded={mapOpen} onClick={() => setMapOpen(!mapOpen)}>{mapOpen ? 'Hide Map' : 'Show Map'}{mapOpen ? <ChevronUp size={13}/> : <ChevronDown size={13}/>}</Button></header>
      {mapOpen && <LiveSchedule mapOnly baseDate={date} day="today" onDayChange={() => {}} report={() => {}} onBusyChange={() => {}} />}
    </section>
  </div>;
}
