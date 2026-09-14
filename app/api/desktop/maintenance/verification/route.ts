import { cookies } from 'next/headers';
import { AUTH_SESSION_COOKIE, verifyAuthSessionCookie, opsAuthRole } from '@/lib/auth';
import { opsRoleCan } from '@/lib/ops-roles';
import { isDesktopWriteOriginAllowed } from '@/lib/desktop-request-origin';
import { maintenanceDirectory } from '@/lib/maintenance-monitor';
import { recordClientRecovery } from '@/lib/maintenance-client-recovery';
export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'private, no-store, max-age=0' };

export async function POST(request: Request) {
  const session = await verifyAuthSessionCookie((await cookies()).get(AUTH_SESSION_COOKIE)?.value || '');
  if (!session) return Response.json({ error: 'Authentication required.' }, { status: 401, headers });
  if (!opsRoleCan(opsAuthRole(session.email), 'platform.manage') || !isDesktopWriteOriginAllowed(request))
    return Response.json({ error: 'Administrator access and a same-origin request are required.' }, { status: 403, headers });
  try {
    const reader = request.body?.getReader();
    if (!reader) return new Response(null, { status: 400, headers });
    let size = 0, text = ''; const decoder = new TextDecoder();
    for (;;) {
      const chunk = await reader.read(); if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > 2048) { await reader.cancel(); return new Response(null, { status: 413, headers }); }
      text += decoder.decode(chunk.value, { stream: true });
    }
    text += decoder.decode();
    let body;
    try { body = JSON.parse(text); }
    catch { return Response.json({ error: 'A valid verification request is required.' }, { status: 400, headers }); }
    if (!body || typeof body.category !== 'string' || typeof body.evidence !== 'string' || !Number.isSafeInteger(body.failureAt))
      return Response.json({ error: 'A failure and the successful interaction check are required.' }, { status: 400, headers });
    if (!recordClientRecovery(body.category, body.failureAt, body.evidence, session.email, maintenanceDirectory()))
      return Response.json({ error: 'The failure changed or the verification is incomplete. Refresh and check the latest incident.' }, { status: 409, headers });
    return Response.json({ message: 'Verification recorded. The observer will reconcile it on its next checks.' }, { headers });
  } catch { return Response.json({ error: 'Verification could not be recorded. Refresh before trying again.' }, { status: 503, headers }); }
}
