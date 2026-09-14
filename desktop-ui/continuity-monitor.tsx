import type { ContinuitySnapshot } from './lib/continuity-contract';
const timestamp = (at: string | null) => at ? new Date(at).toLocaleString('en-US', { timeZone: 'America/Chicago', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'Not observed';
export default function ContinuityMonitor({ snapshot, clock }: { snapshot?: ContinuitySnapshot; clock: number }) {
  const age = clock - Date.parse(snapshot?.checkedAt || '');
  const fresh = snapshot?.fresh && age >= 0 && age <= 180000;
  const clear = fresh && snapshot?.status === 'ready';
  return <section className="maintenance-recovery" aria-labelledby="continuity-title">
    <h3 id="continuity-title">Server continuity</h3>
    <strong>{clear ? 'Checks passed' : fresh ? 'Continuity needs attention' : 'Continuity evidence unavailable or stale'}</strong>
    <p>Mission Control primary · VPS read-only standby. Independent VPS checks run every minute. These checks use no AI and perform no repairs.</p>
    <small>VPS observation {timestamp(snapshot?.checkedAt || null)} · received {timestamp(snapshot?.receivedAt || null)}</small>
    {!fresh && <p role="alert">Current continuity cannot be verified. Check the VPS observer and Mission Control’s monitor connection; previous green results do not establish readiness.</p>}
    <div className="maintenance-incidents">{snapshot?.checks.map(check => {
      const incident = snapshot.incidents.find(row => row.key === check.key);
      return <article key={check.key}>
        <header><strong>{check.title}</strong><span>{!fresh || check.status === 'unknown' ? 'Unknown' : check.status === 'ok' ? incident && incident.status !== 'resolved' ? 'Confirming recovery' : 'Passed' : incident?.status === 'open' ? 'Needs attention' : 'Confirming'}</span></header>
        <p>{check.evidence}</p>
        {(check.status !== 'ok' || !fresh) && <p><b>Next check:</b> {check.nextStep}</p>}
        {incident && <small>{incident.status === 'resolved' ? `Cleared ${timestamp(incident.resolvedAt)}` : `First detected ${timestamp(incident.firstSeenAt)}`} · {incident.occurrences} occurrence{incident.occurrences === 1 ? '' : 's'}</small>}
      </article>;
    })}</div>
    <small>Failures confirm on two separate observations and clear after three successful observations. Public checks verify login and structured readiness; they do not replace signed-in workflow acceptance.</small>
  </section>;
}
