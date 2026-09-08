import { cookies } from 'next/headers';
import { AUTH_SESSION_COOKIE, verifyAuthSessionCookie, opsAuthRole } from '@/lib/auth';
import { opsRoleCan } from '@/lib/ops-roles';
import { recoverySnapshot } from '@/lib/maintenance-recovery';
import { isDesktopWriteOriginAllowed } from '@/lib/desktop-request-origin';
import { maintenanceDirectory, maintenanceSnapshot, recordClientEvent } from '@/lib/maintenance-monitor';
export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'private, no-store, max-age=0' };
async function authorized() { return verifyAuthSessionCookie((await cookies()).get(AUTH_SESSION_COOKIE)?.value || ''); }
export async function GET() {
  const session = await authorized();
  if (!session) return Response.json({ error: 'Authentication required.' }, { status: 401, headers });
  return Response.json({ ...maintenanceSnapshot(), recovery: recoverySnapshot(maintenanceDirectory()), canManageRecovery: opsRoleCan(opsAuthRole(session.email), 'platform.manage') }, { headers });
}
export async function POST(request: Request) {
  if (!await authorized()) return Response.json({ error: 'Authentication required.' }, { status: 401, headers });
  if (!isDesktopWriteOriginAllowed(request)) return Response.json({ error: 'Cross-site reports are not allowed.' }, { status: 403, headers });
  // Only fixed category names are accepted. No messages, URLs, stacks, or records.
  if (Number(request.headers.get('content-length') || '0') > 100) return new Response(null, { status: 413, headers });
  try {
    const reader = request.body?.getReader(); if (!reader) return new Response(null, { status: 400, headers });
    let text = '', bytes = 0;
    for (;;) { const item = await reader.read(); if (item.done) break; bytes += item.value.byteLength; if (bytes > 100) { await reader.cancel(); return new Response(null, { status: 413, headers }); } text += new TextDecoder().decode(item.value); }
    const body = JSON.parse(text);
    if (Object.keys(body).length !== 1 || typeof body.category !== 'string' || !recordClientEvent(body.category)) return new Response(null, { status: 400, headers });
    return new Response(null, { status: 204, headers });
  } catch { return new Response(null, { status: 503, headers }); }
}
