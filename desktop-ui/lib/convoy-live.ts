import type { DesktopFleetSnapshot, DesktopFleetTruck } from './people-fleet-contract';
import { sameTruck } from './convoy-presentation';

export type LiveGroup = 'moving' | 'idle' | 'parked' | 'offline' | 'out';
export type AttentionKind = 'out_of_service' | 'gps' | 'fuel' | 'inspection' | 'service' | 'scheduled';
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
    if (stop.length) items.push({ key: `stop:${t.id}`, kind: 'out_of_service', truckId: t.id, truck: name(t), title: 'Out of service', detail: stop[0].title || 'Active out-of-service repair' });
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
