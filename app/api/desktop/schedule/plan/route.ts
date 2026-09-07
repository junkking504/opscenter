import { cookies } from 'next/headers';
import { AUTH_SESSION_COOKIE, verifyAuthSessionCookie } from '@/lib/auth';
import { isDesktopWriteOriginAllowed } from '@/lib/desktop-request-origin';
import { opsRoleCan } from '@/lib/ops-roles';
import { readDesktopSchedule } from '@/lib/desktop-schedule';
import { routePlanSourceKey } from '@/desktop-ui/lib/route-plan';
import { buildRoutePlan, parsePlanOptions, RoutePlanInputError } from '@/lib/desktop-route-plan';

export const dynamic='force-dynamic';
const headers={'Cache-Control':'private, no-store, max-age=0'};
export async function POST(request: Request) {
  const actor=await verifyAuthSessionCookie((await cookies()).get(AUTH_SESSION_COOKIE)?.value||'');
  if(!actor) return Response.json({error:'Authentication required.'},{status:401,headers});
  if(!isDesktopWriteOriginAllowed(request)||!opsRoleCan(actor.role,'operations.read')) return Response.json({error:'Route planning is not allowed for this request.'},{status:403,headers});
  try {
    const text=await request.text();
    if(text.length>128_000) return Response.json({error:'Route request is too large.'},{status:400,headers});
    const body=JSON.parse(text);
    if(typeof body?.date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(body.date)||!Number.isFinite(Date.parse(body.date+'T12:00:00Z'))||new Date(body.date+'T12:00:00Z').toISOString().slice(0,10)!==body.date) return Response.json({error:'A valid operating date is required.'},{status:400,headers});
    const snapshot=readDesktopSchedule(body.date);
    if(body.sourceKey!==routePlanSourceKey(snapshot.appointments)) return Response.json({error:'The schedule changed. Refresh the day and rebuild the proposal.'},{status:409,headers});
    const plan=await buildRoutePlan(snapshot,parsePlanOptions(body,snapshot));
    if(plan.sourceKey!==routePlanSourceKey(readDesktopSchedule(body.date).appointments)) return Response.json({error:'The schedule changed during calculation. Refresh and rebuild the proposal.'},{status:409,headers});
    return Response.json(plan,{headers});
  } catch(error) {
    return Response.json({error:error instanceof RoutePlanInputError ? error.message : error instanceof SyntaxError ? 'Invalid route request.' : 'Route planning is unavailable. No assignments were changed.'},{status:error instanceof RoutePlanInputError||error instanceof SyntaxError?400:503,headers});
  }
}
