import { useEffect, useState } from 'react';
import type { KnowledgeTroubleshooting } from './lib/knowledge-troubleshooting-contract';
import './knowledge-troubleshooting.css';
const labels = { active: 'Needs investigation', confirming: 'Confirming signal', 'awaiting-verification': 'Awaiting verification', recovering: 'Recovery pending', cleared: 'Observer cleared', stale: 'Stale evidence' };
const date = (at: string | null) => at ? new Date(at).toLocaleString('en-US', {timeZone:'America/Chicago',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}) : 'Unavailable';
export default function KnowledgeTroubleshootingPanel({ snapshot, stale = false, onOpen }: { snapshot?: KnowledgeTroubleshooting; stale?: boolean; onOpen?: (id: string) => void }) {
  const [showCleared, setShowCleared] = useState(false);
  const [clock, setClock] = useState(() => Date.now());
  useEffect(() => { const timer = window.setInterval(() => setClock(Date.now()), 15000); return () => window.clearInterval(timer); }, []);
  if (!snapshot) return null;
  const age = Math.max(clock, Date.parse(snapshot.evaluatedAt)) - Date.parse(snapshot.observedAt || '');
  const evidenceStale = stale || !snapshot.current || !Number.isFinite(age) || age < 0 || age >= 180000;
  const rows = snapshot.cases.filter(row => showCleared ? row.resolvedAt !== null : row.resolvedAt === null);
  return <section className="knowledge-triage" aria-label="OpsWiki troubleshooting">
    <header><div><p>OPSWIKI</p><h3>Automatic troubleshooting</h3><span>Current evidence connected to past experience.</span></div><strong>{evidenceStale ? 'Evidence needs refresh' : 'Observation current'}</strong></header>
    <p role="status">{evidenceStale ? 'Current observer evidence is unavailable or stale. Recheck the observer before relying on these observations.' : snapshot.message}</p>
    <small>Observed {date(snapshot.observedAt)} · Matched {date(snapshot.evaluatedAt)} · Local matching, no additional AI calls</small>
    <div className="knowledge-triage-tabs"><button type="button" aria-pressed={!showCleared} onClick={() => setShowCleared(false)}>Current checks</button><button type="button" aria-pressed={showCleared} onClick={() => setShowCleared(true)}>Cleared conditions</button></div>
    {rows.map(row => <details key={row.key} className="knowledge-triage-case"><summary><strong>{row.title}</strong><span>{evidenceStale ? 'Stale evidence' : labels[row.state]} · {row.occurrences} recorded {row.occurrences === 1 ? 'occurrence' : 'occurrences'}</span></summary>
      <p><b>Observed evidence:</b> {row.evidence}</p><p><b>Assessment:</b> {evidenceStale ? 'Current evidence is unavailable or stale; this prior assessment cannot establish current state.' : row.assessment}</p>
      <small>First detected {date(row.firstSeenAt)} · Last detected {date(row.lastSeenAt)}{row.resolvedAt && ` · Cleared ${date(row.resolvedAt)}`}</small>
      <h4>Next checks</h4><ol>{(evidenceStale ? ['Refresh the observer and source evidence before continuing.'] : row.nextChecks).map(check => <li key={check}>{check}</li>)}</ol>
      <p><b>Recovery evidence required:</b> {row.verification}</p><h4>Relevant past experience</h4>
      {!row.matches.length && <p>{snapshot.knowledgeAvailable ? 'No sufficiently relevant record was found. Investigate the source before adding a new lesson.' : 'Historical records are unavailable.'}</p>}
      {row.matches.map(match => <div className="knowledge-triage-match" key={match.id}>{onOpen ? <button type="button" onClick={() => onOpen(match.id)}>{match.title}</button> : <a href={`?data=live&workspace=Command&commandView=monitor&knowledge=${encodeURIComponent(match.id)}`}>{match.title}</a>}<p>{match.summary}</p><small>{match.outcome} · {match.reviewStatus} · Recorded {date(match.recordedAt)}</small><small>{match.reason}</small></div>)}
    </details>)}
    {!rows.length && <p>{snapshot.available ? 'No conditions in this view. Observer coverage does not verify every operational interaction.' : 'Waiting for usable observer evidence.'}</p>}
  </section>;
}
