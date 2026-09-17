import { cookies } from 'next/headers';
import { AUTH_SESSION_COOKIE, verifyAuthSessionCookie, resolveRequestOrigin } from '@/lib/auth';
import { chicagoDateKey } from '@/lib/report-dates';
import { readTruckAgents, reviewTruckRecommendation, readTruckAgentReviewReceipt } from '@/lib/truck-agents';
export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'private, no-store, max-age=0' };
async function session() { return verifyAuthSessionCookie((await cookies()).get(AUTH_SESSION_COOKIE)?.value || ''); }
export async function GET(request: Request) {
  const actor = await session();
  if (!actor) return Response.json({ error: 'Authentication required.' }, { status: 401, headers });
  const params = new URL(request.url).searchParams;
  try {
    if (params.has('receipt')) {
      const receipt = readTruckAgentReviewReceipt(params.get('receipt') || '', actor.email);
      return Response.json({ receipt }, { status: receipt ? 200 : 404, headers });
    }
    return Response.json(readTruckAgents(params.get('date') || chicagoDateKey(), actor.role), { headers });
  } catch { return Response.json({ error: 'Truck agent evidence or review history could not be read. Existing records are preserved.' }, { status: 503, headers }); }
}
export async function POST(request: Request) {
  const actor = await session();
  if (!actor) return Response.json({ error: 'Authentication required.' }, { status: 401, headers });
  if (request.headers.get('origin') && request.headers.get('origin') !== resolveRequestOrigin(request)) return Response.json({ error: 'Same-origin request required.' }, { status: 403, headers });
  const reader = request.body?.getReader(); let raw = ''; let bytes = 0;
  if (!reader) return Response.json({ error: 'Choose a review action.' }, { status: 400, headers });
  const decoder = new TextDecoder();
  while (true) { const chunk = await reader.read(); if (chunk.done) break; bytes += chunk.value.byteLength; if (bytes > 16_000) { await reader.cancel(); return Response.json({ error: 'Review request too large.' }, { status: 413, headers }); } raw += decoder.decode(chunk.value, { stream: true }); }
  raw += decoder.decode();
  try {
    const body = JSON.parse(raw); if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('Choose a review action.');
    const receipt = reviewTruckRecommendation(body, actor.email, actor.role);
    return Response.json({ receipt }, { status: receipt.status === 'verified' ? 200 : 202, headers });
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : 'Review could not be saved.' }, { status: 409, headers }); }
}
