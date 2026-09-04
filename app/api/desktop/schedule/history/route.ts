import { cookies } from 'next/headers';
import { AUTH_SESSION_COOKIE, verifyAuthSessionCookie } from '@/lib/auth';
import { readDesktopScheduleHistory } from '@/lib/desktop-schedule-calendar';
import { validOperatingDate } from '@/lib/platform/request-actor';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  if (!await verifyAuthSessionCookie((await cookies()).get(AUTH_SESSION_COOKIE)?.value || '')) return Response.json({ error: 'Authentication required.' }, { status: 401 });
  try { return Response.json(await readDesktopScheduleHistory(validOperatingDate(new URL(request.url).searchParams.get('date'))), { headers: { 'Cache-Control': 'private, no-store' } }); }
  catch { return Response.json({ error: 'Saved schedule history is unavailable.' }, { status: 503 }); }
}
