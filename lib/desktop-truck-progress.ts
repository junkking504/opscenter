import { nextTruckStop, freshTruckGps, truckProgressGpsState, type TruckProgress } from './schedule-next-stop';
import { osmTravelMatrix } from './osm-travel-matrix';
import { truckLabel, type ScheduleTruck } from '../desktop-ui/lib/schedule-contract';
import type { DesktopAppointment } from './desktop-schedule';

export async function calculateTruckProgress(jobs:DesktopAppointment[], trucks:ScheduleTruck[], isToday:boolean, provider= osmTravelMatrix, now=Date.now()):Promise<TruckProgress[]> {
  if (!isToday) return [];
  const results:TruckProgress[]=[];
  const names=[...new Set([...trucks.map(t=>truckLabel(t.truck)),...jobs.map(j=>truckLabel(j.truck))])];
  // At most one current-position route per truck, through the existing shared
  // road-provider limiter. This never assigns a truck or confirms a destination.
  for (const name of names) {
    const plan=nextTruckStop(jobs,name,true,now);
    if (!plan) continue;
    const truck=trucks.find(t=>truckLabel(t.truck)===name);
    let status=plan.state;
    if (status==='on_site' && !freshTruckGps(truck,now)) status='last_seen';
    const gpsState=truckProgressGpsState(truck,now);
    if (status==='next') status=gpsState!=='fresh' ? gpsState : !plan.job.location ? 'address_unverified' : 'routing_unavailable';
    const row:TruckProgress={truck:name,appointmentId:plan.job.recordId,appointmentVersion:plan.job.version,status,minutes:null,miles:null,gpsAt:truck?.lastGpsUpdate || null,calculatedAt:new Date(now).toISOString(),arrivalAt:null};
    if (status==='routing_unavailable' && truck && plan.job.location) {
      const elements=await provider([{latitude:truck.latitude!,longitude:truck.longitude!}],[plan.job.location]).catch(()=>null);
      const e=elements?.find(e=>(e.originIndex??0)===0 && (e.destinationIndex??0)===0);
      const seconds=typeof e?.duration==='string' && /^\d+(?:\.\d+)?s$/.test(e.duration)?Number(e.duration.slice(0,-1)):NaN;
      if (!e?.status?.code && e?.condition==='ROUTE_EXISTS' && Number.isFinite(seconds) && seconds>=0 && typeof e.distanceMeters==='number' && Number.isFinite(e.distanceMeters) && e.distanceMeters>=0) {
        row.status='available';row.minutes=Math.ceil(seconds/60);row.miles=Math.round(e.distanceMeters/1609.344*10)/10;
        row.arrivalAt=new Date(now+seconds*1000).toISOString();
      }
    }
    results.push(row);
  }
  return results;
}
