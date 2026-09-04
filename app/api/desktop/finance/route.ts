import { isDesktopWriteOriginAllowed } from '@/lib/desktop-request-origin';
import { cookies } from 'next/headers';
import { AUTH_SESSION_COOKIE, verifyAuthSessionCookie } from '@/lib/auth';
import { opsRoleCan } from '@/lib/ops-roles';
import { chicagoDateKey } from '@/lib/report-dates';
import { readDesktopFinance, updateDesktopFinance } from '@/lib/desktop-finance';
import { validCommercialDate, parseCommercialOperation, readCommercialReceipt, COMMERCIAL_ACTIONS, CommercialActionError } from '@/lib/desktop-marketing';
export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'private, no-store, max-age=0' };
async function session() { return verifyAuthSessionCookie((await cookies()).get(AUTH_SESSION_COOKIE)?.value || ''); }
export async function GET(request: Request) {
  const actor = await session();
  if (!actor) return Response.json({ error: 'Authentication required.' }, { status: 401, headers });
  if (!opsRoleCan(actor.role, 'finance.read')) return Response.json({ error: 'Manager access is required.' }, { status: 403, headers });
  const params = new URL(request.url).searchParams;
  const date = params.get('date') || chicagoDateKey();
  if (!validCommercialDate(date)) return Response.json({ error: 'A valid operating date is required.' }, { status: 400, headers });
  try {
    const receiptId = params.get('receipt');
    if (receiptId) { const receipt = readCommercialReceipt(receiptId); if (!receipt || receipt.actor !== actor.email || !opsRoleCan(actor.role, COMMERCIAL_ACTIONS[receipt.action])) return Response.json({ error: 'Receipt unavailable.' }, { status: 404, headers }); return Response.json({ receipt }, { headers }); }
    return Response.json(readDesktopFinance(date), { headers });
  } catch { return Response.json({ error: 'Finance source unavailable.' }, { status: 503, headers }); }
}
export async function POST(request: Request) {
  const actor = await session();
  if (!actor) return Response.json({ error: 'Authentication required.' }, { status: 401, headers });
  if (!opsRoleCan(actor.role, 'sensitive.write')) return Response.json({ error: 'This role cannot change these records.' }, { status: 403, headers });
  if (!isDesktopWriteOriginAllowed(request)) return Response.json({ error: 'Same-origin request required.' }, { status: 403, headers });
  try {
    const operation = parseCommercialOperation(await request.json().catch(() => null));

    const receipt = updateDesktopFinance(operation, actor);
    return Response.json({ receipt }, { status: receipt.status === 'verified' ? 200 : 202, headers });
  } catch (error) {
    const preflight = error instanceof CommercialActionError && error.stage === 'preflight';
    return Response.json({ error: preflight ? error.message : 'The change result could not be confirmed. Check the source and saved receipt before retrying.', stage: preflight ? 'preflight' : 'uncertain' }, { status: preflight ? 409 : 503, headers });
  }
}
