import { useEffect, useState } from 'react';
import { AlertTriangle, ArrowRight, ChevronDown, ChevronUp, Fuel, Truck } from 'lucide-react';
import { Button } from './components/ui/button';
import LiveSchedule from './deferred-live-schedule';
import { attentionItems, dueDetail, fleetDayTotals, liveCounts, liveGroup, stopLine, truckJobs, type DueItem, type LiveGroup } from './lib/convoy-live';
import { fetchWorkspace } from './lib/workspace-cache';
import type { ScheduleSnapshot } from './lib/schedule-contract';
import { sameTruck } from './lib/convoy-presentation';
import type { DashboardProps } from './convoy-dashboard';
import './convoy-live-board.css';

const groupLabel: Record<LiveGroup, string> = { moving: 'Driving', idle: 'Idling', parked: 'Parked', offline: 'No GPS', out: 'Out of service' };
const money = (v: number | null) => v == null ? '—' : v.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const num = (v: number | null) => v == null ? '—' : Math.round(v).toLocaleString('en-US');
const mapKey = 'opscenter.convoyMap.expanded';

function Level({ label, percent }: { label: string; percent: number | null }) {
  const known = percent != null && Number.isFinite(percent);
  return <div className="clb-level" role="img" aria-label={`${label} ${known ? `${Math.round(percent)} percent` : 'not recorded'}`}>
    <span>{label}</span><i><b className={known && percent <= 25 ? 'low' : ''} style={{ width: `${known ? Math.max(2, Math.min(100, percent)) : 0}%` }} /></i><em>{known ? `${Math.round(percent)}%` : '—'}</em>
  </div>;
}

