import { cookies } from 'next/headers';
import { AUTH_SESSION_COOKIE, verifyAuthSessionCookie } from '@/lib/auth';
import { opsRoleCan } from '@/lib/ops-roles';
import { historyDateValid, readCustomerHistory } from '@/lib/customer-history';

export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'private, no-store, max-age=0' };
export async function GET(request: Request) {
  const actor = await verifyAuthSessionCookie((await cookies()).get(AUTH_SESSION_COOKIE)?.value || '');
  if (!actor) return Response.json({ error: 'Authentication required.' }, { status: 401, headers });
  if (!opsRoleCan(actor.role, 'operations.read')) return Response.json({ error: 'Operations access required.' }, { status: 403, headers });
  const params = new URL(request.url).searchParams, id = params.get('appointment') || '', date = params.get('date') || '';
  if (!/^\d{1,12}$/.test(id) || !historyDateValid(date)) return Response.json({ error: 'A valid appointment and date are required.' }, { status: 400, headers });
  try {
    const history = await readCustomerHistory(id, date);
    return history ? Response.json(history, { headers }) : Response.json({ error: 'This appointment is not available in saved customer history yet.' }, { status: 404, headers });
  } catch { return Response.json({ error: 'Saved customer history is unavailable. Try again shortly.' }, { status: 503, headers }); }
}
