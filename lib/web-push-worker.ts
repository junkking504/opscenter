import { pushMessage, type PushEnvelope } from './web-push-message';
import { lockPushTrial, trialReason, trialFingerprint, authorizePushAttempt } from './web-push-trial';
import { pushRetirementCutoff } from './web-push-archive';
import { retainPushMetadata } from './web-push-retention';
import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { getKernelPool } from './platform/persistence/pool';
import { pushEnabled, pushOutcome, pushHash, PUSH_CATEGORIES } from './web-push-policy';
import { pushTransitions, type PushBatch } from './web-push-events';
import { sendAppleNotification } from './web-push-transport';
import { allowedSessionIdentity, opsAuthRole } from './auth';
import { supervisedPushDelivery } from './web-push-runtime';
import { opsRoleCan } from './ops-roles';
export type PushWorkerDependencies = {pool:Pool;enabled:()=>boolean;send:(endpoint:string,authorize:()=>Promise<boolean>,deadline:number,envelope?:PushEnvelope)=>Promise<number>;ownerAllowed:(owner:string)=>boolean;activatedAt:string};
export const PUSH_LOCK=680018001;
export function pushDependencies():PushWorkerDependencies {
  return {pool:getKernelPool(),enabled:pushEnabled,send:sendAppleNotification,ownerAllowed:owner=>supervisedPushDelivery()&&allowedSessionIdentity(owner)&&opsRoleCan(opsAuthRole(owner),'sensitive.write'),activatedAt:process.env.OPSCENTER_WEB_PUSH_ACTIVATED_AT!};
}
export function pushErrorCode(error:unknown):string {
  const code=(error as {code?:unknown})?.code;
  return typeof code==='string' && /^[0-9A-Z]{5}$/.test(code)?`sql_${code}`:'source_failed';
}
export const deterministicPushErrors=new Set(['invalid_scope','invalid_observation','invalid_generation','generation_mismatch','reset_reordered','sequence_archived','source_date_expired','sequence_conflict','sequence_gap','observation_reordered','baseline_incomplete','duplicate_identity','source_capacity','scope_retired','observation_capacity','invalid_journal_entry','invalid_journal_observation']);
export async function recordPushGap(scope:string,id:string,code:string,d:PushWorkerDependencies) {
  if(!d.enabled())return;
  const safeScope=/^(schedule|krewe|fleet):[a-zA-Z0-9:-]{1,100}$/.test(scope)?scope:/^journal:(capacity|pending|retired)$/.test(scope)?scope:'journal:global';
  const safeCode=/^[a-z_]{1,60}$/.test(code)?code:'capture_failure';
  await d.pool.query(`INSERT INTO opscenter_kernel.push_gaps(scope,gap_id,code,observed_at) VALUES($1,$2,$3,now())
    ON CONFLICT(scope) DO UPDATE SET gap_id=EXCLUDED.gap_id,code=EXCLUDED.code,observed_at=EXCLUDED.observed_at,recorded_at=now(),resolved_at=NULL,recovered_generation=NULL WHERE push_gaps.gap_id<>EXCLUDED.gap_id`,[safeScope,id,safeCode]);
  // Replay on startup must not reopen a gap already reconciled by a commit.
  await d.pool.query(`INSERT INTO opscenter_kernel.push_health(scope,code)
    SELECT scope,CASE WHEN resolved_at IS NULL THEN 'coverage_gap' ELSE 'recovered_gap' END FROM opscenter_kernel.push_gaps WHERE scope=$1
    ON CONFLICT(scope) DO UPDATE SET code=EXCLUDED.code WHERE push_health.code<>EXCLUDED.code`,[safeScope]);
}
async function transaction<T>(client:PoolClient, action:()=>Promise<T>):Promise<T> {
  await client.query('BEGIN');
  try {const result=await action();await client.query('COMMIT');return result;}
  catch(error){await client.query('ROLLBACK');throw error;}
}
/** Call from a durable canonical producer, in retained sequence order. No Slack
 * reads, filesystem polling, or source-collection requests are performed here. */
