import { readWaypointDay } from '@/lib/waypoint-day-summary-source';
import { waypointSandbox } from '@/lib/waypoint-sandbox';
import { requireCrewPhone, requireCrewReady, crewPhoneFailure, crewPhoneResponse } from '@/lib/crew-phone-http';
import { crewCurrentPayload } from '@/lib/crew-dispatch-service';
import { crewDispatchSources } from '@/lib/crew-dispatch-sources';
import { requireCrewDay } from '@/lib/crew-phone-day';
import { readCrewDispatch } from '@/lib/crew-dispatch-store';
import { CrewPhoneError } from '@/lib/crew-phone';
import { after } from 'next/server';
import { crewAssignedDay } from '@/lib/crew-assigned-day';
import { matchingCrewCompletion } from '@/lib/crew-dispatch-store';
import {warmCrewCloseout} from '@/lib/crew-closeout-service';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=600;
const completionChecks=new Map<string,Promise<unknown>>();
const completionRetryAfter=new Map<string,number>();
export async function GET(request:Request) {
  try {
    const testPhone=requireCrewPhone(request);
    if(testPhone.test)return crewPhoneResponse(waypointSandbox(testPhone,'current',new URL(request.url).searchParams));

    const phone=requireCrewReady(request);
    const day=requireCrewDay(phone);
    // The phone cannot choose another truck, date or appointment through a URL.
    if(new URL(request.url).search) throw new CrewPhoneError('Use the current assignment screen.');
    const payload=crewAssignedDay(phone,day.date);
    const summary=readWaypointDay(day);
    // Completion recovery can open JunkWare, but must never hold up browsing.
    const dispatch=readCrewDispatch(phone.truck);
    const receipts=dispatch.current?.date===day.date?await crewDispatchSources.receipts(dispatch.current):[];
    const completionPending=receipts.some(receipt=>matchingCrewCompletion(dispatch,receipt));
    const current=requireCrewReady(request);
    if(current.deviceId!==phone.deviceId || current.truck!==phone.truck || requireCrewDay(current).version!==day.version) throw new CrewPhoneError('Today’s truck setup changed. Refresh your assignment.',409);
    if(completionPending)after(async()=>{
      const key=`${phone.truck}:${dispatch.current!.assignmentId}`;
      if(completionChecks.has(key))return completionChecks.get(key);
      if((completionRetryAfter.get(key) || 0)>Date.now())return;
      const check=crewCurrentPayload(phone,crewDispatchSources).then(result=>{
        if(result.state==='unavailable')completionRetryAfter.set(key,Date.now()+30_000);
        else completionRetryAfter.delete(key);
      }).catch(()=>{completionRetryAfter.set(key,Date.now()+30_000);}).finally(()=>{completionChecks.delete(key);});
      completionChecks.set(key,check);
      await check;
    });
    if(!completionPending && payload.job && payload.jobs?.some(job=>job.assignmentId===payload.job?.assignmentId && /^confirmed$/i.test(job.status)))after(()=>warmCrewCloseout(request,payload.job!.assignmentId));
    return crewPhoneResponse({...payload,summary,completionPending});
  } catch(error) {return crewPhoneFailure(error);}
}
