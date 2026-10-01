import fs from 'node:fs';
import path from 'node:path';
import { truckLabel } from '../desktop-ui/lib/schedule-contract';

export type RouteOrderConfirmation = {
  truck: string;
  appointmentId: string;
  afterAppointmentId: string;
  confirmedAt: string;
  confirmationSource: string;
  note: string;
};

type RouteJob = {
  appointmentId: string;
  truck: string;
  status: string;
  appointmentStartMinutes: number | null;
  routeOrder?: number;
  routeAfterAppointmentId?: string;
  routeAfterLabel?: string;
  routePlacementMinutes?: number;
  customerName: string;
  jkNumber: string;
  truckVisits?: Array<{ truck: string; arrival: string; departure: string | null; observedThrough: string }>;
};

const directory = () => process.env.SCHEDULE_ROUTE_ORDER_DIR
  || path.join(process.env.OPSBOT_DATA_DIR || process.cwd(), 'schedule-route-order');
const fileFor = (date: string) => path.join(directory(), `${date}.json`);
const minute = (value: string) => {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(value)).map(part => [part.type, part.value]));
  return Number(parts.hour) * 60 + Number(parts.minute) + Number(parts.second) / 60;
};

export function readRouteOrderConfirmations(date: string): RouteOrderConfirmation[] {
  try {
    const value = JSON.parse(fs.readFileSync(fileFor(date), 'utf8'));
    if (value.date !== date || !Array.isArray(value.confirmations)) return [];
    return value.confirmations.filter((row: RouteOrderConfirmation) =>
      /^Truck [1-9]\d*$/.test(truckLabel(row?.truck || ''))
      && typeof row?.appointmentId === 'string' && !!row.appointmentId
      && typeof row?.afterAppointmentId === 'string' && !!row.afterAppointmentId
      && row.appointmentId !== row.afterAppointmentId
    );
  } catch { return []; }
}

const firstVisit = (job: RouteJob) => Math.min(...(job.truckVisits || [])
  .filter(visit => truckLabel(visit.truck) === truckLabel(job.truck))
  .map(visit => Date.parse(visit.arrival)).filter(Number.isFinite));
const lastVisit = (job: RouteJob) => Math.max(...(job.truckVisits || [])
  .filter(visit => truckLabel(visit.truck) === truckLabel(job.truck))
  .map(visit => Date.parse(visit.departure || visit.observedThrough)).filter(Number.isFinite));

/** Operational order confirmations change only route projection. They never
 * rewrite source windows, truck assignments, completion, or GPS history. */
export function applyRouteOrderConfirmations<T extends RouteJob>(date: string, jobs: T[]): T[] {
  const confirmations = readRouteOrderConfirmations(date);
  if (!confirmations.length) return jobs;
  const result = jobs.map(job => ({ ...job }));
  for (const truck of [...new Set(confirmations.map(row => truckLabel(row.truck)))]) {
    const rows = result.filter(job => truckLabel(job.truck) === truck && !/cancel/i.test(job.status));
    const relevant = confirmations.filter(row => truckLabel(row.truck) === truck
      && rows.some(job => job.appointmentId === row.appointmentId)
      && rows.some(job => job.appointmentId === row.afterAppointmentId));
    if (!relevant.length) continue;
    rows.sort((a, b) => {
      const aVisit = firstVisit(a), bVisit = firstVisit(b);
      const aTime = Number.isFinite(aVisit) ? minute(new Date(aVisit).toISOString()) : (a.appointmentStartMinutes ?? Infinity);
      const bTime = Number.isFinite(bVisit) ? minute(new Date(bVisit).toISOString()) : (b.appointmentStartMinutes ?? Infinity);
      return aTime - bTime || a.appointmentId.localeCompare(b.appointmentId, undefined, { numeric: true });
    });
    for (const confirmation of relevant) {
      const item = rows.find(job => job.appointmentId === confirmation.appointmentId)!;
      const after = rows.find(job => job.appointmentId === confirmation.afterAppointmentId)!;
      rows.splice(rows.indexOf(item), 1);
      rows.splice(rows.indexOf(after) + 1, 0, item);
      item.routeAfterAppointmentId = after.appointmentId;
      item.routeAfterLabel = `${after.jkNumber} · ${after.customerName}`;
      const boundary = lastVisit(after);
      if (Number.isFinite(boundary)) item.routePlacementMinutes = minute(new Date(boundary).toISOString());
    }
    rows.forEach((job, index) => { job.routeOrder = index; });
  }
  return result;
}
