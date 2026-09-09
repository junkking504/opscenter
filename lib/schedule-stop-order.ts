// Shared by routing and timeline placement: a saved stack order never changes
// the truck or the booked start/end of an appointment.
export type OrderedStop = { recordId: string; version: string; truck: string; status: string; address: string; appointmentStartMinutes: number | null; appointmentEndMinutes: number | null; stopOrder?: number };
export const stopTruck = (value: string) => value.trim().replace(/^truck\s*#?\s*(\d+)$/i, 'Truck $1');
export const stopGroupKey = (job: OrderedStop) => JSON.stringify([stopTruck(job.truck), job.appointmentStartMinutes, job.appointmentEndMinutes]);
export function compareStops(a: Pick<OrderedStop,'recordId'|'appointmentStartMinutes'|'appointmentEndMinutes'|'stopOrder'>, b: Pick<OrderedStop,'recordId'|'appointmentStartMinutes'|'appointmentEndMinutes'|'stopOrder'>) {
  return ((a.appointmentStartMinutes ?? Infinity) - (b.appointmentStartMinutes ?? Infinity) || 0)
    || ((a.appointmentEndMinutes ?? Infinity) - (b.appointmentEndMinutes ?? Infinity) || 0)
    || ((a.stopOrder ?? Infinity) - (b.stopOrder ?? Infinity) || 0)
    || a.recordId.localeCompare(b.recordId, undefined, { numeric: true });
}
export function stopGroups<T extends OrderedStop>(jobs: T[]): T[][] {
  const groups = new Map<string,T[]>();
  for (const job of jobs) {
    if (!job.recordId.includes(':appointment:') || !job.truck || /unassigned|virtual|^—$|^(?:truck\s*)?0$/i.test(job.truck) || /cancel/i.test(job.status) || job.appointmentStartMinutes === null || job.appointmentEndMinutes === null) continue;
    const key = stopGroupKey(job);
    groups.set(key, [...(groups.get(key) || []), job]);
  }
  return [...groups.values()].filter(group => group.length > 1).map(group => group.sort(compareStops));
}
export function stopOrderSourceKey(jobs: OrderedStop[]) {
  // The fast feed and detailed feed format the same address differently.
  // Protect the inputs this operation changes/uses, without treating notes,
  // payments or a cosmetic address refresh as a competing stop-order edit.
  const addressKey = (address: string) => address.toLowerCase().replace(/[.,]/g,' ').replace(/\b(?:la|louisiana)\s+(?=\d{5}\b)/g,'').replace(/\s+/g,' ').trim();
  return JSON.stringify([...jobs].sort((a,b)=>a.recordId.localeCompare(b.recordId)).map(job=>[job.recordId,stopGroupKey(job),/cancel/i.test(job.status),addressKey(job.address),job.stopOrder ?? null]));
}
export function isStopPermutation(jobs: OrderedStop[], ids: unknown): ids is string[] {
  return Array.isArray(ids) && ids.length === jobs.length && new Set(ids).size === ids.length && ids.every(id=>typeof id === 'string' && jobs.some(job=>job.recordId === id));
}
