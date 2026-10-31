import type { DesktopFleetSnapshot, DesktopFleetTruck } from './people-fleet-contract';
import { sameTruck } from './convoy-presentation';
import { isClosed, truckLabel, type ScheduleAppointment } from './schedule-contract';
import { nextTruckStop } from '../../lib/schedule-next-stop';

export type LiveGroup = 'moving' | 'idle' | 'parked' | 'offline' | 'out';
export type AttentionKind = 'out_of_service' | 'no_inspection' | 'gps' | 'fuel' | 'inspection' | 'service' | 'scheduled';
export type AttentionItem = { key: string; kind: AttentionKind; truckId: string; truck: string; title: string; detail: string };

export const LOW_FUEL_PERCENT = 25;

/** Bucket a truck by what it is doing right now; Out of service always wins. */
export function liveGroup(truck: DesktopFleetTruck, outOfService: boolean): LiveGroup {
  if (outOfService || truck.readiness === 'Out of service') return 'out';
  const status = truck.operatingStatus;
  if (status === 'Driving') return 'moving';
  if (status === 'Idle') return 'idle';
  if (status === 'Parked' || status === 'Stopped') return 'parked';
  return 'offline';
}

/** True when the truck's own GPS status says it is reporting. Independent of the out-of-service bucket. */
export const gpsReporting = (truck: Pick<DesktopFleetTruck, 'operatingStatus'>) => !['GPS Stale', 'Offline', 'GPS unavailable', 'Historical GPS'].includes(truck.operatingStatus);

const finite = (value: number | null | undefined): value is number => typeof value === 'number' && Number.isFinite(value);

export function fleetDayTotals(trucks: DesktopFleetTruck[]) {
  const sum = (pick: (t: DesktopFleetTruck) => number | null) => {
    const values = trucks.map(pick).filter(finite);
    return values.length ? values.reduce((a, b) => a + b, 0) : null;
  };
  return { jobs: sum(t => t.jobs), revenue: sum(t => t.revenue), miles: sum(t => t.miles), idleMinutes: sum(t => t.idleMinutes) };
}

export function liveCounts(trucks: DesktopFleetTruck[], outIds: Set<string>) {
  const counts: Record<LiveGroup, number> = { moving: 0, idle: 0, parked: 0, offline: 0, out: 0 };
  for (const truck of trucks) counts[liveGroup(truck, outIds.has(truck.id))] += 1;
  return counts;
}

/** Ranked exceptions: most urgent first. Only recorded facts; unknown values are never flagged. */
export function attentionItems(snapshot: DesktopFleetSnapshot, trucks: DesktopFleetTruck[], isToday = true): AttentionItem[] {
  const items: AttentionItem[] = [];
  const name = (t: DesktopFleetTruck) => t.label.replace('Truck#', 'Truck');
  const active = snapshot.issues.filter(i => i.status !== 'resolved');
  for (const t of trucks) {
    const stop = active.filter(i => sameTruck(i.truck, t.id) && i.severity === 'out_of_service');
    if (stop.length) items.push({ key: `stop:${t.id}`, kind: 'out_of_service', truckId: t.id, truck: name(t), title: 'Out of Service', detail: stop[0].title || 'Active out-of-service repair' });
  }
  for (const t of isToday ? trucks : []) {
    if (['GPS Stale', 'Offline', 'GPS unavailable'].includes(t.operatingStatus))
      items.push({ key: `gps:${t.id}`, kind: 'gps', truckId: t.id, truck: name(t), title: t.operatingStatus === 'Offline' ? 'GPS offline' : 'GPS not reporting', detail: t.gpsAt ? 'Last report is more than a few minutes old' : 'No GPS report on record' });
  }
  for (const t of trucks) {
    if (t.fuel && finite(t.fuel.percent) && t.fuel.percent <= LOW_FUEL_PERCENT)
      items.push({ key: `fuel:${t.id}`, kind: 'fuel', truckId: t.id, truck: name(t), title: `Fuel ${Math.round(t.fuel.percent)}%`, detail: t.fuel.source === 'purchase' ? 'Estimated from last fill-up' : 'From latest inspection' });
  }
  for (const t of trucks) {
    if (t.inspectionStatus === 'In Use, No Inspection') {
      items.push({key:`use:${t.id}`,kind:'no_inspection',truckId:t.id,truck:name(t),title:'In Use, No Inspection',detail:'No submitted inspection for the operating day'});
      continue;
    }
    if (/missing|incomplete|not (started|completed)|overdue/i.test(t.checklist || ''))
      items.push({ key: `insp:${t.id}`, kind: 'inspection', truckId: t.id, truck: name(t), title: 'Inspection', detail: t.checklist });
  }
  const pastScheduled = snapshot.maintenance.filter(r => r.status === 'scheduled' && r.serviceDate < snapshot.date);
  for (const r of pastScheduled) {
    const t = trucks.find(x => sameTruck(r.truck, x.id));
    if (t) items.push({ key: `sched:${r.recordId}`, kind: 'scheduled', truckId: t.id, truck: name(t), title: 'Scheduled service passed', detail: `${r.serviceType} · completion not recorded` });
  }
  return items;
}

