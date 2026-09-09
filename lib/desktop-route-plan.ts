import {osmTravelMatrix} from './osm-travel-matrix';
import { type RoadMatrixElement, type Coordinates } from './job-route-proximity';
import { planEligible, proposeRoutes, routeCandidates, routePlanSourceKey, routeAreas, type PlanOptions, type PlanRoute, type RoutePlan, type PlanStop } from '../desktop-ui/lib/route-plan';
import { appointmentRegion, scheduleTruckNames, type ScheduleSnapshot } from '../desktop-ui/lib/schedule-contract';

export class RoutePlanInputError extends Error {}
const bad = (message: string): never => { throw new RoutePlanInputError(message); };
export function parsePlanOptions(value: unknown, snapshot: ScheduleSnapshot): PlanOptions {
  if (!value || typeof value !== 'object') return bad('Choose trucks and planning assumptions.');
  const v = value as Record<string, unknown>;
  const names = scheduleTruckNames(snapshot).filter(t=>t!=='Unassigned');
  if (!Array.isArray(v.trucks) || !v.trucks.length || v.trucks.length>12 || new Set(v.trucks).size!==v.trucks.length || v.trucks.some(t=>typeof t!=='string'||!names.includes(t))) return bad('Choose 1–12 available trucks.');
  if (typeof v.area!=='string' || !Object.hasOwn(routeAreas,v.area)) return bad('Choose a route area.');
  if (!Number.isInteger(v.start) || Number(v.start)<0 || Number(v.start)>1439 || !Number.isInteger(v.serviceMinutes) || Number(v.serviceMinutes)<5 || Number(v.serviceMinutes)>240) return bad('Enter a start time and 5–240 assumed service minutes per stop.');
  const options: PlanOptions = { trucks:v.trucks,area:v.area,start:Number(v.start),serviceMinutes:Number(v.serviceMinutes) };
  const candidates = routeCandidates(snapshot.appointments,options);
  if (candidates.length>80) return bad('Limit this proposal to 80 appointments by selecting fewer trucks.');
  if (v.routes!==undefined) {
    if (!Array.isArray(v.routes) || v.routes.length!==options.trucks.length) return bad('Every selected truck must have one proposed route.');
    const routes = v.routes as PlanRoute[];
    if (routes.some(r=>!r || !options.trucks.includes(r.truck) || !Array.isArray(r.appointmentIds) || r.appointmentIds.some(id=>typeof id!=='string')) || new Set(routes.map(r=>r.truck)).size!==routes.length) return bad('Invalid proposed route.');
    const ids = routes.flatMap(r=>r.appointmentIds);
    if (ids.length!==candidates.length || new Set(ids).size!==ids.length || ids.some(id=>!candidates.some(j=>j.recordId===id))) return bad('The proposal must include every eligible appointment exactly once. Rebuild the proposal.');
    options.routes = routes;
  }
  return options;
}
type Provider = (origins: Coordinates[], destinations: Coordinates[])=>Promise<RoadMatrixElement[]|null>;
const cache = new Map<string,{expires:number; value:Promise<{minutes:number;miles:number}|null>}>();
async function roadLeg(from: Coordinates, to: Coordinates, provider: Provider) {
  const key=JSON.stringify([from,to]); const cached=cache.get(key);
  if (provider===osmTravelMatrix && cached && cached.expires>Date.now()) return cached.value;
  const value=provider([from],[to]).then(matrix=>{
    const row=matrix?.find(r=>(r.originIndex??0)===0&&(r.destinationIndex??0)===0);
    const seconds = row && typeof row.duration==='string' && /^\d+(?:\.\d+)?s$/.test(row.duration) ? Number(row.duration.slice(0,-1)) : NaN;
    if (!row || row.status?.code || row.condition!=='ROUTE_EXISTS' || !Number.isFinite(seconds) || seconds<0 || typeof row.distanceMeters!=='number' || !Number.isFinite(row.distanceMeters) || row.distanceMeters<0) return null;
    return {minutes:Math.ceil(seconds/60),miles:Math.round(row.distanceMeters/1609.344*10)/10};
  }).catch(()=>null);
  if (provider===osmTravelMatrix) {
    for (const [k,v] of cache) if (v.expires<=Date.now()) cache.delete(k);
    if (cache.size>=512) cache.delete(cache.keys().next().value!);
    cache.set(key,{expires:Date.now()+120_000,value});
  }
  return value;
}
export async function buildRoutePlan(snapshot: ScheduleSnapshot, options: PlanOptions, provider: Provider=osmTravelMatrix): Promise<RoutePlan> {
  const routes=options.routes||proposeRoutes(snapshot.appointments,options);
  const byId=new Map(snapshot.appointments.map(j=>[j.recordId,j]));
  const planned=routes.map(route=>({...route,stops:route.appointmentIds.map(id=>({id,arrival:null,travelMinutes:null,miles:null,warnings:[]} as PlanStop))}));
  const pairs=planned.flatMap(route=>route.stops.slice(1).map((stop,i)=>({stop,from:byId.get(route.stops[i].id)!,to:byId.get(stop.id)!})));
  // One road request per adjacent pair, with shared rate limiting. Same-window stops
  // are separate pairs; no N x N matrix and no straight-line ETA fallback.
  for(let offset=0;offset<pairs.length;offset+=4) await Promise.all(pairs.slice(offset,offset+4).map(async ({stop,from,to})=>{
    if (!from.location||!to.location) { stop.warnings.push('Verify Address'); return; }
    const leg=await roadLeg(from.location,to.location,provider);
    if (leg) {stop.travelMinutes=leg.minutes;stop.miles=leg.miles;} else stop.warnings.push('Travel Unavailable');
  }));
  for(const route of planned) {
    let previousDeparture: number|null=options.start;
    for(let i=0;i<route.stops.length;i++) {
      const stop=route.stops[i]; const job=byId.get(stop.id)!; const previous=i ? byId.get(route.stops[i-1].id)! : null;
      const region = appointmentRegion(job);
      if (region.mismatch) stop.warnings.push('Service Territory Differs From JunkWare Franchise');
      const serviceArea = ['NO', 'JP', 'NS'].includes(region.code) ? 'metro' : region.code;
      if (serviceArea !== options.area) stop.warnings.push('Existing Assignment Outside Selected Route Area');
      if (!job.location && !stop.warnings.includes('Verify Address')) stop.warnings.push('Verify Address');
      if (job.appointmentStartMinutes===null || job.appointmentEndMinutes===null) stop.warnings.push('Time Not Set');
      if (previous && job.appointmentStartMinutes!==null && job.appointmentEndMinutes!==null && previous.appointmentStartMinutes!==null && previous.appointmentEndMinutes!==null && job.appointmentStartMinutes<previous.appointmentEndMinutes && previous.appointmentStartMinutes<job.appointmentEndMinutes) stop.warnings.push('Overlapping Windows');
      const earliest: number|null = previousDeparture===null || i>0 && stop.travelMinutes===null ? null : previousDeparture + (stop.travelMinutes??0);
      stop.arrival=earliest===null ? null : Math.max(earliest,job.appointmentStartMinutes??0);
      if (stop.arrival!==null && job.appointmentEndMinutes!==null && stop.arrival>job.appointmentEndMinutes) stop.warnings.push(`${stop.arrival-job.appointmentEndMinutes} Min Late`);
      if (stop.arrival!==null && stop.arrival>=1440) stop.warnings.push('Next Day');
      previousDeparture=stop.arrival===null ? null : stop.arrival+options.serviceMinutes;
    }
  }
  return {sourceKey:routePlanSourceKey(snapshot.appointments),calculatedAt:new Date().toISOString(),routes:planned,excluded:snapshot.appointments.filter(j=>!planEligible(j)).length};
}
