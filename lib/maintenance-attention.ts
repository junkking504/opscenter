import type { MaintenanceSnapshot } from '../desktop-ui/lib/maintenance-contract';
export function maintenanceAttention(snapshot: MaintenanceSnapshot) {
  const issues = snapshot.incidents.filter(i => i.kind === 'technical' && (i.status === 'open' || i.status === 'verification-needed'));
  const aiUnavailable = /unavailable|paused|disabled|budget|limit|waiting/i.test(snapshot.aiStatus);
  const needsAttention = !snapshot.fresh || aiUnavailable || issues.length > 0;
  const summary = !snapshot.fresh ? 'Maintenance checks are stale or unavailable'
    : issues.length ? `${issues.length} system issue${issues.length === 1 ? '' : 's'} need attention`
    : aiUnavailable ? 'AI diagnosis needs attention' : 'Checks current';
  return { needsAttention, summary, aiUnavailable, issues };
}
