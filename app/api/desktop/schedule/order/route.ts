import { cookies } from 'next/headers';
import { AUTH_SESSION_COOKIE, verifyAuthSessionCookie } from '@/lib/auth';
import { isDesktopWriteOriginAllowed } from '@/lib/desktop-request-origin';
import { opsRoleCan } from '@/lib/ops-roles';
import { readDesktopSchedule, readVerifiedDesktopSchedule, calculateDesktopRouteLegs, type DesktopAppointment } from '@/lib/desktop-schedule';
import { stopGroups, stopGroupKey, stopOrderSourceKey, isStopPermutation } from '@/lib/schedule-stop-order';
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
    if (!/^\d{4}-\d{2}-\d{2}$/.test(body.date || '') || !Number.isFinite(Date.parse(body.date+'T12:00:00Z')) || new Date(body.date+'T12:00:00Z').toISOString().slice(0,10) !== body.date || typeof body.groupKey !== 'string' || typeof body.sourceKey !== 'string' || !['preview','nearest','save'].includes(body.action)) throw new Error('Invalid stop order request.');
    const snapshot = await readVerifiedDesktopSchedule(body.date);
    const group = stopGroups(snapshot.appointments).find(group=>stopGroupKey(group[0]) === body.groupKey);
    if (!group || stopOrderSourceKey(group) !== body.sourceKey) throw new StopOrderConflict('The schedule or stop order changed. Refresh and review the current stops.');
    if (!isStopPermutation(group,body.ids)) throw new Error('Include every appointment in this time slot exactly once.');
    if (body.action === 'save') {
      saveStopOrder({...body,actor:actor.email},()=>readDesktopSchedule(body.date).appointments);
      return Response.json({saved:true,snapshot:readDesktopSchedule(body.date)},{headers});
    }
    let ordered: DesktopAppointment[] = body.ids.map((id: string)=>group.find(job=>job.recordId === id)!);
    if (body.action === 'nearest') ordered = await nearestStopOrder(ordered);
    const legs = await calculateDesktopRouteLegs(ordered.map((job,index)=>({...job,stopOrder:index})));
    const latest = stopGroups(readDesktopSchedule(body.date).appointments).find(group=>stopGroupKey(group[0]) === body.groupKey);
    if (!latest || stopOrderSourceKey(latest) !== body.sourceKey) throw new StopOrderConflict('The schedule changed during calculation. Refresh and review the current stops.');
    return Response.json({ids:ordered.map(job=>job.recordId),legs},{headers});
  } catch (error) {
    return Response.json({error:error instanceof Error ? error.message : 'Stop order unavailable.'},{status:error instanceof StopOrderConflict ? 409 : 400,headers});
  }
}
