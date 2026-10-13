import {cookies} from 'next/headers';
import {AUTH_SESSION_COOKIE,verifyAuthSessionCookie} from '@/lib/auth';
import {isDesktopWriteOriginAllowed} from '@/lib/desktop-request-origin';
import {opsRoleCan} from '@/lib/ops-roles';
import {validRosterDate} from '@/lib/schedule-crew-roster';
import {readAppointmentCostEstimate,readAppointmentAttendanceCosts} from '@/lib/appointment-cost';
import {saveAppointmentCost,AppointmentCostError} from '@/lib/appointment-cost-store';
import {readDesktopSchedule} from '@/lib/desktop-schedule';
export const dynamic='force-dynamic';
const headers={'Cache-Control':'private, no-store, max-age=0'};
async function session(){return verifyAuthSessionCookie((await cookies()).get(AUTH_SESSION_COOKIE)?.value||'');}
function failure(error:unknown){return Response.json({error:error instanceof AppointmentCostError?error.message:'Cost sources are unavailable. Retry without assuming zero costs.'},{status:error instanceof AppointmentCostError?error.status:503,headers});}
export async function GET(request:Request){
 const actor=await session();if(!actor)return Response.json({error:'Authentication required.'},{status:401,headers});
 if(!opsRoleCan(actor.role,'finance.read'))return Response.json({error:'Manager access is required for cost estimates.'},{status:403,headers});
 try{const p=new URL(request.url).searchParams,date=p.get('date')||'',id=p.get('id')||'';if(validRosterDate(date)&&p.get('scope')==='attendance')return Response.json(await readAppointmentAttendanceCosts(date),{headers});if(!validRosterDate(date)||!id||id.length>250)throw new AppointmentCostError('Choose an appointment and valid date.');return Response.json(await readAppointmentCostEstimate(date,id),{headers});}catch(e){return failure(e);}
}
export async function POST(request:Request){
 const actor=await session();if(!actor)return Response.json({error:'Authentication required.'},{status:401,headers});
 if(!isDesktopWriteOriginAllowed(request)||!opsRoleCan(actor.role,'sensitive.write'))return Response.json({error:'Manager access is required to save cost assumptions.'},{status:403,headers});
 try{const text=await request.text();if(text.length>8000)throw new AppointmentCostError('Request too large.');const body=JSON.parse(text);if(!validRosterDate(body.date)||typeof body.id!=='string')throw new AppointmentCostError('Choose an appointment and valid date.');const job=readDesktopSchedule(body.date).appointments.find(row=>row.recordId===body.id);if(!job)throw new AppointmentCostError('Appointment no longer exists.',404);return Response.json({record:saveAppointmentCost(`${body.date}:${job.appointmentId||job.recordId}`,body.expectedVersion,body.inputs,actor.email)},{headers});}catch(e){return failure(e);}
}
