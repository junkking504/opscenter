import { validClientEvidence } from '@/desktop-ui/lib/maintenance-evidence';
import { cookies } from 'next/headers';
import { AUTH_SESSION_COOKIE, verifyAuthSessionCookie, opsAuthRole } from '@/lib/auth';
import { opsRoleCan } from '@/lib/ops-roles';
import { recoverySnapshot } from '@/lib/maintenance-recovery';
import { isDesktopWriteOriginAllowed } from '@/lib/desktop-request-origin';
import { maintenanceDirectory, maintenanceSnapshot, recordClientEvent, readClientEvents } from '@/lib/maintenance-monitor';
export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'private, no-store, max-age=0' };
async function authorized() { return verifyAuthSessionCookie((await cookies()).get(AUTH_SESSION_COOKIE)?.value || ''); }
export async function GET() {
  const session = await authorized();
  if (!session) return Response.json({ error: 'Authentication required.' }, { status: 401, headers });
  return Response.json({ ...maintenanceSnapshot(), recovery: recoverySnapshot(maintenanceDirectory()), clientFailureTimes: Object.fromEntries(Object.entries(readClientEvents()).map(([key, event]) => [key, event.at])), canVerify: opsRoleCan(opsAuthRole(session.email), 'operations.write'), canManageRecovery: opsRoleCan(opsAuthRole(session.email), 'platform.manage') }, { headers });
}
export async function POST(request: Request) {
  if (!await authorized()) return Response.json({ error: 'Authentication required.' }, { status: 401, headers });
  if (!isDesktopWriteOriginAllowed(request)) return Response.json({ error: 'Cross-site reports are not allowed.' }, { status: 403, headers });
  // Only closed operation/method/failure/status enums. No messages, URLs or records.
  if (Number(request.headers.get('content-length') || '0') > 256) return new Response(null, { status: 413, headers });
  try {
    const reader = request.body?.getReader(); if (!reader) return new Response(null, { status: 400, headers });
    let text = '', bytes = 0;
    for (;;) { const item = await reader.read(); if (item.done) break; bytes += item.value.byteLength; if (bytes > 256) { await reader.cancel(); return new Response(null, { status: 413, headers }); } text += new TextDecoder().decode(item.value); }
    const body = JSON.parse(text);
    if (!validClientEvidence(body) || !recordClientEvent(body)) return new Response(null, { status: 400, headers });
    return new Response(null, { status: 204, headers });
  } catch { return new Response(null, { status: 503, headers }); }
}
