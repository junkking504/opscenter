import { isDesktopWriteOriginAllowed } from '@/lib/desktop-request-origin';
import { cookies } from 'next/headers';
import { AUTH_SESSION_COOKIE, verifyAuthSessionCookie } from '@/lib/auth';
import { authorizeOpsRequest } from '@/lib/ops-roles';
import { executeDesktopCreation, readDesktopCreation } from '@/lib/desktop-creation';
import { JunkwareAppointmentCreationError } from '@/lib/junkware-appointment-creation';
export const dynamic = 'force-dynamic';
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
    const receipt = await executeDesktopCreation(await request.json(), auth.email);
    return Response.json({ receipt }, { status: receipt.status === 'verified' ? 200 : receipt.status === 'failed' ? 422 : 202, headers });
  } catch (error) {
    const invalid = error instanceof JunkwareAppointmentCreationError && error.stage === 'validation';
    const conflict = error instanceof Error && /request ID belongs/.test(error.message);
    return Response.json({ error: invalid || conflict ? (error as Error).message : 'The booking result could not be confirmed. Check the saved result before retrying.' }, { status: invalid ? 400 : conflict ? 409 : 503, headers });
  }
}
