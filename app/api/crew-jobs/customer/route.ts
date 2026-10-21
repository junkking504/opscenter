import {crewPhoneBody,crewPhoneFailure,crewPhoneResponse,requireCrewReady} from '@/lib/crew-phone-http';
import {CrewPhoneError} from '@/lib/crew-phone';
import {trackedAfter as after} from '@/lib/release-after';
import {loadCrewCustomer,queueCrewCustomer,checkCrewCustomer} from '@/lib/crew-customer-service';
import {PendingScheduleOperationError} from '@/lib/desktop-schedule-operations';
import {CustomerCorrectionError} from '@/lib/junkware-customer-correction';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=600;
function failure(error:unknown){
  if(error instanceof PendingScheduleOperationError)return crewPhoneResponse({error:'An earlier appointment change needs verification. Check its saved result before making a correction.'},409);
  if(error instanceof Error && /^(This appointment changed|This request ID already|Closed appointments|Canceled appointments)/.test(error.message))return crewPhoneResponse({error:'This appointment changed. Reload customer information before saving.'},409);
  if(error instanceof CustomerCorrectionError)return crewPhoneResponse({error:error.message},409);
  return crewPhoneFailure(error);
}
export async function GET(request:Request){try{
  requireCrewReady(request);const query=new URL(request.url).searchParams;
  if([...query.keys()].some(key=>!['assignmentId','requestId','reconcile'].includes(key)) || query.has('reconcile')&&query.get('reconcile')!=='1')throw new CrewPhoneError('Use the customer correction form.');
  const assignmentId=query.get('assignmentId')||'',requestId=query.get('requestId');
  return crewPhoneResponse(requestId?{receipt:await checkCrewCustomer(request,assignmentId,requestId,query.get('reconcile')==='1')}:await loadCrewCustomer(request,assignmentId));
}catch(error){return failure(error);}}
export async function POST(request:Request){try{
  requireCrewReady(request);const body=await crewPhoneBody(request,8192),queued=await queueCrewCustomer(request,body);
  if(queued.run)after(async()=>{await queued.run!();});
  return crewPhoneResponse({receipt:queued.receipt},queued.receipt.status==='verified'?200:queued.receipt.status==='failed'?422:202);
}catch(error){return failure(error);}}
