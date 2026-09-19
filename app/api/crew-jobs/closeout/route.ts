import { after } from 'next/server';
import { crewPhoneBody, crewPhoneFailure, crewPhoneResponse, requireCrewPhone } from '@/lib/crew-phone-http';
import { CrewPhoneError } from '@/lib/crew-phone';
import { checkCrewCloseout, crewReceiptProjection, loadCrewCloseout, submitCrewCloseout, simulateCrewCloseout } from '@/lib/crew-closeout-service';
import { PendingScheduleOperationError } from '@/lib/desktop-schedule-operations';
import { publishVerifiedCloseout } from '@/lib/publish-closeout';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function GET(request:Request) {
  try {
    requireCrewPhone(request);
    const params=new URL(request.url).searchParams;
    if([...params.keys()].some(key=>!['assignmentId','requestId','reconcile'].includes(key)))throw new CrewPhoneError('Use the current closeout screen.');
    const assignmentId=params.get('assignmentId') || '',requestId=params.get('requestId');
    return crewPhoneResponse(requestId?{receipt:crewReceiptProjection(await checkCrewCloseout(request,assignmentId,requestId,params.get('reconcile')==='1'))}:await loadCrewCloseout(request,assignmentId));
  }catch(error){return crewPhoneFailure(error);}
}
export async function POST(request:Request) {
  try {
    requireCrewPhone(request);
    const body=await crewPhoneBody(request,16*1024);
    const simulated=await simulateCrewCloseout(request,body);
    if(simulated)return crewPhoneResponse({receipt:simulated});
    const receipt=await submitCrewCloseout(request,body);
    if(receipt.status==='verified' && receipt.sourceResult)after(async()=>{await publishVerifiedCloseout(receipt.sourceResult!,receipt.recordId.split(':appointment:')[1]);});
    requireCrewPhone(request);
    return crewPhoneResponse({receipt:crewReceiptProjection(receipt)},receipt.status==='verified'?200:receipt.status==='failed'?422:202);
  }catch(error){
    if(error instanceof PendingScheduleOperationError)return crewPhoneResponse({error:'An earlier appointment change needs verification. Contact the office before another payment.'},409);
    if(error instanceof Error && /changed|valid appointment|required|too large|request ID already/.test(error.message))return crewPhoneResponse({error:error.message},409);
    return crewPhoneFailure(error);
  }
}
