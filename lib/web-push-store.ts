import { lockPushTrial, trialFingerprint } from './web-push-trial';
import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { getKernelPool } from './platform/persistence/pool';
import { pushHash, PUSH_ACTIONS, type PushCategory } from './web-push-policy';
export type PushSubscriptionRecord = {endpoint:string; keys:{p256dh:string;auth:string};expirationTime?:number|null};
export async function managePushDevice(owner: string, input: {action:'subscribe'|'unsubscribe';deviceId?:string;subscription?:PushSubscriptionRecord;categories?:PushCategory[];expiresAt:Date}, pool: Pool = getKernelPool()) {
  const client=await pool.connect();
  try {
    await client.query('BEGIN');
    const trial=await lockPushTrial(client);
    // Serializes enrollment and caps per owner, including simultaneous tabs.
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',[`push-owner:${owner}`]);
    let id=input.deviceId || randomUUID();
    if(input.action==='unsubscribe') {
      const owned=await client.query('SELECT id FROM opscenter_kernel.push_devices WHERE id=$1 AND owner_id=$2 FOR UPDATE',[id,owner]);
      if(!owned.rows.length){await client.query('COMMIT');return id;}
      await client.query('UPDATE opscenter_kernel.push_devices SET revoked_at=now() WHERE id=$1 AND owner_id=$2',[id,owner]);
      await client.query("UPDATE opscenter_kernel.push_deliveries SET status='skipped',reason='revoked' WHERE device_id=$1 AND status='pending'",[id]);
      await client.query('UPDATE opscenter_kernel.push_trial SET device_id=NULL,subscription_hash=NULL,approved_at=NULL WHERE singleton=true AND device_id=$1',[id]);
    } else {
      if(trial.owner_id!==owner||trial.stopped_at||trial.deadline&&trial.deadline<=trial.now||trial.attempts_used>=3)throw new Error('trial_enrollment_closed');
      const hash=pushHash(input.subscription!.endpoint);
      const existing=await client.query('SELECT id,owner_id,revoked_at,expires_at FROM opscenter_kernel.push_devices WHERE endpoint_hash=$1 FOR UPDATE',[hash]);
      trial.now=(await client.query('SELECT clock_timestamp() AS now')).rows[0].now;
      if(trial.deadline&&trial.deadline<=trial.now)throw new Error('trial_enrollment_closed');
      if(existing.rows[0] && existing.rows[0].owner_id!==owner) throw new Error('Device belongs to another account.');
      id=existing.rows[0]?.id || id;
      const approved=trial.device_id===id;
      if(trial.device_id && (!approved||trial.subscription_hash!==trialFingerprint(input.subscription!)))throw new Error('different_device_not_approved');
      // An expired/revoked approval cannot be renewed by a shared-login request.
      if(approved && (existing.rows[0]?.revoked_at||existing.rows[0]?.expires_at<=trial.now))throw new Error('new_device_approval_required');
      const expiresAt=new Date(Math.min(input.expiresAt.getTime(),trial.deadline?.getTime()||Infinity,approved?existing.rows[0].expires_at.getTime():Infinity));
      if(expiresAt<=trial.now)throw new Error('device_expired');
      const count=await client.query('SELECT count(*)::int AS count FROM opscenter_kernel.push_devices WHERE owner_id=$1 AND revoked_at IS NULL AND expires_at>now()',[owner]);
      if((!existing.rows.length || existing.rows[0].revoked_at || new Date(existing.rows[0].expires_at).getTime()<=Date.now()) && count.rows[0].count>=10) throw new Error('Device limit reached.');
      const saved=await client.query(`INSERT INTO opscenter_kernel.push_devices(id,owner_id,endpoint_hash,subscription_json,categories,expires_at)
        VALUES($1,$2,$3,$4::jsonb,$5,$6) ON CONFLICT(endpoint_hash) DO UPDATE SET subscription_json=EXCLUDED.subscription_json,categories=EXCLUDED.categories,expires_at=EXCLUDED.expires_at,revoked_at=NULL,created_at=CASE WHEN push_devices.revoked_at IS NOT NULL OR push_devices.expires_at<=now() THEN now() ELSE push_devices.created_at END WHERE push_devices.owner_id=EXCLUDED.owner_id RETURNING id`,[id,owner,hash,JSON.stringify(input.subscription),input.categories,expiresAt]);
      if(saved.rows.length!==1)throw new Error('Device ownership changed.');
    }
    if(input.action==='subscribe') await client.query("UPDATE opscenter_kernel.push_deliveries q SET status='skipped',reason='category_disabled' FROM opscenter_kernel.push_events e WHERE q.event_id=e.id AND q.device_id=$1 AND q.status='pending' AND NOT(e.category=ANY($2::text[]))",[id,input.categories]);
    await client.query('INSERT INTO opscenter_kernel.push_audit(owner_id,action,device_id) VALUES($1,$2,$3)',[owner,PUSH_ACTIONS[input.action],id]);
    await client.query("SELECT pg_notify('opscenter_web_push','retention')");
    await client.query('COMMIT'); return id;
  } catch(error) {await client.query('ROLLBACK');throw error;} finally {client.release();}
}
export async function listPushDevices(owner: string, pool: Pool = getKernelPool()) {
  const result=await pool.query(`SELECT d.id,d.categories,d.created_at,d.expires_at,d.subscription_json,t.device_id,t.subscription_hash
    FROM opscenter_kernel.push_devices d LEFT JOIN opscenter_kernel.push_trial t ON t.singleton=true AND t.owner_id=d.owner_id
    WHERE d.owner_id=$1 AND d.revoked_at IS NULL AND d.expires_at>clock_timestamp() ORDER BY d.created_at DESC`,[owner]);
  return result.rows.map(({subscription_json,device_id,subscription_hash,...device})=>{
    const fingerprint=trialFingerprint(subscription_json);
    return {...device,fingerprint,approved:device.id===device_id&&fingerprint===subscription_hash};
  });
}

/** Manager-only settings route exposes codes, never raw SQL or provider errors. */
export async function readPushHealth(pool:Pool=getKernelPool()) {
  const day=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Chicago',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  const expected=[...['352','477','399','484'].map(id=>`schedule:${day}:market-${id}`),`krewe:${day}`,`fleet:${day}`];
  const current=await pool.query('SELECT h.scope,h.code,h.recorded_at,g.code AS reason FROM opscenter_kernel.push_health h LEFT JOIN opscenter_kernel.push_gaps g ON g.scope=h.scope WHERE h.scope=ANY($1::text[])',[expected]);
  const gaps=await pool.query("SELECT scope,CASE WHEN resolved_at IS NULL THEN 'coverage_gap' ELSE 'recovered_gap' END AS code,code AS reason,observed_at,resolved_at,recorded_at FROM opscenter_kernel.push_gaps ORDER BY recorded_at DESC LIMIT 20");
  return [...current.rows.filter(row=>!gaps.rows.some(gap=>gap.scope===row.scope)),...gaps.rows,...expected.filter(scope=>!current.rows.some(row=>row.scope===scope)&&!gaps.rows.some(row=>row.scope===scope)).map(scope=>({scope,code:'source_unknown',recorded_at:null}))];
}
