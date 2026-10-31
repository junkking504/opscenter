import { useRegisterDisplayedRefresh } from './displayed-refresh';
import './daily-finance-freshness.css';
import { ageFinanceKpi } from '../lib/daily-finance-freshness';
import { subscribeCommandArrivalUpdates } from './lib/arrival-updates';
import { useCallback, useEffect, useRef, useState } from 'react';
import Home from './app/page';
import { fetchWorkspace, WorkspaceReadError } from './lib/workspace-cache';
import { commandSnapshotUrl, cachedCommandSnapshot, mergeCommandSummary } from './lib/command-loading';
import { currentOperatingDay, isOperatingDay, normalizeOperatingDayUrl, operatingDayUrl } from './lib/operating-day';
import type { DesktopCommandSnapshot } from './lib/live-contract';
import { workspaceShell, type WorkspaceBootstrap } from './lib/workspace-bootstrap';

const currentDay = currentOperatingDay;
const initialUrl = normalizeOperatingDayUrl(window.location.href);
if (initialUrl.href !== window.location.href) window.history.replaceState(window.history.state, '', initialUrl);
const tvMode = initialUrl.searchParams.get('tv') === '1';
const explicitDate = tvMode ? null : initialUrl.searchParams.get('date');

export default function LiveCommand({ bootstrap }: { bootstrap?: WorkspaceBootstrap } = {}) {
  const [date,setDate] = useState(() => tvMode ? currentDay() : bootstrap?.date || explicitDate || currentDay());
  const [selection, setSelection] = useState(0);
  const workspaceBusy = useRef(false);
  const onWorkspaceBusy = useCallback((busy:boolean) => {workspaceBusy.current=busy;},[]);
  const [snapshot, setSnapshot] = useState<DesktopCommandSnapshot | null>(() => bootstrap ? workspaceShell(tvMode ? {...bootstrap,date:currentDay()} : bootstrap) : null);
  const [clock, setClock] = useState(Date.now);
  const [error, setError] = useState('');
  const [pendingAlertId, setPendingAlertId] = useState<string | null>(null);
  const pendingRef = useRef(false);
  const generation = useRef(0);
  const readsPending = useRef(new Map<string, number>());
  const readKey = `${date}:${selection}`;
  const activeDate = useRef(date);
  activeDate.current = date;
  const commandReceived = useRef(false);
  const refresh = useCallback(async (signal?: AbortSignal, force = false) => {
    readsPending.current.set(readKey, (readsPending.current.get(readKey) || 0) + 1);
    const run = ++generation.current;
    const current = () => run === generation.current && activeDate.current === date && !signal?.aborted;
    const readSignal = signal || AbortSignal.timeout(30_000);
    const handleAuth = (failure: unknown) => {
      if (failure instanceof WorkspaceReadError && [401, 403].includes(failure.status)) {
        if (current()) setSnapshot(bootstrap ? workspaceShell({...bootstrap, date}) : null);
        if (failure.status === 401) window.location.replace(`/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`);
        throw failure;
      }
    };
    try {
      // Local figures must publish before slower remote update history begins.
      try {
        const summary = await fetchWorkspace<DesktopCommandSnapshot>(commandSnapshotUrl(date, true), readSignal);
        if (current()) setSnapshot(previous => mergeCommandSummary(previous, summary));
      } catch (failure) { handleAuth(failure); if (readSignal.aborted) throw failure; }
      const url = commandSnapshotUrl(date);
      const body = await fetchWorkspace<DesktopCommandSnapshot>(force ? `${url}&refresh=1` : url, readSignal, url);
      if (current()) {
        commandReceived.current = true;
        setSnapshot(body);
        setError(body.sources.alerts ? '' : 'Operational alerts are unavailable. This is not confirmation that there are no alerts.');
      }
    } catch (failure) { handleAuth(failure); throw failure; }
    finally { const remaining = (readsPending.current.get(readKey) || 1) - 1; if (remaining) readsPending.current.set(readKey, remaining); else readsPending.current.delete(readKey); }
  }, [date, readKey, bootstrap]);
  const refreshDisplayed = useCallback(async (signal: AbortSignal) => {
    if (signal.aborted || pendingRef.current || workspaceBusy.current || (readsPending.current.get(readKey) || 0) > 0) throw new Error('Dashboard refresh is busy.');
    await refresh(signal, true);
  }, [refresh, readKey]);
  useRegisterDisplayedRefresh('Command', refreshDisplayed, Boolean(pendingAlertId), date);
  useRegisterDisplayedRefresh('Settings', refreshDisplayed, Boolean(pendingAlertId), date);
  useEffect(() => {
    let disposed = false, queued = false;
    const abort = new AbortController();
    const load = () => { if (disposed || document.visibilityState === 'hidden' || pendingRef.current) return; if ((readsPending.current.get(readKey) || 0) > 0) { queued = true; return; } setClock(Date.now()); if (!new URL(window.location.href).searchParams.has('date') && !workspaceBusy.current && date !== currentDay()) { generation.current += 1; commandReceived.current = false; setSnapshot(bootstrap ? workspaceShell({...bootstrap,date:currentDay()}) : null); setDate(currentDay()); return; } void refresh(abort.signal).catch(() => { if (!disposed) { setSnapshot(previous => previous?.updatesLoading ? {...previous, updatesLoading: false} : previous); setError(commandReceived.current ? 'Live data could not refresh. The last verified snapshot remains visible.' : 'Operational updates could not load. Available daily figures remain visible.'); } }).finally(() => { if (queued && !disposed) { queued = false; load(); } }); };
    load();
    const unsubscribe = subscribeCommandArrivalUpdates(date, load);
    const timer = window.setInterval(() => { setClock(Date.now()); load(); }, 30_000);
    window.addEventListener('focus',load); window.addEventListener('online',load);
    document.addEventListener('visibilitychange',load);
    return () => { disposed = true; abort.abort(); unsubscribe(); window.clearInterval(timer); window.removeEventListener('focus',load); window.removeEventListener('online',load); document.removeEventListener('visibilitychange',load); generation.current += 1; };
  }, [refresh,date,bootstrap,readKey]);

  const selectDate = useCallback((nextDate: string, workspace?: string, fromHistory = false) => {
    if (workspaceBusy.current || pendingRef.current || !isOperatingDay(nextDate)) return;
    if (!fromHistory) window.history.pushState(window.history.state, '', operatingDayUrl(window.location.href, nextDate, workspace));
    generation.current += 1;
    activeDate.current = nextDate;
    const saved = cachedCommandSnapshot(nextDate);
    commandReceived.current = Boolean(saved && !saved.updatesLoading);
    setError('');
    setSnapshot(saved || (bootstrap ? workspaceShell({...bootstrap, date: nextDate}) : null));
    setDate(nextDate);
    setSelection(value => value + 1);
  }, [bootstrap]);
  useEffect(() => {
    const back = () => {
      const next = normalizeOperatingDayUrl(window.location.href).searchParams.get('date') || currentDay();
      if (workspaceBusy.current || pendingRef.current) {
        window.history.replaceState(window.history.state, '', operatingDayUrl(window.location.href, activeDate.current));
        return;
      }
      if (next !== activeDate.current) selectDate(next, undefined, true);
    };
    window.addEventListener('popstate', back);
    return () => window.removeEventListener('popstate', back);
  }, [selectDate]);

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
  if (!snapshot) return <main className="empty-state" role="status"><strong>{error || 'Loading Dashboard from live sources…'}</strong><span>No sample records are used.</span></main>;
  return <Home key={`${snapshot.date}:${selection}`} live={{ onBusyChange: onWorkspaceBusy, snapshot: { ...snapshot, kpis: snapshot.kpis.map(kpi => ageFinanceKpi(kpi, clock)) }, error, pendingAlertId, onAlertAction, onDateChange: selectDate }} />;
}
