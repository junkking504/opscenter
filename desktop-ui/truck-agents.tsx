import { useCallback, useRef, useState } from 'react';
import { Button } from './components/ui/button';
import { useWorkspaceSnapshot } from './use-workspace-snapshot';
import { fetchWorkspace } from './lib/workspace-cache';
import { useWorkspaceRefresh } from './workspace-freshness';
import { agentFleetHref, agentScheduleHref, agentTruckNumber, type TruckAgentSnapshot, type TruckRecommendation, type TruckAgentProgress } from './lib/truck-agent-contract';
import './truck-agents.css';

const time = (at: string | null) => at && Number.isFinite(Date.parse(at)) ? new Date(at).toLocaleString('en-US', { timeZone: 'America/Chicago', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) + ' CT' : 'Unavailable';
const progressLabel = (progress: TruckAgentProgress, now: number) => `${progress.kind !== 'visited' && !progress.label.startsWith('Last report:') && (now - Date.parse(progress.observedAt) > 180_000 || now < Date.parse(progress.observedAt)) ? 'Last report: ' : ''}${progress.label}`;
export default function TruckAgents({ date, truck, compact = false }: { date: string; truck?: string; compact?: boolean }) {
  const key = `/api/desktop/truck-agents?date=${encodeURIComponent(date)}`;
  const [snapshot, setSnapshot] = useWorkspaceSnapshot<TruckAgentSnapshot>(key);
  const [feedback, setFeedback] = useState(''), [pending, setPending] = useState(false), [lastRequest, setLastRequest] = useState('');
  const busy = useRef(false);
  const load = useCallback(async (signal: AbortSignal) => { const result = await fetchWorkspace<TruckAgentSnapshot>(key, signal); if (result.version !== 1 || result.date !== date || !Array.isArray(result.agents)) throw new Error('Truck agent response is incomplete.'); if (!signal.aborted) setSnapshot(result); }, [key, date, setSnapshot]);
  const freshness = useWorkspaceRefresh(load, key, pending, 30_000, key);
  async function review(rec: TruckRecommendation) {
    if (busy.current) return; busy.current = true; setPending(true); setFeedback('');
    const requestId = crypto.randomUUID(); setLastRequest(requestId);
    try {
      const response = await fetch('/api/desktop/truck-agents', { method: 'POST', credentials: 'same-origin', signal: AbortSignal.timeout(30_000), headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ date, recommendationId: rec.id, recommendationVersion: rec.version, expectedVersion: rec.reviewVersion, status: rec.review?.status === 'acknowledged' ? 'open' : 'acknowledged', requestId }) });
      const result = await response.json(); if (!response.ok) throw new Error(result.error || 'Review was not saved.');
      setFeedback(result.receipt.status === 'verified' ? 'Review saved and verified. The source condition remains visible.' : 'Review result is pending. Check Saved Result before another action.');
      await freshness.refresh();
    } catch (error) { setFeedback(`${error instanceof Error ? error.message : 'Result unavailable.'} Check Saved Result before trying again.`); }
    finally { busy.current = false; setPending(false); }
  }
  async function check() {
    if (!lastRequest || busy.current) return; busy.current = true; setPending(true);
    try { const response = await fetch(`/api/desktop/truck-agents?receipt=${encodeURIComponent(lastRequest)}`, { credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(30_000) }); const data = await response.json(); if (!response.ok || !data.receipt) throw new Error('No saved review was confirmed. Refresh and inspect the current recommendation.'); setFeedback(`Saved review: ${data.receipt.status}.`); await freshness.refresh(); }
    catch (error) { setFeedback(error instanceof Error ? error.message : 'Saved result unavailable.'); }
    finally { busy.current = false; setPending(false); }
  }
  if (!snapshot || snapshot.date !== date || !Array.isArray(snapshot.agents)) return <section className="truck-agents" aria-label="Truck agents"><strong>Truck agents</strong><p role="status">{freshness.error || 'Reading truck recommendations…'}</p></section>;
  const agents = snapshot.agents.filter(a => !truck || agentTruckNumber(a.truck) === agentTruckNumber(truck));
  const stale = !snapshot.heartbeatAt || freshness.now - Date.parse(snapshot.heartbeatAt) > 180_000 || freshness.now - Date.parse(snapshot.heartbeatAt) < -60_000;
  const overdueView = freshness.now - Date.parse(snapshot.generatedAt) > 180_000;
  const urgent = agents.filter(a => a.recommendations.some(r => r.priority === 'urgent')).length;
  return <section className={`truck-agents${compact ? ' truck-agents-compact' : ''}`} aria-label="Truck agents">
    <header><div><h2>{truck ? `Truck ${agentTruckNumber(truck)} agent` : 'Truck agents'}</h2><p>{agents.length} assigned · {urgent} need urgent review · advisory actions</p></div><Button variant="outline" size="sm" disabled={pending || freshness.pending} onClick={() => void freshness.refresh().catch(() => {})}>Refresh agents</Button></header>
    <p className="truck-agent-timing">Background check: {time(snapshot.heartbeatAt)}{stale ? ' · heartbeat needs attention' : ''}{overdueView ? ' · displayed assessment is stale' : ''}</p>
    {freshness.error && <p role="alert">Refresh failed; retained recommendations may be outdated. {freshness.error}</p>}
    {snapshot.warnings.map(w => <p className="truck-agent-warning" key={w}>{w}</p>)}
    {!truck && <p className="truck-agent-dispatch">Shared dispatch: {snapshot.dispatcher.unassigned ?? 'Unknown'} appointments without a physical truck · {snapshot.dispatcher.current && !overdueView ? 'observed' : 'retained / needs refresh'} {time(snapshot.dispatcher.scheduleAt)}. <a href={agentScheduleHref(date)}>Review assignments</a></p>}
    {feedback && <p role="status">{feedback}</p>}
    {lastRequest && <Button variant="outline" size="sm" disabled={pending} onClick={() => void check()}>Check Saved Result</Button>}
    <div className="truck-agent-grid">{agents.map(agent => <details key={agent.id} className={`truck-agent-card ${agent.recommendations[0]?.priority || 'watch'}`} open={truck ? true : undefined}>
      <summary><span><strong>{agent.truck}</strong><small>{agent.summary.progress ? progressLabel(agent.summary.progress, freshness.now) : agent.mode}{agent.status !== 'ok' ? ' · evidence incomplete' : ''}</small></span><span className="truck-agent-next">{agent.recommendations[0]?.title || agent.error || 'Assessment unavailable'}</span></summary>
      <div className="truck-agent-body"><p>{agent.summary.assigned ?? 'Unknown'} assigned · {agent.summary.completed ?? 'Unknown'} completed · Load: {agent.summary.load}</p><p>Inspection: {time(agent.summary.inspectionAt)} · GPS observation: {time(agent.summary.gpsAt)}</p>
        {agent.summary.progress && <p aria-label="Appointment progress"><strong>{progressLabel(agent.summary.progress, freshness.now)}</strong> · {agent.summary.progress.jobNumbers.join(', ')}{agent.summary.progress.distanceMeters !== null ? ` · ${agent.summary.progress.distanceMeters} m from nearest assigned appointment pin` : ''}. {agent.summary.progress.detail} Observed {time(agent.summary.progress.observedAt)}{agent.summary.progress.stoppedSince ? ` · ${agent.summary.progress.kind === 'nearby' ? 'stopped since' : 'since'} ${time(agent.summary.progress.stoppedSince)} (${Math.max(0, Math.floor((Date.parse(agent.summary.progress.observedAt) - Date.parse(agent.summary.progress.stoppedSince)) / 60_000))} min observed)` : ''}{overdueView || freshness.error ? ' · retained assessment; refresh needed' : ''}</p>}
        {agent.error && <p role="alert">{agent.error}</p>}
        {agent.recommendations.map(rec => <article className="truck-agent-recommendation" key={rec.id}><div><span className={`truck-agent-priority ${rec.priority}`}>{rec.priority === 'urgent' ? 'Urgent' : rec.priority === 'next' ? 'Next action' : 'Watch'}</span>{rec.review?.status === 'acknowledged' && <span>Acknowledged · {time(rec.review.at)}</span>}</div><h3>{rec.title}</h3><p>{rec.detail}</p><p>Owner: {rec.owner}{rec.due ? ` · Due: ${rec.due}` : ''}</p><ul>{rec.evidence.map((e, i) => <li key={i}><a href={e.href}>{e.source}</a>: {e.value}<small>Observed {time(e.observedAt)}</small></li>)}</ul><div className="truck-agent-actions"><a href={rec.href}>Open supporting record</a><Button variant="outline" size="sm" disabled={pending || !snapshot.canWrite || overdueView} onClick={() => void review(rec)}>{rec.review?.status === 'acknowledged' ? 'Reopen review' : 'Acknowledge'}</Button></div></article>)}
        <details className="truck-agent-sources"><summary>Source times and recommendation history</summary>{agent.sources.map(s => <p key={s.name}>{s.name}: {time(s.observedAt)} · {s.available ? 'Available' : 'Unavailable / retained'}{s.note ? ` · ${s.note}` : ''}</p>)}{agent.history.map((h, i) => <p key={`${h.id}:${i}`}>{time(h.at)} · Superseded: {h.title}. Review source evidence for resolution.</p>)}</details>
        {!truck && <a href={agentFleetHref(date, agentTruckNumber(agent.truck)!)}>Open {agent.truck} in Convoy</a>}
      </div>
    </details>)}</div>
  </section>;
}
