import type { Pool, PoolClient } from 'pg';
import { getKernelPool } from './platform/persistence/pool';
import { pushHash } from './web-push-policy';
import type { PushSubscriptionRecord } from './web-push-store';
export const trialFingerprint = (subscription:PushSubscriptionRecord) => pushHash([subscription.endpoint,subscription.keys.p256dh,subscription.keys.auth]);
export type TrialRow={owner_id:string|null;device_id:string|null;subscription_hash:string|null;approved_at:Date|null;started_at:Date|null;deadline:Date|null;stopped_at:Date|null;attempts_used:number;ongoing_started_at?:Date|null;ongoing_expires_at?:Date|null;reenabled_at?:Date|null;now:Date};
export async function lockPushTrial(client:PoolClient):Promise<TrialRow> {
  // Global order everywhere: trial, device, delivery. clock_timestamp is read
  // AFTER waiting for the lock, never transaction-start now().
  const row=(await client.query('SELECT * FROM opscenter_kernel.push_trial WHERE singleton=true FOR UPDATE')).rows[0];
  if(!row)throw new Error('trial_missing');
  return {...row,now:(await client.query('SELECT clock_timestamp() AS now')).rows[0].now};
}
export function trialReason(trial:TrialRow,device:{id:string;owner_id:string;subscription_json:PushSubscriptionRecord}|undefined,requireActive=true):string|null {
  if(!trial.owner_id)return 'trial_unprepared';
  if(trial.stopped_at)return 'trial_stopped';
  if(trial.ongoing_started_at){
    if(!trial.ongoing_expires_at||trial.ongoing_expires_at<=trial.now)return 'ongoing_expired';
  }else{
    if(trial.deadline && trial.deadline.getTime()<=trial.now.getTime())return 'trial_expired';
    if(trial.attempts_used>=3)return 'trial_exhausted';
  }
  if(!device||device.owner_id!==trial.owner_id||device.id!==trial.device_id||trialFingerprint(device.subscription_json)!==trial.subscription_hash)return 'device_unapproved';
  if(requireActive&&!trial.ongoing_started_at&&!trial.started_at)return 'trial_not_started';
  return null;
}
export async function readPushTrial(owner:string,pool:Pool=getKernelPool()) {
  const trial=(await pool.query('SELECT *,clock_timestamp() AS now FROM opscenter_kernel.push_trial WHERE singleton=true')).rows[0] as TrialRow|undefined;
  const ownerEligible=!!trial?.owner_id&&trial.owner_id===owner;
  const status=!trial?.owner_id?'unprepared':!ownerEligible?'not_allowed':trial.stopped_at?'stopped':trial.ongoing_started_at?(!trial.device_id?'ongoing_revoked':trial.ongoing_expires_at&&trial.ongoing_expires_at>trial.now?'ongoing':'ongoing_expired'):trial.deadline&&trial.deadline<=trial.now?'expired':trial.attempts_used>=3?'exhausted':!trial.device_id?'awaiting_device':!trial.started_at?'awaiting_start':'active';
  return {status,ownerEligible,canRequest:ownerEligible&&['awaiting_device','awaiting_start','active','ongoing'].includes(status),deadline:ownerEligible?(trial?.ongoing_started_at?trial.ongoing_expires_at:trial?.deadline):null,attemptsUsed:ownerEligible?trial?.attempts_used:0,maxAttempts:trial?.ongoing_started_at?null:3,durationMinutes:trial?.ongoing_started_at?null:30};
}
export type TrialAction = {action:'prepare';owner:string} | {action:'approve';owner:string;deviceId:string;fingerprint:string;expiresInMinutes:number} | {action:'revoke';owner:string;deviceId:string} | {action:'promote';owner:string;deviceId:string;fingerprint:string;verifiedEnrollmentExpiresAt:Date;handsetConfirmed:true} | {action:'start'} | {action:'stop'};
/** LOCAL OPERATOR CONTROL ONLY. No HTTP route, auto-approval or reset operation.
 * Call only after separate explicit human authorization of this exact action. */
