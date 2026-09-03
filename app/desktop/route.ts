import { cookies } from 'next/headers';
import { AUTH_SESSION_COOKIE, verifyAuthSessionCookie } from '@/lib/auth';
import { desktopReferenceAllowed, desktopReferenceDocument } from '@/lib/desktop-release';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request: Request) {
  const session = await verifyAuthSessionCookie((await cookies()).get(AUTH_SESSION_COOKIE)?.value || '');
  if (!session) return Response.json({ error: 'Authentication required.' }, { status: 401 });
  const allowed = desktopReferenceAllowed(process.env.OPSCENTER_RUNTIME, process.env.OPSCENTER_DESKTOP_PREVIEW, request.url);
  if (!allowed) return new Response('Not Found', { status: 404 });
  const mode = new URL(request.url).searchParams.get('data') === 'live' ? 'command-live' : 'reference';
  return new Response(await desktopReferenceDocument(mode), {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'private, no-store, max-age=0',
      'X-Content-Type-Options': 'nosniff',
      'X-OpsCenter-Desktop-Mode': mode,
    },
  });
}
