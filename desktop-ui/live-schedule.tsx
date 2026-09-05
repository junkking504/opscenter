import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { ArrowRight, Check, GripVertical, LockKeyhole, X } from 'lucide-react';
import { Button } from './components/ui/button';
import { Input } from './components/ui/input';
import AppointmentCreation from './appointment-creation';
import AppointmentCloseout from './appointment-closeout';
import { ScheduleCalendar, ScheduleHistory, ScheduleFollowup } from './schedule-tabs';
import ScheduleMap from './schedule-map';
import ScheduleTravel from './schedule-travel';
import TruckCameraController from '../components/TruckCameraController';
import ScheduleControls, { MoveConfirmation, type MoveProposal } from './schedule-controls';
import { scheduleMoveProposal, useScheduleDrag } from './schedule-drag';
import { resolveScheduleDeepLink, scheduleMatchesQuery, scheduleStatusTone, scheduleMoveRestriction, unavailableRoute, assignmentNeedsVerification, appointmentCategory, appointmentRegion, appointmentStatus, isClosed, timelinePlacement, timelineRange, territoryLabels, territoryOrder, truckLabel, type ScheduleAppointment, type ScheduleRouting, type ScheduleSnapshot } from './lib/schedule-contract';
import './live-schedule.css';
import './schedule-board.css';

