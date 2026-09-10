import { cookies } from 'next/headers';
import { AUTH_SESSION_COOKIE, verifyAuthSessionCookie } from '@/lib/auth';
import { opsRoleCan } from '@/lib/ops-roles';
import { isDesktopWriteOriginAllowed } from '@/lib/desktop-request-origin';
import { EstimateError, readEstimateFollowups, saveEstimateFollowup } from '@/lib/estimate-follow-up';
export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'private, no-store, max-age=0' };
async function session() { return verifyAuthSessionCookie((await cookies()).get(AUTH_SESSION_COOKIE)?.value || ''); }
export async function GET() {
  const actor = await session();
  if (!actor) return Response.json({ error: 'Authentication required.' }, { status: 401, headers });
  if (!opsRoleCan(actor.role, 'operations.read')) return Response.json({ error: 'Operations access required.' }, { status: 403, headers });
  try { return Response.json({ ...readEstimateFollowups(), canWrite: opsRoleCan(actor.role, 'operations.write'), actor: actor.email }, { headers }); }
  catch { return Response.json({ error: 'Estimate history or saved follow-ups are unavailable. No empty result is assumed.' }, { status: 503, headers }); }
}
export async function POST(request: Request) {
  const actor = await session();
  if (!actor) return Response.json({ error: 'Authentication required.' }, { status: 401, headers });
  if (!opsRoleCan(actor.role, 'operations.write')) return Response.json({ error: 'Operations write access required.' }, { status: 403, headers });
  if (!isDesktopWriteOriginAllowed(request)) return Response.json({ error: 'Same-origin request required.' }, { status: 403, headers });
  try { const event = saveEstimateFollowup(await request.json(), actor); return Response.json({ event, verified: true }, { headers }); }
  catch (error) { return Response.json({ error: error instanceof EstimateError ? error.message : 'Save result could not be confirmed. Reload and check history before retrying.' }, { status: error instanceof EstimateError ? error.status : 503, headers }); }
}