export type DueItem = { key: string; truckId: string; truck: string; serviceType: string; status: 'due' | 'soon'; milesRemaining: number | null; daysRemaining: number | null };
const dueDetail = (d: DueItem) => [
  d.milesRemaining != null ? `${Math.abs(Math.round(d.milesRemaining)).toLocaleString('en-US')} mi ${d.milesRemaining <= 0 ? 'past target' : 'remaining'}` : '',
  d.daysRemaining != null ? `${Math.abs(d.daysRemaining)} days ${d.daysRemaining <= 0 ? 'past target' : 'remaining'}` : '',
].filter(Boolean).join(' · ') || 'Check the service planner';
export { dueDetail };

export type StopKind = 'on_site' | 'at_job' | 'last_seen' | 'ambiguous' | 'unverified' | 'untimed' | 'next';
export type TruckJobs = { total: number; done: number; stop: { kind: StopKind; label: string } | null; isToday: boolean };

const clock = (minutes: number | null) => minutes == null ? '' : new Date(2000, 0, 1, Math.floor(minutes / 60), minutes % 60).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

/** Stops assigned to one truck, how many are closed, and the stop the Command next-stop rules pick today. */
export function truckJobs(appointments: ScheduleAppointment[], truck: string, isToday: boolean, now: number): TruckJobs {
  const mine = appointments.filter(a => !/cancel/i.test(a.status) && truckLabel(a.truck) === truckLabel(truck));
  const plan = nextTruckStop(appointments, truck, isToday, now);
  const stop = plan ? { kind: plan.state as StopKind, label: [clock(plan.job.appointmentStartMinutes), plan.job.customerName].filter(Boolean).join(' ') } : null;
  return { total: mine.length, done: mine.filter(a => isClosed(a)).length, stop, isToday };
}

/** One honest line per card. Presence claims need a GPS-reporting truck and a fresh schedule; unknown states are never shown as "Next". Past days show none. */
export function stopLine(jobs: TruckJobs, current: { gps: boolean; scheduleFresh: boolean }): string | null {
  if (!jobs.isToday) return null;
  const { stop } = jobs;
  if (!stop) return current.scheduleFresh ? 'No open stops' : 'Stops not confirmed · schedule not refreshed';
  const at = stop.label ? ` · ${stop.label}` : '';
  const suffix = current.scheduleFresh ? '' : ' · schedule not refreshed';
  switch (stop.kind) {
    case 'on_site': return (current.gps && current.scheduleFresh ? `On site${at}` : `Last reported on site${at}${current.gps ? '' : ' · GPS not reporting'}`) + suffix;
    case 'at_job': return (current.gps && current.scheduleFresh ? `At job${at}` : `Last reported at job${at}${current.gps ? '' : ' · GPS not reporting'}`) + suffix;
    case 'last_seen': return `Last seen at${at.replace(' ·', '')}${suffix}`;
    case 'ambiguous': return 'Check current stop in Command' + suffix;
    case 'unverified': return `Assignment unverified${at}${suffix}`;
    case 'untimed': return `Next, time not set${at}${suffix}`;
    default: return `Next${at}${suffix}`;
  }
}

/** Overview exceptions are actionable red facts; amber and unknown evidence stay in the board. */
export function overviewSummary(snapshot: DesktopFleetSnapshot, trucks: DesktopFleetTruck[], due: DueItem[], isToday: boolean) {
  const rank: Partial<Record<AttentionKind, number>> = { no_inspection: 0, out_of_service: 1, service: 2 };
  const attention = attentionItems(snapshot, trucks, isToday).filter(a => a.kind in rank);
  for (const t of trucks) {
    if (t.readiness === 'Out of service' && !attention.some(a => a.truckId === t.id && a.kind === 'out_of_service'))
      attention.push({key:`stop:${t.id}`, kind:'out_of_service', truckId:t.id, truck:t.label.replace('Truck#','Truck'), title:'Out of Service', detail:'Recorded out-of-service condition'});
  }
  attention.push(...due.filter(d => d.status === 'due').map(d => ({key:`due:${d.key}`, kind:'service' as const, truckId:d.truckId, truck:d.truck, title:`${d.serviceType} Due Now`, detail:dueDetail(d)})));
  attention.sort((a,b) => rank[a.kind]! - rank[b.kind]! || a.truck.localeCompare(b.truck, undefined, {numeric:true}) || a.key.localeCompare(b.key));
  const outIds = new Set(attention.filter(a => a.kind === 'out_of_service').map(a => a.truckId));
  const needIds = new Set(attention.filter(a => a.kind !== 'out_of_service').map(a => a.truckId));
  const counts = {ready:0, working:0, need:0, out:0};
  for (const t of trucks) {
    if (outIds.has(t.id)) counts.out++;
    else if (needIds.has(t.id)) counts.need++;
    else if (isToday && ['moving','idle'].includes(liveGroup(t,false))) counts.working++;
    else if (t.readiness === 'Ready') counts.ready++;
  }
  return {attention, counts, outIds};
}
