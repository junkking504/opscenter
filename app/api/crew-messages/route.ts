import {CrewPhoneError} from '@/lib/crew-phone';
import {cookies} from 'next/headers';
import {AUTH_SESSION_COOKIE,verifyAuthSessionCookie} from '@/lib/auth';
import {opsRoleCan} from '@/lib/ops-roles';
import {crewPhoneBody,crewPhoneFailure,crewPhoneResponse} from '@/lib/crew-phone-http';
import {saveWaypointMessage,waypointMessages} from '@/lib/waypoint-push';
import {JUNKWARE_DISPATCH_TRUCKS} from '@/lib/junkware-trucks';
export const runtime='nodejs';export const dynamic='force-dynamic';
async function manager(){const session=await verifyAuthSessionCookie((await cookies()).get(AUTH_SESSION_COOKIE)?.value || '');if(!session || !opsRoleCan(session.role,'sensitive.write'))throw new CrewPhoneError('Manager access required.',403);return session;}
export async function GET(request:Request){try{await manager();const truck=new URL(request.url).searchParams.get('truck') || '';if(!JUNKWARE_DISPATCH_TRUCKS.includes(truck))throw new CrewPhoneError('Choose a truck.',400);return crewPhoneResponse({messages:await waypointMessages(truck)});}catch(e){return crewPhoneFailure(e);}}
export async function POST(request:Request){try{const actor=await manager(),input=await crewPhoneBody(request,8192);return crewPhoneResponse(await saveWaypointMessage({id:String(input.id || ''),truck:String(input.truck || ''),body:typeof input.body==='string'?input.body:'',date:String(input.date || '')},actor.email));}catch(e){return crewPhoneFailure(e);}}
