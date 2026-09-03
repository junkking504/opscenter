import { useCallback, useEffect, useRef, useState } from 'react';
import Home from './app/page';
import type { DesktopCommandSnapshot } from './lib/live-contract';

const date = new URLSearchParams(window.location.search).get('date') || new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(new Date());

export default function LiveCommand() {
  const [snapshot, setSnapshot] = useState<DesktopCommandSnapshot | null>(null);
  const [error, setError] = useState('');
  const [pendingAlertId, setPendingAlertId] = useState<string | null>(null);
  const pendingRef = useRef(false);
  const generation = useRef(0);
  const refresh = useCallback(async () => {
    const run = ++generation.current;
    const response = await fetch(`/api/desktop/command?date=${encodeURIComponent(date)}`, { cache: 'no-store', credentials: 'same-origin', signal: AbortSignal.timeout(30_000) });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || 'Command could not refresh.');
    if (run === generation.current) {
      setSnapshot(body);
      setError(body.sources.alerts ? '' : 'Slack alerts are unavailable. This is not confirmation that there are no alerts.');
    }
  }, []);
  useEffect(() => {
    const load = () => { void refresh().catch(() => setError('Live data could not refresh. The last verified snapshot remains visible.')); };
    load();
    const timer = window.setInterval(load, 30_000);
    return () => { window.clearInterval(timer); generation.current += 1; };
  }, [refresh]);

  const onAlertAction = async (alertId: string, action: 'acknowledge' | 'add_to_control') => {
    if (pendingRef.current) return;
    const alert = snapshot?.alerts.find(item => item.id === alertId);
    if (!alert || !snapshot?.sources.workflow) {
      setError('The shared action service is unavailable. No action was saved.');
      return;
    }
    pendingRef.current = true;
    setPendingAlertId(alertId);
    setError('');
    let saved = false;
    let responseConfirmed = false;
    try {
      const response = await fetch('/api/command/alert-workflow', {
        method: 'POST', credentials: 'same-origin', signal: AbortSignal.timeout(30_000),
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date, alertId, action, expectedVersion: alert.version }),
      });
      saved = response.ok;
      const body = await response.json();
      responseConfirmed = true;
      if (!response.ok) {
        if (response.status === 409) await refresh();
        throw new Error(body.error || 'The alert action was not saved.');
      }
      saved = true;
      await refresh();
    } catch (failure) {
      setError(saved ? 'The action was saved, but the refresh failed. Refresh before trying again.' : !responseConfirmed ? 'The result could not be confirmed. Refresh and check the shared action before trying again.' : failure instanceof Error ? failure.message : 'The alert action could not be saved.');
    } finally {
      pendingRef.current = false;
      setPendingAlertId(null);
    }
  };
  if (!snapshot) return <main className="empty-state" role="status"><strong>{error || 'Loading Command from live sources…'}</strong><span>No sample records are used.</span></main>;
  return <Home live={{ snapshot, error, pendingAlertId, onAlertAction }} />;
}
