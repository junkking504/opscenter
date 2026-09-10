import { currentOnsiteTruckGps, freshTruckGps, nextTruckStop, truckProgressGpsState, type TruckProgress } from '../lib/schedule-next-stop';
import { parkedTruckObservation } from '../lib/truck-gps-status';
import { truckLabel, type ScheduleSnapshot } from './lib/schedule-contract';
import './schedule-truck-progress.css';

export default function ScheduleTruckProgress({truck,snapshot,progress,now,select}:{truck:string;snapshot:ScheduleSnapshot;progress?:TruckProgress[];now:number;select:(id:string)=>void}) {
  const plan=nextTruckStop(snapshot.appointments,truck,snapshot.fleet.isToday,now);
  if (!plan) return null;
  const gps=snapshot.fleet.trucks.find(t=>truckLabel(t.truck)===truckLabel(truck));
  const result=progress?.find(p=>p.truck===truckLabel(truck) && p.appointmentId===plan.job.recordId && p.appointmentVersion===plan.job.version);
  let status=plan.state;
  const gpsState=truckProgressGpsState(gps,now);
  if(status==='on_site' && !currentOnsiteTruckGps(gps,now)) status='last_seen';
  if(status==='next') status=gpsState!=='fresh' ? gpsState : !plan.job.location ? 'address_unverified' : result?.status==='parked' ? 'checking' : result?.status || 'checking';
  if(status==='available' && (!result || !freshTruckGps({...gps!,lastGpsUpdate:result.gpsAt},now) || !Number.isFinite(result.minutes) || result.minutes===null || result.minutes<0 || Date.parse(result.arrivalAt || '')<now)) status='checking';
  const between=plan.between && gpsState!=='parked';
  const label=status==='on_site'?'On site':status==='last_seen'?'Last on site':between?'Between appointments':'Next scheduled stop';
  const age=Math.max(0,Math.floor((now-Date.parse(gps?.lastGpsUpdate || ''))/60000));
  const ageLabel=age<1?'just now':age<60?`${age}m ago`:`${Math.floor(age/60)}h ${age%60}m ago`;
  const parkedLabel=`Parked · ${ageLabel}`;
  const messages:Record<string,string>={ambiguous:'Check current stop',unverified:'Verify assignment',untimed:'Time not set',gps_unavailable:'GPS unavailable',parked:parkedLabel,stale_gps:`${gps && parkedTruckObservation(gps)?'Last parked':'Last position'} · ${ageLabel}`,address_unverified:'Verify address',routing_unavailable:'ETA unavailable',checking:'Updating ETA',last_seen:gpsState==='parked'?parkedLabel:'Awaiting GPS'};
  const time=result?.arrivalAt?new Date(result.arrivalAt).toLocaleTimeString('en-US',{timeZone:'America/Chicago',hour:'numeric',minute:'2-digit'}):'';
  const eta=status==='available'?`${result!.minutes} min · ${time}`:messages[status] || '';
  const gpsAt=status==='available'?result?.gpsAt:gps?.lastGpsUpdate;
  const observed=gpsAt?`GPS ${new Date(gpsAt).toLocaleTimeString('en-US',{timeZone:'America/Chicago',hour:'numeric',minute:'2-digit',second:'2-digit'})}`:'No GPS position';
  const explanation=gpsState==='parked'?'Last report: zero speed, ignition off. Within the parked reporting window; departure is not confirmed. ETA resumes with a recent non-parked report.':status==='stale_gps'?'Position report is older than the reporting window. Current motion is unconfirmed; live ETA is unavailable.':status==='available'?'Road estimate from GPS if continuing to the next scheduled stop, without live traffic. Destination is not confirmed.':'';
  const detail=`${truck} · ${label}: ${plan.job.customerName} · ${plan.job.jkNumber}${eta?' · '+eta:''}. ${observed}. ${explanation}`;
  return <button type="button" className={`schedule-truck-progress ${status} ${gpsState==='parked'?'parked-report':''}`} aria-label={detail} title={detail} onClick={()=>select(plan.job.recordId)}><span className="truck-progress-customer">{status==='on_site'?'On site':status==='last_seen'?'Last on site':between?'Between jobs →':'Next'}{between && status!=='on_site' && status!=='last_seen'?' ':': '}{plan.job.customerName || plan.job.jkNumber}</span>{eta && <strong>{eta}</strong>}</button>;
}
