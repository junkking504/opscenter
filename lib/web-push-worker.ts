import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { getKernelPool } from './platform/persistence/pool';
import { pushEnabled, pushOutcome, pushHash, PUSH_CATEGORIES } from './web-push-policy';
import { pushTransitions, type PushBatch } from './web-push-events';
import { sendAppleWakeup } from './web-push-transport';
import { allowedSessionIdentity, opsAuthRole } from './auth';
import { opsRoleCan } from './ops-roles';
export type PushWorkerDependencies = {pool:Pool;enabled:()=>boolean;send:(endpoint:string)=>Promise<number>;ownerAllowed:(owner:string)=>boolean;activatedAt:string;maxAgeMs?:number};
export const PUSH_LOCK=680018001;
export function pushDependencies():PushWorkerDependencies {
  return {pool:getKernelPool(),enabled:pushEnabled,send:sendAppleWakeup,ownerAllowed:owner=>allowedSessionIdentity(owner)&&opsRoleCan(opsAuthRole(owner),'sensitive.write'),activatedAt:process.env.OPSCENTER_WEB_PUSH_ACTIVATED_AT!};
}
export function pushErrorCode(error:unknown):string {
  const code=(error as {code?:unknown})?.code;
  return typeof code==='string' && /^[0-9A-Z]{5}$/.test(code)?`sql_${code}`:'source_failed';
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
      const stamp=Date.parse(batch.observedAt);
      if(!Number.isFinite(stamp)||stamp>Date.now()||!Number.isSafeInteger(batch.sequence)||batch.sequence<1)throw new Error('invalid_observation');
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',[`push-source:${batch.scope}`]);
      const source=(await client.query('SELECT * FROM opscenter_kernel.push_sources WHERE scope=$1',[batch.scope])).rows[0];
      const digest=pushHash(batch);
      if(batch.sequence<=(Number(source?.sequence)||0)){
        const prior=(await client.query('SELECT digest FROM opscenter_kernel.push_batches WHERE scope=$1 AND sequence=$2',[batch.scope,batch.sequence])).rows[0];
        if(prior?.digest!==digest)throw new Error('sequence_conflict');
        return;
      }
      if(batch.sequence!==(Number(source?.sequence)||0)+1)throw new Error('sequence_gap');
      if(source && stamp<new Date(source.observed_at).getTime())throw new Error('observation_reordered');
      if(!source?.baseline_complete && !batch.complete)throw new Error('baseline_incomplete');
      await client.query('INSERT INTO opscenter_kernel.push_batches(scope,sequence,digest) VALUES($1,$2,$3)',[batch.scope,batch.sequence,digest]);
      const rows=await client.query('SELECT identity_hash,revision_hash,version,present FROM opscenter_kernel.push_observations WHERE scope=$1',[batch.scope]);
      const previous=new Map(rows.rows.map(row=>[row.identity_hash,row]));
      for(const change of pushTransitions(previous,batch)) {
        await client.query(`INSERT INTO opscenter_kernel.push_observations(scope,identity_hash,revision_hash,version,observed_at,present) VALUES($1,$2,$3,$4,$5,$6)
          ON CONFLICT(scope,identity_hash) DO UPDATE SET revision_hash=EXCLUDED.revision_hash,version=EXCLUDED.version,observed_at=EXCLUDED.observed_at,present=EXCLUDED.present`,[batch.scope,change.identity,change.revision,change.version,batch.observedAt,change.present]);
        const id=pushHash([batch.scope,batch.category,change.identity,change.revision,change.version]);
        await client.query('INSERT INTO opscenter_kernel.push_events(id,category,occurred_at) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',[id,batch.category,batch.observedAt]);
        if(source?.baseline_complete && stamp>=Date.parse(d.activatedAt)) {
          const devices=await client.query('SELECT id,owner_id FROM opscenter_kernel.push_devices WHERE $1=ANY(categories) AND revoked_at IS NULL AND expires_at>now() AND created_at<=$2',[batch.category,batch.observedAt]);
          for(const device of devices.rows)if(d.ownerAllowed(device.owner_id))await client.query('INSERT INTO opscenter_kernel.push_deliveries(event_id,device_id) VALUES($1,$2) ON CONFLICT DO NOTHING',[id,device.id]);
        }
      }
      await client.query(`INSERT INTO opscenter_kernel.push_sources(scope,observed_at,sequence,baseline_complete) VALUES($1,$2,$3,true)
        ON CONFLICT(scope) DO UPDATE SET observed_at=EXCLUDED.observed_at,sequence=EXCLUDED.sequence,baseline_complete=true`,[batch.scope,batch.observedAt,batch.sequence]);
      await client.query("INSERT INTO opscenter_kernel.push_health(scope,code) VALUES($1,'recorded') ON CONFLICT(scope) DO UPDATE SET code='recorded',recorded_at=now()",[batch.scope]);
      await client.query("SELECT pg_notify('opscenter_web_push','')");
    });
  } catch(error) {
    const reason=['sequence_conflict','sequence_gap','observation_reordered','baseline_incomplete','invalid_observation','duplicate_identity'].includes((error as Error).message)?(error as Error).message:pushErrorCode(error);
    await client.query('INSERT INTO opscenter_kernel.push_health(scope,code) VALUES($1,$2) ON CONFLICT(scope) DO UPDATE SET code=EXCLUDED.code,recorded_at=now()',[batch.scope,reason]);
    throw new Error(reason);
  } finally {client.release();}
}
/** Caller owns the dedicated single-instance lock. Claims serialize per device;
 * a completed claim may finish after revoke. No later claim can bypass revoke. */
