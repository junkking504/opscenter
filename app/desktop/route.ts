import { cookies } from 'next/headers';
import { AUTH_SESSION_COOKIE, verifyAuthSessionCookie, opsAuthDisplayName } from '@/lib/auth';
import { desktopReleaseMode, desktopReferenceDocument } from '@/lib/desktop-release';
import { opsRoleLabel } from '@/lib/ops-roles';
import { chicagoDateKey } from '@/lib/report-dates';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request: Request) {
  const session = await verifyAuthSessionCookie((await cookies()).get(AUTH_SESSION_COOKIE)?.value || '');
  if (!session) return Response.json({ error: 'Authentication required.' }, { status: 401 });
  const mode = desktopReleaseMode(process.env.OPSCENTER_RUNTIME, process.env.OPSCENTER_DESKTOP_PREVIEW, request.url);
  const requestedDate = new URL(request.url).searchParams.get('date') || chicagoDateKey();
  const date = /^\d{4}-\d{2}-\d{2}$/.test(requestedDate) && Number.isFinite(Date.parse(`${requestedDate}T12:00:00Z`))
    && new Date(`${requestedDate}T12:00:00Z`).toISOString().slice(0, 10) === requestedDate ? requestedDate : chicagoDateKey();
  return new Response(await desktopReferenceDocument(mode, { date, actor: { displayName: opsAuthDisplayName(session.email), role: opsRoleLabel(session.role) } }), {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'private, no-store, max-age=0',
      'X-Content-Type-Options': 'nosniff',
      'X-OpsCenter-Desktop-Mode': mode,
    },
  });
}
