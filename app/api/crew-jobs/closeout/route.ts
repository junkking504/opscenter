import { waypointSandbox } from '@/lib/waypoint-sandbox';
import { after } from 'next/server';
import { crewPhoneBody, crewPhoneFailure, crewPhoneResponse, requireCrewPhone } from '@/lib/crew-phone-http';
import { CrewPhoneError } from '@/lib/crew-phone';
import { checkCrewCloseout, crewReceiptProjection, loadCrewCloseout, queueCrewCloseout, simulateCrewCloseout } from '@/lib/crew-closeout-service';
import { PendingScheduleOperationError } from '@/lib/desktop-schedule-operations';
import { publishVerifiedCloseout } from '@/lib/publish-closeout';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=600;
export async function GET(request:Request) {
  try {
    const testPhone=requireCrewPhone(request);
    if(testPhone.test)return crewPhoneResponse(waypointSandbox(testPhone,'closeout',new URL(request.url).searchParams));

    requireCrewPhone(request);
    const params=new URL(request.url).searchParams;
    if([...params.keys()].some(key=>!['assignmentId','requestId','reconcile'].includes(key)))throw new CrewPhoneError('Use the current closeout screen.');
    const assignmentId=params.get('assignmentId') || '',requestId=params.get('requestId');
    return crewPhoneResponse(requestId?{receipt:crewReceiptProjection(await checkCrewCloseout(request,assignmentId,requestId,params.get('reconcile')==='1'))}:await loadCrewCloseout(request,assignmentId));
  }catch(error){return crewPhoneFailure(error);}
}
export async function POST(request:Request) {
  try {
    const testPhone=requireCrewPhone(request);
    if(testPhone.test)return crewPhoneResponse(waypointSandbox(testPhone,'closeout',new URL(request.url).searchParams,await crewPhoneBody(request,16384)));

    requireCrewPhone(request);
    const body=await crewPhoneBody(request,16*1024);
    const simulated=await simulateCrewCloseout(request,body);
    if(simulated)return crewPhoneResponse({receipt:simulated});
    const queued=await queueCrewCloseout(request,body),receipt=queued.receipt;
    if(queued.run)after(async()=>{
      const completed=await queued.run!();
      if(completed.status==='verified' && completed.sourceResult)await publishVerifiedCloseout(completed.sourceResult,completed.recordId.split(':appointment:')[1]);
    });
    requireCrewPhone(request);
    return crewPhoneResponse({receipt:crewReceiptProjection(receipt)},receipt.status==='verified'?200:receipt.status==='failed'?422:202);
  }catch(error){
    if(error instanceof PendingScheduleOperationError)return crewPhoneResponse({error:'An earlier appointment change needs verification. Contact the office before another payment.'},409);
    if(error instanceof Error && /changed|valid appointment|required|too large|request ID already/.test(error.message))return crewPhoneResponse({error:error.message},409);
    return crewPhoneFailure(error);
  }
}
