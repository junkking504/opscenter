import {createHash} from 'node:crypto';
import {readPendingScheduleReceipt} from '@/lib/desktop-schedule-operations';
import {cookies} from 'next/headers';
import {AUTH_SESSION_COOKIE,verifyAuthSessionCookie} from '@/lib/auth';
import {authorizeOpsRequest} from '@/lib/ops-roles';
import {withJunkwareAppointmentSyncLock} from '@/lib/job-route-assignments';
import {junkwareCustomer} from '@/lib/customer-edit';
export const dynamic='force-dynamic';
const headers={'Cache-Control':'private, no-store, max-age=0'};
export async function GET(request:Request) {
  const actor=await verifyAuthSessionCookie((await cookies()).get(AUTH_SESSION_COOKIE)?.value || '');
  if(!actor)return Response.json({error:'Authentication required.'},{status:401,headers});
  if(!authorizeOpsRequest(actor.role,'/api/job-closeout','POST').allowed)return Response.json({error:'Customer editing is not permitted.'},{status:403,headers});
  const id=new URL(request.url).searchParams.get('appointmentId') || '';
  if(!/^\d{1,12}$/.test(id))return Response.json({error:'A valid appointment is required.'},{status:400,headers});
  const pending=await readPendingScheduleReceipt(`:appointment:${id}`);
  const context={actorKey:createHash('sha256').update(actor.email.toLowerCase()).digest('hex').slice(0,24),pendingReceipt:pending?.actor===actor.email ? pending : null,blockedByOtherActor:Boolean(pending && pending.actor!==actor.email)};
  if(new URL(request.url).searchParams.get('statusOnly')==='1')return Response.json(context,{headers});
  if(pending)return Response.json({...context,error:'This appointment has an unverified change. Check its result before editing.'},{status:409,headers});
  try {const result=await withJunkwareAppointmentSyncLock(id,()=>junkwareCustomer(id));if(!result.ok)throw new Error();return Response.json({...result,...context},{headers});}
  catch{return Response.json({error:'Current JunkWare customer information is unavailable.'},{status:502,headers});}
}
