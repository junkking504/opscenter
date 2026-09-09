import { cookies } from 'next/headers';
import { AUTH_SESSION_COOKIE, verifyAuthSessionCookie } from '@/lib/auth';
import { opsRoleCan } from '@/lib/ops-roles';
import { isDesktopWriteOriginAllowed } from '@/lib/desktop-request-origin';
import { chicagoDateKey } from '@/lib/report-dates';
import { readFinancialStatements } from '@/lib/financial-statements';
import { refreshQboFinancialStatements } from '@/lib/qbo-financial-refresh';
import { getQboConfig } from '@/lib/qbo-config';
export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'private, no-store, max-age=0' };
export async function POST(request: Request) {
  const actor = await verifyAuthSessionCookie((await cookies()).get(AUTH_SESSION_COOKIE)?.value || '');
  if (!actor) return Response.json({ error: 'Authentication required.' }, { status: 401, headers });
  if (!opsRoleCan(actor.role, 'finance.read')) return Response.json({ error: 'Manager access is required.' }, { status: 403, headers });
  if (!isDesktopWriteOriginAllowed(request)) return Response.json({ error: 'Same-origin request required.' }, { status: 403, headers });
  const companies = [...new Set(readFinancialStatements().records.map(r => r.company))];
  const expectedCompany = getQboConfig().expectedCompanyName || (companies.length === 1 ? companies[0] : '');
  if (!expectedCompany) return Response.json({ error: 'The accounting company needs verification before refresh.' }, { status: 409, headers });
  try {
    const result = await refreshQboFinancialStatements(chicagoDateKey(), expectedCompany);
    return Response.json({ ...result, message: result.cached ? 'QBO reports were refreshed within the last 15 minutes. Showing that snapshot.' : 'QBO reports refreshed. Accountant drafts are preserved.' }, { headers });
  } catch (error) {
    const busy = (error as NodeJS.ErrnoException).code === 'EEXIST';
    return Response.json({ error: busy ? 'A QBO report refresh is already running. Try again shortly.' : 'QBO reports could not refresh. The last imported statements are retained.' }, { status: busy ? 409 : 503, headers });
  }
}
