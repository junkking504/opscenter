import { isDesktopWriteOriginAllowed } from '@/lib/desktop-request-origin';
import { cookies } from 'next/headers';
import { AUTH_SESSION_COOKIE, verifyAuthSessionCookie } from '@/lib/auth';
import { opsRoleCan } from '@/lib/ops-roles';
import { ensureHumanOperator } from '@/lib/platform/persistence/actors';
import { reconcileControlQueue } from '@/lib/desktop-control-reconciliation';
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
  if (!isDesktopWriteOriginAllowed(request)) return Response.json({ error: 'Cross-site changes are not allowed.' }, { status: 403, headers });
  try {
    const body = await request.json();
    const date = validControlDate(body.date);
    const actor = await ensureHumanOperator(session.email);
    const result = await reconcileControlQueue(date, actor.id);
    return Response.json({ result, message: `Checked ${result.checked.length} operating date${result.checked.length === 1 ? '' : 's'}, including eligible carryovers. ${result.skipped.length} date${result.skipped.length === 1 ? '' : 's'} could not be checked.${result.remaining ? ` ${result.remaining} additional dates remain outside this batch.` : ''} Resolution still requires two distinct fresh observations.` }, { headers });
  } catch {
    return Response.json({ error: 'Source reconciliation could not complete. Existing work and audit history remain available; refresh before retrying.' }, { status: 503, headers });
  }
}
