import { isDesktopWriteOriginAllowed } from '@/lib/desktop-request-origin';
import { cookies } from 'next/headers';
import { AUTH_SESSION_COOKIE, verifyAuthSessionCookie } from '@/lib/auth';
import { readDesktopControl, executeDesktopControl } from '@/lib/desktop-control';
import { validControlDate } from '../../../../desktop-ui/lib/control-contract';

export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'private, no-store, max-age=0' };
async function identity() { return verifyAuthSessionCookie((await cookies()).get(AUTH_SESSION_COOKIE)?.value || ''); }
function failure(error: unknown) {
  const message = error instanceof Error ? error.message : '';
  const forbidden = /Your role/.test(message);
  const invalid = /required|Unsupported|within 31|valid|current Chicago|outside the selected/.test(message);
  const conflict = /changed|already|prior handoff|transition|Every readiness/.test(message);
  return Response.json({ error: forbidden || invalid || conflict ? message : 'Control could not confirm the result. Refresh and check the recorded action before retrying.' }, { status: forbidden ? 403 : conflict ? 409 : invalid ? 400 : 503, headers });
}
export async function GET(request: Request) {
  const actor = await identity();
  if (!actor) return Response.json({ error: 'Authentication required.' }, { status: 401, headers });
  try { const url = new URL(request.url); return Response.json(await readDesktopControl(validControlDate(url.searchParams.get('date')), actor, Number(url.searchParams.get('page') || '1'), url.searchParams.get('action') || undefined), { headers }); }
  catch (error) { return failure(error); }
}
export async function POST(request: Request) {
  const actor = await identity();
  if (!actor) return Response.json({ error: 'Authentication required.' }, { status: 401, headers });
  if (!isDesktopWriteOriginAllowed(request)) return Response.json({ error: 'Cross-site changes are not allowed.' }, { status: 403, headers });
  try { return Response.json({ receipt: await executeDesktopControl(await request.json(), actor) }, { headers }); }
  catch (error) { return failure(error); }
}