export async function recordPushBatch(batch:PushBatch,d:PushWorkerDependencies) {
  if(!d.enabled())return;
  if(!/^(schedule|krewe|fleet):[a-zA-Z0-9:-]{1,100}$/.test(batch.scope) || !batch.scope.startsWith(`${batch.category}:`) || !PUSH_CATEGORIES.includes(batch.category))throw new Error('invalid_scope');
  const client=await d.pool.connect();
  try {
    await transaction(client,async()=>{
      const stamp=Date.parse(batch.observedAt),recorded=Date.parse(batch.recordedAt||batch.observedAt);
      const generation=batch.generation||'legacy';
      if(generation!=='legacy'&&!/^[a-f0-9]{32}$/.test(generation))throw new Error('invalid_generation');
      if(!Number.isFinite(recorded)||recorded>Date.now()||recorded<stamp)throw new Error('invalid_observation');
      if(!Number.isFinite(stamp)||stamp>Date.now()||!Number.isSafeInteger(batch.sequence)||batch.sequence<1)throw new Error('invalid_observation');
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',[`push-source:${batch.scope}`]);
      let source=(await client.query('SELECT * FROM opscenter_kernel.push_sources WHERE scope=$1',[batch.scope])).rows[0];
      const day=batch.scope.match(/:(\d{4}-\d{2}-\d{2})(?::|$)/)?.[1];
      // V2 validates against publication time, so a queued entry crossing
      // midnight or an outage does not expire before it can be recorded.
      const publicationDay=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Chicago',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(batch.recordedAt?recorded:Date.now()));
      const windowTime=Date.parse(publicationDay+'T12:00:00Z');
      if(day && (day<new Date(windowTime-14*86400000).toISOString().slice(0,10)||day>new Date(windowTime+90*86400000).toISOString().slice(0,10)))throw new Error('source_date_expired');
      if(!source&&day){const floor=(await client.query('SELECT retired_before::text FROM opscenter_kernel.push_retention WHERE singleton=true')).rows[0]?.retired_before;if(floor&&day<floor)throw new Error('scope_retired');}
      if(!source && Number((await client.query('SELECT count(*)::int AS count FROM opscenter_kernel.push_sources')).rows[0]?.count||0)>=1000)throw new Error('source_capacity');
      if(source && (source.generation||'legacy')!==generation){
        if(!batch.reset||(!batch.baseline&&!batch.reconcile)||batch.sequence!==1||!batch.gapId)throw new Error('generation_mismatch');
        if(recorded<=new Date(source.source_recorded_at||source.observed_at).getTime())throw new Error('reset_reordered');
        if(!batch.reconcile)await client.query('DELETE FROM opscenter_kernel.push_observations WHERE scope=$1',[batch.scope]);
        await client.query('DELETE FROM opscenter_kernel.push_batches WHERE scope=$1',[batch.scope]);
        source=batch.reconcile?{...source,sequence:0,archived_sequence:0}:undefined;
      }
      const digest=pushHash(batch);
      if(source && batch.sequence<=Number(source.archived_sequence||0))throw new Error('sequence_archived');
      if(batch.sequence<=(Number(source?.sequence)||0)){
        const prior=(await client.query('SELECT digest FROM opscenter_kernel.push_batches WHERE scope=$1 AND sequence=$2',[batch.scope,batch.sequence])).rows[0];
        if(prior?.digest!==digest)throw new Error('sequence_conflict');
        return;
      }
      if(batch.sequence!==(Number(source?.sequence)||0)+1)throw new Error('sequence_gap');
      if(source && stamp<new Date(source.observed_at).getTime())throw new Error('observation_reordered');
      if(!source?.baseline_complete && !batch.complete)throw new Error('baseline_incomplete');
      await client.query('INSERT INTO opscenter_kernel.push_batches(scope,sequence,digest) VALUES($1,$2,$3)',[batch.scope,batch.sequence,digest]);
      const rows=await client.query('SELECT identity_hash,revision_hash,version,present,notification_json FROM opscenter_kernel.push_observations WHERE scope=$1',[batch.scope]);
      const previous=new Map(rows.rows.map(row=>[row.identity_hash,row]));
      if(new Set([...previous.keys(),...batch.observations.map(row=>pushHash(row.identity))]).size>10000)throw new Error('observation_capacity');
      const descriptions=new Map(batch.observations.map(item=>[pushHash(item.identity),item]));
      for(const change of pushTransitions(previous,batch)) {
        await client.query(`INSERT INTO opscenter_kernel.push_observations(scope,identity_hash,revision_hash,version,observed_at,present) VALUES($1,$2,$3,$4,$5,$6)
          ON CONFLICT(scope,identity_hash) DO UPDATE SET revision_hash=EXCLUDED.revision_hash,version=EXCLUDED.version,observed_at=EXCLUDED.observed_at,present=EXCLUDED.present`,[batch.scope,change.identity,change.revision,change.version,batch.observedAt,change.present]);
        const item=descriptions.get(change.identity);
        const old=previous.get(change.identity)?.notification_json;
        const notification=change.present?pushMessage(item?.notification):pushMessage(old?{title:'Appointment removed',body:`${old.body.split(' · ')[0]} · removed from the schedule`}:null);
        const id=pushHash([batch.scope,generation,batch.sequence,batch.category,change.identity,change.revision,change.version]);
        await client.query('INSERT INTO opscenter_kernel.push_events(id,category,occurred_at,source_recorded_at,source_scope,notification_json) VALUES($1,$2,$3,$4,$5,$6::jsonb) ON CONFLICT DO NOTHING',[id,batch.category,batch.observedAt,batch.recordedAt||batch.observedAt,batch.scope,notification?JSON.stringify(notification):null]);
        if(!batch.baseline && !batch.silentIdentities?.some(identity=>pushHash(identity)===change.identity) && (source?.baseline_complete||batch.baseline===false) && recorded>=Date.parse(d.activatedAt)) {
          const devices=await client.query(`SELECT d.id,d.owner_id,d.subscription_json,t.subscription_hash FROM opscenter_kernel.push_devices d JOIN opscenter_kernel.push_trial t ON t.singleton=true AND t.device_id=d.id AND t.owner_id=d.owner_id
            WHERE $1=ANY(d.categories) AND d.revoked_at IS NULL AND d.expires_at>clock_timestamp() AND d.created_at<=$2
              AND t.stopped_at IS NULL AND ((t.ongoing_started_at IS NOT NULL AND t.ongoing_started_at<=$2 AND t.ongoing_expires_at>clock_timestamp()) OR (t.ongoing_started_at IS NULL AND t.started_at IS NOT NULL AND t.started_at<=$2 AND t.deadline>clock_timestamp() AND t.attempts_used<3))`,[batch.category,batch.recordedAt||batch.observedAt]);
          for(const device of devices.rows)if(d.ownerAllowed(device.owner_id)&&trialFingerprint(device.subscription_json)===device.subscription_hash)await client.query('INSERT INTO opscenter_kernel.push_deliveries(event_id,device_id) VALUES($1,$2) ON CONFLICT DO NOTHING',[id,device.id]);
        }
      }
      const metadata=batch.observations.flatMap(item=>{const notification=pushMessage(item.notification);return notification?[{identity:pushHash(item.identity),notification}]:[];});
      if(metadata.length)await client.query('UPDATE opscenter_kernel.push_observations o SET notification_json=x.notification FROM jsonb_to_recordset($2::jsonb) AS x(identity text,notification jsonb) WHERE o.scope=$1 AND o.identity_hash=x.identity AND o.notification_json IS DISTINCT FROM x.notification',[batch.scope,JSON.stringify(metadata)]);
      await client.query(`INSERT INTO opscenter_kernel.push_sources(scope,observed_at,sequence,baseline_complete,generation,source_recorded_at) VALUES($1,$2,$3,true,$4,$5)
        ON CONFLICT(scope) DO UPDATE SET observed_at=EXCLUDED.observed_at,sequence=EXCLUDED.sequence,baseline_complete=true,generation=EXCLUDED.generation,source_recorded_at=EXCLUDED.source_recorded_at,archived_sequence=CASE WHEN push_sources.generation<>EXCLUDED.generation THEN 0 ELSE push_sources.archived_sequence END`,[batch.scope,batch.observedAt,batch.sequence,generation,batch.recordedAt||batch.observedAt]);
      await client.query("INSERT INTO opscenter_kernel.push_health(scope,code) VALUES($1,'recorded') ON CONFLICT(scope) DO UPDATE SET code='recorded',recorded_at=now()",[batch.scope]);
      if(batch.reconcile&&batch.gapIds?.length)await client.query(`UPDATE opscenter_kernel.push_gaps SET resolved_at=now(),recovered_generation=$3 WHERE scope=$1 AND gap_id=ANY($2::text[]) AND resolved_at IS NULL AND code<>'ordering_uncertain'`,[batch.scope,batch.gapIds,batch.generation]);
      await client.query(`UPDATE opscenter_kernel.push_health h SET code=CASE WHEN g.resolved_at IS NULL THEN 'coverage_gap' ELSE 'recovered_gap' END FROM opscenter_kernel.push_gaps g WHERE h.scope=$1 AND g.scope=h.scope`,[batch.scope]);
      if(batch.sequence%100===0)await retainPushMetadata(client);
      await client.query("SELECT pg_notify('opscenter_web_push','')");
    });
  } catch(error) {
    const reason=deterministicPushErrors.has((error as Error).message)?(error as Error).message:pushErrorCode(error);
    await client.query('INSERT INTO opscenter_kernel.push_health(scope,code) VALUES($1,$2) ON CONFLICT(scope) DO UPDATE SET code=EXCLUDED.code,recorded_at=now()',[batch.scope,reason]);
    throw new Error(reason);
  } finally {client.release();}
}
/** Caller owns the dedicated single-instance lock. Claims serialize per device;
 * a completed claim may finish after revoke. No later claim can bypass revoke. */
