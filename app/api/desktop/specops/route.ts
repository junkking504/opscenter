import { cookies } from 'next/headers';
import { AUTH_SESSION_COOKIE, verifyAuthSessionCookie } from '@/lib/auth';
import { opsRoleCan } from '@/lib/ops-roles';
import { readSpecOpsConditions } from '@/lib/specops-conditions';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
const headers = { 'Cache-Control': 'private, no-store, max-age=0' };
export async function GET() {
  const session = await verifyAuthSessionCookie((await cookies()).get(AUTH_SESSION_COOKIE)?.value || '');
  if (!session) return Response.json({ error: 'Authentication required.' }, { status: 401, headers });
  if (!opsRoleCan(session.role, 'finance.read')) return Response.json({ error: 'Manager access required.' }, { status: 403, headers });
  return Response.json(readSpecOpsConditions(), { headers });
}
