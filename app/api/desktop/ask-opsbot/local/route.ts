import { cookies } from 'next/headers';
import { AUTH_SESSION_COOKIE, resolveRequestOrigin, verifyAuthSessionCookie } from '@/lib/auth';
import { buildLocalCrewRevenueAnswer } from '@/lib/local-crew-revenue-answer';
import { buildLocalTerritoryDemandAnswer } from '@/lib/local-territory-demand-answer';
import { opsRoleCan } from '@/lib/ops-roles';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
const headers = { 'Cache-Control': 'private, no-store, max-age=0' };

export async function POST(request: Request) {
  const session = await verifyAuthSessionCookie((await cookies()).get(AUTH_SESSION_COOKIE)?.value || '');
  if (!session) return Response.json({ error: 'Authentication required.' }, { status: 401, headers });
  if (!opsRoleCan(session.role, 'sensitive.write')) return Response.json({ error: 'Manager access required.' }, { status: 403, headers });
  const origin = request.headers.get('origin');
  if (origin && origin !== resolveRequestOrigin(request)) return Response.json({ error: 'Request origin rejected.' }, { status: 403, headers });

  let body: { question?: unknown; date?: unknown };
  try { body = await request.json(); }
  catch { return Response.json({ error: 'A valid question is required.' }, { status: 400, headers }); }
  const question = typeof body.question === 'string' ? body.question.trim() : '';
  const date = typeof body.date === 'string' ? body.date : '';
  if (question.length < 2 || question.length > 1_000 || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return Response.json({ error: 'Enter a question under 1,000 characters and select a valid operating date.' }, { status: 400, headers });
  }
  try {
    return Response.json(buildLocalTerritoryDemandAnswer(question, date) || buildLocalCrewRevenueAnswer(question, date, session.role) || { matched: false }, { headers });
  } catch {
    return Response.json({ error: 'The OpsCenter reporting source is unavailable.' }, { status: 503, headers });
  }
}
