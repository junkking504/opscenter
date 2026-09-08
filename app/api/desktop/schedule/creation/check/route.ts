import {cookies} from 'next/headers';
import {AUTH_SESSION_COOKIE,verifyAuthSessionCookie} from '@/lib/auth';
import {authorizeOpsRequest} from '@/lib/ops-roles';
import {isDesktopWriteOriginAllowed} from '@/lib/desktop-request-origin';
import {normalizeJunkwareAppointmentCreationInput,JunkwareAppointmentCreationError} from '@/lib/junkware-appointment-creation';
import {prebookingCheck,PrebookingReviewRequired} from '@/lib/prebooking-duplicates';
import {readDesktopSchedule} from '@/lib/desktop-schedule';
export const dynamic='force-dynamic';
const headers={'Cache-Control':'private, no-store, max-age=0'};
// POST keeps customer details out of URLs. This endpoint never creates a booking.
export async function POST(request:Request) {
  const actor=await verifyAuthSessionCookie((await cookies()).get(AUTH_SESSION_COOKIE)?.value||'');
  if(!actor)return Response.json({error:'Authentication required.'},{status:401,headers});
  if(!isDesktopWriteOriginAllowed(request)||!authorizeOpsRequest(actor.role,'/api/appointments','POST').allowed)return Response.json({error:'Booking review is not permitted.'},{status:403,headers});
  try {const input=normalizeJunkwareAppointmentCreationInput(await request.json());return Response.json({check:prebookingCheck(input,readDesktopSchedule(input.date))},{headers});}
  catch(error){const invalid=error instanceof JunkwareAppointmentCreationError&&error.stage==='validation';return Response.json({error:invalid||error instanceof PrebookingReviewRequired?error.message:'Duplicate check unavailable. No appointment was created. Try reviewing again.'},{status:invalid?400:503,headers});}
}
