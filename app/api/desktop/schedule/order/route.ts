import { cookies } from 'next/headers';
import { AUTH_SESSION_COOKIE, verifyAuthSessionCookie } from '@/lib/auth';
import { isDesktopWriteOriginAllowed } from '@/lib/desktop-request-origin';
import { opsRoleCan } from '@/lib/ops-roles';
import { readDesktopSchedule, readVerifiedDesktopSchedule, calculateDesktopRouteLegs, type DesktopAppointment } from '@/lib/desktop-schedule';
import { orderGroups, orderGroupKey, orderSourceKey, isStopPermutation } from '@/lib/schedule-stop-order';
import { saveStopOrder, StopOrderConflict } from '@/lib/desktop-stop-order-store';
import { nearestStopOrder } from '@/lib/desktop-stop-order';

export const dynamic = 'force-dynamic';
const headers = {'Cache-Control':'private, no-store, max-age=0'};
export async function POST(request: Request) {
  const actor = await verifyAuthSessionCookie((await cookies()).get(AUTH_SESSION_COOKIE)?.value || '');
  if (!actor) return Response.json({error:'Authentication required.'},{status:401,headers});
  if (!isDesktopWriteOriginAllowed(request) || !opsRoleCan(actor.role,'operations.write')) return Response.json({error:'Stop ordering is not allowed for this request.'},{status:403,headers});
  try {
    const text = await request.text();
    if (text.length > 32_000) throw new Error('Request too large.');
    const body = JSON.parse(text);
    if (body.scope !== undefined && !['window','remaining'].includes(body.scope)) throw new Error('Invalid stop order scope.');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(body.date || '') || !Number.isFinite(Date.parse(body.date+'T12:00:00Z')) || new Date(body.date+'T12:00:00Z').toISOString().slice(0,10) !== body.date || typeof body.groupKey !== 'string' || typeof body.sourceKey !== 'string' || !['preview','nearest','save'].includes(body.action)) throw new Error('Invalid stop order request.');
    // Saving a local sequence needs source/conflict checks, not geocoding or
    // road requests. Keep external lookups exclusively on preview/suggestion.
    const snapshot = body.action === 'save' ? readDesktopSchedule(body.date) : await readVerifiedDesktopSchedule(body.date);
    const group = orderGroups(snapshot.appointments,body.scope).find(group=>orderGroupKey(group[0],body.scope) === body.groupKey);
    if (!group || orderSourceKey(group,body.scope) !== body.sourceKey) throw new StopOrderConflict('The schedule or stop order changed. Refresh and review the current stops.');
    if (!isStopPermutation(group,body.ids)) throw new Error('Include every appointment in this stop list exactly once.');
    if (body.action === 'save') {
      saveStopOrder({...body,actor:actor.email},()=>readDesktopSchedule(body.date).appointments);
      return Response.json({saved:true,snapshot:readDesktopSchedule(body.date)},{headers});
    }
    let ordered: DesktopAppointment[] = body.ids.map((id: string)=>group.find(job=>job.recordId === id)!);
    if (body.action === 'nearest') ordered = await nearestStopOrder(ordered);
    const legs = await calculateDesktopRouteLegs(ordered.map((job,index)=>({...job,routeOrder:undefined,stopOrder:index,...(body.scope === 'remaining' ? {visitOrder:index} : {})})));
    const latest = orderGroups(readDesktopSchedule(body.date).appointments,body.scope).find(group=>orderGroupKey(group[0],body.scope) === body.groupKey);
    if (!latest || orderSourceKey(latest,body.scope) !== body.sourceKey) throw new StopOrderConflict('The schedule changed during calculation. Refresh and review the current stops.');
    return Response.json({ids:ordered.map(job=>job.recordId),legs},{headers});
  } catch (error) {
    return Response.json({error:error instanceof Error ? error.message : 'Stop order unavailable.'},{status:error instanceof StopOrderConflict ? 409 : 400,headers});
  }
}
