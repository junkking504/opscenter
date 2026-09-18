import type {HierarchyFeed, HierarchyFinding} from '../desktop-ui/lib/agent-hierarchy-contract';
import type {MaintenanceState} from '../desktop-ui/lib/maintenance-contract';
import {agentScheduleHref} from '../desktop-ui/lib/truck-agent-contract';
import {hierarchyFresh} from './agent-hierarchy';
import {monthKey, MONTHLY_BUDGET_MICROS} from './maintenance-monitor';
import {ADDRESS_RESEARCH_LIMIT_MICROS} from './metered-usage-policy';

type AddressJob = {appointmentId: string; jkNumber: string; status: string; located: boolean};
const monitor = '/desktop?data=live&workspace=Command&commandView=monitor';

/** Whole-schedule coverage includes unassigned appointments, unlike truck rules. */
export function scheduleAddressFeed(date: string, jobs: AddressJob[], observedAt: string | null, now: number): HierarchyFeed {
  const available = hierarchyFresh(observedAt, now, 120_000);
  const unresolved = jobs.filter(j => !/cancel|no.?show|complet|closed/i.test(j.status) && !j.located);
  const findings: HierarchyFinding[] = unresolved.map(j => ({
    id: `appointment-location:${date}:${j.appointmentId}`, feed: 'schedule-addresses',
    title: `${j.jkNumber || j.appointmentId}: service location unresolved`,
    detail: 'No verified service location. Map placement and closest-truck guidance are unavailable. Dispatch must follow through on address recovery; this includes unassigned appointments. Escalates to Control if the review deadline passes.',
    href: agentScheduleHref(date, j.appointmentId), origin: 'dispatch', target: 'dispatch', priority: 'urgent',
  }));
  return {id: 'schedule-addresses', available, observedAt, detail: `${jobs.length} appointments checked; ${unresolved.length} open appointments lack a verified location.`, findings};
}

/** Read-only oversight: never requests research, changes a ledger or raises limits. */
export function addressResearchFeed(state: MaintenanceState, now: number): HierarchyFeed {
  const queue = state.addressResearch;
  if (!queue) throw new Error('Address research evidence unavailable');
  const available = hierarchyFresh(queue.checkedAt, now);
  const active = Object.values(queue.items).filter(r => !['inactive','resolved'].includes(r.status));
  const usage = state.months[monthKey(now)];
  const limit = usage?.calls >= 500 ? 'Shared monthly research/maintenance call limit reached (500/500).'
    : usage && usage.committedMicros + ADDRESS_RESEARCH_LIMIT_MICROS > MONTHLY_BUDGET_MICROS ? 'Shared monthly budget cannot reserve another address investigation.' : '';
  const stopped = /paused|cooling|allowance reached|budget/i.test(queue.status);
  const failed = active.filter(r => ['unresolved','provider_error'].includes(r.status)).length;
  const stalled = active.some(r => !Number.isFinite(Date.parse(r.updatedAt)) || now - Date.parse(r.updatedAt) >= 15 * 60_000);
  const needsReview = Boolean(limit) || active.length > 0 && (stopped || failed > 0 || stalled);
  const detail = `${limit || queue.status} ${active.length} unresolved addresses; ${failed} exhausted or failed investigations. Spending limits remain in effect. Engineering must review recovery and Dispatch retains appointment ownership.`;
  const findings: HierarchyFinding[] = needsReview ? [{
    id: 'address-research:recovery-blocked', feed: 'address-research', title: 'Automatic address recovery needs attention',
    detail, href: monitor, origin: 'engineering', target: 'integrations', priority: active.length ? 'urgent' : 'watch',
  }] : [];
  return {id: 'address-research', available, observedAt: queue.checkedAt, detail, findings};
}
