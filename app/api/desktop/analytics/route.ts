import { cookies } from 'next/headers';
import { AUTH_SESSION_COOKIE, verifyAuthSessionCookie } from '@/lib/auth';
import { opsRoleCan } from '@/lib/ops-roles';
import { chicagoDateKey } from '@/lib/report-dates';
import { validCommercialDate } from '@/lib/desktop-marketing';
import { readPredictionDataset } from '@/lib/prediction-data';
import { operatingTrendsSnapshot, scopeOperatingTrends, scopeMetrics, type AnalyticsScope } from '@/lib/operating-trends';

export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'private, no-store, max-age=0' };
export async function GET(request: Request) {
  const actor = await verifyAuthSessionCookie((await cookies()).get(AUTH_SESSION_COOKIE)?.value || '');
  if (!actor) return Response.json({ error: 'Authentication required.' }, { status: 401, headers });
  const params = new URL(request.url).searchParams;
  const scope = params.get('scope') as AnalyticsScope;
  if (!Object.hasOwn(scopeMetrics, scope)) return Response.json({ error: 'Choose a valid chart page.' }, { status: 400, headers });
  const capability = ['forecast', 'business', 'expenses', 'labor'].includes(scope) ? 'finance.read' : 'operations.read';
  if (!opsRoleCan(actor.role, capability)) return Response.json({ error: 'This role cannot access these charts.' }, { status: 403, headers });
  const date = params.get('date') || chicagoDateKey();
  if (!validCommercialDate(date)) return Response.json({ error: 'A valid operating date is required.' }, { status: 400, headers });
  try { return Response.json({ data: scopeOperatingTrends(operatingTrendsSnapshot(readPredictionDataset(), date), scope) }, { headers }); }
  catch { return Response.json({ error: 'Historical chart data is unavailable.' }, { status: 503, headers }); }
}
