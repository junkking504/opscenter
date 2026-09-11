import { appointmentRegion, isClosed, assignmentNeedsVerification, truckLabel, type ScheduleAppointment } from './schedule-contract';

export type PlanRoute = { truck: string; appointmentIds: string[] };
export type PlanOptions = { trucks: string[]; area: string; start: number; serviceMinutes: number; routes?: PlanRoute[] };
export type PlanStop = { id: string; arrival: number | null; travelMinutes: number | null; miles: number | null; warnings: string[] };
export type RoutePlan = { sourceKey: string; calculatedAt: string; routes: Array<PlanRoute & { stops: PlanStop[] }>; excluded: number };
export const routeAreas = { metro: 'New Orleans · Jefferson Parish · Northshore', RP: 'River Parishes', BR: 'Baton Rouge', LF: 'Lafayette' };
export function routePlanSourceKey(jobs: ScheduleAppointment[]) {
  return JSON.stringify(jobs.map(j => [j.recordId, j.version, j.stopOrder, j.address, j.location, appointmentRegion(j), j.junkwareSyncStatus]).sort((a,b)=>String(a[0]).localeCompare(String(b[0]))));
}
export function planEligible(job: ScheduleAppointment) { return !isClosed(job) && !assignmentNeedsVerification(job) && Boolean(job.appointmentId) && !appointmentRegion(job).needsReview; }
export function routeArea(job: ScheduleAppointment) { const code = appointmentRegion(job).code; return ['NO','JP','NS'].includes(code) ? 'metro' : code; }
export function routeCandidates(jobs: ScheduleAppointment[], options: PlanOptions) {
  return jobs.filter(j => planEligible(j) && (options.trucks.includes(truckLabel(j.truck)) || truckLabel(j.truck) === 'Unassigned' && routeArea(j) === options.area));
}
// Geographic proximity is only a tie-break for the proposal, never a road
// distance or a travel-time estimate. The road provider supplies every displayed road leg.
function proximity(a?: ScheduleAppointment, b?: ScheduleAppointment) {
  if (!a?.location || !b?.location) return Infinity;
  const lat = (a.location.latitude + b.location.latitude) * Math.PI / 360;
  return Math.hypot(a.location.latitude-b.location.latitude, (a.location.longitude-b.location.longitude)*Math.cos(lat));
}
function ordered(jobs: ScheduleAppointment[]) {
  const remaining = [...jobs]; const result: ScheduleAppointment[] = [];
  while (remaining.length) {
    remaining.sort((a,b) => (a.appointmentStartMinutes ?? 1440)-(b.appointmentStartMinutes ?? 1440)
      || (proximity(result.at(-1),a)-proximity(result.at(-1),b) || 0) || a.recordId.localeCompare(b.recordId,undefined,{numeric:true}));
    result.push(remaining.shift()!);
  }
  return result;
}
export function proposeRoutes(jobs: ScheduleAppointment[], options: PlanOptions): PlanRoute[] {
  const eligible = routeCandidates(jobs, options);
  const groups = options.trucks.map(truck => ({ truck, jobs: eligible.filter(j=>truckLabel(j.truck)===truck) }));
  const unassigned = ordered(eligible.filter(j=>truckLabel(j.truck)==='Unassigned'));
  // Seed empty trucks in different geographic clusters, then keep nearby work
  // together. Existing assigned stops are anchors, never silently redistributed.
  for (const group of groups.filter(g=>!g.jobs.length)) {
    if (!unassigned.length) break;
    const anchors=groups.flatMap(g=>g.jobs).filter(j=>j.location);
    const seed=anchors.length ? [...unassigned].filter(j=>j.location).sort((a,b)=>Math.min(...anchors.map(j=>proximity(j,b)))-Math.min(...anchors.map(j=>proximity(j,a))) || a.recordId.localeCompare(b.recordId))[0] : unassigned[0];
    const selected=seed||unassigned[0];group.jobs.push(selected);unassigned.splice(unassigned.indexOf(selected),1);
  }
  for (const job of unassigned) {
    const score=(group: typeof groups[number])=>Math.min(...group.jobs.map(anchor=>proximity(anchor,job))) + group.jobs.length*0.015;
    // Geography must not put nine new stops on one truck and leave the other
    // with one distant stop. Bound new work by an equal-share stop count;
    // pre-existing assignments are preserved even when already over that cap.
    const capacity=Math.ceil(eligible.length/groups.length);
    const available=groups.filter(g=>g.jobs.length<capacity);
    const target = [...(available.length?available:groups)].sort((a,b) => (score(a)-score(b) || 0) || a.jobs.length-b.jobs.length || a.truck.localeCompare(b.truck))[0];
    if (target) target.jobs.push(job);
  }
  return groups.map(group=>({truck:group.truck,appointmentIds:ordered(group.jobs).map(j=>j.recordId)}));
}
export function adjustRoute(routes: PlanRoute[], id: string, truck: string, direction = 0): PlanRoute[] {
  const result = routes.map(r=>({...r,appointmentIds:[...r.appointmentIds]}));
  const from = result.find(r=>r.appointmentIds.includes(id)); const to = result.find(r=>r.truck===truck);
  if (!from || !to) return result;
  const index = from.appointmentIds.indexOf(id);
  if (from === to) {
    const next = index + direction;
    if (next>=0 && next<from.appointmentIds.length) [from.appointmentIds[index],from.appointmentIds[next]]=[from.appointmentIds[next],from.appointmentIds[index]];
  } else { from.appointmentIds.splice(index,1); to.appointmentIds.push(id); }
  return result;
}
