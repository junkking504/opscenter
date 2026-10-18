import { pushHash, type PushCategory } from './web-push-policy';
export type PushObservation = { identity: string; revision: unknown };
export type PushBatch = { scope:string;category:PushCategory;observedAt:string;observations:PushObservation[] };
export function pushEventId(batch: Pick<PushBatch,'scope'|'category'>, item: PushObservation, version=1) {
  return pushHash(['opscenter-push-v1',batch.scope,batch.category,item.identity,item.revision,version]);
}
/** Read saved canonical data only. Never import Slack digest, collectors or senders. */
export async function readPushBatches(date: string, now=Date.now()): Promise<PushBatch[]> {
  const [{readJobRows,junkwareScheduleUpdatedAt},{readDesktopKrewe},{readGeofenceEntries}]=await Promise.all([
    import('./desktop-schedule-source'),import('./desktop-krewe'),import('./linxup-geofence-alerts')]);
  const fresh=(stamp:string|null|undefined)=>!!stamp && Number.isFinite(Date.parse(stamp)) && Date.parse(stamp)<=now && now-Date.parse(stamp)<10*60000;
  const batches:PushBatch[]=[];
  const scheduleAt=junkwareScheduleUpdatedAt(date);
  if(fresh(scheduleAt)) batches.push({scope:`schedule:${date}`,category:'schedule',observedAt:scheduleAt!,observations:readJobRows(date).filter(j=>j.appointmentId && j.sourceDate===date).map(j=>({identity:j.appointmentId,revision:[j.status,j.truck,j.appointmentTime,j.driver,j.navigator]}))});
  const krewe=readDesktopKrewe(date,'today','operator',false);
  if(!krewe.missingDates.includes(date) && fresh(krewe.sourceUpdatedAt)) batches.push({scope:`krewe:${date}`,category:'krewe',observedAt:krewe.sourceUpdatedAt!,observations:krewe.members.filter(m=>m.clockIn || m.clockOut).map(m=>({identity:m.id,revision:[m.clockIn,m.clockOut]}))});
  const geofences=readGeofenceEntries(date);
  if(geofences.complete && fresh(geofences.observedAt)) batches.push({scope:`fleet:${date}`,category:'fleet',observedAt:geofences.observedAt,observations:[
    ...geofences.entries.map(e=>({identity:`arrival:${e.id}`,revision:e.timestamp})),
    ...geofences.nativeVisits.map(v=>({identity:`departure:${v.id}`,revision:v.departedAt})),
  ]});
  return batches;
}
