import { cookies } from 'next/headers';
import { AUTH_SESSION_COOKIE, verifyAuthSessionCookie } from '@/lib/auth';
import { readDesktopCalendar } from '@/lib/desktop-schedule-calendar';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  if (!await verifyAuthSessionCookie((await cookies()).get(AUTH_SESSION_COOKIE)?.value || '')) return Response.json({ error: 'Authentication required.' }, { status: 401 });
  try { return Response.json(readDesktopCalendar(new URL(request.url).searchParams.get('month') || ''), { headers: { 'Cache-Control': 'private, no-store' } }); }
  catch { return Response.json({ error: 'The calendar source is unavailable.' }, { status: 503 }); }
}
