import { truckGpsStatus } from '../lib/truck-gps-status';
import { MetricValue } from './metric-value';
import { appointmentCategory, appointmentStatus, isClosed, scheduleDisplayTruck, scheduleTruckNames, truckLabel, type ScheduleSnapshot } from './lib/schedule-contract';

export function truckSummaries(snapshot: ScheduleSnapshot, now: number) {
  const trucks = scheduleTruckNames(snapshot).filter(name => name !== 'Unassigned');
  const summaries = trucks.map(truck => {
    const work = snapshot.appointments.filter(job => scheduleDisplayTruck(job) === truck && !/cancel/i.test(job.status));
    const jobs = work.filter(job => appointmentCategory(job) === 'Job');
    const completed = jobs.filter(job => appointmentStatus(job) === 'Completed');
    const revenue = completed.some(job => job.chargeDetailsPending || !job.closeout || !Number.isFinite(job.closeout.total) || !Number.isFinite(job.closeout.tip)) ? null : completed.reduce((sum, job) => sum + job.closeout!.total - job.closeout!.tip, 0);
    const telemetry = snapshot.fleet.trucks.find(row => truckLabel(row.truck) === truck);
    const gps = truckGpsStatus(telemetry, now);
    const status = work.length && work.every(isClosed) ? 'Done' : !snapshot.fleet.isToday ? 'Planned' : gps.stale ? 'Unavailable' : gps.status === 'Parked' ? 'Parked' : gps.status === 'Driving' ? 'On route' : gps.status;
    return { truck, appointments: work.length, jobs: jobs.length, completed: completed.length, revenue, status,
      route: [...new Set(work.map(job => job.territory).filter(Boolean))].join(' · ') || 'Route not recorded',
      crew: [...new Set(work.flatMap(job => [job.driver, job.navigator, ...(job.additionalCrew || [])]).filter(Boolean))].join(' · ') || 'Not recorded',
      observedAt: telemetry?.lastGpsUpdate,
    };
  });
  return { active: summaries.filter(row => row.appointments), off: summaries.filter(row => !row.appointments).length };
}
export function TruckSummaryStrip({ snapshot, now, select, disabled }: { snapshot: ScheduleSnapshot; now: number; select: (truck: string) => void; disabled?: boolean }) {
  const {active, off} = truckSummaries(snapshot,now);
  return <section className="truck-summary-strip" aria-label="Truck route summaries">{active.map(row => <button type="button" className="truck-summary-card" key={row.truck} onClick={() => select(row.truck)} disabled={disabled}>
    <header><strong>{row.truck}</strong><span title={row.observedAt ? `GPS observed ${row.observedAt}` : 'No current GPS observation'}><MetricValue value={row.status} /></span></header>
    <span className="truck-summary-route" title={row.route}>{row.route}</span>
    <div><strong><MetricValue value={row.revenue == null ? null : row.revenue.toLocaleString('en-US',{style:'currency',currency:'USD',maximumFractionDigits:0})} reason="Completed job charges are incomplete" /></strong><span>{row.completed}/{row.jobs} jobs done{row.appointments > row.jobs ? ` · ${row.appointments - row.jobs} estimates` : ''}</span></div>
    <small>Recorded charges · excludes tips</small><small title={row.crew}><MetricValue value={row.crew} reason="Crew names not recorded on the selected appointments" /></small>
  </button>)}{off > 0 && <span className="truck-off-chip" title="No active appointments in the selected schedule snapshot; this does not establish attendance">{off} off {snapshot.fleet.isToday ? 'today' : 'this day'}</span>}</section>;
}