export async function drainPushOutbox(d:PushWorkerDependencies) {
  let attempted=0,retirementEligibilityChanged=false;
  while(d.enabled()) {
    const pending=await d.pool.query(`SELECT q.event_id,q.device_id,e.source_scope FROM opscenter_kernel.push_deliveries q JOIN opscenter_kernel.push_events e ON e.id=q.event_id
      WHERE q.status='pending' ORDER BY e.dispatch_order,q.device_id LIMIT 50`);
    if(!pending.rows.length)break;
    for(const row of pending.rows) {
      if(!row.source_scope||row.source_scope.split(':')[1]<pushRetirementCutoff())retirementEligibilityChanged=true;
      if(!d.enabled())return {attempted,retirementEligibilityChanged};
      const client=await d.pool.connect();
      let claim:{endpoint:string;token:string;deadline:number;owner:string;envelope:PushEnvelope}|null=null;
      try {
        claim=await transaction(client,async()=>{
          const trial=await lockPushTrial(client);
          const device=(await client.query('SELECT * FROM opscenter_kernel.push_devices WHERE id=$1 FOR UPDATE',[row.device_id])).rows[0];
          const delivery=(await client.query(`SELECT q.status,e.category,e.occurred_at,e.source_recorded_at,e.notification_json FROM opscenter_kernel.push_deliveries q JOIN opscenter_kernel.push_events e ON e.id=q.event_id
            WHERE q.event_id=$1 AND q.device_id=$2 FOR UPDATE OF q`,[row.event_id,row.device_id])).rows[0];
          if(!delivery || delivery.status!=='pending')return null;
          trial.now=(await client.query('SELECT clock_timestamp() AS now')).rows[0].now;
          const age=Date.now()-new Date(delivery.source_recorded_at||delivery.occurred_at).getTime();
          const reason=!d.enabled()?'disabled':trialReason(trial,device)||(!device||device.revoked_at?'revoked':new Date(device.expires_at).getTime()<=Date.now()?'expired':!d.ownerAllowed(device.owner_id)?'owner_denied':!device.categories.includes(delivery.category)?'category_disabled':!Number.isFinite(age)||age<0||new Date(delivery.source_recorded_at||delivery.occurred_at).getTime()<Math.max(Date.parse(d.activatedAt),(trial.ongoing_started_at||trial.started_at)?.getTime()||Infinity)?'before_activation':null);
          if(reason){await client.query("UPDATE opscenter_kernel.push_deliveries SET status='skipped',reason=$3 WHERE event_id=$1 AND device_id=$2 AND status='pending'",[row.event_id,row.device_id,reason]);return null;}
          const token=randomUUID();
          const saved=await client.query("UPDATE opscenter_kernel.push_deliveries SET status='sending',claim_token=$3,attempted_at=now() WHERE event_id=$1 AND device_id=$2 AND status='pending' RETURNING event_id",[row.event_id,row.device_id,token]);
          if(saved.rows.length!==1)return null;
          if(trial.ongoing_started_at)await client.query('INSERT INTO opscenter_kernel.push_ongoing_attempts(claim_token,event_id,device_id) VALUES($1,$2,$3)',[token,row.event_id,row.device_id]);
          else {await client.query('INSERT INTO opscenter_kernel.push_trial_attempts(ordinal,claim_token,event_id,device_id) VALUES($1,$2,$3,$4)',[trial.attempts_used+1,token,row.event_id,row.device_id]);
          await client.query('UPDATE opscenter_kernel.push_trial SET attempts_used=attempts_used+1 WHERE singleton=true');}
          const message=pushMessage(delivery.notification_json)||{title:`OpsCenter ${delivery.category} update`,body:`A new ${delivery.category} change was recorded. Open OpsCenter for the source record.`};
          return {envelope:{subscription:device.subscription_json,message:{...message,eventId:row.event_id}},endpoint:device.subscription_json.endpoint as string,owner:device.owner_id as string,token,deadline:Math.min((trial.ongoing_started_at?trial.ongoing_expires_at!:trial.deadline!).getTime(),device.expires_at.getTime())};
        });
      } finally {client.release();}
      if(!claim)continue;
      // Deliberately no automatic retries, including definitive rejection: a
      // future retry policy must reauthorize each attempt after revocation.
      let status='skipped',reason='disabled_before_send';
      const reserved=claim;
      const authorize=async()=>d.enabled()&&d.ownerAllowed(reserved.owner)&&Date.now()<reserved.deadline&&await authorizePushAttempt(d.pool,reserved.token,reserved.endpoint);
      if(await authorize()) {attempted++;try {status=pushOutcome(await d.send(claim.endpoint,authorize,claim.deadline,claim.envelope));reason=status;}catch {status='uncertain';reason='transport_unknown';}}
      else reason='trial_or_device_changed_before_send';
      const receipt=await d.pool.connect();
      try {await transaction(receipt,async()=>{
        await lockPushTrial(receipt);
        await receipt.query('SELECT id FROM opscenter_kernel.push_devices WHERE id=$1 FOR UPDATE',[row.device_id]);
        await receipt.query("UPDATE opscenter_kernel.push_deliveries SET status=$4,reason=$5 WHERE event_id=$1 AND device_id=$2 AND claim_token=$3 AND status='sending'",[row.event_id,row.device_id,claim.token,status,reason]);
        if(status==='expired'){
          retirementEligibilityChanged=true;
          await receipt.query('UPDATE opscenter_kernel.push_devices SET revoked_at=now() WHERE id=$1',[row.device_id]);
          await receipt.query('UPDATE opscenter_kernel.push_trial SET device_id=NULL,subscription_hash=NULL,approved_at=NULL WHERE singleton=true AND device_id=$1',[row.device_id]);
          await receipt.query("UPDATE opscenter_kernel.push_deliveries SET status='skipped',reason='expired' WHERE device_id=$1 AND status='pending'",[row.device_id]);
        }
      });}finally{receipt.release();}
    }
  }
  return {attempted,retirementEligibilityChanged};
}
/** Compatibility test harness; never scheduled. Production dispatch uses LISTEN. */
export async function runPushWorker(batches:PushBatch[],deps?:PushWorkerDependencies) {
  if(!deps && !pushEnabled())return {disabled:true,attempted:0};
  const d=deps||pushDependencies();if(!d.enabled())return {disabled:true,attempted:0};
  for(const batch of batches){try{await recordPushBatch(batch,d);}catch{/* failure persisted per scope; other scopes continue */}}
  return drainPushOutbox(d);
}
