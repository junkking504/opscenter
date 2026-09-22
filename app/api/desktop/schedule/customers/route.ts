import { cookies } from 'next/headers';
import { AUTH_SESSION_COOKIE, verifyAuthSessionCookie } from '@/lib/auth';
import { authorizeOpsRequest } from '@/lib/ops-roles';
import { isDesktopWriteOriginAllowed } from '@/lib/desktop-request-origin';
import { customerSearchFields, normalizeCustomerSelection } from '@/lib/junkware-customer-contract';
import { lookupJunkwareCustomer } from '@/lib/junkware-customer-lookup';
export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'private, no-store, max-age=0' };
// Read-only POST keeps customer search terms out of URLs and access logs.
export async function POST(request: Request) {
  const actor = await verifyAuthSessionCookie((await cookies()).get(AUTH_SESSION_COOKIE)?.value || '');
  if (!actor) return Response.json({ error: 'Authentication required.' }, { status: 401, headers });
  if (!isDesktopWriteOriginAllowed(request) || !authorizeOpsRequest(actor.role, '/api/appointments', 'POST').allowed) return Response.json({ error: 'Customer lookup is not permitted.' }, { status: 403, headers });
  let input: { query: string; key?: string };
  try {
    const body = await request.text();
    if (body.length > 2000) throw new Error();
    input = JSON.parse(body);
    if (typeof input.query !== 'string') throw new Error();
    customerSearchFields(input.query);
    if (input.key != null) normalizeCustomerSelection(input);
  } catch { return Response.json({ error: 'Enter a customer name, email, or phone number.' }, { status: 400, headers }); }
  try { return Response.json(await lookupJunkwareCustomer(input), { headers }); }
  catch (error) { return Response.json({ error: error instanceof Error ? error.message : 'Customer search unavailable.' }, { status: 503, headers }); }
}