export async function controlPushTrial(input:TrialAction,reference:string,pool:Pool=getKernelPool()) {
  if(!/^[A-Za-z0-9][A-Za-z0-9 ._:/-]{2,199}$/.test(reference))throw new Error('approval_reference_required');
  const client=await pool.connect();
  try {await client.query('BEGIN');const trial=await lockPushTrial(client);
    if(input.action==='prepare') {
      if(!input.owner||input.owner.length>200||trial.started_at||trial.device_id||trial.owner_id&&trial.owner_id!==input.owner||trial.stopped_at)throw new Error('trial_already_prepared');
      await client.query('UPDATE opscenter_kernel.push_trial SET owner_id=$1,approval_reference=$2 WHERE singleton=true',[input.owner,reference]);
    } else if(input.action==='promote') {
      const device=(await client.query('SELECT * FROM opscenter_kernel.push_devices WHERE id=$1 FOR UPDATE',[input.deviceId])).rows[0];
      trial.now=(await client.query('SELECT clock_timestamp() AS now')).rows[0].now;
      if(input.handsetConfirmed!==true||trial.stopped_at||trial.ongoing_started_at||!trial.started_at||trial.owner_id!==input.owner||trial.device_id!==input.deviceId||!device||device.revoked_at||device.owner_id!==input.owner||trial.subscription_hash!==input.fingerprint||trialFingerprint(device.subscription_json)!==input.fingerprint)throw new Error('verified_handset_required');
      const accepted=await client.query("SELECT 1 FROM opscenter_kernel.push_deliveries q JOIN opscenter_kernel.push_trial_attempts a ON a.claim_token=q.claim_token WHERE q.device_id=$1 AND q.status='accepted' LIMIT 1",[device.id]);
      if(!accepted.rows.length)throw new Error('accepted_trial_required');
      // Legacy trial shortened expires_at. The operator supplies its previously
      // verified enrollment ceiling, bounded by original creation + 30 days and
      // Apple's own subscription expiry. New enrollments persist this ceiling.
      const ceiling=device.enrollment_expires_at||input.verifiedEnrollmentExpiresAt;
      const expires=new Date(Math.min(ceiling.getTime(),device.created_at.getTime()+30*86400000,trial.now.getTime()+30*86400000,device.subscription_json.expirationTime||Infinity));
      if(!Number.isFinite(expires.getTime())||expires<=trial.now)throw new Error('invalid_ongoing_expiry');
      await client.query("UPDATE opscenter_kernel.push_deliveries SET status='skipped',reason='before_ongoing' WHERE status='pending'");
      await client.query('UPDATE opscenter_kernel.push_devices SET expires_at=$2,enrollment_expires_at=$2 WHERE id=$1',[device.id,expires]);
      await client.query('UPDATE opscenter_kernel.push_trial SET ongoing_started_at=$1,ongoing_expires_at=$2,approval_reference=$3 WHERE singleton=true',[trial.now,expires,reference]);
    } else if(input.action==='approve') {
      if(trial.ongoing_started_at)throw new Error('ongoing_device_requires_promotion');
      if(trial.owner_id!==input.owner||trial.stopped_at||trial.deadline&&trial.deadline<=trial.now||trial.attempts_used>=3)throw new Error('trial_closed');
      if(!Number.isInteger(input.expiresInMinutes)||input.expiresInMinutes<1||input.expiresInMinutes>30)throw new Error('invalid_device_expiry');
      const device=(await client.query('SELECT * FROM opscenter_kernel.push_devices WHERE id=$1 FOR UPDATE',[input.deviceId])).rows[0];
      trial.now=(await client.query('SELECT clock_timestamp() AS now')).rows[0].now;
      if(trial.deadline&&trial.deadline<=trial.now)throw new Error('trial_closed');
      if(!device||device.owner_id!==input.owner||device.revoked_at||device.expires_at<=trial.now||! /^[a-f0-9]{64}$/.test(input.fingerprint)||trialFingerprint(device.subscription_json)!==input.fingerprint)throw new Error('device_verification_failed');
      // Explicit replacement skips old pending work and never resets deadline/budget.
      await client.query("UPDATE opscenter_kernel.push_deliveries SET status='skipped',reason='approval_replaced' WHERE status='pending' AND device_id<>$1",[device.id]);
      await client.query('UPDATE opscenter_kernel.push_devices SET expires_at=LEAST(expires_at,$2::timestamptz) WHERE id=$1',[device.id,new Date(Math.min(trial.now.getTime()+input.expiresInMinutes*60000,trial.deadline?.getTime()||Infinity))]);
      await client.query('UPDATE opscenter_kernel.push_trial SET device_id=$1,subscription_hash=$2,approved_at=clock_timestamp(),approval_reference=$3 WHERE singleton=true',[device.id,input.fingerprint,reference]);
    } else if(input.action==='revoke') {
      const device=(await client.query('SELECT id FROM opscenter_kernel.push_devices WHERE id=$1 AND owner_id=$2 FOR UPDATE',[input.deviceId,input.owner])).rows[0];
      if(!device||trial.owner_id!==input.owner)throw new Error('device_verification_failed');
      await client.query('UPDATE opscenter_kernel.push_devices SET revoked_at=clock_timestamp() WHERE id=$1',[device.id]);
      await client.query("UPDATE opscenter_kernel.push_deliveries SET status='skipped',reason='revoked' WHERE device_id=$1 AND status='pending'",[device.id]);
      await client.query('UPDATE opscenter_kernel.push_trial SET device_id=NULL,subscription_hash=NULL,approved_at=NULL WHERE singleton=true AND device_id=$1',[device.id]);
    } else if(input.action==='start') {
      if(trial.started_at||trial.stopped_at||trial.attempts_used!==0)throw new Error('trial_cannot_restart');
      const device=(await client.query('SELECT * FROM opscenter_kernel.push_devices WHERE id=$1 FOR UPDATE',[trial.device_id])).rows[0];
      trial.now=(await client.query('SELECT clock_timestamp() AS now')).rows[0].now;
      if(trialReason(trial,device,false)||device.revoked_at||device.expires_at<=trial.now)throw new Error('approved_device_required');
      await client.query("UPDATE opscenter_kernel.push_trial SET started_at=$1,deadline=$1::timestamptz+interval '30 minutes',approval_reference=$2 WHERE singleton=true",[trial.now,reference]);
      await client.query("UPDATE opscenter_kernel.push_devices SET expires_at=LEAST(expires_at,$2::timestamptz+interval '30 minutes') WHERE id=$1",[device.id,trial.now]);
    } else if(input.action==='stop') {
      await client.query('UPDATE opscenter_kernel.push_trial SET stopped_at=COALESCE(stopped_at,clock_timestamp()) WHERE singleton=true');
      await client.query("UPDATE opscenter_kernel.push_deliveries SET status='skipped',reason='trial_stopped' WHERE status='pending'");
    } else throw new Error('invalid_trial_action');
    await client.query('INSERT INTO opscenter_kernel.push_trial_audit(action,reference,device_id) VALUES($1,$2,$3)',[input.action,reference,'deviceId' in input?input.deviceId:trial.device_id]);
    await client.query("SELECT pg_notify('opscenter_web_push','retention')");await client.query('COMMIT');
  }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
}
/** Rechecked immediately before transport and again after DNS. A reservation
 * is never refunded, including a crash or cancellation before network I/O. */
