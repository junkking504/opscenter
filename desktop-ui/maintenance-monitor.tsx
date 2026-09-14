import ContinuityMonitor from './continuity-monitor';
import { useEffect, useState } from 'react';
import type { MaintenanceIncident, MaintenanceSnapshot } from './lib/maintenance-contract';
import './maintenance-monitor.css';

const timestamp = (value: string | null | undefined) => value ? new Date(value).toLocaleString('en-US', { timeZone: 'America/Chicago', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'Not observed yet';
function VerifyBrowserRecovery({ incident }: { incident: MaintenanceIncident }) {
  const [evidence, setEvidence] = useState('');
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState('');
  const [recorded, setRecorded] = useState(false);
  async function save() {
    if (saving || recorded || !incident.clientFailureAt) return;
    setSaving(true); setResult('');
    try {
      const response = await fetch('/api/desktop/maintenance/verification', { method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(10_000),
        body: JSON.stringify({ category: incident.key.slice(7), failureAt: incident.clientFailureAt, evidence }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || 'Verification was not recorded.');
      setResult(body.message); setRecorded(true);
    } catch (error) { setResult(error instanceof Error ? error.message : 'Refresh before trying again.'); }
    finally { setSaving(false); }
  }
  return <details><summary>Record a successful interaction check</summary>
    <p>After reproducing the affected interaction while signed in, describe the action and the successful result. Include no passwords or customer details.</p>
    <label>Verified interaction <textarea value={evidence} maxLength={500} onChange={event => setEvidence(event.target.value)} disabled={saving || recorded} /></label>
    <button type="button" disabled={saving || recorded || evidence.trim().length < 20} onClick={() => void save()}>{saving ? 'Recording…' : recorded ? 'Verification recorded' : 'Record verification'}</button>
    {result && <p role="status">{result}</p>}
  </details>;
}

export default function MaintenanceMonitor() {
  const [snapshot, setSnapshot] = useState<MaintenanceSnapshot | null>(null);
  const [error, setError] = useState('');
  const [history, setHistory] = useState(false);
  const [clock, setClock] = useState(() => Date.now());
  const [savingRecovery, setSavingRecovery] = useState(false);
  const [recoveryError, setRecoveryError] = useState('');
  async function toggleRecovery() {
    if (!snapshot?.recovery || savingRecovery) return;
    setSavingRecovery(true); setRecoveryError('');
    try {
      const response = await fetch('/api/desktop/maintenance/recovery', { method: 'PATCH', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: !snapshot.recovery.enabled }), signal: AbortSignal.timeout(10_000) });
      if (!response.ok) throw new Error('unavailable');
      const recovery = await response.json();
      setSnapshot(previous => previous ? { ...previous, recovery } : previous);
    } catch { setRecoveryError('Setting could not be confirmed. Refresh status before trying again.'); }
    finally { setSavingRecovery(false); }
  }
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
    <header><div><span className="section-kicker">OpsBot · maintenance pilot</span><h2 id="maintenance-title">Background maintenance</h2><p>Detects conditions and suggests next steps. Process recovery has its own bounded controls below.</p></div><span className={`maintenance-state ${fresh ? 'current' : 'stale'}`}>{fresh ? 'Monitoring' : snapshot ? 'Monitor needs attention' : 'Loading status…'}</span></header>
    {error && <p role="alert">{error}</p>}
    <ContinuityMonitor snapshot={snapshot?.continuity} clock={clock} />
    {snapshot && <>
      <div className="maintenance-metrics"><div><span>Last observation</span><strong>{timestamp(snapshot.checkedAt)}</strong></div><div><span>AI status</span><strong>{snapshot.aiStatus}</strong></div><div><span>Monthly AI usage · {snapshot.month}</span><strong>{snapshot.available ? `$${snapshot.estimatedUsd.toFixed(3)} estimated · ${snapshot.calls} calls` : 'Unavailable'}</strong><small>{snapshot.available ? `$${snapshot.committedUsd.toFixed(3)} including reserved or uncertain usage / $${snapshot.budgetUsd} limit` : 'Budget state has not been verified.'}</small></div></div>
      {!fresh && <p role="status">The worker has not supplied a current observation. This does not establish that OpsCenter is healthy.</p>}
      {snapshot.addressResearch && <div className="maintenance-recovery" aria-label="Automatic address investigation">
        <strong>Address investigation · {snapshot.addressResearch.enabled ? 'Enabled' : 'Paused'}</strong>
        <p role="status">{snapshot.addressResearch.status}</p>
        <small>{snapshot.addressResearch.pending} queued · {snapshot.addressResearch.resolved} resolved · {snapshot.addressResearch.unresolved} without a verified location</small>
        <small>Up to ${snapshot.addressResearch.perAddressUsd.toFixed(2)} per address, included in the shared ${snapshot.budgetUsd} monthly limit.</small>
        <details><summary>Address work and evidence</summary>{snapshot.addressResearch.items.length ? snapshot.addressResearch.items.map(item => <div key={item.id}>
          <p><strong>{item.address}</strong><small>{item.status.replaceAll('_',' ')} · {item.reason}</small>
            <small>${(item.estimatedMicros / 1e6).toFixed(4)} estimated · ${(item.committedMicros / 1e6).toFixed(2)} used or reserved · {timestamp(item.updatedAt)}</small></p>
          {item.sources?.map(url => <a key={url} href={url} target="_self" rel="noreferrer">Source evidence</a>)}
        </div>) : <p>No address investigations recorded.</p>}</details>
      </div>}
      {snapshot.recovery && <div className="maintenance-recovery">
        <strong>Automatic process recovery · {snapshot.recovery.enabled ? 'Enabled' : 'Paused'}</strong>
        <p>Starts OpsCenter only after three checks confirm it is stopped. One attempt per outage, a 30-minute cooldown, and at most two attempts per day. Running processes stay untouched.</p>
        <p role="status">{snapshot.recovery.status}</p>
        <small>Last recovery check {timestamp(snapshot.recovery.checkedAt)} · {snapshot.recovery.attemptsToday}/2 attempts today</small>
        {(!snapshot.recovery.fresh || clock - Date.parse(snapshot.recovery.checkedAt || '') >= 180_000) && <p>Recovery checks are unavailable or stale. Recovery is not confirmed active.</p>}
        {snapshot.canManageRecovery && <div className="maintenance-filters"><button type="button" disabled={savingRecovery} onClick={() => void toggleRecovery()}>{savingRecovery ? 'Saving…' : snapshot.recovery.enabled ? 'Pause automatic recovery' : 'Enable automatic recovery'}</button></div>}
        <small>Pausing blocks new attempts; a start already issued may finish. Source data, collectors, and code changes require separate review.</small>
        {recoveryError && <p role="alert">{recoveryError}</p>}
        <details><summary>Recent recovery receipts</summary>{snapshot.recovery.receipts.length ? snapshot.recovery.receipts.map((receipt, index) => <p key={`${receipt.at}-${index}`}><small>{timestamp(receipt.at)}</small>{receipt.event}</p>) : <p>No process recovery attempts recorded.</p>}</details>
      </div>}
      <div className="maintenance-filters" role="group" aria-label="Maintenance incident status"><button type="button" aria-pressed={!history} onClick={() => setHistory(false)}>Current conditions</button><button type="button" aria-pressed={history} onClick={() => setHistory(true)}>Cleared conditions</button></div>
      <div className="maintenance-incidents">{incidents.map(incident => <article key={incident.key}>
        <header><div><strong>{incident.title}</strong><small>{incident.area} · {incident.kind === 'review' ? 'Human review' : 'Technical condition'}</small></div><span>{incident.status === 'confirming' ? 'Confirming' : incident.status === 'resolved' ? 'Condition cleared' : incident.key.startsWith('client-') && incident.unhealthy === null ? 'Awaiting verification' : 'Needs attention'}</span></header>
        <p>{incident.evidence}</p><p><b>Next check:</b> {incident.nextStep}</p>
        <small>First observed {timestamp(incident.firstSeenAt)} · Last detected {timestamp(incident.lastSeenAt)}{incident.resolvedAt ? ` · Cleared ${timestamp(incident.resolvedAt)}` : ''}</small>
        {incident.diagnosis ? <details><summary>AI assessment · suggested, not verified</summary><p>{incident.diagnosis.summary}</p><p><b>Possible cause:</b> {incident.diagnosis.likelyCause}</p><p><b>Suggested next step:</b> {incident.diagnosis.nextStep}</p><p><b>Verify with:</b> {incident.diagnosis.verification}</p><small>Assessment from {timestamp(incident.diagnosisAt)}. AI assessments do not execute repairs; process actions are recorded separately above.</small></details> : <small>{incident.unhealthy !== true ? (incident.key.startsWith('client-') ? (incident.recoveryVerifiedAt ? 'The successful interaction check is recorded. No AI request is queued.' : 'A successful interaction check is required. No AI request is queued for this unknown condition.') : incident.status === 'resolved' ? 'Recovery confirmed by source observations.' : incident.unhealthy === false ? 'Recovery observed; waiting for the remaining observer checks.' : 'Waiting for current source evidence. No AI request is queued.') : incident.status === 'confirming' ? 'Waiting for a second observation before AI diagnosis.' : incident.diagnosisStatus === 'unavailable' ? 'AI assessment unavailable. The recorded evidence and next check remain available.' : 'AI assessment pending within the pilot budget.'}</small>}
        {incident.key.startsWith('client-') && incident.status !== 'resolved' && snapshot.canManageRecovery && incident.clientFailureAt && <VerifyBrowserRecovery key={`${incident.key}:${incident.clientFailureAt}`} incident={incident} />}
      </article>)}</div>
      {!incidents.length && <p>{history ? 'No conditions have cleared yet.' : snapshot.available ? 'No confirmed or pending conditions in the latest observation. Browser reports cover active sessions only.' : 'Waiting for the first worker observation.'}</p>}
    </>}
  </section>;
}
