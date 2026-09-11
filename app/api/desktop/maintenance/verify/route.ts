import { cookies } from 'next/headers';
import { AUTH_SESSION_COOKIE, verifyAuthSessionCookie, opsAuthRole } from '@/lib/auth';
import { opsRoleCan } from '@/lib/ops-roles';
import { isDesktopWriteOriginAllowed } from '@/lib/desktop-request-origin';
import { verifyClientInteraction } from '@/lib/maintenance-monitor';
export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'private, no-store, max-age=0' };
export async function POST(request: Request) {
  const session = await verifyAuthSessionCookie((await cookies()).get(AUTH_SESSION_COOKIE)?.value || '');
  if (!session) return Response.json({ error: 'Authentication required.' }, { status: 401, headers });
  if (!opsRoleCan(opsAuthRole(session.email), 'operations.write') || !isDesktopWriteOriginAllowed(request)) return new Response(null, { status: 403, headers });
  try {
    const reader = request.body?.getReader(); if (!reader) return new Response(null, { status: 400, headers });
    let text = '', bytes = 0;
    for (;;) { const item = await reader.read(); if (item.done) break; bytes += item.value.byteLength; if (bytes > 128) { await reader.cancel(); return new Response(null, { status: 413, headers }); } text += new TextDecoder().decode(item.value); }
    const body = JSON.parse(text);
    if (!body || Object.keys(body).length !== 2 || typeof body.category !== 'string' || !Number.isSafeInteger(body.failureAt)) return new Response(null, { status: 400, headers });
    if (!verifyClientInteraction(body.category, body.failureAt, undefined, session.email)) return Response.json({ error: 'Evidence changed; verify the latest failure.' }, { status: 409, headers });
    return Response.json({ status: 'pending-observer', message: 'Verification recorded; awaiting observer read-back.' }, { status: 202, headers });
  } catch { return Response.json({ error: 'Verification could not be saved.' }, { status: 503, headers }); }
}
