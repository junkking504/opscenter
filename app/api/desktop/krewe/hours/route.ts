import { cookies } from 'next/headers';
import { AUTH_SESSION_COOKIE, verifyAuthSessionCookie } from '@/lib/auth';
import { canViewCrewPayroll } from '@/lib/crew-payroll-access';
import { chicagoDateKey } from '@/lib/report-dates';
import { readKreweHours } from '@/lib/desktop-krewe-hours';

export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'private, no-store, max-age=0' };
export async function GET(request: Request) {
  const session = await verifyAuthSessionCookie((await cookies()).get(AUTH_SESSION_COOKIE)?.value || '');
  if (!session) return Response.json({ error: 'Authentication required.' }, { status: 401, headers });
  if (!canViewCrewPayroll(session.role)) return Response.json({ error: 'Payroll access is required to view employee hours.' }, { status: 403, headers });
  const date = new URL(request.url).searchParams.get('date') || chicagoDateKey();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(`${date}T12:00:00Z`)) || new Date(`${date}T12:00:00Z`).toISOString().slice(0, 10) !== date) return Response.json({ error: 'Choose a valid pay-period date.' }, { status: 400, headers });
  try { return Response.json(readKreweHours(date), { headers }); }
  catch { return Response.json({ error: 'Employee hours are unavailable. Please retry.' }, { status: 503, headers }); }
}