type Day = 'today' | 'tomorrow';
type Props = { mapOnly?: boolean; view?: 'board' | 'calendar' | 'followup' | 'history'; onOpenDate?: (date: string) => void; onBusyChange?: (busy: boolean) => void; baseDate: string; day: Day; onDayChange: (day: Day) => void; onCounts?: (counts: Record<Day, number>) => void; report: (message: string) => void };
const money = (value: number) => Number.isFinite(value) ? new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value) : 'Unavailable';
const slug = (value: string) => value.toLowerCase().replaceAll(' ', '-');
const clock = (minutes: number) => `${Math.floor(minutes / 60) % 12 || 12}${minutes % 60 ? ':' + String(minutes % 60).padStart(2, '0') : ''} ${minutes >= 720 ? 'PM' : 'AM'}`;
export const dateForDay = (base: string, day: Day) => { const date = new Date(`${base}T12:00:00Z`); if (day === 'tomorrow') date.setUTCDate(date.getUTCDate() + 1); return date.toISOString().slice(0, 10); };
const crew = (job: ScheduleAppointment) => [job.driver, job.navigator, ...(job.additionalCrew || [])].filter(value => value && !/^—$|^unknown$/i.test(value)).join(' · ') || 'Crew Not Available';
function Address({ value }: { value: string }) { return value ? <strong className="google-maps-address-shell"><a className="google-maps-address" target="_blank" rel="noopener noreferrer" href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(value)}`}>{value}</a></strong> : <span>Address Unavailable</span>; }
function Phone({ value }: { value: string }) { const digits = value.replace(/\D/g, ''); return digits.length >= 7 ? <span className="phone-contact"><a className="phone-link" href={`tel:${digits.length === 10 ? '+1' : '+'}${digits}`}>{value}</a></span> : <small>Phone Unavailable</small>; }

export default function LiveSchedule({ baseDate, day, onDayChange, onCounts, report, view = 'board', onOpenDate, onBusyChange, mapOnly = false }: Props) {
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
  const [dragNotice, setDragNotice] = useState('');
  const deepLinkApplied = useRef(false);
  const [scope, setScope] = useState('ALL');
  const [priority, setPriority] = useState<string | null>(null);
  const [selectedTruck, setSelectedTruck] = useState<string | null>(null);
  const [mapResetKey, setMapResetKey] = useState(0);
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
  const boardLayoutRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const board = boardLayoutRef.current;
    if (!board || mapOnly || view !== 'board') return;
    const fit = () => {
      const pageTop = board.getBoundingClientRect().top + window.scrollY;
      board.style.setProperty('--schedule-available-height', `${Math.max(180, Math.min(520, window.innerHeight - pageTop - 12))}px`);
    };
    const observer = new ResizeObserver(fit);
    document.querySelectorAll('.topbar, .workspace-heading, .schedule-control-bar, .schedule-summary-strip').forEach(element => observer.observe(element));
    window.addEventListener('resize', fit);
    fit();
    return () => { observer.disconnect(); window.removeEventListener('resize', fit); };
  }, [Boolean(snapshot), mapOnly, view]);
  const countsCallback = useRef(onCounts);
  countsCallback.current = onCounts;
  useEffect(() => {
    const abort = new AbortController();
    let pending = false;
    const load = async () => {
      if (pending) return;
      pending = true;
      try {
        const result = await Promise.all((mapOnly ? ['today'] as const : ['today', 'tomorrow'] as const).map(async key => {
          const dayDate = dateForDay(baseDate, key);
          const response = await fetch(`/api/desktop/schedule?date=${dayDate}`, { credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.any([abort.signal, AbortSignal.timeout(30_000)]) });
          const body = await response.json();
          if (!response.ok) throw new Error(body.error || 'Schedule could not refresh.');
          return body as ScheduleSnapshot;
        }));
        if (abort.signal.aborted) return;
        setSnapshots(Object.fromEntries(result.map(value => [value.date, value])));
        if (!mapOnly) countsCallback.current?.({ today: result[0].appointments.length, tomorrow: result[1].appointments.length });
        setError('');
      } catch { if (!abort.signal.aborted) setError('Schedule could not refresh. Any visible records are the last retrieved snapshot, not a confirmed live update.'); }
      finally { pending = false; }
    };
    void load();
    const interval = window.setInterval(() => { setNow(new Date()); void load(); }, 15_000);
    return () => { abort.abort(); window.clearInterval(interval); };
  }, [baseDate, refreshKey, mapOnly]);
  useEffect(() => { setSelectedId(null); setSelectedTruck(null); setDrawerId(null); setPendingMove(null); setScope('ALL'); setPriority(null); setFilter('all'); setSearchQuery(''); setLinkNotice(''); setRouting(null); }, [date, setDrawerId]);
  useEffect(() => {
    if (mapOnly || !snapshot || snapshot.date !== date || date !== baseDate || deepLinkApplied.current || operationBusyRef.current) return;
    deepLinkApplied.current = true;
    const params = new URLSearchParams(window.location.search);
    const target = resolveScheduleDeepLink(snapshot.appointments, params.get('q') || '', params.get('appointment') || '');
    setSearchQuery(target.query); setLinkNotice(target.notice);
    if (target.recordId) { setSelectedId(target.recordId); setDrawerId(target.recordId); }
  }, [snapshot, date, baseDate, setDrawerId, mapOnly]);
  const routingKey = snapshot ? JSON.stringify(snapshot.appointments.map(job => [job.recordId, job.truck, job.status, job.appointmentStartMinutes, job.appointmentEndMinutes, job.location])) : '';
  useEffect(() => {
    if (!routingKey || (mapOnly && !selectedId)) return;
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
  }, [date, selectedId, routingKey, mapOnly]);
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
  const reset = () => { setSearchQuery(''); setLinkNotice(''); setFilter('all'); setScope('ALL'); setPriority(null); setSelectedId(null); setSelectedTruck(null); setMapResetKey(value => value + 1); };
  const focusTerritory = (value: string) => { setScope(value); setSelectedId(null); setSelectedTruck(null); setMapResetKey(key => key + 1); };
  const selectAppointment = (id: string) => { if (operationBusyRef.current) return; setSelectedTruck(null); setSelectedId(id); setMapResetKey(key => key + 1); setShowMap(true); setDrawerId(id); };
  const selectTruck = (truck: string) => { if (operationBusyRef.current) return; setScope('ALL'); setFilter('all'); setSearchQuery(''); setSelectedId(null); setSelectedTruck(truck); setMapResetKey(key => key + 1); setShowMap(true); };
  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented || operationBusyRef.current || document.querySelector('[role="dialog"]') || (event.target as HTMLElement).closest('input,textarea,select')) return;
      setScope('ALL'); setFilter('all'); setSearchQuery(''); setSelectedId(null); setSelectedTruck(null); setMapResetKey(key => key + 1);
    };
    window.addEventListener('keydown', escape);
    return () => window.removeEventListener('keydown', escape);
  }, []);
  const truckDetails = snapshot?.fleet.trucks.find(truck => truckLabel(truck.truck) === selectedTruck);
  const truckGpsAge = Date.now() - Date.parse(truckDetails?.lastGpsUpdate || '');
  const truckGpsLabel = Number.isFinite(truckGpsAge) && truckGpsAge >= 0 && truckGpsAge <= 180_000 ? 'Recent GPS' : 'Last Known Position';
  const truckJobs = jobs.filter(job => truckLabel(job.truck) === selectedTruck);
  const selected = jobs.find(job => job.recordId === selectedId);
  const drawer = jobs.find(job => job.recordId === drawerId);
  const truckNames = [...new Set([...snapshot?.fleet.trucks.map(truck => truckLabel(truck.truck)) || [], ...jobs.map(job => truckLabel(job.truck))])].sort((a, b) => a === 'Unassigned' ? 1 : b === 'Unassigned' ? -1 : a.localeCompare(b, undefined, { numeric: true }));
  const range = timelineRange(jobs);
  const drag = useScheduleDrag(jobs, range, setPendingMove, date, operationBusy || Boolean(pendingMove), setDragNotice);
  const ticks = Array.from({ length: (range.end - range.start) / 60 }, (_, index) => range.start + index * 60);
  const nowParts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now);
  const nowMinutes = Number(nowParts.find(part => part.type === 'hour')?.value) * 60 + Number(nowParts.find(part => part.type === 'minute')?.value);
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(now);
  const progress = (nowMinutes - range.start) / range.duration;
  const displayLegs = routing?.date === date ? routing.legs : [];
  const routeTo = (id: string) => displayLegs.find(leg => leg.toAppointmentId === id);
  const safeSourceHref = (job: ScheduleAppointment) => { try { const url = new URL(job.appointmentUrl); return /^https?:$/.test(url.protocol) ? url.href : null; } catch { return null; } };

  if (!snapshot) return <section className="empty-state" role="status"><strong>{error || 'Loading Schedule from JunkWare…'}</strong><span>No sample appointments are used.</span></section>;
  return <TruckCameraController className="live-schedule-camera"><section className={`schedule-workspace live-schedule${mapOnly ? ' command-map-content' : ' schedule-dispatch'}`}>
    {!mapOnly && <div className="schedule-control-bar">
      <div className="day-switcher" role="tablist" aria-label="Schedule day">{(['today', 'tomorrow'] as const).map(key => <button key={key} disabled={operationBusy} onClick={() => onDayChange(key)} className={day === key ? 'active' : ''}>{baseDate === new Intl.DateTimeFormat('en-CA',{timeZone:'America/Chicago'}).format(new Date()) ? (key === 'today' ? 'Today' : 'Tomorrow') : dateForDay(baseDate,key)} <span>{snapshots[dateForDay(baseDate, key)]?.appointments.length ?? '—'}</span></button>)}</div>
      <div className="schedule-control-actions"><Input aria-label="Filter source appointments" style={{ width: 220, maxWidth: '30vw' }} placeholder="Search appointments" value={searchQuery} maxLength={200} disabled={operationBusy} onChange={event => { setSearchQuery(event.target.value); setLinkNotice(''); }} /><Button variant="outline" size="sm" onClick={() => setShowMap(value => !value)}>{showMap ? 'Hide Map' : 'Show Map'}</Button><Button size="sm" disabled={operationBusy} onClick={() => setCreationOpen(true)}>New Appointment</Button></div>
    </div>}
    {linkNotice && <p className="live-schedule-status" role="status">{linkNotice}</p>}
    {view === 'board' && <>{!mapOnly && <div className="schedule-summary-strip">{[
      ['all', 'Scheduled', jobs.length], ['completed', 'Completed Jobs', jobs.filter(job => appointmentStatus(job) === 'Completed').length], ['estimates', 'Closed Estimates', jobs.filter(job => appointmentStatus(job) === 'Estimate Closed').length], ['open', 'Open', jobs.filter(job => !isClosed(job)).length], ['unassigned', 'Unassigned', jobs.filter(job => truckLabel(job.truck) === 'Unassigned').length], ['verify', 'Verify Address', jobs.filter(job => !job.location).length],
    ].map(([key, label, count]) => <button key={key} className={`schedule-summary-button${filter === key ? ' active' : ''}${key === 'unassigned' || key === 'verify' ? ' attention' : ''}`} onClick={() => setFilter(filter === key ? 'all' : String(key))}><span>{label}</span><strong>{count}</strong></button>)}<Button variant="outline" size="sm" disabled={!filtered && !priority} onClick={reset}>Clear</Button></div>}
    {error && <div className="live-schedule-status live-schedule-error" role="alert">{error}</div>}
    <div ref={boardLayoutRef} className={`schedule-board-layout${showMap ? ' map-open' : ''}`}>
      {showMap && <section className="schedule-map-panel">
        <nav className="live-map-territories" aria-label="Focus map on territory"><button onClick={reset} aria-pressed={scope === 'ALL'}>All</button>{territoryOrder.filter(code => code !== 'UNK' || groups.some(group => group.code === code)).map(code => <button key={code} className={`territory-${code.toLowerCase()}`} aria-label={`Focus ${territoryLabels[code]}`} aria-pressed={scope === code} onClick={() => focusTerritory(code)} title={territoryLabels[code]}>{code}<small>{regions.filter(region => region.code === code).length}</small></button>)}</nav>
        <div className="schedule-map-canvas">
          <ScheduleMap appointments={visible} trucks={snapshot.fleet.isToday ? snapshot.fleet.trucks : []} selected={selectedId} selectedTruck={selectedTruck} scope={scope} resetKey={mapResetKey} date={date} onSelect={selectAppointment} onSelectTruck={selectTruck} />
          <div className="map-focus-chip"><span>{filtered ? 'Filtered View' : 'Operating Footprint'}</span><strong>{selectedTruck || (scope === 'ALL' ? 'All Territories' : territoryLabels[scope.split(':')[0]] || scope)}</strong>{(filtered || selectedId || selectedTruck) && <div className="map-focus-actions"><button onClick={reset}>Reset</button></div>}</div>
          <div className="map-operation-summary"><span>{visible.length} appointments</span><span>{visible.filter(job => job.location).length} verified pins</span></div>
        </div>
        <aside className="schedule-map-controls">{!selectedTruck && !selected && <><div><span className="section-kicker">{snapshot.fleet.isToday ? 'Live Map' : 'Planning Map'}</span><h2>{snapshot.fleet.isToday ? 'Dispatch Positions' : 'Appointment Coverage'}</h2></div>
          <div className="live-map-help">{mapOnly ? 'Select an appointment or truck pin for details. Escape resets the map.' : 'Select a pin or truck row for details. Escape resets the map.'}</div></>}
          {selectedTruck ? <section className="live-map-truck-details" aria-label={`${selectedTruck} details`}>
            <header><strong>{selectedTruck}</strong><button aria-label="Clear truck selection" onClick={() => setSelectedTruck(null)}>×</button></header>
            <dl><div><dt>Krewe</dt><dd>{[truckDetails?.driver, truckDetails?.navigator].filter(Boolean).join(' · ') || (truckJobs[0] ? crew(truckJobs[0]) : 'Crew Not Available')}</dd></div><div><dt>Status</dt><dd>{truckDetails?.operationalStatus || 'Not Available'} · {truckDetails?.serviceStatus || 'Service Status Not Available'}</dd></div><div><dt>GPS</dt><dd>{truckDetails?.lastGpsUpdate ? new Date(truckDetails.lastGpsUpdate).toLocaleString('en-US', { timeZone: 'America/Chicago' }) : 'No GPS Timestamp'} · {truckDetails?.lastGpsUpdate ? truckGpsLabel : 'Position Unavailable'}</dd></div></dl>
            {!snapshot.fleet.isToday && <p>Planning day: current GPS is not a planned origin.</p>}
            {(!truckDetails || truckDetails.latitude === null || truckDetails.longitude === null) && <p>No verified position is available for this truck.</p>}
            <div className="live-map-truck-actions"><a href={`/desktop?data=live&workspace=Fleet&date=${date}&truck=${encodeURIComponent(selectedTruck)}`}>Open Fleet Record</a>{/^Truck \d+$/.test(selectedTruck) && <Button size="sm" data-truck-camera={Number(selectedTruck.replace('Truck ', ''))} aria-label={`View live video for ${selectedTruck}`}>View LinxUp Live Video</Button>}{truckDetails?.latitude != null && truckDetails?.longitude != null && <a href={`https://www.google.com/maps/search/?api=1&query=${truckDetails.latitude},${truckDetails.longitude}`} target="_blank" rel="noopener noreferrer">Open GPS in Maps</a>}</div>
            <div className="live-map-truck-jobs"><strong>{truckJobs.length} appointments</strong>{truckJobs.map(job => <button key={job.recordId} onClick={() => selectAppointment(job.recordId)}>{job.jkNumber} · {job.appointmentTime} · {appointmentStatus(job)}</button>)}</div>
          </section> : selected ? <section className="route-intelligence-panel" aria-label={`Closest trucks to ${selected.jkNumber}`}>
            <header><div><span>Closest Trucks</span><strong>{selected.jkNumber} · {appointmentRegion(selected).area}</strong></div><div><button onClick={() => setDrawerId(selected.recordId)}>Open</button><button aria-label="Clear route comparison" onClick={() => setSelectedId(null)}>×</button></div></header>
            <div className="route-candidate-list">{routeState ? <p>{routeState}</p> : routing?.appointmentId === selectedId && routing.closest.map((candidate, index) => <div className={`route-candidate-row ${candidate.status === 'available' ? 'clear' : 'unavailable'}`} key={candidate.truck}><span className="route-rank">{candidate.minutes !== null ? index + 1 : '—'}</span><div><strong>{truckLabel(candidate.truck)}</strong><small>{candidate.status === 'available' ? 'From Recent GPS' : candidate.status.replaceAll('_', ' ')}</small></div><div><b>{candidate.minutes !== null ? `${candidate.minutes} min · ${candidate.miles} mi` : 'Unavailable'}</b><small>{candidate.gpsUpdatedAt ? new Date(candidate.gpsUpdatedAt).toLocaleTimeString('en-US', { timeZone: 'America/Chicago', hour: 'numeric', minute: '2-digit' }) : 'No GPS Timestamp'}</small></div></div>)}</div>
            <footer>Google traffic estimate · Distance ranking only; availability, load, and schedule must be checked before assigning.</footer>
          </section> : <div className="map-status-list"><span><i className={snapshot.fleet.isToday ? 'healthy' : 'warning'} />{snapshot.fleet.isToday ? 'Truck markers show GPS; amber marks last-known positions' : 'Planning day · Current GPS is not a planned truck origin'}</span><span>{visible.filter(job => !job.location).length} appointments need verified coordinates</span><span>Overlapping pins spread apart; dotted lines point to their actual locations.</span></div>}
        </aside>
      </section>}
      {!mapOnly && <div className="schedule-board-shell"><div className="section-title"><div><span className="section-kicker">{day === 'today' ? 'Today' : 'Tomorrow'} · JunkWare Snapshot</span><h2>Truck Schedule</h2></div><div className="schedule-board-actions"><span className="schedule-drag-help"><GripVertical size={13} />Drag Appointment → Truck + Time</span></div></div>
        <div className="schedule-board-scroll"><div className={`schedule-board ${truckNames.length >= 10 ? 'ultra' : truckNames.length >= 7 ? 'compact' : 'comfortable'}`} style={{ '--schedule-hour-count': ticks.length } as CSSProperties}>
          <div className="schedule-time-row" style={{ gridTemplateColumns: `104px repeat(${ticks.length}, minmax(0, 1fr))` }}><span>Route</span>{ticks.map(tick => <span key={tick}>{clock(tick)}</span>)}</div>
          {date === today && progress >= 0 && progress <= 1 && <div className="schedule-now-line" style={{ left: `calc(${progress * 100}% + ${(1 - progress) * 104}px)` }} aria-label={`Current time ${clock(nowMinutes)}`}><span>{clock(nowMinutes)}</span></div>}
          {truckNames.map((truck, index) => {
            const rowJobs = jobs.filter(job => truckLabel(job.truck) === truck).sort((a, b) => (a.appointmentStartMinutes ?? Infinity) - (b.appointmentStartMinutes ?? Infinity));
            const lanes: number[] = [];
            const placed = rowJobs.flatMap(job => { const position = timelinePlacement(job, range); if (!position) return []; let lane = lanes.findIndex(end => end <= job.appointmentStartMinutes!); if (lane < 0) lane = lanes.length; lanes[lane] = job.appointmentEndMinutes!; return [{ job, position, lane }]; });
            const laneCount = Math.max(1, lanes.length);
            const ghost = drag.preview?.truck === truck ? drag.preview : null;
            const ghostStart = ghost?.start ?? ghost?.job.appointmentStartMinutes;
            const ghostDuration = ghost?.job.appointmentStartMinutes !== null && ghost?.job.appointmentEndMinutes != null ? ghost.job.appointmentEndMinutes - ghost.job.appointmentStartMinutes! : 60;
            return <div className="schedule-truck-row" data-schedule-truck={truck} key={truck} style={{ flex: laneCount }}><button type="button" className="schedule-truck-cell" aria-label={`Select ${truck} on map`} aria-pressed={selectedTruck === truck} onClick={() => selectTruck(truck)}><i className={['blue', 'red', 'gold', 'purple'][index % 4]} /><strong>{truck}</strong><span>{rowJobs[0] ? crew(rowJobs[0]) : 'No Scheduled Work'}</span></button><div className="live-truck-timeline">
              {placed.map(({ job, position, lane }) => <div key={job.recordId} className={`schedule-appointment territory-${appointmentRegion(job).code.toLowerCase()} ${slug(appointmentCategory(job))} ${slug(appointmentStatus(job))}${filtered ? match(job) ? ' scope-match' : ' scope-muted' : ''}${selectedId === job.recordId ? ' route-selected' : ''}${drag.preview?.job.recordId === job.recordId ? ' is-dragging' : ''}`} style={{ left: `${position.left * 100}%`, width: `calc(${position.width * 100}% - 2px)`, top: `calc(${lane} * (100% - 14px) / ${laneCount} + 2px)`, height: `min(26px, calc((100% - 14px) / ${laneCount} - 4px))` }} role="group" tabIndex={0} aria-roledescription={isClosed(job) || assignmentNeedsVerification(job) || operationBusy ? undefined : "draggable appointment"} onPointerDown={event => drag.begin(event, job)} aria-label={`${job.jkNumber} · ${job.customerName} · ${job.appointmentTime} · ${appointmentStatus(job)}`} aria-description={scheduleMoveRestriction(job) || "Drag to change truck or time; click for appointment details."} onClick={() => { if (!drag.suppressClick.current) selectAppointment(job.recordId); }} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); selectAppointment(job.recordId); } }} title={`${job.jkNumber} · ${job.customerName} · ${job.appointmentTime} · ${appointmentRegion(job).label} · ${appointmentStatus(job)}${scheduleMoveRestriction(job) ? ` · ${scheduleMoveRestriction(job)}` : ""}`}>{!isClosed(job) && !assignmentNeedsVerification(job) && <GripVertical className="schedule-grip" size={9} aria-hidden="true" />}<em title={appointmentStatus(job)} className={`schedule-block-status status-${scheduleStatusTone(job)}`}>
                {scheduleStatusTone(job) === 'on-site' ? <i className="schedule-on-site-light" aria-hidden="true" /> : scheduleStatusTone(job) === 'completed' ? <Check size={12} strokeWidth={3} aria-hidden="true" /> : scheduleStatusTone(job) === 'canceled' ? <X size={12} strokeWidth={3} aria-hidden="true" /> : assignmentNeedsVerification(job) ? <LockKeyhole size={10} aria-hidden="true" /> : null}
                <span>{assignmentNeedsVerification(job) ? "Verify" : appointmentStatus(job)}</span></em></div>)}
              {displayLegs.filter(leg => truckLabel(leg.truck) === truck).map(leg => { const to = jobs.find(job => job.recordId === leg.toAppointmentId)!; const end = to?.appointmentStartMinutes; const gap = leg.gapMinutes; if (end == null || gap === null || gap <= 0) return null; return <div key={`${leg.fromAppointmentId}:${leg.toAppointmentId}`} className={`schedule-route-leg ${leg.bufferMinutes !== null && leg.bufferMinutes < 0 ? 'late' : leg.travelMinutes === null ? 'unavailable' : 'clear'}`} style={{ left: `${(end - gap - range.start) / range.duration * 100}%`, width: `${gap / range.duration * 100}%` }} title={`${leg.fromJk} → ${leg.toJk}: ${leg.travelMinutes === null ? unavailableRoute(leg, jobs).detail : `${leg.travelMinutes} minutes · ${leg.miles} miles · ${leg.bufferMinutes} minute window gap after travel`}`}><strong>{leg.travelMinutes === null ? unavailableRoute(leg, jobs).label : `${leg.travelMinutes}m · ${leg.miles}mi`}</strong></div>; })}
              {ghost && ghostStart != null && <div className={`schedule-drag-preview${ghost.conflicts.length ? ' conflict' : ''}`} style={{ left: `${(ghostStart - range.start) / range.duration * 100}%`, width: `${ghostDuration / range.duration * 100}%` }}><strong>{ghost.job.jkNumber}</strong><small>{clock(ghostStart)} · {ghost.conflicts.length ? `Conflicts ${ghost.conflicts.join(', ')}` : 'Drop to Review'}</small></div>}
            </div></div>;
          })}
        </div></div>
      </div>}
      {dragNotice && <div className="schedule-drag-notice" role="status"><span>{dragNotice}</span><button type="button" aria-label="Dismiss drag notice" onClick={() => setDragNotice('')}>×</button></div>}
      {pendingMove && <MoveConfirmation key={`${pendingMove.job.recordId}:${pendingMove.truck}:${pendingMove.start}`} move={pendingMove} date={date} cancel={() => setPendingMove(null)} saved={refresh} onBusyChange={onOperationBusyChange} />}
    </div>
    {mapOnly && <div className="live-schedule-status">{snapshot.observedAt ? `Appointments updated ${new Date(snapshot.observedAt).toLocaleString('en-US', { timeZone: 'America/Chicago' })}` : 'Appointment update time unavailable'}</div>}
    {!mapOnly && <><div className="live-schedule-status">{snapshot.observedAt ? `JunkWare snapshot: ${new Date(snapshot.observedAt).toLocaleString('en-US', { timeZone: 'America/Chicago' })}` : 'JunkWare snapshot timestamp unavailable'} · {routeState || (displayLegs.length ? `${displayLegs.filter(leg => leg.source === 'google_live_traffic').length} of ${displayLegs.length} travel estimates available${routing?.calculatedAt ? ` · Calculated ${new Date(routing.calculatedAt).toLocaleTimeString('en-US', { timeZone: 'America/Chicago', hour: 'numeric', minute: '2-digit' })}` : ''}. Google current traffic; unavailable routes need verified locations and provider data.` : 'No consecutive assigned appointments to route.')} Appointment windows are not confirmed service durations.{jobs.some(job => !job.hasScheduledTime) && ` · ${jobs.filter(job => !job.hasScheduledTime).length} untimed appointments are listed below.`}</div>
    <ScheduleTravel legs={displayLegs} jobs={jobs} select={selectAppointment} />
    <section className="appointment-register"><div className="section-title appointment-register-title"><div><span className="section-kicker">{visible.length} Shown · {selectedTruck || (scope === 'ALL' ? 'All Territories' : territoryLabels[scope.split(':')[0]] || scope)}</span><h2>All Appointments</h2></div>{filtered && <Button variant="outline" size="sm" onClick={reset}>Show All {jobs.length}</Button>}</div>
      <nav className="appointment-territory-toolbar" aria-label="Prioritize territory"><span>Territory Order</span>{groups.map(group => <button key={group.code} className={priority === group.code ? 'active' : ''} onClick={() => { setScope('ALL'); setPriority(group.code); }} title={`Move ${group.label} to the top`}><i className={slug(group.label)} />{group.code}<small>{group.jobs.length}</small></button>)}<button className="reset-order" onClick={reset} disabled={!priority && !filtered}>Reset Order</button></nav>
      <div className="appointment-register-table" role="table" aria-label="All scheduled appointments">{[...groups].sort((a, b) => a.code === priority ? -1 : b.code === priority ? 1 : territoryOrder.indexOf(a.code) - territoryOrder.indexOf(b.code)).map(group => {
        const groupJobs = group.jobs.filter(region => match(region.job)); if (!groupJobs.length) return null;
        return <section className={`appointment-territory-group ${slug(group.label)}`} role="rowgroup" key={group.code}><div className="appointment-territory-heading"><div><i /><button onClick={() => focusTerritory(group.code)}>{group.code}</button><button className="territory-record-link" onClick={() => focusTerritory(group.code)}>{group.label}<ArrowRight size={11} /></button></div><span>{groupJobs.length} Appointments</span></div><div className="appointment-register-head" role="row"><span>Time</span><span>Appointment</span><span>Customer</span><span>Service Location</span><span>Assignment</span><span>Work</span><span>Status and Notes</span></div>
          {[...new Set(groupJobs.map(region => region.areaCode))].map(areaCode => { const areaJobs = groupJobs.filter(region => region.areaCode === areaCode); return <section className={`appointment-area-group ${areaCode.toLowerCase()}`} key={areaCode}><div className="appointment-area-heading"><div><button onClick={() => focusTerritory(`${group.code}:${areaCode}`)}>{areaCode}</button><button className="area-record-link" onClick={() => focusTerritory(`${group.code}:${areaCode}`)}>{areaJobs[0].area}<ArrowRight size={10} /></button></div><span>{areaJobs.length} Appointments</span></div>{areaJobs.map(({ job, area }) => { const leg = routeTo(job.recordId); return <article className={`appointment-register-row ${slug(appointmentStatus(job))}`} role="row" key={job.recordId}><div><strong>{job.appointmentTime || 'Time Not Set'}</strong><small>{appointmentCategory(job)}</small></div><div><button className="jk-record-link" onClick={() => selectAppointment(job.recordId)}>{job.jkNumber || 'JK Pending'}</button></div><div><strong>{job.customerName || 'Customer Unavailable'}</strong><Phone value={job.phone} /></div><div><Address value={job.address} /><small>{area}</small>{leg && <small className={`route-leg-inline${leg.bufferMinutes !== null && leg.bufferMinutes < 0 ? ' late' : ''}`}>{leg.travelMinutes === null ? unavailableRoute(leg, jobs).label : `${leg.travelMinutes} min · ${leg.miles} mi`} from {leg.fromJk}{leg.bufferMinutes !== null ? ` · ${leg.bufferMinutes < 0 ? `${Math.abs(leg.bufferMinutes)}m short` : `${leg.bufferMinutes}m window gap`}` : ''}</small>}</div><div><strong>{truckLabel(job.truck)}</strong><small>{crew(job)}</small>{assignmentNeedsVerification(job) && <small className="assignment-unverified">Assignment Not Verified</small>}</div><div><strong>{job.junkItems.join(' · ') || appointmentCategory(job)}</strong><small>{job.paymentAmount ? `${money(job.paymentAmount)} paid` : 'No Payment Recorded'}</small></div><div><span className={`appointment-state ${slug(appointmentStatus(job))}`}>{appointmentStatus(job)}</span><small>{appointmentStatus(job) === 'Canceled' ? job.cancellationReason : job.appointmentNotes.join(' · ')}</small></div></article>; })}</section>; })}
        </section>;
      })}{!visible.length && <div className="appointment-empty-state"><strong>{filtered ? 'No Appointments Match This View' : 'No Appointments In This Source Snapshot'}</strong>{filtered && <Button variant="outline" size="sm" onClick={reset}>Clear Filters</Button>}</div>}</div>
    </section></>}
    </>}
    {view === 'calendar' && <ScheduleCalendar date={date} openDate={value => onOpenDate?.(value)} />}
    {view === 'history' && <ScheduleHistory date={date} jobs={jobs} open={setDrawerId} />}
    {view === 'followup' && <ScheduleFollowup jobs={jobs} open={setDrawerId} />}
    {creationOpen && <AppointmentCreation date={date} appointments={jobs} close={() => { if (!operationBusyRef.current) setCreationOpen(false); }} saved={refresh} onBusyChange={onOperationBusyChange} />}
    {drawer && <><button className="record-drawer-backdrop" aria-label="Close appointment" disabled={operationBusy} onClick={() => setDrawerId(null)} /><aside className="record-drawer job-record-drawer" role="dialog" aria-modal="true" aria-labelledby="live-appointment-title" onKeyDown={event => { if (event.key !== 'Tab') return; const focusable = [...event.currentTarget.querySelectorAll<HTMLElement>('button, a[href], input, select, textarea, [tabindex="0"]')].filter(element => !element.hasAttribute('disabled')); const first = focusable[0], last = focusable[focusable.length - 1]; if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); } }}><header className="record-drawer-header"><div><span>{appointmentCategory(drawer)} · {appointmentStatus(drawer)}</span><h2 id="live-appointment-title">{drawer.jkNumber}</h2><p>{drawer.customerName}</p></div><Button ref={closeButton} variant="ghost" size="icon" aria-label="Close" disabled={operationBusy} onClick={() => setDrawerId(null)}><X /></Button></header><div className="record-drawer-body"><section className="drawer-facts" aria-label="Record details">{[
      ['Appointment ID', drawer.appointmentId || 'Unavailable'], ['Time', drawer.appointmentTime], ['Customer', drawer.customerName], ['Phone', <Phone key="phone" value={drawer.phone} />], ['Email', drawer.customerEmail || 'Not Recorded'], ['Address', <Address key="address" value={drawer.address} />], ['Truck', truckLabel(drawer.truck)], ['Krewe', crew(drawer)], ['Category', appointmentCategory(drawer)], ['Status', appointmentStatus(drawer)], ['Work', drawer.junkItems.join(' · ') || 'Not Recorded'], ['Payment', `${money(drawer.paymentAmount)} · ${drawer.paymentType || 'Method Not Recorded'}`], ['Tip', money(drawer.tipAmount)], ['Notes', drawer.appointmentNotes.join(' · ') || 'No Notes'],
    ].map(([label, value]) => <div key={String(label)}><span>{label}</span><strong>{value || 'Unavailable'}</strong></div>)}</section><ScheduleControls key={drawer.recordId} job={drawer} date={date} trucks={truckNames} saved={refresh} onBusyChange={onOperationBusyChange} onMove={proposal => { setPendingMove(scheduleMoveProposal(proposal.job, proposal.truck, proposal.start, jobs)); setDrawerId(null); }} /><AppointmentCloseout job={drawer} date={date} saved={refresh} onBusyChange={onOperationBusyChange} /></div><footer className="record-drawer-actions"><Button variant="outline" disabled={operationBusy} onClick={() => setDrawerId(null)}>Close</Button>{safeSourceHref(drawer) && <Button onClick={() => window.open(safeSourceHref(drawer)!, '_blank', 'noopener,noreferrer')}>Open in JunkWare <ArrowRight /></Button>}</footer></aside></>}
  </section></TruckCameraController>;
}
