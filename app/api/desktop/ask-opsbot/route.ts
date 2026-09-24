import { createHash } from 'node:crypto';
import { cookies } from 'next/headers';
import { AUTH_SESSION_COOKIE, resolveRequestOrigin, verifyAuthSessionCookie } from '@/lib/auth';
import { runAskOpsBot, readOpenAIKey } from '@/lib/ask-opsbot-agent';
import { readAskOpsBotLedger, reserveAskOpsBotQuestion, settleAskOpsBotQuestion } from '@/lib/ask-opsbot-ledger';
import { askOpsBotApproved } from '@/lib/metered-usage-policy';
import { opsRoleCan } from '@/lib/ops-roles';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
const responseHeaders = { 'Cache-Control': 'private, no-store, max-age=0' };

async function actor() {
  const session = await verifyAuthSessionCookie((await cookies()).get(AUTH_SESSION_COOKIE)?.value || '');
  if (!session) return null;
  return { session, allowed: opsRoleCan(session.role, 'sensitive.write') };
}

function statusPayload() {
  if (!askOpsBotApproved()) return { available: false, reason: 'Ask OpsBot is not approved.', remaining: 0, limit: 50 };
  if (!readOpenAIKey()) return { available: false, reason: 'Ask OpsBot is not configured.', remaining: 0, limit: 50 };
  try {
    const ledger = readAskOpsBotLedger();
    return { available: ledger.available, reason: ledger.available ? null : ledger.paused ? 'Ask OpsBot is paused.' : 'The 50-question pilot is complete.', remaining: ledger.remaining, limit: ledger.limit };
  } catch { return { available: false, reason: 'Ask OpsBot usage history is unavailable.', remaining: 0, limit: 50 }; }
}

export async function GET() {
  const access = await actor();
  if (!access) return Response.json({ error: 'Authentication required.' }, { status: 401, headers: responseHeaders });
  if (!access.allowed) return Response.json({ error: 'Manager access required.' }, { status: 403, headers: responseHeaders });
  return Response.json(statusPayload(), { headers: responseHeaders });
}

export async function POST(request: Request) {
  const access = await actor();
  if (!access) return Response.json({ error: 'Authentication required.' }, { status: 401, headers: responseHeaders });
  if (!access.allowed) return Response.json({ error: 'Manager access required.' }, { status: 403, headers: responseHeaders });
  const origin = request.headers.get('origin');
  if (origin && origin !== resolveRequestOrigin(request)) return Response.json({ error: 'Request origin rejected.' }, { status: 403, headers: responseHeaders });
  let body: { question?: unknown; date?: unknown };
  try { body = await request.json(); }
  catch { return Response.json({ error: 'A valid question is required.' }, { status: 400, headers: responseHeaders }); }
  const question = typeof body.question === 'string' ? body.question.trim() : '';
  const date = typeof body.date === 'string' ? body.date : '';
  if (question.length < 2 || question.length > 1_000 || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return Response.json({ error: 'Enter a question under 1,000 characters and select a valid operating date.' }, { status: 400, headers: responseHeaders });
  }
  if (!askOpsBotApproved()) return Response.json({ error: 'Ask OpsBot is not approved.' }, { status: 503, headers: responseHeaders });
  const apiKey = readOpenAIKey();
  if (!apiKey) return Response.json({ error: 'Ask OpsBot is not configured.' }, { status: 503, headers: responseHeaders });
  const actorHash = createHash('sha256').update(access.session.email).digest('hex').slice(0, 16);
  let reservation;
  try { reservation = reserveAskOpsBotQuestion(actorHash); }
  catch (error) { return Response.json({ error: error instanceof Error ? error.message : 'Ask OpsBot is unavailable.' }, { status: 429, headers: responseHeaders }); }
  try {
    const result = await runAskOpsBot(question, date, access.session.role, apiKey);
    settleAskOpsBotQuestion(reservation, result.usage);
    return Response.json({ ...result, ...statusPayload() }, { headers: responseHeaders });
  } catch {
    try { settleAskOpsBotQuestion(reservation, null); } catch { /* A pending reservation remains consumed and requires review. */ }
    return Response.json({ error: 'Ask OpsBot could not complete this question. The reserved question remains counted because provider usage is uncertain.', ...statusPayload() }, { status: 502, headers: responseHeaders });
  }
}
