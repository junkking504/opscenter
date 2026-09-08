import { useEffect, useState } from 'react';
import type { MaintenanceSnapshot } from './lib/maintenance-contract';
import './maintenance-monitor.css';

const timestamp = (value: string | null | undefined) => value ? new Date(value).toLocaleString('en-US', { timeZone: 'America/Chicago', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'Not observed yet';
export default function MaintenanceMonitor() {
  const [snapshot, setSnapshot] = useState<MaintenanceSnapshot | null>(null);
  const [error, setError] = useState('');
  const [history, setHistory] = useState(false);
  const [clock, setClock] = useState(Date.now());
  useEffect(() => {
    let active = true;
    const refresh = async () => {
      try {
        const response = await fetch('/api/desktop/maintenance', { credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(10_000) });
        if (!response.ok) throw new Error('unavailable');
        const result: MaintenanceSnapshot = await response.json();
        if (active) { setSnapshot(result); setError(''); setClock(Date.now()); }
      } catch { if (active) { setError('Maintenance status could not refresh. Previous observations may be stale.'); setClock(Date.now()); } }
    };
    void refresh(); const interval = window.setInterval(() => void refresh(), 30_000);
    return () => { active = false; window.clearInterval(interval); };
  }, []);
  const age = clock - Date.parse(snapshot?.checkedAt || '');
  const fresh = snapshot?.fresh && age >= 0 && age < 180_000 && !error;
  const incidents = snapshot?.incidents.filter(i => history ? i.status === 'resolved' : i.status !== 'resolved') || [];
  return <section className="maintenance-panel" aria-labelledby="maintenance-title">
    <header><div><span className="section-kicker">OpsBot · observation pilot</span><h2 id="maintenance-title">Background maintenance</h2><p>Detects conditions and suggests next steps. Automatic repairs are off.</p></div><span className={`maintenance-state ${fresh ? 'current' : 'stale'}`}>{fresh ? 'Monitoring' : snapshot ? 'Monitor needs attention' : 'Loading status…'}</span></header>
    {error && <p role="alert">{error}</p>}
    {snapshot && <>
      <div className="maintenance-metrics"><div><span>Last observation</span><strong>{timestamp(snapshot.checkedAt)}</strong></div><div><span>AI status</span><strong>{snapshot.aiStatus}</strong></div><div><span>Monthly AI usage · {snapshot.month}</span><strong>{snapshot.available ? `$${snapshot.estimatedUsd.toFixed(3)} estimated · ${snapshot.calls} calls` : 'Unavailable'}</strong><small>{snapshot.available ? `$${snapshot.committedUsd.toFixed(3)} including reserved or uncertain usage / $${snapshot.budgetUsd} limit` : 'Budget state has not been verified.'}</small></div></div>
      {!fresh && <p role="status">The worker has not supplied a current observation. This does not establish that OpsCenter is healthy.</p>}
      <div className="maintenance-filters" role="group" aria-label="Maintenance incident status"><button type="button" aria-pressed={!history} onClick={() => setHistory(false)}>Current conditions</button><button type="button" aria-pressed={history} onClick={() => setHistory(true)}>Cleared conditions</button></div>
      <div className="maintenance-incidents">{incidents.map(incident => <article key={incident.key}>
        <header><div><strong>{incident.title}</strong><small>{incident.area} · {incident.kind === 'review' ? 'Human review' : 'Technical condition'}</small></div><span>{incident.status === 'confirming' ? 'Confirming' : incident.status === 'resolved' ? 'Condition cleared' : 'Needs attention'}</span></header>
        <p>{incident.evidence}</p><p><b>Next check:</b> {incident.nextStep}</p>
        <small>First observed {timestamp(incident.firstSeenAt)} · Last detected {timestamp(incident.lastSeenAt)}{incident.resolvedAt ? ` · Cleared ${timestamp(incident.resolvedAt)}` : ''}</small>
        {incident.diagnosis ? <details><summary>AI assessment · suggested, not verified</summary><p>{incident.diagnosis.summary}</p><p><b>Possible cause:</b> {incident.diagnosis.likelyCause}</p><p><b>Suggested next step:</b> {incident.diagnosis.nextStep}</p><p><b>Verify with:</b> {incident.diagnosis.verification}</p><small>Assessment from {timestamp(incident.diagnosisAt)}. No repair was executed.</small></details> : <small>{incident.status === 'confirming' ? 'Waiting for a second observation before AI diagnosis.' : incident.diagnosisStatus === 'unavailable' ? 'AI assessment unavailable. The recorded evidence and next check remain available.' : 'AI assessment pending within the pilot budget.'}</small>}
        {incident.key.startsWith('client-') && incident.status === 'resolved' && <p>No recent browser reports. The affected interaction still needs verification.</p>}
      </article>)}</div>
      {!incidents.length && <p>{history ? 'No conditions have cleared yet.' : snapshot.available ? 'No confirmed or pending conditions in the latest observation. Browser reports cover active sessions only.' : 'Waiting for the first worker observation.'}</p>}
    </>}
  </section>;
}
