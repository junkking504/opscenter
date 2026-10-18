import type { PushWorkerDependencies } from './web-push-worker';
export type PushAcknowledgement={scope:string;generation:string;sequence:number};
/** Service-day cutoff is inclusive: dates strictly before today minus 14 days
 * retire. Compact monotonic floor prevents replay after per-scope state leaves. */
export function pushRetirementCutoff(now=new Date()) {
 const day=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Chicago',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
 return new Date(Date.parse(day+'T12:00:00Z')-14*86400000).toISOString().slice(0,10);
}
export async function archivePushScopes(d:PushWorkerDependencies,retireFiles:(cutoff:string,acks:PushAcknowledgement[])=>Promise<string[]>,now=new Date()) {
 if(!d.enabled())return [];
 const cutoff=pushRetirementCutoff(now),client=await d.pool.connect();
 try {
  await client.query('BEGIN');
  await client.query(`INSERT INTO opscenter_kernel.push_retention(singleton,retired_before) VALUES(true,$1)
   ON CONFLICT(singleton) DO UPDATE SET retired_before=GREATEST(push_retention.retired_before,EXCLUDED.retired_before) WHERE push_retention.retired_before<EXCLUDED.retired_before`,[cutoff]);
  const candidates=(await client.query(`SELECT scope FROM (SELECT scope FROM opscenter_kernel.push_sources UNION SELECT scope FROM opscenter_kernel.push_gaps) candidates WHERE split_part(scope,':',2) ~ '^\\d{4}-\\d{2}-\\d{2}$' AND split_part(scope,':',2)<$1 ORDER BY scope`,[cutoff])).rows;
  const acknowledgements:PushAcknowledgement[]=[];
  for(const candidate of candidates){
   // Same lock order as the recorder. The row cannot change between proof and deletion.
   await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',[`push-source:${candidate.scope}`]);
   const source=(await client.query('SELECT * FROM opscenter_kernel.push_sources WHERE scope=$1 FOR UPDATE',[candidate.scope])).rows[0];

   const pending=await client.query(`SELECT 1 FROM opscenter_kernel.push_events e JOIN opscenter_kernel.push_deliveries q ON q.event_id=e.id
    WHERE (e.source_scope=$1 OR e.source_scope IS NULL) AND q.status IN ('pending','sending') LIMIT 1`,[candidate.scope]);
   if(pending.rows.length)continue;
   acknowledgements.push({scope:candidate.scope,generation:source?.generation||'absent',sequence:Number(source?.sequence||0)});
  }
  // Helper holds the producer lock, validates its checkpoint and all retained
  // references, writes its replay floor before deleting only eligible metadata.
  const retired=await retireFiles(cutoff,acknowledgements);
  if(retired.some(scope=>!acknowledgements.some(ack=>ack.scope===scope)))throw new Error('invalid_retirement_receipt');
  for(const scope of retired){
   for(const table of ['push_observations','push_batches','push_gaps','push_health','push_sources'])await client.query(`DELETE FROM opscenter_kernel.${table} WHERE scope=$1`,[scope]);
  }
  await client.query('COMMIT');return retired;
 }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
}
