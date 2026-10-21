import { cookies } from 'next/headers';
import { AUTH_SESSION_COOKIE, verifyAuthSessionCookie } from '@/lib/auth';
import { opsRoleCan } from '@/lib/ops-roles';
import { readCustomers } from '@/lib/customer-accounts';
export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'private, no-store, max-age=0' };
export async function GET(request: Request) {
  const actor = await verifyAuthSessionCookie((await cookies()).get(AUTH_SESSION_COOKIE)?.value || '');
  if (!actor) return Response.json({ error: 'Authentication required.' }, { status: 401, headers });
  if (!opsRoleCan(actor.role, 'operations.read')) return Response.json({ error: 'Operations access required.' }, { status: 403, headers });
  const params = new URL(request.url).searchParams;
  const id = params.get('customer') || '', query = params.get('q') || '', offsetText = params.get('offset') || '0';
  if (id && !/^\d{1,12}$/.test(id) || query.length > 120 || !/^\d{1,7}$/.test(offsetText)) return Response.json({ error: 'Invalid customer search.' }, { status: 400, headers });
  try {
    const result = await readCustomers(query, Number(offsetText), id || undefined);
    return result ? Response.json(result, { headers }) : Response.json({ error: 'Customer not found in saved appointments.' }, { status: 404, headers });
  } catch { return Response.json({ error: 'Saved customer information is unavailable. Try again shortly.' }, { status: 503, headers }); }
}
