import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowRight, GripVertical, X } from 'lucide-react';
import { Button } from './components/ui/button';
import { Input } from './components/ui/input';
import AppointmentCreation from './appointment-creation';
import AppointmentCloseout from './appointment-closeout';
import { ScheduleCalendar, ScheduleHistory, ScheduleFollowup } from './schedule-tabs';
import ScheduleMap from './schedule-map';
import ScheduleControls, { MoveConfirmation, type MoveProposal } from './schedule-controls';
import { scheduleMoveProposal, useScheduleDrag } from './schedule-drag';
import { resolveScheduleDeepLink, scheduleMatchesQuery, assignmentNeedsVerification, appointmentCategory, appointmentRegion, appointmentStatus, isClosed, timelinePlacement, timelineRange, territoryOrder, truckLabel, type ScheduleAppointment, type ScheduleRouting, type ScheduleSnapshot } from './lib/schedule-contract';
import './live-schedule.css';

type Day = 'today' | 'tomorrow';
type Props = { view?: 'board' | 'calendar' | 'followup' | 'history'; onOpenDate?: (date: string) => void; onBusyChange?: (busy: boolean) => void; baseDate: string; day: Day; onDayChange: (day: Day) => void; onCounts: (counts: Record<Day, number>) => void; report: (message: string) => void };
const money = (value: number) => Number.isFinite(value) ? new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value) : 'Unavailable';
const slug = (value: string) => value.toLowerCase().replaceAll(' ', '-');
const clock = (minutes: number) => `${Math.floor(minutes / 60) % 12 || 12}${minutes % 60 ? ':' + String(minutes % 60).padStart(2, '0') : ''} ${minutes >= 720 ? 'PM' : 'AM'}`;
export const dateForDay = (base: string, day: Day) => { const date = new Date(`${base}T12:00:00Z`); if (day === 'tomorrow') date.setUTCDate(date.getUTCDate() + 1); return date.toISOString().slice(0, 10); };
const crew = (job: ScheduleAppointment) => [job.driver, job.navigator, ...(job.additionalCrew || [])].filter(value => value && !/^—$|^unknown$/i.test(value)).join(' · ') || 'Crew Not Available';
function Address({ value }: { value: string }) { return value ? <strong className="google-maps-address-shell"><a className="google-maps-address" target="_blank" rel="noopener noreferrer" href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(value)}`}>{value}</a></strong> : <span>Address Unavailable</span>; }
function Phone({ value }: { value: string }) { const digits = value.replace(/\D/g, ''); return digits.length >= 7 ? <span className="phone-contact"><a className="phone-link" href={`tel:${digits.length === 10 ? '+1' : '+'}${digits}`}>{value}</a></span> : <small>Phone Unavailable</small>; }

export default function LiveSchedule({ baseDate, day, onDayChange, onCounts, report, view = 'board', onOpenDate, onBusyChange }: Props) {
  const date = dateForDay(baseDate, day);
  const [creationOpen, setCreationOpen] = useState(false);
  const [snapshots, setSnapshots] = useState<Record<string, ScheduleSnapshot>>({});
  const [refreshKey, setRefreshKey] = useState(0);
  const [pendingMove, setPendingMove] = useState<MoveProposal | null>(null);
  const refresh = () => setRefreshKey(value => value + 1);
  const [error, setError] = useState('');
  const [showMap, setShowMap] = useState(true);
  const [filter, setFilter] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [linkNotice, setLinkNotice] = useState('');
  const deepLinkApplied = useRef(false);
  const [scope, setScope] = useState('ALL');
  const [priority, setPriority] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [drawerId, setDrawerIdValue] = useState<string | null>(null);
  const [operationBusy, setOperationBusy] = useState(false);
  const operationBusyRef = useRef(false);
  const onOperationBusyChange = useCallback((busy: boolean) => { operationBusyRef.current = busy; setOperationBusy(busy); onBusyChange?.(busy); }, [onBusyChange]);
  const setDrawerId = useCallback((id: string | null) => { if (!operationBusyRef.current) setDrawerIdValue(id); }, []);
  const [routing, setRouting] = useState<ScheduleRouting | null>(null);
  const [routeState, setRouteState] = useState('Loading Route Estimates');
  const [now, setNow] = useState(new Date());
  const snapshot = snapshots[date];
  const countsCallback = useRef(onCounts);
  countsCallback.current = onCounts;
  useEffect(() => {
    const abort = new AbortController();
    let pending = false;
    const load = async () => {
      if (pending) return;
      pending = true;
      try {
        const result = await Promise.all((['today', 'tomorrow'] as const).map(async key => {
          const dayDate = dateForDay(baseDate, key);
          const response = await fetch(`/api/desktop/schedule?date=${dayDate}`, { credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.any([abort.signal, AbortSignal.timeout(30_000)]) });
          const body = await response.json();
          if (!response.ok) throw new Error(body.error || 'Schedule could not refresh.');
          return body as ScheduleSnapshot;
        }));
        if (abort.signal.aborted) return;
        setSnapshots(Object.fromEntries(result.map(value => [value.date, value])));
        countsCallback.current({ today: result[0].appointments.length, tomorrow: result[1].appointments.length });
        setError('');
      } catch { if (!abort.signal.aborted) setError('Schedule could not refresh. Any visible records are the last retrieved snapshot, not a confirmed live update.'); }
      finally { pending = false; }
    };
    void load();
    const interval = window.setInterval(() => { setNow(new Date()); void load(); }, 15_000);
    return () => { abort.abort(); window.clearInterval(interval); };
  }, [baseDate, refreshKey]);
  useEffect(() => { setSelectedId(null); setDrawerId(null); setPendingMove(null); setScope('ALL'); setPriority(null); setFilter('all'); setSearchQuery(''); setLinkNotice(''); setRouting(null); }, [date, setDrawerId]);
  useEffect(() => {
    if (!snapshot || snapshot.date !== date || date !== baseDate || deepLinkApplied.current || operationBusyRef.current) return;
    deepLinkApplied.current = true;
    const params = new URLSearchParams(window.location.search);
    const target = resolveScheduleDeepLink(snapshot.appointments, params.get('q') || '', params.get('appointment') || '');
    setSearchQuery(target.query); setLinkNotice(target.notice);
    if (target.recordId) { setSelectedId(target.recordId); setDrawerId(target.recordId); }
  }, [snapshot, date, baseDate, setDrawerId]);
  const routingKey = snapshot ? JSON.stringify(snapshot.appointments.map(job => [job.recordId, job.truck, job.status, job.appointmentStartMinutes, job.appointmentEndMinutes, job.location])) : '';
  useEffect(() => {
    if (!routingKey) return;
    const abort = new AbortController();
    let pending = false;
    const load = async () => {
      if (pending) return;
      pending = true;
      setRouteState('Loading Route Estimates');
      try {
        const query = new URLSearchParams({ date });
        if (selectedId) query.set('appointment', selectedId);
        const response = await fetch(`/api/desktop/schedule/routes?${query}`, { cache: 'no-store', credentials: 'same-origin', signal: AbortSignal.any([abort.signal, AbortSignal.timeout(60_000)]) });
        const body = await response.json();
        if (!response.ok) throw new Error(body.error);
        if (!abort.signal.aborted) { setRouting(body); setRouteState(''); }
      } catch { if (!abort.signal.aborted) { setRouting(null); setRouteState('Route Estimates Unavailable'); } }
      finally { pending = false; }
    };
    setRouting(null);
    void load();
    const timer = window.setInterval(() => { void load(); }, 120_000);
    return () => { abort.abort(); window.clearInterval(timer); };
  }, [date, selectedId, routingKey]);
  const closeButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!drawerId) return;
    const previous = document.activeElement as HTMLElement | null;
    closeButton.current?.focus({ preventScroll: true });
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setDrawerId(null); };
    window.addEventListener('keydown', escape);
    return () => { window.removeEventListener('keydown', escape); if (previous?.isConnected) previous.focus({ preventScroll: true }); };
  }, [drawerId, setDrawerId]);
  const jobs = snapshot?.appointments || [];
  const regions = jobs.map(job => ({ job, ...appointmentRegion(job) }));
  const groups = territoryOrder.map(code => ({ code, label: regions.find(region => region.code === code)?.label || '', jobs: regions.filter(region => region.code === code) })).filter(group => group.jobs.length);
  const match = (job: ScheduleAppointment) => {
    const region = appointmentRegion(job);
    const scopeMatch = scope === 'ALL' || scope === region.code || scope === `${region.code}:${region.areaCode}`;
    return scopeMatch && scheduleMatchesQuery(job, searchQuery) && (filter === 'all' || filter === 'completed' && appointmentStatus(job) === 'Completed' || filter === 'estimates' && appointmentStatus(job) === 'Estimate Closed' || filter === 'open' && !isClosed(job) || filter === 'unassigned' && truckLabel(job.truck) === 'Unassigned' || filter === 'verify' && !job.location);
  };
  const visible = jobs.filter(match);
  const filtered = filter !== 'all' || scope !== 'ALL' || Boolean(searchQuery);
  const reset = () => { setSearchQuery(''); setLinkNotice(''); setFilter('all'); setScope('ALL'); setPriority(null); setSelectedId(null); };
  const selected = jobs.find(job => job.recordId === selectedId);
  const drawer = jobs.find(job => job.recordId === drawerId);
  const truckNames = [...new Set([...snapshot?.fleet.trucks.map(truck => truckLabel(truck.truck)) || [], ...jobs.map(job => truckLabel(job.truck))])].sort((a, b) => a === 'Unassigned' ? 1 : b === 'Unassigned' ? -1 : a.localeCompare(b, undefined, { numeric: true }));
  const range = timelineRange(jobs);
  const drag = useScheduleDrag(jobs, range, setPendingMove, date, operationBusy || Boolean(pendingMove));
  const ticks = Array.from({ length: (range.end - range.start) / 60 }, (_, index) => range.start + index * 60);
  const nowParts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now);
  const nowMinutes = Number(nowParts.find(part => part.type === 'hour')?.value) * 60 + Number(nowParts.find(part => part.type === 'minute')?.value);
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(now);
  const progress = (nowMinutes - range.start) / range.duration;
  const displayLegs = routing?.date === date ? routing.legs : [];
  const routeTo = (id: string) => displayLegs.find(leg => leg.toAppointmentId === id);
  const safeSourceHref = (job: ScheduleAppointment) => { try { const url = new URL(job.appointmentUrl); return /^https?:$/.test(url.protocol) ? url.href : null; } catch { return null; } };

  if (!snapshot) return <section className="empty-state" role="status"><strong>{error || 'Loading Schedule from JunkWare…'}</strong><span>No sample appointments are used.</span></section>;
  return <section className="schedule-workspace live-schedule">
    <div className="schedule-control-bar">
      <div className="day-switcher" role="tablist" aria-label="Schedule day">{(['today', 'tomorrow'] as const).map(key => <button key={key} disabled={operationBusy} onClick={() => onDayChange(key)} className={day === key ? 'active' : ''}>{key === 'today' ? 'Today' : 'Tomorrow'} <span>{snapshots[dateForDay(baseDate, key)]?.appointments.length ?? '—'}</span></button>)}</div>
      <div className="schedule-control-actions"><Input aria-label="Filter source appointments" style={{ width: 220, maxWidth: '30vw' }} placeholder="Search appointments" value={searchQuery} maxLength={200} disabled={operationBusy} onChange={event => { setSearchQuery(event.target.value); setLinkNotice(''); }} /><Button variant="outline" size="sm" onClick={() => setShowMap(value => !value)}>{showMap ? 'Hide Map' : 'Show Map'}</Button><Button size="sm" disabled={operationBusy} onClick={() => setCreationOpen(true)}>New Appointment</Button></div>
    </div>
    {linkNotice && <p className="live-schedule-status" role="status">{linkNotice}</p>}
    {view === 'board' && <><div className="schedule-summary-strip">{[
      ['all', 'Scheduled', jobs.length], ['completed', 'Completed Jobs', jobs.filter(job => appointmentStatus(job) === 'Completed').length], ['estimates', 'Closed Estimates', jobs.filter(job => appointmentStatus(job) === 'Estimate Closed').length], ['open', 'Open', jobs.filter(job => !isClosed(job)).length], ['unassigned', 'Unassigned', jobs.filter(job => truckLabel(job.truck) === 'Unassigned').length], ['verify', 'Verify Address', jobs.filter(job => !job.location).length],
    ].map(([key, label, count]) => <button key={key} className={`schedule-summary-button${filter === key ? ' active' : ''}${key === 'unassigned' || key === 'verify' ? ' attention' : ''}`} onClick={() => setFilter(filter === key ? 'all' : String(key))}><span>{label}</span><strong>{count}</strong></button>)}<Button variant="outline" size="sm" disabled={!filtered && !priority} onClick={reset}>Clear</Button></div>
    {error && <div className="live-schedule-status live-schedule-error" role="alert">{error}</div>}
    <div className={`schedule-board-layout${showMap ? ' map-open' : ''}`}>
      {showMap && <section className="schedule-map-panel">
        <div className="schedule-map-canvas">
          <ScheduleMap appointments={visible} trucks={snapshot.fleet.isToday ? snapshot.fleet.trucks : []} selected={selectedId} onSelect={setSelectedId} />
          <div className="map-focus-chip"><span>{filtered ? 'Filtered View' : 'Operating Footprint'}</span><strong>{scope === 'ALL' ? 'All Territories' : scope}</strong>{filtered && <div className="map-focus-actions"><button onClick={reset}>Reset</button></div>}</div>
          <div className="map-operation-summary"><span>{visible.length} appointments</span><span>{visible.filter(job => job.location).length} verified pins</span></div>
        </div>
        <aside className="schedule-map-controls"><div><span className="section-kicker">{snapshot.fleet.isToday ? 'Live Map' : 'Planning Map'}</span><h2>{snapshot.fleet.isToday ? 'Dispatch Positions' : 'Appointment Coverage'}</h2></div>
          <div className="map-control-buttons"><button onClick={() => setScope('ALL')} className={scope === 'ALL' ? 'active' : ''}>All</button>{groups.map(group => <button key={group.code} className={scope === group.code ? 'active' : ''} onClick={() => setScope(group.code)}>{group.code}</button>)}</div>
          {selected ? <section className="route-intelligence-panel" aria-label={`Closest trucks to ${selected.jkNumber}`}>
            <header><div><span>Closest Trucks</span><strong>{selected.jkNumber} · {appointmentRegion(selected).area}</strong></div><div><button onClick={() => setDrawerId(selected.recordId)}>Open</button><button aria-label="Clear route comparison" onClick={() => setSelectedId(null)}>×</button></div></header>
            <div className="route-candidate-list">{routeState ? <p>{routeState}</p> : routing?.appointmentId === selectedId && routing.closest.map((candidate, index) => <div className={`route-candidate-row ${candidate.status === 'available' ? 'clear' : 'unavailable'}`} key={candidate.truck}><span className="route-rank">{candidate.minutes !== null ? index + 1 : '—'}</span><div><strong>{truckLabel(candidate.truck)}</strong><small>{candidate.status === 'available' ? 'From Recent GPS' : candidate.status.replaceAll('_', ' ')}</small></div><div><b>{candidate.minutes !== null ? `${candidate.minutes} min · ${candidate.miles} mi` : 'Unavailable'}</b><small>{candidate.gpsUpdatedAt ? new Date(candidate.gpsUpdatedAt).toLocaleTimeString('en-US', { timeZone: 'America/Chicago', hour: 'numeric', minute: '2-digit' }) : 'No GPS Timestamp'}</small></div></div>)}</div>
            <footer>Google traffic estimate · Distance ranking only; availability, load, and schedule must be checked before assigning.</footer>
          </section> : <div className="map-status-list"><span><i className={snapshot.fleet.isToday ? 'healthy' : 'warning'} />{snapshot.fleet.isToday ? 'Truck markers show GPS; amber marks last-known positions' : 'Planning day · Current GPS is not a planned truck origin'}</span><span>{jobs.filter(job => !job.location).length} appointments need verified coordinates</span></div>}
        </aside>
      </section>}
      <div className="schedule-board-shell"><div className="section-title"><div><span className="section-kicker">{day === 'today' ? 'Today' : 'Tomorrow'} · JunkWare Snapshot</span><h2>Truck Schedule</h2></div><div className="schedule-board-actions"><span className="schedule-drag-help"><GripVertical size={13} />Drag Appointment → Truck + Time</span></div></div>
        <div className="schedule-board-scroll"><div className={`schedule-board ${truckNames.length >= 10 ? 'ultra' : truckNames.length >= 7 ? 'compact' : 'comfortable'}`} style={{ gridTemplateRows: `22px repeat(${Math.max(1, truckNames.length)}, minmax(0, 1fr))` }}>
          <div className="schedule-time-row" style={{ gridTemplateColumns: `88px repeat(${ticks.length}, minmax(0, 1fr))` }}><span>Route</span>{ticks.map(tick => <span key={tick}>{clock(tick)}</span>)}</div>
          {date === today && progress >= 0 && progress <= 1 && <div className="schedule-now-line" style={{ left: `calc(${progress * 100}% + ${(1 - progress) * 88}px)` }} aria-label={`Current time ${clock(nowMinutes)}`}><span>{clock(nowMinutes)}</span></div>}
          {truckNames.map((truck, index) => {
            const rowJobs = jobs.filter(job => truckLabel(job.truck) === truck).sort((a, b) => (a.appointmentStartMinutes ?? Infinity) - (b.appointmentStartMinutes ?? Infinity));
            const lanes: number[] = [];
            const placed = rowJobs.flatMap(job => { const position = timelinePlacement(job, range); if (!position) return []; let lane = lanes.findIndex(end => end <= job.appointmentStartMinutes!); if (lane < 0) lane = lanes.length; lanes[lane] = job.appointmentEndMinutes!; return [{ job, position, lane }]; });
            const laneCount = Math.max(1, lanes.length);
            const ghost = drag.preview?.truck === truck ? drag.preview : null;
            const ghostStart = ghost?.start ?? ghost?.job.appointmentStartMinutes;
            const ghostDuration = ghost?.job.appointmentStartMinutes !== null && ghost?.job.appointmentEndMinutes != null ? ghost.job.appointmentEndMinutes - ghost.job.appointmentStartMinutes! : 60;
            return <div className="schedule-truck-row" data-schedule-truck={truck} key={truck}><button type="button" className="schedule-truck-cell" onClick={() => report(`${truck}: ${rowJobs.length} appointments. Full appointment details are below the board.`)}><i className={['blue', 'red', 'gold', 'purple'][index % 4]} /><strong>{truck}</strong><span>{rowJobs[0] ? crew(rowJobs[0]) : 'No Scheduled Work'}</span></button><div className="live-truck-timeline">
              {placed.map(({ job, position, lane }) => <div key={job.recordId} className={`schedule-appointment ${slug(appointmentCategory(job))} ${slug(appointmentStatus(job))}${filtered ? match(job) ? ' scope-match' : ' scope-muted' : ''}${selectedId === job.recordId ? ' route-selected' : ''}${drag.preview?.job.recordId === job.recordId ? ' is-dragging' : ''}`} style={{ left: `${position.left * 100}%`, width: `calc(${position.width * 100}% - 2px)`, top: `calc(${lane / laneCount * 100}% + 1px)`, bottom: `calc(${(laneCount - lane - 1) / laneCount * 100}% + 3px)` }} role="group" tabIndex={0} aria-roledescription={isClosed(job) || assignmentNeedsVerification(job) || operationBusy ? undefined : "draggable appointment"} onPointerDown={event => drag.begin(event, job)} aria-label={`${job.jkNumber} · ${job.customerName} · ${job.appointmentTime}`} onClick={() => setSelectedId(job.recordId)} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setSelectedId(job.recordId); } }} title={`${job.jkNumber} · ${job.customerName} · ${job.appointmentTime} · ${appointmentStatus(job)}`}><span>{job.appointmentTime}</span>{!isClosed(job) && !assignmentNeedsVerification(job) && <GripVertical className="schedule-grip" size={10} aria-hidden="true" />}<button type="button" className="jk-record-link schedule-jk-link" onClick={event => { event.stopPropagation(); setDrawerId(job.recordId); }}>{job.jkNumber}</button><small>{job.customerName}</small></div>)}
              {displayLegs.filter(leg => truckLabel(leg.truck) === truck && leg.gapMinutes > 0).map(leg => { const to = jobs.find(job => job.recordId === leg.toAppointmentId)!; const end = to?.appointmentStartMinutes; if (end == null) return null; return <div key={`${leg.fromAppointmentId}:${leg.toAppointmentId}`} className={`schedule-route-leg ${leg.bufferMinutes !== null && leg.bufferMinutes < 0 ? 'late' : leg.travelMinutes === null ? 'unavailable' : 'clear'}`} style={{ left: `${(end - leg.gapMinutes - range.start) / range.duration * 100}%`, width: `${leg.gapMinutes / range.duration * 100}%` }} title={`${leg.fromJk} → ${leg.toJk}: ${leg.travelMinutes === null ? 'Route unavailable' : `${leg.travelMinutes} minutes · ${leg.miles} miles · ${leg.bufferMinutes} minute window gap after travel`}`}><strong>{leg.travelMinutes === null ? 'Route —' : `${leg.travelMinutes}m · ${leg.miles}mi`}</strong></div>; })}
              {ghost && ghostStart != null && <div className={`schedule-drag-preview${ghost.conflicts.length ? ' conflict' : ''}`} style={{ left: `${(ghostStart - range.start) / range.duration * 100}%`, width: `${ghostDuration / range.duration * 100}%` }}><strong>{ghost.job.jkNumber}</strong><small>{clock(ghostStart)} · {ghost.conflicts.length ? `Conflicts ${ghost.conflicts.join(', ')}` : 'Drop to Review'}</small></div>}
            </div></div>;
          })}
        </div></div>
      </div>
      {pendingMove && <MoveConfirmation key={`${pendingMove.job.recordId}:${pendingMove.truck}:${pendingMove.start}`} move={pendingMove} date={date} cancel={() => setPendingMove(null)} saved={refresh} onBusyChange={onOperationBusyChange} />}
    </div>
    <div className="live-schedule-status">{snapshot.observedAt ? `JunkWare snapshot: ${new Date(snapshot.observedAt).toLocaleString('en-US', { timeZone: 'America/Chicago' })}` : 'JunkWare snapshot timestamp unavailable'} · {routeState || (displayLegs.length ? `${displayLegs.filter(leg => leg.source === 'google_live_traffic').length} of ${displayLegs.length} travel estimates available${routing?.calculatedAt ? ` · Calculated ${new Date(routing.calculatedAt).toLocaleTimeString('en-US', { timeZone: 'America/Chicago', hour: 'numeric', minute: '2-digit' })}` : ''}. Google current traffic; unavailable routes need verified locations and provider data.` : 'No consecutive assigned appointments to route.')} Appointment windows are not confirmed service durations.{jobs.some(job => !job.hasScheduledTime) && ` · ${jobs.filter(job => !job.hasScheduledTime).length} untimed appointments are listed below.`}</div>
    <section className="appointment-register"><div className="section-title appointment-register-title"><div><span className="section-kicker">{visible.length} Shown · {scope === 'ALL' ? 'All Territories' : scope}</span><h2>All Appointments</h2></div>{filtered && <Button variant="outline" size="sm" onClick={reset}>Show All {jobs.length}</Button>}</div>
      <nav className="appointment-territory-toolbar" aria-label="Prioritize territory"><span>Territory Order</span>{groups.map(group => <button key={group.code} className={priority === group.code ? 'active' : ''} onClick={() => { setScope('ALL'); setPriority(group.code); }} title={`Move ${group.label} to the top`}><i className={slug(group.label)} />{group.code}<small>{group.jobs.length}</small></button>)}<button className="reset-order" onClick={reset} disabled={!priority && !filtered}>Reset Order</button></nav>
      <div className="appointment-register-table" role="table" aria-label="All scheduled appointments">{[...groups].sort((a, b) => a.code === priority ? -1 : b.code === priority ? 1 : territoryOrder.indexOf(a.code) - territoryOrder.indexOf(b.code)).map(group => {
        const groupJobs = group.jobs.filter(region => match(region.job)); if (!groupJobs.length) return null;
        return <section className={`appointment-territory-group ${slug(group.label)}`} role="rowgroup" key={group.code}><div className="appointment-territory-heading"><div><i /><button onClick={() => setScope(group.code)}>{group.code}</button><button className="territory-record-link" onClick={() => setScope(group.code)}>{group.label}<ArrowRight size={11} /></button></div><span>{groupJobs.length} Appointments</span></div><div className="appointment-register-head" role="row"><span>Time</span><span>Appointment</span><span>Customer</span><span>Service Location</span><span>Assignment</span><span>Work</span><span>Status and Notes</span></div>
          {[...new Set(groupJobs.map(region => region.areaCode))].map(areaCode => { const areaJobs = groupJobs.filter(region => region.areaCode === areaCode); return <section className={`appointment-area-group ${areaCode.toLowerCase()}`} key={areaCode}><div className="appointment-area-heading"><div><button onClick={() => setScope(`${group.code}:${areaCode}`)}>{areaCode}</button><button className="area-record-link" onClick={() => setScope(`${group.code}:${areaCode}`)}>{areaJobs[0].area}<ArrowRight size={10} /></button></div><span>{areaJobs.length} Appointments</span></div>{areaJobs.map(({ job, area }) => { const leg = routeTo(job.recordId); return <article className={`appointment-register-row ${slug(appointmentStatus(job))}`} role="row" key={job.recordId}><div><strong>{job.appointmentTime || 'Time Not Set'}</strong><small>{appointmentCategory(job)}</small></div><div><button className="jk-record-link" onClick={() => setDrawerId(job.recordId)}>{job.jkNumber || 'JK Pending'}</button></div><div><strong>{job.customerName || 'Customer Unavailable'}</strong><Phone value={job.phone} /></div><div><Address value={job.address} /><small>{area}</small>{leg && <small className={`route-leg-inline${leg.bufferMinutes !== null && leg.bufferMinutes < 0 ? ' late' : ''}`}>{leg.travelMinutes === null ? 'Travel Unavailable' : `${leg.travelMinutes} min · ${leg.miles} mi`} from {leg.fromJk}{leg.bufferMinutes !== null ? ` · ${leg.bufferMinutes < 0 ? `${Math.abs(leg.bufferMinutes)}m short` : `${leg.bufferMinutes}m window gap`}` : ''}</small>}</div><div><strong>{truckLabel(job.truck)}</strong><small>{crew(job)}</small>{assignmentNeedsVerification(job) && <small className="assignment-unverified">Assignment Not Verified</small>}</div><div><strong>{job.junkItems.join(' · ') || appointmentCategory(job)}</strong><small>{job.paymentAmount ? `${money(job.paymentAmount)} paid` : 'No Payment Recorded'}</small></div><div><span className={`appointment-state ${slug(appointmentStatus(job))}`}>{appointmentStatus(job)}</span><small>{appointmentStatus(job) === 'Canceled' ? job.cancellationReason : job.appointmentNotes.join(' · ')}</small></div></article>; })}</section>; })}
        </section>;
      })}{!visible.length && <div className="appointment-empty-state"><strong>{filtered ? 'No Appointments Match This View' : 'No Appointments In This Source Snapshot'}</strong>{filtered && <Button variant="outline" size="sm" onClick={reset}>Clear Filters</Button>}</div>}</div>
    </section>
    </>}
    {view === 'calendar' && <ScheduleCalendar date={date} openDate={value => onOpenDate?.(value)} />}
    {view === 'history' && <ScheduleHistory date={date} jobs={jobs} open={setDrawerId} />}
    {view === 'followup' && <ScheduleFollowup jobs={jobs} open={setDrawerId} />}
    {creationOpen && <AppointmentCreation date={date} appointments={jobs} close={() => { if (!operationBusyRef.current) setCreationOpen(false); }} saved={refresh} onBusyChange={onOperationBusyChange} />}
    {drawer && <><button className="record-drawer-backdrop" aria-label="Close appointment" disabled={operationBusy} onClick={() => setDrawerId(null)} /><aside className="record-drawer job-record-drawer" role="dialog" aria-modal="true" aria-labelledby="live-appointment-title" onKeyDown={event => { if (event.key !== 'Tab') return; const focusable = [...event.currentTarget.querySelectorAll<HTMLElement>('button, a[href], input, select, textarea, [tabindex="0"]')].filter(element => !element.hasAttribute('disabled')); const first = focusable[0], last = focusable[focusable.length - 1]; if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); } }}><header className="record-drawer-header"><div><span>{appointmentCategory(drawer)} · {appointmentStatus(drawer)}</span><h2 id="live-appointment-title">{drawer.jkNumber}</h2><p>{drawer.customerName}</p></div><Button ref={closeButton} variant="ghost" size="icon" aria-label="Close" disabled={operationBusy} onClick={() => setDrawerId(null)}><X /></Button></header><div className="record-drawer-body"><section className="drawer-facts" aria-label="Record details">{[
      ['Appointment ID', drawer.appointmentId || 'Unavailable'], ['Time', drawer.appointmentTime], ['Customer', drawer.customerName], ['Phone', <Phone key="phone" value={drawer.phone} />], ['Email', drawer.customerEmail || 'Not Recorded'], ['Address', <Address key="address" value={drawer.address} />], ['Truck', truckLabel(drawer.truck)], ['Krewe', crew(drawer)], ['Category', appointmentCategory(drawer)], ['Status', appointmentStatus(drawer)], ['Work', drawer.junkItems.join(' · ') || 'Not Recorded'], ['Payment', `${money(drawer.paymentAmount)} · ${drawer.paymentType || 'Method Not Recorded'}`], ['Tip', money(drawer.tipAmount)], ['Notes', drawer.appointmentNotes.join(' · ') || 'No Notes'],
    ].map(([label, value]) => <div key={String(label)}><span>{label}</span><strong>{value || 'Unavailable'}</strong></div>)}</section><ScheduleControls key={drawer.recordId} job={drawer} date={date} trucks={truckNames} saved={refresh} onBusyChange={onOperationBusyChange} onMove={proposal => { setPendingMove(scheduleMoveProposal(proposal.job, proposal.truck, proposal.start, jobs)); setDrawerId(null); }} /><AppointmentCloseout job={drawer} date={date} saved={refresh} onBusyChange={onOperationBusyChange} /></div><footer className="record-drawer-actions"><Button variant="outline" disabled={operationBusy} onClick={() => setDrawerId(null)}>Close</Button>{safeSourceHref(drawer) && <Button onClick={() => window.open(safeSourceHref(drawer)!, '_blank', 'noopener,noreferrer')}>Open in JunkWare <ArrowRight /></Button>}</footer></aside></>}
  </section>;
}
