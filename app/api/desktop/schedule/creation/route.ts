import { isDesktopWriteOriginAllowed } from '@/lib/desktop-request-origin';
import { cookies } from 'next/headers';
import { after } from 'next/server';
import { AUTH_SESSION_COOKIE, verifyAuthSessionCookie } from '@/lib/auth';
import { authorizeOpsRequest } from '@/lib/ops-roles';
import { finishDesktopCreation, readDesktopCreation, startDesktopCreation } from '@/lib/desktop-creation';
import { JunkwareAppointmentCreationError } from '@/lib/junkware-appointment-creation';
import {prebookingCheck,requirePrebookingReview,PrebookingReviewRequired} from '@/lib/prebooking-duplicates';
import {readDesktopSchedule} from '@/lib/desktop-schedule';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;
const headers = { 'Cache-Control': 'private, no-store, max-age=0' };
async function actor() { return verifyAuthSessionCookie((await cookies()).get(AUTH_SESSION_COOKIE)?.value || ''); }
export async function GET(request: Request) {
  const auth = await actor();
  if (!auth) return Response.json({ error: 'Authentication required.' }, { status: 401, headers });
  const receipt = await readDesktopCreation(new URL(request.url).searchParams.get('requestId') || '', auth.email);
  return receipt ? Response.json({ receipt }, { headers }) : Response.json({ error: 'Booking receipt not found. Check JunkWare before retrying.' }, { status: 404, headers });
}
export async function POST(request: Request) {
  const auth = await actor();
  if (!auth) return Response.json({ error: 'Authentication required.' }, { status: 401, headers });
  if (!authorizeOpsRequest(auth.role, '/api/appointments', 'POST').allowed || !isDesktopWriteOriginAllowed(request)) return Response.json({ error: 'Booking is not permitted.' }, { status: 403, headers });
  try {
    const body=await request.json();
    const start = await startDesktopCreation(body, auth.email, input=>requirePrebookingReview(input,prebookingCheck(input,readDesktopSchedule(input.date)),body.duplicateReview));
    if (start.execute) after(async () => {
      try { await finishDesktopCreation(start); }
      catch (error) { console.error('[desktop-creation] background verification failed', { requestId: start.receipt.requestId, error: error instanceof Error ? error.message : 'Unknown error' }); }
    });
    const receipt = start.receipt;
    return Response.json({ receipt }, { status: receipt.status === 'verified' ? 200 : receipt.status === 'failed' ? 422 : 202, headers });
  } catch (error) {
    if(error instanceof PrebookingReviewRequired)return Response.json({error:error.message},{status:409,headers});
    const invalid = error instanceof JunkwareAppointmentCreationError && error.stage === 'validation';
    const conflict = error instanceof Error && /request ID belongs/.test(error.message);
    return Response.json({ error: invalid || conflict ? (error as Error).message : 'The booking result could not be confirmed. Check the saved result before retrying.' }, { status: invalid ? 400 : conflict ? 409 : 503, headers });
  }
}
