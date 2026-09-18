import { cookies } from 'next/headers';
import { AUTH_SESSION_COOKIE, verifyAuthSessionCookie, opsAuthRole } from '@/lib/auth';
import { opsRoleCan } from '@/lib/ops-roles';
import { JUNKWARE_DISPATCH_TRUCKS } from '@/lib/junkware-trucks';
import { chicagoDateKey } from '@/lib/report-dates';
import { CrewPhoneError } from '@/lib/crew-phone';
import { crewPhoneBody, crewPhoneFailure, crewPhoneResponse } from '@/lib/crew-phone-http';
import { readCrewDispatch, clearQueuedCrewJob, validCrewDate } from '@/lib/crew-dispatch-store';
import { dispatchCrewJob, crewScheduleFresh } from '@/lib/crew-dispatch-service';
import { crewDispatchSources } from '@/lib/crew-dispatch-sources';
export const runtime='nodejs';
export const dynamic='force-dynamic';
async function manager() {
  const actor=await verifyAuthSessionCookie((await cookies()).get(AUTH_SESSION_COOKIE)?.value || '');
  if(!actor)throw new CrewPhoneError('Sign in to OpsCenter.',401);
  if(!opsRoleCan(opsAuthRole(actor.email),'sensitive.write'))throw new CrewPhoneError('Manager access is required for crew dispatch.',403);
  return actor;
}
export async function GET(request:Request) {
  try {
    await manager();
    const params=new URL(request.url).searchParams;
    const truck=params.get('truck') || JUNKWARE_DISPATCH_TRUCKS[0];
    const date=params.get('date') || chicagoDateKey();
    if(!validCrewDate(date))throw new CrewPhoneError('Choose a valid date.');
    const dispatch=readCrewDispatch(truck);
    const snapshot=crewDispatchSources.schedule(date);
    return crewPhoneResponse({dispatch,trucks:JUNKWARE_DISPATCH_TRUCKS,date,observedAt:snapshot.observedAt,sourceFresh:crewScheduleFresh(snapshot.observedAt),jobs:snapshot.appointments.filter(job=>job.truck===truck).map(job=>({
      appointmentId:job.appointmentId,version:job.version,customerName:job.customerName,appointmentTime:job.appointmentTime,status:job.status,
    }))});
  }catch(error){return crewPhoneFailure(error);}
}
export async function POST(request:Request) {
  try {
    const actor=await manager();
    const body=await crewPhoneBody(request);
    const truck=String(body.truck || ''),requestId=String(body.requestId || ''),expectedVersion=Number(body.expectedVersion);
    if(!Number.isSafeInteger(body.expectedVersion) || !JUNKWARE_DISPATCH_TRUCKS.includes(truck))throw new CrewPhoneError('Refresh dispatch before changing assignments.');
    if(body.action==='clear-queued')return crewPhoneResponse({dispatch:clearQueuedCrewJob(truck,requestId,expectedVersion,actor.email)});
    if(body.action!=='release')throw new CrewPhoneError('Choose a valid dispatch action.');
    const date=String(body.date || '');
    if(!validCrewDate(date))throw new CrewPhoneError('Choose a valid date.');
    const dispatch=await dispatchCrewJob({truck,requestId,expectedVersion,date,appointmentId:String(body.appointmentId || ''),expectedJobVersion:String(body.expectedJobVersion || '')},actor.email,crewDispatchSources);
    return crewPhoneResponse({dispatch});
  }catch(error){return crewPhoneFailure(error);}
}
