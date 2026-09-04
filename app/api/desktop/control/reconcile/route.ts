import { cookies } from 'next/headers';
import { AUTH_SESSION_COOKIE, verifyAuthSessionCookie } from '@/lib/auth';
import { opsRoleCan } from '@/lib/ops-roles';
import { ensureHumanOperator } from '@/lib/platform/persistence/actors';
import { reconcileOperatingInbox } from '@/lib/platform/inbox';
import { readMetrics } from '@/lib/opsData';
import { controlReconciliationReady } from '@/lib/desktop-control';
import { validControlDate } from '../../../../../desktop-ui/lib/control-contract';

export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'private, no-store, max-age=0' };

// Reuses the kernel's registered detector and its durable detector_runs/events.
// The detector resolves supported conditions only after two distinct fresh
// observations; refreshing the same snapshot cannot manufacture verification.
export async function POST(request: Request) {
  const session = await verifyAuthSessionCookie((await cookies()).get(AUTH_SESSION_COOKIE)?.value || '');
  if (!session) return Response.json({ error: 'Authentication required.' }, { status: 401, headers });
  if (!opsRoleCan(session.role, 'sensitive.write')) return Response.json({ error: 'A manager is required to reconcile all source categories.' }, { status: 403, headers });
  const origin = request.headers.get('origin');
  if (request.headers.get('sec-fetch-site') === 'cross-site' || origin && origin !== new URL(request.url).origin) return Response.json({ error: 'Cross-site changes are not allowed.' }, { status: 403, headers });
  try {
    const body = await request.json();
    const date = validControlDate(body.date);
    if (!controlReconciliationReady(date, readMetrics(date))) return Response.json({ error: 'The metrics snapshot is missing, incomplete, or stale. Source conditions cannot be resolved until complete evidence is available.' }, { status: 409, headers });
    const actor = await ensureHumanOperator(session.email);
    const result = await reconcileOperatingInbox(date, actor.id);
    return Response.json({ result, message: result.sourceFresh ? 'Source conditions reconciled. Resolution requires two distinct fresh observations.' : 'Sources were checked, but the evidence is not fresh enough to resolve conditions.' }, { headers });
  } catch {
    return Response.json({ error: 'Source reconciliation could not complete. Existing work and audit history remain available; refresh before retrying.' }, { status: 503, headers });
  }
}
