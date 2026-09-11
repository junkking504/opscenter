import { subscribeArrivalUpdates } from './lib/arrival-updates';
import { useCallback, useEffect, useRef, useState } from 'react';
import Home from './app/page';
import { currentOperatingDay, isOperatingDay, normalizeOperatingDayUrl, operatingDayUrl } from './lib/operating-day';
import type { DesktopCommandSnapshot } from './lib/live-contract';

const currentDay = currentOperatingDay;
const initialUrl = normalizeOperatingDayUrl(window.location.href);
if (initialUrl.href !== window.location.href) window.history.replaceState(window.history.state, '', initialUrl);
const explicitDate = initialUrl.searchParams.get('date');

export default function LiveCommand() {
  const [date,setDate] = useState(() => explicitDate || currentDay());
  const workspaceBusy = useRef(false);
  const onWorkspaceBusy = useCallback((busy:boolean) => {workspaceBusy.current=busy;},[]);
  const [snapshot, setSnapshot] = useState<DesktopCommandSnapshot | null>(null);
  const [, setClock] = useState(Date.now);
  const [error, setError] = useState('');
  const [pendingAlertId, setPendingAlertId] = useState<string | null>(null);
  const pendingRef = useRef(false);
  const generation = useRef(0);
  const readsPending = useRef(0);
  const refresh = useCallback(async () => {
    readsPending.current += 1;
    try {
      const run = ++generation.current;
      const response = await fetch(`/api/desktop/command?date=${encodeURIComponent(date)}`, { cache: 'no-store', credentials: 'same-origin', signal: AbortSignal.timeout(30_000) });
      const body = await response.json();
      if (response.status === 401) {
        window.location.replace(`/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`);
        return;
      }
      if (!response.ok) throw new Error(body.error || 'Command could not refresh.');
      if (run === generation.current) {
        setSnapshot(body);
        setError(body.sources.alerts ? '' : 'Operational alerts are unavailable. This is not confirmation that there are no alerts.');
      }
    } finally { readsPending.current -= 1; }
  }, [date]);
  useEffect(() => {
    let disposed = false, queued = false;
    const load = () => { if (disposed || document.visibilityState === 'hidden' || pendingRef.current) return; if (readsPending.current > 0) { queued = true; return; } setClock(Date.now()); if (!explicitDate && !workspaceBusy.current && date !== currentDay()) { generation.current += 1; setSnapshot(null); setDate(currentDay()); return; } void refresh().catch(() => setError('Live data could not refresh. The last verified snapshot remains visible.')).finally(() => { if (queued && !disposed) { queued = false; load(); } }); };
    load();
    const unsubscribe = subscribeArrivalUpdates(load);
    const timer = window.setInterval(load, 30_000);
    window.addEventListener('focus',load); window.addEventListener('online',load);
    document.addEventListener('visibilitychange',load);
    return () => { disposed = true; unsubscribe(); window.clearInterval(timer); window.removeEventListener('focus',load); window.removeEventListener('online',load); document.removeEventListener('visibilitychange',load); generation.current += 1; };
  }, [refresh,date]);

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
  return <Home key={snapshot.date} live={{ onBusyChange: onWorkspaceBusy, snapshot, error, pendingAlertId, onAlertAction, onDateChange: (nextDate, workspace) => { if (workspaceBusy.current || pendingRef.current || !isOperatingDay(nextDate)) return; window.location.assign(operatingDayUrl(window.location.href, nextDate, workspace).href); } }} />;
}
