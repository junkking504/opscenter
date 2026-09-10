import { freshTruckGps, nextTruckStop, type TruckProgress } from '../lib/schedule-next-stop';
import { truckLabel, type ScheduleSnapshot } from './lib/schedule-contract';
import './schedule-truck-progress.css';

export default function ScheduleTruckProgress({truck,snapshot,progress,now,select}:{truck:string;snapshot:ScheduleSnapshot;progress?:TruckProgress[];now:number;select:(id:string)=>void}) {
  const plan=nextTruckStop(snapshot.appointments,truck,snapshot.fleet.isToday,now);
  if (!plan) return null;
  const gps=snapshot.fleet.trucks.find(t=>truckLabel(t.truck)===truckLabel(truck));
  const result=progress?.find(p=>p.truck===truckLabel(truck) && p.appointmentId===plan.job.recordId && p.appointmentVersion===plan.job.version);
  let status=plan.state;
  if(status==='on_site' && !freshTruckGps(gps,now)) status='last_seen';
  if(status==='next') status=!gps?.lastGpsUpdate ? 'gps_unavailable' : !freshTruckGps(gps,now) ? 'stale_gps' : !plan.job.location ? 'address_unverified' : result?.status || 'checking';
  if(status==='available' && (!result || !freshTruckGps({...gps!,lastGpsUpdate:result.gpsAt},now) || !Number.isFinite(result.minutes) || result.minutes===null || result.minutes<0 || Date.parse(result.arrivalAt || '')<now)) status='checking';
  const label=status==='on_site'?'On site':status==='last_seen'?'Last on site':plan.between?'Between appointments':'Next scheduled stop';
  const messages:Record<string,string>={ambiguous:'Check current stop',unverified:'Verify assignment',untimed:'Time not set',gps_unavailable:'GPS unavailable',stale_gps:'GPS stale',address_unverified:'Verify address',routing_unavailable:'ETA unavailable',checking:'Updating ETA',last_seen:'Awaiting GPS'};
  const time=result?.arrivalAt?new Date(result.arrivalAt).toLocaleTimeString('en-US',{timeZone:'America/Chicago',hour:'numeric',minute:'2-digit'}):'';
  const eta=status==='available'?`${result!.minutes} min · ${time}`:messages[status] || '';
  const gpsAt=result?.gpsAt || gps?.lastGpsUpdate;
  const observed=gpsAt?`GPS ${new Date(gpsAt).toLocaleTimeString('en-US',{timeZone:'America/Chicago',hour:'numeric',minute:'2-digit',second:'2-digit'})}`:'No GPS position';
  const detail=`${truck} · ${label}: ${plan.job.customerName} · ${plan.job.jkNumber}${eta?' · '+eta:''}. ${observed}. ${status==='available'?'Road estimate from GPS, without live traffic. Next scheduled stop; destination is not confirmed.':''}`;
  return <button type="button" className={`schedule-truck-progress ${status}`} aria-label={detail} title={detail} onClick={()=>select(plan.job.recordId)}><span className="truck-progress-customer">{status==='on_site'?'On site':status==='last_seen'?'Last on site':plan.between?'Between jobs →':'Next'}{plan.between && status!=='on_site' && status!=='last_seen'?' ':': '}{plan.job.customerName || plan.job.jkNumber}</span>{eta && <strong>{eta}</strong>}</button>;
}