export async function authorizePushAttempt(pool:Pool,token:string,endpoint:string):Promise<boolean> {
  const result=await pool.query(`SELECT d.subscription_json,t.subscription_hash FROM (SELECT claim_token,event_id,device_id,false AS ongoing FROM opscenter_kernel.push_trial_attempts UNION ALL SELECT claim_token,event_id,device_id,true AS ongoing FROM opscenter_kernel.push_ongoing_attempts) a
    JOIN opscenter_kernel.push_trial t ON t.singleton=true
    JOIN opscenter_kernel.push_devices d ON d.id=a.device_id
    JOIN opscenter_kernel.push_deliveries q ON q.device_id=a.device_id AND q.event_id=a.event_id
    JOIN opscenter_kernel.push_events e ON e.id=a.event_id
    WHERE a.claim_token=$1 AND q.claim_token=$1 AND q.status='sending'
      AND t.device_id=d.id AND t.owner_id=d.owner_id AND t.started_at IS NOT NULL AND t.stopped_at IS NULL
      AND ((a.ongoing AND t.ongoing_started_at IS NOT NULL AND t.ongoing_expires_at>clock_timestamp()) OR (NOT a.ongoing AND t.ongoing_started_at IS NULL AND t.deadline>clock_timestamp())) AND d.expires_at>clock_timestamp() AND d.revoked_at IS NULL
      AND (t.reenabled_at IS NULL OR e.occurred_at>=t.reenabled_at) AND e.category=ANY(d.categories) AND COALESCE(e.source_recorded_at,e.occurred_at)>=GREATEST(COALESCE(t.ongoing_started_at,t.started_at),t.reenabled_at)`,[token]);
  const row=result.rows[0];return !!row&&row.subscription_json.endpoint===endpoint&&trialFingerprint(row.subscription_json)===row.subscription_hash;
}
