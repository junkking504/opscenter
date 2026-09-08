import { cookies } from 'next/headers';
import { AUTH_SESSION_COOKIE, verifyAuthSessionCookie, opsAuthRole } from '@/lib/auth';
import { opsRoleCan } from '@/lib/ops-roles';
import { isDesktopWriteOriginAllowed } from '@/lib/desktop-request-origin';
import { maintenanceDirectory } from '@/lib/maintenance-monitor';
import { recoverySnapshot, setRecoveryEnabled } from '@/lib/maintenance-recovery';
export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'private, no-store, max-age=0' };
export async function PATCH(request: Request) {
  const session = await verifyAuthSessionCookie((await cookies()).get(AUTH_SESSION_COOKIE)?.value || '');
  if (!session) return Response.json({ error: 'Authentication required.' }, { status: 401, headers });
  if (!opsRoleCan(opsAuthRole(session.email), 'platform.manage') || !isDesktopWriteOriginAllowed(request)) return Response.json({ error: 'Administrator access and a same-origin request are required.' }, { status: 403, headers });
  try {
    const reader = request.body?.getReader(); if (!reader) return new Response(null, { status: 400, headers });
    let text = '', bytes = 0;
    for (;;) { const item = await reader.read(); if (item.done) break; bytes += item.value.byteLength; if (bytes > 100) { await reader.cancel(); return new Response(null, { status: 413, headers }); } text += new TextDecoder().decode(item.value); }
    const body = JSON.parse(text);
    if (!body || Object.keys(body).length !== 1 || typeof body.enabled !== 'boolean') return new Response(null, { status: 400, headers });
    setRecoveryEnabled(maintenanceDirectory(), body.enabled);
    return Response.json(recoverySnapshot(maintenanceDirectory()), { headers });
  } catch { return Response.json({ error: 'Recovery setting could not be saved.' }, { status: 503, headers }); }
}
