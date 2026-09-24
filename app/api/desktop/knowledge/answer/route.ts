import { cookies } from 'next/headers';
import { AUTH_SESSION_COOKIE, verifyAuthSessionCookie, opsAuthRole } from '@/lib/auth';
import { opsRoleCan } from '@/lib/ops-roles';
import { knowledgeSnapshot } from '@/lib/knowledge-store';
import { answerKnowledgeQuestion } from '@/desktop-ui/lib/knowledge-answer';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
const headers = { 'Cache-Control': 'private, no-store, max-age=0' };

export async function GET(request: Request) {
  const session = await verifyAuthSessionCookie((await cookies()).get(AUTH_SESSION_COOKIE)?.value || '');
  if (!session) return Response.json({ error: 'Authentication required.' }, { status: 401, headers });
  const query = new URL(request.url).searchParams.get('q')?.trim().slice(0, 240) || '';
  if (query.length < 2) return Response.json({ query, answer: null, available: true }, { headers });
  const snapshot = knowledgeSnapshot(opsRoleCan(opsAuthRole(session.email), 'sensitive.write'));
  return Response.json({ query, answer: answerKnowledgeQuestion(snapshot.entries, query, Date.now()), available: snapshot.available, error: snapshot.error }, { headers });
}
