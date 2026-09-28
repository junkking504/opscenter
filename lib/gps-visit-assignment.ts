import {createHash} from 'node:crypto';
import {readDesktopSchedule, type DesktopAppointment} from './desktop-schedule';
import {truckLabel} from '../desktop-ui/lib/schedule-contract';
import {executeScheduleOperation, readScheduleReceipt} from './desktop-schedule-operations';
import {saveJobRouteAssignment, withJunkwareAppointmentSyncLock} from './job-route-assignments';
import {syncJunkwareTruckAssignment} from './junkware-truck-assignment';

export function visitedAssignmentTruck(job: DesktopAppointment, date: string, now = Date.now()): string | null {
  if (!/^\d{1,12}$/.test(job.appointmentId) || job.recordId !== `${date}:appointment:${job.appointmentId}`
    || truckLabel(job.truck) !== 'Unassigned' || !job.location || /cancel/i.test(job.status)
    || job.junkwareSyncStatus && job.junkwareSyncStatus !== 'verified') return null;
  const day=(stamp:string)=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/Chicago',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(stamp));
  const trucks = new Set((job.truckVisits || []).filter(visit=>Number.isFinite(Date.parse(visit.arrival)) && Date.parse(visit.arrival)<=now && day(visit.arrival)===date)
    .map(visit=>truckLabel(visit.truck)).filter(truck=>/^Truck [1-9]\d*$/.test(truck)));
  return trucks.size === 1 ? [...trucks][0] : null;
}

function requestId(date: string, appointmentId: string) {
  // One durable decision per appointment/day. Restarts, repeat GPS reports and
  // a later manual unassignment must never resubmit the same physical visit.
  const hash=createHash('sha256').update(`gps-visit-assignment-v1:${date}:${appointmentId}`).digest('hex');
  return `${hash.slice(0,8)}-${hash.slice(8,12)}-5${hash.slice(13,16)}-a${hash.slice(17,20)}-${hash.slice(20,32)}`;
}

export async function reconcileVisitedAssignments(date: string, options: {
  load?: () => DesktopAppointment[];
  sync?: typeof syncJunkwareTruckAssignment;
  now?: number;
} = {}) {
  const now=options.now ?? Date.now();
  const today=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Chicago',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
  if(date!==today) return [];
  const load=options.load || (()=>readDesktopSchedule(date).appointments), sync=options.sync || syncJunkwareTruckAssignment;
  const results: Array<{appointmentId:string;truck:string;status:string}>=[];
  for(const initial of load()) {
    const truck=visitedAssignmentTruck(initial,date,now);
    if(!truck) continue;
    const id=requestId(date,initial.appointmentId);
    if(await readScheduleReceipt(id)) continue;
    if(results.length>=5) break;
    try {
      const receipt=await executeScheduleOperation({requestId:id,date,recordId:initial.recordId,expectedVersion:initial.version,
        action:'move',values:{truck}},'gps-visit-assignment',()=>load().find(job=>job.recordId===initial.recordId),async()=>
        withJunkwareAppointmentSyncLock(initial.appointmentId,async()=>{
          const current=load().find(job=>job.recordId===initial.recordId);
          if(!current || visitedAssignmentTruck(current,date,now)!==truck) return {status:409,body:{error:'The appointment or GPS attribution changed. No automatic move was submitted.'}};
          let result: Awaited<ReturnType<typeof sync>>;
          try { result=await sync({appointmentId:initial.appointmentId,truck,expectedDate:date,onlyIfUnassigned:true}); }
          catch(error) {
            if(error instanceof Error && /No automatic move was submitted/.test(error.message)) return {status:409,body:{error:error.message}};
            throw error;
          }
          if(result.appointmentId!==initial.appointmentId || result.truck!==truck || result.date!==date
            || result.previousTruck && result.previousTruck!==truck || !Number.isFinite(Date.parse(result.verifiedAt))
            || !Number.isInteger(result.appointmentStartMinutes) || !Number.isInteger(result.appointmentEndMinutes)) throw new Error('Source assignment verification is incomplete.');
          const clock=(minutes:number)=>new Date(Date.UTC(2000,0,1,0,minutes)).toLocaleTimeString('en-US',{timeZone:'UTC',hour:'numeric',minute:'2-digit'});
          const saved=saveJobRouteAssignment({date,jobKey:`appt:${initial.appointmentId}`,appointmentId:initial.appointmentId,truck,
            appointmentTime:`${clock(result.appointmentStartMinutes!)}–${clock(result.appointmentEndMinutes!)}`,
            appointmentStartMinutes:result.appointmentStartMinutes,appointmentEndMinutes:result.appointmentEndMinutes,
            junkwareVerifiedAt:result.verifiedAt,junkwareSyncStatus:'verified'});
          if(!saved) throw new Error('The verified assignment could not be saved.');
          return {status:200,body:{ok:true,junkwareSynced:true,assignment:saved,evidence:'confirmed_gps_visit'}};
        }));
      results.push({appointmentId:initial.appointmentId,truck,status:receipt.status});
    } catch { results.push({appointmentId:initial.appointmentId,truck,status:'blocked'}); }
  }
  return results;
}
