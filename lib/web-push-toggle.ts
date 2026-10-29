import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { getKernelPool } from './platform/persistence/pool';
import { lockPushTrial, trialFingerprint } from './web-push-trial';
import { pushCategories, pushHash, pushSubscription } from './web-push-policy';
import type { PushSubscriptionRecord } from './web-push-store';

/** Authenticated, same-origin explicit ON only. GET/startup never calls this. */
export async function enablePushDevice(owner:string,input:{subscription:PushSubscriptionRecord;categories:unknown},pool:Pool=getKernelPool()) {
 const subscription=pushSubscription(input.subscription),categories=pushCategories(input.categories),fingerprint=trialFingerprint(subscription);
 const client=await pool.connect();
 try {
  await client.query('BEGIN');
  const trial=await lockPushTrial(client);
  if(trial.owner_id!==owner)throw Error('owner_required');
  if(trial.stopped_at)throw Error('service_stopped');
  await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',[`push-owner:${owner}`]);
  const hash=pushHash(subscription.endpoint);
  const old=(await client.query('SELECT * FROM opscenter_kernel.push_devices WHERE endpoint_hash=$1 FOR UPDATE',[hash])).rows[0];
  if(old&&old.owner_id!==owner)throw Error('device_owner_mismatch');
  if(old?.invalidated_at&&trialFingerprint(old.subscription_json)===fingerprint)throw Error('subscription_invalid');
  const now=(await client.query('SELECT clock_timestamp() AS now')).rows[0].now as Date;
  // A browser/provider expiry is honored; session and legacy trial expiry are not
  // device-consent deadlines. Null means no provider expiry was supplied.
  const expiry=subscription.expirationTime?new Date(subscription.expirationTime):null;
  if(expiry&&expiry<=now)throw Error('subscription_expired');
  const unchanged=old&&!old.revoked_at&&old.consented_at&&old.consent_fingerprint===fingerprint&&(old.expires_at?.getTime()??null)===(expiry?.getTime()??null)&&(!old.expires_at||old.expires_at>now)&&JSON.stringify([...old.categories].sort())===JSON.stringify([...categories].sort());
  if(unchanged){await client.query('COMMIT');return {deviceId:old.id,expiresAt:old.expires_at};}
  const count=(await client.query('SELECT count(*)::int AS count FROM opscenter_kernel.push_devices WHERE owner_id=$1 AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at>$2)',[owner,now])).rows[0].count;
  if((!old||old.revoked_at||old.expires_at&&old.expires_at<=now)&&count>=10)throw Error('device_limit');
  const id=old?.id||randomUUID();
  await client.query(`INSERT INTO opscenter_kernel.push_devices(id,owner_id,endpoint_hash,subscription_json,categories,created_at,expires_at,consented_at,consent_fingerprint)
    VALUES($1,$2,$3,$4::jsonb,$5,$6,$7,$6,$8) ON CONFLICT(endpoint_hash) DO UPDATE SET
    subscription_json=EXCLUDED.subscription_json,categories=EXCLUDED.categories,expires_at=EXCLUDED.expires_at,
    consented_at=EXCLUDED.consented_at,consent_fingerprint=EXCLUDED.consent_fingerprint,revoked_at=NULL,invalidated_at=NULL`,
    [id,owner,hash,JSON.stringify(subscription),categories,now,expiry,fingerprint]);
  await client.query("UPDATE opscenter_kernel.push_deliveries SET status='skipped',reason='before_device_enable' WHERE device_id=$1 AND status='pending'",[id]);
  await client.query('DELETE FROM opscenter_kernel.push_reenable_requests WHERE owner_id=$1',[owner]);
  await client.query("INSERT INTO opscenter_kernel.push_audit(owner_id,action,device_id) VALUES($1,'push.device.enabled',$2)",[owner,id]);
  await client.query("SELECT pg_notify('opscenter_web_push','retention')");
  await client.query('COMMIT');return {deviceId:id,expiresAt:expiry};
 }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
}