/** Dashboard top: day totals, live trucks beside the map, and ranked exceptions. */
export function ConvoyLiveBoard({ snapshot, trucks, onTruck, onView, onFilter, date, now, dueItems }: Pick<DashboardProps, 'snapshot' | 'trucks' | 'onTruck' | 'onView' | 'now'> & { onFilter: (filter: string) => void; date: string; dueItems: DueItem[] }) {
  const [mapOpen, setMapOpen] = useState(() => { try { return localStorage.getItem(mapKey) !== 'false'; } catch { return true; } });
  const [appointments, setAppointments] = useState<ScheduleSnapshot['appointments'] | null>(null);
  const [scheduleStale, setScheduleStale] = useState(false);
  useEffect(() => {
    // Own cache key: an invalid reply here must never reach the Command map cache.
    const url = `/api/desktop/schedule?date=${date}&load=1`;
    let live = true, controller = new AbortController();
    const load = () => { controller.abort(); controller = new AbortController(); fetchWorkspace<ScheduleSnapshot>(url, controller.signal, `convoy-jobs:${date}`).then(body => { if (!live) return; if (Array.isArray(body.appointments)) { setAppointments(body.appointments); setScheduleStale(false); } else setScheduleStale(true); }).catch(() => { if (live && !controller.signal.aborted) setScheduleStale(true); }); };
    setAppointments(null); setScheduleStale(false); load();
    const timer = window.setInterval(load, 60_000);
    return () => { live = false; controller.abort(); window.clearInterval(timer); };
  }, [date]);
  const repairsKnown = !snapshot.warnings.some(w => w.startsWith('Repair source'));
  const outIds = new Set(trucks.filter(t => snapshot.issues.some(i => i.status !== 'resolved' && i.severity === 'out_of_service' && sameTruck(i.truck, t.id))).map(t => t.id));
  const counts = liveCounts(trucks, outIds);
  const totals = fleetDayTotals(trucks);
  const isToday = date === new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(now);
  const rank: Record<string, number> = { out_of_service: 0, service: 1, gps: 2, fuel: 3, inspection: 4, scheduled: 5 };
  const attention = [...attentionItems(snapshot, trucks, isToday), ...dueItems.filter(d => d.status === 'due').map(d => ({ key: `due:${d.key}`, kind: 'service' as const, truckId: d.truckId, truck: d.truck, title: `${d.serviceType} due`, detail: dueDetail(d) }))].sort((a, b) => rank[a.kind] - rank[b.kind]);
  const jobs = new Map(trucks.map(t => [t.id, appointments ? truckJobs(appointments, t.id, isToday, now) : null]));
  const stops = appointments ? [...jobs.values()].reduce((a, j) => ({ total: a.total + (j?.total || 0), done: a.done + (j?.done || 0) }), { total: 0, done: 0 }) : null;
  const soon = dueItems.filter(d => d.status === 'soon');
  const toggle = () => { const next = !mapOpen; setMapOpen(next); try { localStorage.setItem(mapKey, String(next)); } catch { /* optional preference */ } };
  const tiles: Array<[string, React.ReactNode, string, (() => void) | undefined]> = [
    ['Driving now', isToday ? counts.moving : '—', isToday ? `${counts.idle} idling · ${counts.parked} parked` : 'Live status shows for today', undefined],
    ['No GPS', isToday ? counts.offline : '—', 'Stale, offline or unavailable', undefined],
    ['Out of service', repairsKnown ? counts.out : '—', 'Active repairs', () => onFilter('stop')],
    ['Needs attention', attention.length, `${attention.filter(a => a.kind === 'out_of_service').length} critical`, undefined],
    stops ? ['Stops done', `${stops.done} / ${stops.total}`, `${money(totals.revenue)} revenue`, undefined] : ['Jobs', num(totals.jobs), `${money(totals.revenue)} revenue`, undefined],
    ['Miles driven', num(totals.miles), totals.idleMinutes == null ? 'Idle time not recorded' : `${num(totals.idleMinutes)} idle min`, undefined],
  ];
  return <div className="clb">
    <div className="clb-tiles">{tiles.map(([title, value, detail, click]) => {
      const body = <><strong>{value}</strong><span>{title}</span><small>{detail}</small></>;
      return click ? <button key={title} className="clb-tile" onClick={click}>{body}</button> : <div key={title} className="clb-tile">{body}</div>;
    })}</div>
    {scheduleStale && appointments && <p className="clb-stale" role="status">Stop progress may be out of date: the schedule could not be refreshed.</p>}
    <div className="clb-main">
      <section className="convoy-dash-panel clb-live" aria-labelledby="clb-live-title">
        <header><h2 id="clb-live-title">Live trucks</h2><small>{isToday ? 'Updates about every 30 seconds' : 'Historical day'}</small></header>
        <div className="clb-cards">{trucks.map(t => {
          const group = liveGroup(t, outIds.has(t.id));
          return <button key={t.id} className={`clb-card ${group}`} onClick={() => onTruck(t.id)} aria-label={`${t.label}, ${groupLabel[group]}. Open truck`}>
            <span className="clb-card-head"><Truck size={14} /><strong>{t.label.replace('Truck#', 'Truck')}</strong><span className={`clb-pill ${group}`}>{isToday || group === 'out' ? groupLabel[group] : 'History'}</span></span>
            <small className="clb-where">{t.operatingStatus}{typeof t.speed === 'number' && t.speed > 0 ? ` · ${Math.round(t.speed)} mph` : ''}{t.driver && t.driver !== '—' ? ` · ${t.driver}` : ''}</small>
            <Level label="Fuel" percent={t.fuel ? t.fuel.percent : null} />
            <Level label="Load" percent={t.loadNeedsVerification ? null : t.loadPercent} />
            {jobs.get(t.id)?.total ? <div className="clb-jobs"><div className="clb-level" role="img" aria-label={`${jobs.get(t.id)!.done} of ${jobs.get(t.id)!.total} stops done`}><span>Stops</span><i><b style={{ width: `${(100 * jobs.get(t.id)!.done) / jobs.get(t.id)!.total}%` }} /></i><em>{jobs.get(t.id)!.done}/{jobs.get(t.id)!.total}</em></div>
              {stopLine(jobs.get(t.id)!, group !== 'offline') && <small>{stopLine(jobs.get(t.id)!, group !== 'offline')}</small>}</div> : null}
            <small className="clb-foot">{t.jobs == null ? 'Jobs —' : `${t.jobs} ${t.jobs === 1 ? 'job' : 'jobs'}`} · {t.miles == null ? '— mi' : `${Math.round(t.miles)} mi`} · {t.nextService || 'Service not set'}</small>
          </button>;
        })}</div>
      </section>
      <aside className="convoy-dash-panel clb-attention" aria-labelledby="clb-att-title">
        <header><h2 id="clb-att-title">Needs attention</h2><small>{attention.length ? `${attention.length} open` : 'All clear'}</small></header>
        {attention.length ? <ul>{attention.slice(0, 8).map(a => <li key={a.key}><button onClick={() => { onTruck(a.truckId); if (a.kind === 'scheduled' || a.kind === 'service') onView?.('service'); else if (a.kind === 'out_of_service' || a.kind === 'inspection') onView?.('maintenance'); }}>
          <span className={`clb-dot ${a.kind}`}>{a.kind === 'fuel' ? <Fuel size={13} /> : <AlertTriangle size={13} />}</span>
          <span><strong>{a.truck} · {a.title}</strong><small>{a.detail}</small></span><ArrowRight size={12} /></button></li>)}</ul>
          : <p className="convoy-empty">Nothing is flagged from recorded repairs, GPS, fuel or inspections.</p>}
        {attention.length > 8 && <small className="clb-more">{attention.length - 8} more in the truck table below</small>}
        <Button variant="outline" size="sm" onClick={() => onView?.('service')}>Open service planner <ArrowRight size={13} /></Button>
      </aside>
    </div>
    {soon.length > 0 && <section className="convoy-dash-panel clb-soon" aria-labelledby="clb-soon-title">
      <header><h2 id="clb-soon-title">Service due soon</h2><small>Within 30 days or 1,000 miles</small></header>
      <ul>{soon.map(d => <li key={d.key}><button onClick={() => { onTruck(d.truckId); onView?.('service'); }}><strong>{d.truck}</strong><span>{d.serviceType}</span><small>{dueDetail(d)}</small><ArrowRight size={12} /></button></li>)}</ul>
    </section>}
    <section className="convoy-dash-panel clb-map" aria-labelledby="clb-map-title">
      <header><h2 id="clb-map-title">Trucks and appointments map</h2>
        <Button variant="outline" size="sm" aria-expanded={mapOpen} onClick={toggle}>{mapOpen ? 'Hide map' : 'Show map'}{mapOpen ? <ChevronUp size={13} /> : <ChevronDown size={13} />}</Button></header>
      {mapOpen && <LiveSchedule mapOnly baseDate={date} day="today" onDayChange={() => {}} report={() => {}} onBusyChange={() => {}} />}
    </section>
  </div>;
}
