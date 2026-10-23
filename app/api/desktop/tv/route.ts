import { cookies } from 'next/headers';
import { AUTH_SESSION_COOKIE, verifyAuthSessionCookie } from '@/lib/auth';
import { opsRoleCan } from '@/lib/ops-roles';
import { chicagoDateKey } from '@/lib/report-dates';
import { readTvSpotlights } from '@/lib/tv-spotlights';
export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'private, no-store, max-age=0' };
export async function GET() {
  const actor = await verifyAuthSessionCookie((await cookies()).get(AUTH_SESSION_COOKIE)?.value || '');
  if (!actor) return Response.json({ error: 'Authentication required.' }, { status: 401, headers });
  if (!opsRoleCan(actor.role, 'operations.read')) return Response.json({ error: 'Manager access is required.' }, { status: 403, headers });
  return Response.json(readTvSpotlights(chicagoDateKey(), actor.role), { headers });
}
