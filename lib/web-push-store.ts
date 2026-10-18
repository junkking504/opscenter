import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { getKernelPool } from './platform/persistence/pool';
import { pushHash, PUSH_ACTIONS, type PushCategory } from './web-push-policy';
export type PushSubscriptionRecord = {endpoint:string; keys:{p256dh:string;auth:string};expirationTime?:number|null};
export async function managePushDevice(owner: string, input: {action:'subscribe'|'unsubscribe';deviceId?:string;subscription?:PushSubscriptionRecord;categories?:PushCategory[];expiresAt:Date}, pool: Pool = getKernelPool()) {
  const client=await pool.connect();
  try {
    await client.query('BEGIN');
    // Serializes enrollment and caps per owner, including simultaneous tabs.
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',[`push-owner:${owner}`]);
    let id=input.deviceId || randomUUID();
    if(input.action==='unsubscribe') {
      await client.query('DELETE FROM opscenter_kernel.push_devices WHERE id=$1 AND owner_id=$2',[id,owner]);
    } else {
      const hash=pushHash(input.subscription!.endpoint);
      const existing=await client.query('SELECT id,owner_id FROM opscenter_kernel.push_devices WHERE endpoint_hash=$1 FOR UPDATE',[hash]);
      if(existing.rows[0] && existing.rows[0].owner_id!==owner) throw new Error('Device belongs to another account.');
      id=existing.rows[0]?.id || id;
      const count=await client.query('SELECT count(*)::int AS count FROM opscenter_kernel.push_devices WHERE owner_id=$1',[owner]);
      if(!existing.rows.length && count.rows[0].count>=10) throw new Error('Device limit reached.');
      const saved=await client.query(`INSERT INTO opscenter_kernel.push_devices(id,owner_id,endpoint_hash,subscription_json,categories,expires_at)
        VALUES($1,$2,$3,$4::jsonb,$5,$6) ON CONFLICT(endpoint_hash) DO UPDATE SET subscription_json=EXCLUDED.subscription_json,categories=EXCLUDED.categories,expires_at=EXCLUDED.expires_at WHERE push_devices.owner_id=EXCLUDED.owner_id RETURNING id`,[id,owner,hash,JSON.stringify(input.subscription),input.categories,input.expiresAt]);
      if(saved.rows.length!==1)throw new Error('Device ownership changed.');
    }
    if(input.action==='subscribe') await client.query("UPDATE opscenter_kernel.push_deliveries SET status='skipped' WHERE device_id=$1 AND status='pending'",[id]);
    await client.query('INSERT INTO opscenter_kernel.push_audit(owner_id,action,device_id) VALUES($1,$2,$3)',[owner,PUSH_ACTIONS[input.action],id]);
    await client.query('COMMIT'); return id;
  } catch(error) {await client.query('ROLLBACK');throw error;} finally {client.release();}
}
export async function listPushDevices(owner: string, pool: Pool = getKernelPool()) {
  const result=await pool.query('SELECT id,categories,created_at,expires_at FROM opscenter_kernel.push_devices WHERE owner_id=$1 ORDER BY created_at DESC',[owner]);
  return result.rows;
}
