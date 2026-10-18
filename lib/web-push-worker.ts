import type { Pool } from 'pg';
import { getKernelPool } from './platform/persistence/pool';
import { pushEnabled, pushOutcome, pushHash } from './web-push-policy';
import { pushEventId, type PushBatch } from './web-push-events';
import { sendAppleWakeup } from './web-push-transport';
import { allowedSessionIdentity, opsAuthRole } from './auth';
import { opsRoleCan } from './ops-roles';
export type PushWorkerDependencies = {pool:Pool;enabled:()=>boolean;send:(endpoint:string)=>Promise<number>;ownerAllowed:(owner:string)=>boolean;activatedAt:string};
/** Dependency injection is for local mocks; there is no HTTP dispatch endpoint. */
export async function runPushWorker(batches: PushBatch[], deps?: PushWorkerDependencies) {
  if(!deps && !pushEnabled()) return {disabled:true,attempted:0};
  const d=deps || {pool:getKernelPool(),enabled:pushEnabled,send:sendAppleWakeup,ownerAllowed:(owner:string)=>allowedSessionIdentity(owner) && opsRoleCan(opsAuthRole(owner),'sensitive.write'),activatedAt:process.env.OPSCENTER_WEB_PUSH_ACTIVATED_AT!};
  if(!d.enabled()) return {disabled:true,attempted:0};
  const client=await d.pool.connect();let attempted=0,locked=false;
  try {
    const lock=await client.query('SELECT pg_try_advisory_lock(680018001) AS locked');
    if(!lock.rows[0].locked)return {busy:true,attempted};
    locked=true;
    // A crash after reservation has an unknown result. Never resend automatically.
    await client.query("UPDATE opscenter_kernel.push_deliveries SET status='uncertain' WHERE status='sending'");
    await client.query('DELETE FROM opscenter_kernel.push_devices WHERE expires_at<=now()');
    await client.query("DELETE FROM opscenter_kernel.push_events WHERE observed_at<now()-interval '7 days'");
    await client.query("DELETE FROM opscenter_kernel.push_sources WHERE observed_at<now()-interval '7 days'");
    await client.query("DELETE FROM opscenter_kernel.push_audit WHERE recorded_at<now()-interval '90 days'");
    await client.query("DELETE FROM opscenter_kernel.push_observations WHERE observed_at<now()-interval '7 days'");
    for(const batch of batches) {
      const stamp=Date.parse(batch.observedAt);
      if(!Number.isFinite(stamp) || stamp>Date.now() || Date.now()-stamp>10*60000)continue;
      await client.query('BEGIN');
      const initialized=await client.query('SELECT scope,observed_at FROM opscenter_kernel.push_sources WHERE scope=$1',[batch.scope]);
      if(initialized.rows[0] && new Date(initialized.rows[0].observed_at).getTime()>=stamp){await client.query('COMMIT');continue;}
      for(const item of batch.observations) {
        const identity=pushHash(item.identity),revision=pushHash(item.revision);
        const previous=await client.query('SELECT revision_hash,version FROM opscenter_kernel.push_observations WHERE scope=$1 AND identity_hash=$2',[batch.scope,identity]);
        if(previous.rows[0]?.revision_hash===revision)continue;
        const version=(previous.rows[0]?.version || 0)+1;
        await client.query(`INSERT INTO opscenter_kernel.push_observations(scope,identity_hash,revision_hash,version,observed_at) VALUES($1,$2,$3,$4,$5)
          ON CONFLICT(scope,identity_hash) DO UPDATE SET revision_hash=EXCLUDED.revision_hash,version=EXCLUDED.version,observed_at=EXCLUDED.observed_at`,[batch.scope,identity,revision,version,batch.observedAt]);
        const id=pushEventId(batch,item,version);
        const inserted=await client.query('INSERT INTO opscenter_kernel.push_events(id,category) VALUES($1,$2) ON CONFLICT DO NOTHING RETURNING id',[id,batch.category]);
        if(inserted.rows.length && initialized.rows.length && Date.parse(batch.observedAt)>=Date.parse(d.activatedAt)) {
          await client.query(`INSERT INTO opscenter_kernel.push_deliveries(event_id,device_id)
            SELECT $1,id FROM opscenter_kernel.push_devices WHERE $2=ANY(categories) AND expires_at>now() AND created_at<=$3
            ON CONFLICT DO NOTHING`,[id,batch.category,batch.observedAt]);
        }
      }
      await client.query('INSERT INTO opscenter_kernel.push_sources(scope,observed_at) VALUES($1,$2) ON CONFLICT(scope) DO UPDATE SET observed_at=EXCLUDED.observed_at',[batch.scope,batch.observedAt]);
      await client.query('COMMIT');
    }
    const pending=await client.query(`SELECT DISTINCT ON(q.device_id) q.event_id,q.device_id,e.category,e.observed_at FROM opscenter_kernel.push_deliveries q
      JOIN opscenter_kernel.push_events e ON e.id=q.event_id WHERE q.status='pending' ORDER BY q.device_id,e.observed_at DESC,q.event_id LIMIT 50`);
    for(const delivery of pending.rows) {
      if(!d.enabled())break;
      await client.query("UPDATE opscenter_kernel.push_deliveries SET status='sending',attempted_at=now() WHERE device_id=$1 AND status='pending'",[delivery.device_id]);
      await client.query('BEGIN');
      // Serializes with revoke/preferences. Re-check immediately before each send.
      const found=await client.query('SELECT * FROM opscenter_kernel.push_devices WHERE id=$1 AND expires_at>now() FOR UPDATE',[delivery.device_id]);
      const device=found.rows[0];let status='skipped';
      if(d.enabled() && device && d.ownerAllowed(device.owner_id) && device.categories.includes(delivery.category) && new Date(delivery.observed_at).getTime()>=Date.parse(d.activatedAt) && Date.now()-new Date(delivery.observed_at).getTime()<15*60000) {
        attempted++;
        try {status=pushOutcome(await d.send(device.subscription_json.endpoint));} catch {status='uncertain';}
      }
      if(status==='expired') await client.query('DELETE FROM opscenter_kernel.push_devices WHERE id=$1',[delivery.device_id]);
      else await client.query('UPDATE opscenter_kernel.push_deliveries SET status=$3 WHERE event_id=$1 AND device_id=$2',[delivery.event_id,delivery.device_id,status]);
      if(status!=='expired') await client.query("UPDATE opscenter_kernel.push_deliveries SET status=$2,attempted_at=now() WHERE device_id=$1 AND status='sending'",[delivery.device_id,status]);
      await client.query('COMMIT');
    }
    return {attempted};
  } catch {await client.query('ROLLBACK');throw new Error('Push worker stopped; inspect sanitized delivery receipts.');}
  finally {try {if(locked)await client.query('SELECT pg_advisory_unlock(680018001)');} finally {client.release();}}
}
