import { ArrowRight, Check } from 'lucide-react';
import { Button } from './components/ui/button';
import { controlItemActive, controlStatus, type ControlItem, type ControlSnapshot } from './lib/control-contract';
import { controlBucket, controlBucketLabels, controlNextStep } from './lib/control-triage';
import './control-decisions.css';

type Props = {
  snapshot: ControlSnapshot; filter: string; setFilter: (filter: string) => void;
  visible: ControlItem[]; busy: boolean; canReconcile: boolean;
  onReconcile: () => void; onOpen: (item: ControlItem) => void;
  page: number; setPage: (page: number) => void; navigate: (workspace: string) => void;
  reconciliation: { checked: string[]; skipped: Array<{date: string; reason: string}>; remaining: number } | null;
};
const timestamp = (value?: string | null) => value ? new Date(value).toLocaleString('en-US', { timeZone: 'America/Chicago', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'No Deadline';

export default function ControlDecisions({ snapshot, filter, setFilter, visible, busy, canReconcile, onReconcile, onOpen, page, setPage, navigate, reconciliation }: Props) {
  const active = snapshot.items.filter(controlItemActive);
  const runs = ['approval', 'verification'].includes(filter) ? snapshot.actionRuns.filter(run => run.status === (filter === 'approval' ? 'awaiting_approval' : 'verifying')) : [];
  const filters: Array<[string, string, number]> = [
    ['needs_action', 'Needs Action', active.filter(item => controlBucket(item) === 'needs_action').length],
    ['waiting', 'Waiting', active.filter(item => controlBucket(item) === 'waiting').length],
    ['verification', 'Awaiting Verification', active.filter(item => controlBucket(item) === 'verification').length + snapshot.counts.verifying],
    ['resolved', 'Resolved', snapshot.items.length - active.length],
    ['all', 'All Open', active.length],
    ['mine', 'Mine', active.filter(item => item.ownerActorId === snapshot.actor.id).length],
    ['approval', 'Approval', snapshot.counts.approval],
  ];
  return <section className="activity-panel control-decisions" id="operating-decisions">
    <div className="section-title"><div><span className="section-kicker">{active.length} Open Decisions on This Page</span><h2>Operating Decisions</h2><p>Act on current conditions. Waiting work and source checks stay separate.</p></div>
      {snapshot.actor.canCloseDay && <Button size="sm" variant="outline" disabled={!canReconcile} onClick={onReconcile}>{busy ? 'Checking…' : 'Check Latest Sources'}</Button>}
    </div>
    <div className="control-decision-filters" role="group" aria-label="Filter operating decisions">{filters.map(([value, label, count]) => <button key={value} aria-pressed={filter === value} onClick={() => setFilter(value)}>{label}<span>{count}</span></button>)}</div>
    {filter === 'urgent' && <p className="control-triage-note">Urgent or overdue items that still need action. Waiting and source-verification items are shown separately.</p>}
    {filter === 'verification' && <p className="control-triage-note">Newer evidence is available; these decisions are not yet resolved. A completed appointment does not clear its payment, photo, or Krewe requirements.</p>}
    {reconciliation && <div className="control-reconciliation-result" role="status"><strong>Source Check: {reconciliation.checked.length} Dates Checked · {reconciliation.skipped.length} Not Checked</strong><p>Two distinct fresh observations are still required to resolve a source condition. Rechecking unchanged data does not count twice.</p>{reconciliation.skipped.length > 0 && <details><summary>Why Some Dates Could Not Be Checked</summary><ul>{reconciliation.skipped.map(item => <li key={item.date}>{item.date}: {item.reason}</li>)}</ul></details>}{reconciliation.remaining > 0 && <p>{reconciliation.remaining} additional operating dates remain outside this batch.</p>}</div>}
    <div className="control-decision-list">{visible.map(item => {
      const bucket = controlBucket(item);
      const urgent = bucket === 'needs_action' && (item.severity === 'critical' || item.overdue);
      return <article key={item.id} className={`control-decision-row ${bucket}${urgent ? ' urgent' : ''}`}>
        <div className="control-decision-context"><span>{item.category === 'Crew' ? 'Krewe' : item.category} · {item.entity.label || item.entity.id}</span><span className="control-decision-state">{urgent ? 'Urgent · ' : ''}{bucket === 'resolved' && item.status === 'dismissed' ? 'Dismissed' : controlBucketLabels[bucket]}</span><span>{item.operatingDate}{item.carryover ? ' · Carryover' : ''}</span></div>
        <div className="control-decision-content"><div className="control-decision-main"><h3>{item.title}</h3>
          {(bucket === 'needs_action' || bucket === 'waiting') && <p>{item.description}</p>}
          {item.currentSource && <p className="control-decision-source"><strong>Latest Source: {item.currentSource.status}</strong><span>{item.currentSource.observedAt ? timestamp(item.currentSource.observedAt) : 'Observation Unavailable'}</span></p>}
          <p><strong>Next:</strong> {controlNextStep(item)}</p>
          <details><summary>Recorded Condition and Evidence</summary><p>{item.description}</p><p>{item.source} · {timestamp(item.sourceObservedAt)} · {controlStatus(item.status)}</p>{item.resolutionCode === 'manual_resolution' && <p>Manual decision—not an external source verification.</p>}</details>
        </div><dl><div><dt>Owner</dt><dd>{item.ownerDisplayName || 'Needs Owner'}</dd></div><div><dt>{item.overdue && bucket === 'needs_action' ? 'Overdue' : 'Follow-Up'}</dt><dd>{timestamp(item.dueAt)}</dd></div></dl>
          <div className="control-decision-actions"><Button variant="outline" size="sm" disabled={busy} onClick={() => onOpen(item)}>Manage <ArrowRight size={13} /></Button>{item.href && <a href={item.href}>Open Source <ArrowRight size={13} /></a>}</div>
        </div>
      </article>;
    })}
    {runs.map(run => <article className="control-decision-row verification" key={run.id}><div className="control-decision-context"><span>{run.workspace}</span><span>{filter === 'approval' ? 'Awaiting Approval' : 'Awaiting Verification'}</span><span>{timestamp(run.requestedAt)}</span></div><div className="control-decision-content"><div><h3>{run.key}</h3><p>Review this action in its originating workflow. Opening it does not approve or verify the result.</p></div><Button variant="outline" onClick={() => navigate(run.workspace)}>Open {run.workspace} <ArrowRight size={13} /></Button></div></article>)}
    {!visible.length && !runs.length && <div className="empty-state"><Check size={20} /><strong>No Matching Decisions on This Page</strong><span>Other work and incomplete sources may still need review.</span></div>}
    </div>
    <footer className="control-decision-pagination"><Button variant="outline" size="sm" disabled={busy || page <= 1} onClick={() => setPage(page - 1)}>Previous</Button><span>Page {snapshot.pagination.page} of {snapshot.pagination.pages} · {snapshot.pagination.total} Decisions · Filters Apply to This Page</span><Button variant="outline" size="sm" disabled={busy || page >= snapshot.pagination.pages} onClick={() => setPage(page + 1)}>Next</Button></footer>
  </section>;
}
