import { cookies } from 'next/headers';
import { AUTH_SESSION_COOKIE, verifyAuthSessionCookie, opsAuthRole } from '@/lib/auth';
import { opsRoleCan } from '@/lib/ops-roles';
import { isDesktopWriteOriginAllowed } from '@/lib/desktop-request-origin';
import { executeKnowledgeAction, knowledgeSnapshot, KnowledgeError } from '@/lib/knowledge-store';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
const headers = { 'Cache-Control': 'private, no-store, max-age=0' };
async function actor() {
  const session = await verifyAuthSessionCookie((await cookies()).get(AUTH_SESSION_COOKIE)?.value || '');
  return session ? { id: session.email, canManage: opsRoleCan(opsAuthRole(session.email), 'sensitive.write') } : null;
}
export async function GET() {
  const current = await actor();
  if (!current) return Response.json({ error: 'Authentication required.' }, { status: 401, headers });
  return Response.json(knowledgeSnapshot(current.canManage), { headers });
}
export async function POST(request: Request) {
  const current = await actor();
  if (!current) return Response.json({ error: 'Authentication required.' }, { status: 401, headers });
  if (!current.canManage || !isDesktopWriteOriginAllowed(request)) return Response.json({ error: 'Manager access and a same-site request are required.' }, { status: 403, headers });
  try {
    const reader = request.body?.getReader();
    if (!reader) throw new KnowledgeError('A knowledge action is required.');
    const chunks: Uint8Array[] = []; let bytes = 0;
    for (;;) {
      const chunk = await reader.read(); if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > 100_000) { await reader.cancel(); throw new KnowledgeError('The entry is too large.', 413); }
      chunks.push(chunk.value);
    }
    let input;
    try { input = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new KnowledgeError('Invalid knowledge action.'); }
    if (!knowledgeSnapshot(true).available) throw new KnowledgeError('Knowledge history requires recovery before saving.', 503);
    const entry = executeKnowledgeAction(input, current);
    return Response.json({ entry }, { headers });
  } catch (error) {
    return Response.json({ error: error instanceof KnowledgeError ? error.message : 'The save result could not be confirmed. Reload the library to check the saved entry before retrying.' }, { status: error instanceof KnowledgeError ? error.status : 503, headers });
  }
}
