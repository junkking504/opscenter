import { cookies } from 'next/headers';
import { AUTH_SESSION_COOKIE, verifyAuthSessionCookie } from '@/lib/auth';
import { chicagoDateKey } from '@/lib/report-dates';
import { readDesktopSchedule } from '@/lib/desktop-schedule';
import {requestScheduleDay} from '@/lib/requested-schedule-day';

export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'private, no-store, max-age=0' };

export async function GET(request: Request) {
  const session = await verifyAuthSessionCookie((await cookies()).get(AUTH_SESSION_COOKIE)?.value || '');
  if (!session) return Response.json({ error: 'Authentication required.' }, { status: 401, headers });
  const date = new URL(request.url).searchParams.get('date') || chicagoDateKey();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(`${date}T12:00:00Z`)) || new Date(`${date}T12:00:00Z`).toISOString().slice(0, 10) !== date) {
    return Response.json({ error: 'A valid operating date is required.' }, { status: 400, headers });
  }
  try {
    // Render source truth immediately; the separate routing request verifies addresses.
    const snapshot=readDesktopSchedule(date);
    const params=new URL(request.url).searchParams;
    const sourceRequest=params.get('load')==='1' ? requestScheduleDay(date,snapshot.observedAt,snapshot.appointments.length>0,params.get('refresh')==='1') : undefined;
    return Response.json({...snapshot,sourceRequest}, { headers });
  } catch {
    return Response.json({ error: 'Schedule source unavailable.' }, { status: 503, headers });
  }
}
