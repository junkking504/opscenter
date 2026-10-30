import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { getKernelPool } from './platform/persistence/pool';
import { lockPushTrial, trialFingerprint, type TrialRow } from './web-push-trial';
import { pushCategories, pushHash, pushSubscription } from './web-push-policy';
import type { PushSubscriptionRecord } from './web-push-store';

// A shared manager login can REQUEST recovery, never authorize a replacement.
// The local owner control must verify the exact request ID and fingerprint.
async function previousDevice(client: PoolClient, owner: string, trial: TrialRow) {
  if (trial.owner_id !== owner || trial.stopped_at || trial.device_id || !trial.ongoing_started_at || !trial.ongoing_expires_at || trial.ongoing_expires_at <= trial.now) return null;
  const result = await client.query(`SELECT d.* FROM opscenter_kernel.push_trial_audit a
    JOIN opscenter_kernel.push_devices d ON d.id=a.device_id
    WHERE a.action IN ('promote','reenable') ORDER BY a.recorded_at DESC,a.id DESC LIMIT 1`);
  const device = result.rows[0];
  return device && device.owner_id === owner && device.revoked_at && device.expires_at > trial.now ? device : null;
}
export async function readPushReenable(owner: string, pool: Pool = getKernelPool()) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const trial = await lockPushTrial(client), source = await previousDevice(client, owner, trial);
    const pending = source ? (await client.query(`SELECT id,fingerprint,categories,expires_at FROM opscenter_kernel.push_reenable_requests
      WHERE owner_id=$1 AND source_device_id=$2 AND source_revoked_at=$3 AND expires_at>$4`, [owner, source.id, source.revoked_at, trial.now])).rows[0] : null;
    await client.query('COMMIT');
    return { eligible: Boolean(source), categories: source?.categories || [], pending: pending || null };
  } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
}
export async function requestPushReenable(owner: string, input: { subscription: PushSubscriptionRecord; categories: unknown; expiresAt: Date }, pool: Pool = getKernelPool()) {
  const subscription = pushSubscription(input.subscription), categories = pushCategories(input.categories), fingerprint = trialFingerprint(subscription);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const trial = await lockPushTrial(client), source = await previousDevice(client, owner, trial);
    if (!source) throw new Error('reenable_not_available');
    if (categories.some(category => !source.categories.includes(category))) throw new Error('category_scope_changed');
    const grantExpiry = new Date(Math.min(source.expires_at.getTime(), trial.ongoing_expires_at!.getTime(), input.expiresAt.getTime(), subscription.expirationTime || Infinity));
    if (!Number.isFinite(grantExpiry.getTime()) || grantExpiry <= trial.now) throw new Error('reenable_expired');
    const existing = (await client.query('SELECT * FROM opscenter_kernel.push_reenable_requests WHERE owner_id=$1', [owner])).rows[0];
    if (existing && existing.expires_at > trial.now && existing.source_device_id === source.id && existing.source_revoked_at.getTime() === source.revoked_at.getTime() && existing.fingerprint === fingerprint && JSON.stringify(existing.categories) === JSON.stringify(categories)) {
      await client.query('COMMIT'); return { requestId: existing.id };
    }
    const id = randomUUID();
    await client.query(`INSERT INTO opscenter_kernel.push_reenable_requests(owner_id,id,source_device_id,source_revoked_at,subscription_json,fingerprint,categories,requested_at,expires_at,grant_expires_at)
      VALUES($1,$2,$3,$4,$5::jsonb,$6,$7,$8,LEAST($9::timestamptz,$8::timestamptz+interval '15 minutes'),$9)
      ON CONFLICT(owner_id) DO UPDATE SET id=EXCLUDED.id,source_device_id=EXCLUDED.source_device_id,source_revoked_at=EXCLUDED.source_revoked_at,subscription_json=EXCLUDED.subscription_json,fingerprint=EXCLUDED.fingerprint,categories=EXCLUDED.categories,requested_at=EXCLUDED.requested_at,expires_at=EXCLUDED.expires_at,grant_expires_at=EXCLUDED.grant_expires_at`,
      [owner,id,source.id,source.revoked_at,JSON.stringify(subscription),fingerprint,categories,trial.now,grantExpiry]);
    await client.query("INSERT INTO opscenter_kernel.push_audit(owner_id,action,device_id) VALUES($1,'push.device.reenable_requested',$2)",[owner,source.id]);
    await client.query('COMMIT'); return { requestId: id };
  } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
}
/** Explicit local operator action, only after owner verification of this request. */
export async function authorizePushReenable(input: { owner: string; requestId: string; fingerprint: string; handsetConfirmed: boolean; reference: string }, pool: Pool = getKernelPool()) {
  if (!input.handsetConfirmed || !/^[a-f0-9]{64}$/.test(input.fingerprint) || !/^[A-Za-z0-9][A-Za-z0-9 ._:/-]{2,199}$/.test(input.reference)) throw new Error('explicit_phone_authorization_required');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const trial = await lockPushTrial(client), source = await previousDevice(client, input.owner, trial);
    const request = (await client.query('SELECT * FROM opscenter_kernel.push_reenable_requests WHERE owner_id=$1 AND id=$2 FOR UPDATE',[input.owner,input.requestId])).rows[0];
    if (!source || !request || request.source_device_id !== source.id || request.source_revoked_at.getTime() !== source.revoked_at.getTime() || request.expires_at <= trial.now || request.grant_expires_at <= trial.now || request.fingerprint !== input.fingerprint || trialFingerprint(request.subscription_json) !== input.fingerprint) throw new Error('request_verification_failed');
    const subscription = pushSubscription(request.subscription_json), categories = pushCategories(request.categories);
    if (categories.some(category => !source.categories.includes(category))) throw new Error('category_scope_changed');
    const expiry = new Date(Math.min(request.grant_expires_at.getTime(),source.expires_at.getTime(),trial.ongoing_expires_at!.getTime(),subscription.expirationTime || Infinity));
    const hash = pushHash(subscription.endpoint);
    const old = (await client.query('SELECT * FROM opscenter_kernel.push_devices WHERE endpoint_hash=$1 FOR UPDATE',[hash])).rows[0];
    if (old && (old.owner_id !== input.owner || !old.revoked_at)) throw new Error('subscription_not_available');
    const id = old?.id || randomUUID();
    await client.query(`INSERT INTO opscenter_kernel.push_devices(id,owner_id,endpoint_hash,subscription_json,categories,created_at,expires_at,enrollment_expires_at)
      VALUES($1,$2,$3,$4::jsonb,$5,$6,$7,$7)
      ON CONFLICT(endpoint_hash) DO UPDATE SET subscription_json=EXCLUDED.subscription_json,categories=EXCLUDED.categories,created_at=EXCLUDED.created_at,expires_at=EXCLUDED.expires_at,enrollment_expires_at=EXCLUDED.enrollment_expires_at,revoked_at=NULL`,[id,input.owner,hash,JSON.stringify(subscription),categories,trial.now,expiry]);
    // Preserve all receipts/history. Nothing waiting from the revoked interval may send.
    await client.query("UPDATE opscenter_kernel.push_deliveries q SET status='skipped',reason='before_reenable' FROM opscenter_kernel.push_devices d WHERE q.device_id=d.id AND d.owner_id=$1 AND q.status='pending'",[input.owner]);
    await client.query('UPDATE opscenter_kernel.push_trial SET device_id=$1,subscription_hash=$2,approved_at=$3,reenabled_at=$3,approval_reference=$4 WHERE singleton=true',[id,input.fingerprint,trial.now,input.reference]);
    await client.query("INSERT INTO opscenter_kernel.push_trial_audit(action,reference,device_id) VALUES('reenable',$1,$2)",[input.reference,id]);
    await client.query("INSERT INTO opscenter_kernel.push_audit(owner_id,action,device_id) VALUES($1,'push.device.reenabled',$2)",[input.owner,id]);
    await client.query('DELETE FROM opscenter_kernel.push_reenable_requests WHERE owner_id=$1',[input.owner]);
    await client.query("SELECT pg_notify('opscenter_web_push','retention')");
    await client.query('COMMIT'); return { deviceId: id, expiresAt: expiry };
  } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
}
