import type { PoolClient, Client } from 'pg';
/** Event/startup maintenance, never an interval. Closed date scopes cannot be
 * reopened after retention; source ingestion rejects that old date first. */
export async function retainPushMetadata(client:PoolClient|Client) {
  await client.query("UPDATE opscenter_kernel.push_deliveries q SET status='skipped',reason='stale' FROM opscenter_kernel.push_events e WHERE q.event_id=e.id AND q.status='pending' AND e.occurred_at<now()-interval '15 minutes'");
  await client.query("DELETE FROM opscenter_kernel.push_events WHERE recorded_at<now()-interval '7 days' AND NOT EXISTS(SELECT 1 FROM opscenter_kernel.push_deliveries q WHERE q.event_id=push_events.id AND q.status IN ('pending','sending'))");
  await client.query("DELETE FROM opscenter_kernel.push_audit WHERE recorded_at<now()-interval '90 days'");
  await client.query("DELETE FROM opscenter_kernel.push_devices WHERE GREATEST(expires_at,COALESCE(revoked_at,expires_at))<now()-interval '90 days' AND NOT EXISTS(SELECT 1 FROM opscenter_kernel.push_deliveries q WHERE q.device_id=push_devices.id AND q.status IN ('pending','sending'))");
  // Keep a bounded replay window and a permanent watermark for each active
  // scope. Older conflicting replays fail closed instead of becoming new events.
  await client.query('UPDATE opscenter_kernel.push_sources SET archived_sequence=GREATEST(archived_sequence,sequence-10000)');
  await client.query('DELETE FROM opscenter_kernel.push_batches b USING opscenter_kernel.push_sources s WHERE b.scope=s.scope AND b.sequence<=s.archived_sequence');
  const expired="scope ~ '^(schedule|krewe|fleet):[0-9]{4}-[0-9]{2}-[0-9]{2}(:|$)' AND substring(scope from '[0-9]{4}-[0-9]{2}-[0-9]{2}')<to_char((now() AT TIME ZONE 'UTC')::date-7,'YYYY-MM-DD')";
  for(const table of ['push_observations','push_batches','push_sources','push_health'])await client.query(`DELETE FROM opscenter_kernel.${table} WHERE ${expired}`);
}
