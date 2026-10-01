import {cookies} from 'next/headers';
import {AUTH_SESSION_COOKIE,verifyAuthSessionCookie} from '@/lib/auth';
import {isDesktopWriteOriginAllowed} from '@/lib/desktop-request-origin';
import {opsRoleCan} from '@/lib/ops-roles';
import {crewDayRoster} from '@/lib/crew-phone-day';
import {JUNKWARE_DISPATCH_TRUCKS} from '@/lib/junkware-trucks';
import {readScheduleCrewRoster,saveScheduleCrewRoster,RosterError} from '@/lib/schedule-crew-roster';
export const dynamic='force-dynamic';
const headers={'Cache-Control':'private, no-store, max-age=0'};
async function session(){return verifyAuthSessionCookie((await cookies()).get(AUTH_SESSION_COOKIE)?.value||'');}
function failure(error:unknown){return Response.json({error:error instanceof RosterError?error.message:'Roster storage is unavailable.'},{status:error instanceof RosterError?error.status:503,headers});}
export async function GET(request:Request){
 const actor=await session();if(!actor)return Response.json({error:'Authentication required.'},{status:401,headers});
 try{return Response.json({roster:readScheduleCrewRoster(new URL(request.url).searchParams.get('date')||''),names:crewDayRoster(),trucks:JUNKWARE_DISPATCH_TRUCKS,canWrite:opsRoleCan(actor.role,'operations.write')},{headers});}catch(error){return failure(error);}
}
export async function POST(request:Request){
 const actor=await session();if(!actor)return Response.json({error:'Authentication required.'},{status:401,headers});
 if(!isDesktopWriteOriginAllowed(request)||!opsRoleCan(actor.role,'operations.write'))return Response.json({error:'Roster editing is not allowed.'},{status:403,headers});
 try{const text=await request.text();if(text.length>32000)throw new RosterError('Request too large.');let body;try{body=JSON.parse(text);}catch{throw new RosterError('Invalid roster request.');}return Response.json({roster:saveScheduleCrewRoster(body.date,body.expectedVersion,body.entries,actor.email)},{headers});}catch(error){return failure(error);}
}