export async function drainPushOutbox(d:PushWorkerDependencies) {
  let attempted=0;
  while(d.enabled()) {
    const pending=await d.pool.query(`SELECT q.event_id,q.device_id FROM opscenter_kernel.push_deliveries q JOIN opscenter_kernel.push_events e ON e.id=q.event_id
      WHERE q.status='pending' ORDER BY e.recorded_at,q.event_id,q.device_id LIMIT 50`);
    if(!pending.rows.length)break;
    for(const row of pending.rows) {
      if(!d.enabled())return {attempted};
      const client=await d.pool.connect();
      let claim:{endpoint:string;token:string}|null=null;
      try {
        claim=await transaction(client,async()=>{
          const device=(await client.query('SELECT * FROM opscenter_kernel.push_devices WHERE id=$1 FOR UPDATE',[row.device_id])).rows[0];
          const delivery=(await client.query(`SELECT q.status,e.category,e.occurred_at FROM opscenter_kernel.push_deliveries q JOIN opscenter_kernel.push_events e ON e.id=q.event_id
            WHERE q.event_id=$1 AND q.device_id=$2 FOR UPDATE OF q`,[row.event_id,row.device_id])).rows[0];
          if(!delivery || delivery.status!=='pending')return null;
          const age=Date.now()-new Date(delivery.occurred_at).getTime();
          const reason=!d.enabled()?'disabled':!device||device.revoked_at?'revoked':new Date(device.expires_at).getTime()<=Date.now()?'expired':!d.ownerAllowed(device.owner_id)?'owner_denied':!device.categories.includes(delivery.category)?'category_disabled':!Number.isFinite(age)||age<0||new Date(delivery.occurred_at).getTime()<Date.parse(d.activatedAt)?'before_activation':age>(d.maxAgeMs??15*60000)?'stale':null;
          if(reason){await client.query("UPDATE opscenter_kernel.push_deliveries SET status='skipped',reason=$3 WHERE event_id=$1 AND device_id=$2 AND status='pending'",[row.event_id,row.device_id,reason]);return null;}
          const token=randomUUID();
          const saved=await client.query("UPDATE opscenter_kernel.push_deliveries SET status='sending',claim_token=$3,attempted_at=now() WHERE event_id=$1 AND device_id=$2 AND status='pending' RETURNING event_id",[row.event_id,row.device_id,token]);
          return saved.rows.length===1?{endpoint:device.subscription_json.endpoint as string,token}:null;
        });
      } finally {client.release();}
      if(!claim)continue;
      // Deliberately no automatic retries, including definitive rejection: a
      // future retry policy must reauthorize each attempt after revocation.
      let status='skipped',reason='disabled_before_send';
      if(d.enabled()) {attempted++;try {status=pushOutcome(await d.send(claim.endpoint));reason=status;}catch {status='uncertain';reason='transport_unknown';}}
      const receipt=await d.pool.connect();
      try {await transaction(receipt,async()=>{
        await receipt.query('SELECT id FROM opscenter_kernel.push_devices WHERE id=$1 FOR UPDATE',[row.device_id]);
        await receipt.query("UPDATE opscenter_kernel.push_deliveries SET status=$4,reason=$5 WHERE event_id=$1 AND device_id=$2 AND claim_token=$3 AND status='sending'",[row.event_id,row.device_id,claim.token,status,reason]);
        if(status==='expired'){
          await receipt.query('UPDATE opscenter_kernel.push_devices SET revoked_at=now() WHERE id=$1',[row.device_id]);
          await receipt.query("UPDATE opscenter_kernel.push_deliveries SET status='skipped',reason='expired' WHERE device_id=$1 AND status='pending'",[row.device_id]);
        }
      });}finally{receipt.release();}
    }
  }
  return {attempted};
}
/** Compatibility test harness; never scheduled. Production dispatch uses LISTEN. */
export async function runPushWorker(batches:PushBatch[],deps?:PushWorkerDependencies) {
  if(!deps && !pushEnabled())return {disabled:true,attempted:0};
  const d=deps||pushDependencies();if(!d.enabled())return {disabled:true,attempted:0};
  for(const batch of batches){try{await recordPushBatch(batch,d);}catch{/* failure persisted per scope; other scopes continue */}}
  return drainPushOutbox(d);
}
