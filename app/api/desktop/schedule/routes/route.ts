import { cookies } from 'next/headers';
import { AUTH_SESSION_COOKIE, verifyAuthSessionCookie } from '@/lib/auth';
import { chicagoDateKey } from '@/lib/report-dates';
import { readDesktopScheduleRouting } from '@/lib/desktop-schedule';

export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'private, no-store, max-age=0' };

export async function GET(request: Request) {
  const session = await verifyAuthSessionCookie((await cookies()).get(AUTH_SESSION_COOKIE)?.value || '');
  if (!session) return Response.json({ error: 'Authentication required.' }, { status: 401, headers });
  const query = new URL(request.url).searchParams;
  const date = query.get('date') || chicagoDateKey();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(`${date}T12:00:00Z`)) || new Date(`${date}T12:00:00Z`).toISOString().slice(0, 10) !== date) return Response.json({ error: 'A valid operating date is required.' }, { status: 400, headers });
  const recordId = query.get('appointment');
  if (recordId && recordId.length > 180) return Response.json({ error: 'Invalid appointment identity.' }, { status: 400, headers });
  try {
    const result = await readDesktopScheduleRouting(date, recordId);
    return result ? Response.json(result, { headers }) : Response.json({ error: 'Appointment no longer exists in this schedule. Refresh before comparing routes.' }, { status: 404, headers });
  } catch {
    return Response.json({ error: 'Route estimates are unavailable. No travel time or distance has been assumed.' }, { status: 503, headers });
  }
}
