import { cookies } from 'next/headers';
import { AUTH_SESSION_COOKIE, verifyAuthSessionCookie } from '@/lib/auth';
import { authorizeOpsRequest } from '@/lib/ops-roles';
import { GET as read } from '@/app/api/job-closeout/route';
import { closeoutSourceVersion } from '@/lib/desktop-closeout-contract';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  const actor = await verifyAuthSessionCookie((await cookies()).get(AUTH_SESSION_COOKIE)?.value || '');
  if (!actor) return Response.json({ error: 'Authentication required.' }, { status: 401 });
  const response = await read(request);
  const body = await response.json();
  return Response.json({ ...body, ...(body.closeout ? { sourceVersion: closeoutSourceVersion(body.closeout), canWrite: authorizeOpsRequest(actor.role, '/api/job-closeout', 'POST').allowed } : {}) }, { status: response.status, headers: { 'Cache-Control': 'private, no-store' } });
}
