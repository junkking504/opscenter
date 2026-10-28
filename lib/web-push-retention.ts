import type { PoolClient, Client } from 'pg';
/** Event/startup maintenance, never an interval. Preserve source watermarks
 * while retained publications may still need ordered recovery. */
export async function retainPushMetadata(client:PoolClient|Client) {
  await client.query("DELETE FROM opscenter_kernel.push_reenable_requests WHERE expires_at<now()");
  await client.query("DELETE FROM opscenter_kernel.push_events WHERE recorded_at<now()-interval '14 days' AND NOT EXISTS(SELECT 1 FROM opscenter_kernel.push_deliveries q WHERE q.event_id=push_events.id AND q.status IN ('pending','sending'))");
  await client.query("DELETE FROM opscenter_kernel.push_ongoing_attempts a WHERE reserved_at<now()-interval '90 days' AND NOT EXISTS(SELECT 1 FROM opscenter_kernel.push_deliveries q WHERE q.claim_token=a.claim_token AND q.status IN ('pending','sending'))");
  await client.query("DELETE FROM opscenter_kernel.push_audit WHERE recorded_at<now()-interval '90 days'");
  await client.query("DELETE FROM opscenter_kernel.push_devices WHERE ((expires_at IS NOT NULL AND GREATEST(expires_at,COALESCE(revoked_at,expires_at))<now()-interval '90 days') OR (expires_at IS NULL AND revoked_at<now()-interval '90 days')) AND NOT EXISTS(SELECT 1 FROM opscenter_kernel.push_deliveries q WHERE q.device_id=push_devices.id AND q.status IN ('pending','sending'))");
  // Keep a bounded replay window and a permanent watermark for each active
  // scope. Older conflicting replays fail closed instead of becoming new events.
  await client.query('UPDATE opscenter_kernel.push_sources SET archived_sequence=GREATEST(archived_sequence,sequence-10000)');
  await client.query('DELETE FROM opscenter_kernel.push_batches b USING opscenter_kernel.push_sources s WHERE b.scope=s.scope AND b.sequence<=s.archived_sequence');
  // Source/observation retirement runs separately under source and producer
  // locks, with matching checkpoints, retained-reference guards and a permanent
  // compact date floor. Pending/sending deliveries never expire by age.
}
