import { cookies } from 'next/headers';
import { AUTH_SESSION_COOKIE, verifyAuthSessionCookie } from '@/lib/auth';
import { opsRoleCan } from '@/lib/ops-roles';
import { isDesktopWriteOriginAllowed } from '@/lib/desktop-request-origin';
import { ACCOUNTING_ACTIONS, runJunkwareAccounting } from '@/lib/junkware-accounting';
export const runtime = 'nodejs';
export const maxDuration = 300;
const headers = { 'Cache-Control': 'private, no-store, max-age=0' };
export async function POST(request: Request) {
  const actor = await verifyAuthSessionCookie((await cookies()).get(AUTH_SESSION_COOKIE)?.value || '');
  if (!actor) return Response.json({ error: 'Authentication required.' }, { status: 401, headers });
  if (!opsRoleCan(actor.role, 'finance.read') || !isDesktopWriteOriginAllowed(request)) return Response.json({ error: 'Manager accounting access required.' }, { status: 403, headers });
  const raw = await request.text();
  if (raw.length > 120_000) return Response.json({ error: 'Select fewer records.' }, { status: 413, headers });
  try {
    const body = JSON.parse(raw);
    if (!['list','action','recover'].includes(body.mode)) throw new Error('Unknown accounting operation.');
    if (body.mode !== 'list' && (!opsRoleCan(actor.role, 'sensitive.write') || (body.mode === 'action' && !Object.hasOwn(ACCOUNTING_ACTIONS, body.action)))) return Response.json({ error: 'This accounting action is not permitted.' }, { status: 403, headers });
    const data = await runJunkwareAccounting({ ...body, actor: actor.email });
    return Response.json({ data }, { headers });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'Accounting source unavailable.' }, { status: 409, headers });
  }
}
