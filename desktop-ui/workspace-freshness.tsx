import { cachedWorkspace } from './lib/workspace-cache';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from './components/ui/button';

/** Cancels one caller without cancelling a poll it joined. */
function waitForRefresh(promise: Promise<void>, signal?: AbortSignal): Promise<void> {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise<void>((resolve, reject) => {
    const aborted = () => reject(signal.reason);
    signal.addEventListener('abort', aborted, { once: true });
    void promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', aborted));
  });
}

/** One bounded request at a time; failures retain the last snapshot. Drafts pause background reads. */
export function useWorkspaceRefresh(load: (signal: AbortSignal) => Promise<void>, key: string, paused = false, intervalMs = 30_000, snapshotKey?: string) {
  const current = useRef({ load, paused }); current.current = { load, paused };
  const flight = useRef<{ controller: AbortController; promise: Promise<void> } | null>(null);
  const [receivedAt, setReceivedAt] = useState<number | null>(() => snapshotKey ? cachedWorkspace(snapshotKey)?.receivedAt ?? null : null);
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const [now, setNow] = useState(Date.now);
  const refresh = useCallback((signal?: AbortSignal) => {
    if (signal?.aborted) return Promise.reject(signal.reason);
    if (flight.current) return waitForRefresh(flight.current.promise, signal);
    const controller = new AbortController();
    const abort = () => controller.abort(signal?.reason);
    signal?.addEventListener('abort', abort, { once: true });
    setPending(true);
    const task = { controller, promise: Promise.resolve() };
    task.promise = current.current.load(AbortSignal.any([controller.signal, AbortSignal.timeout(30_000)]))
      .then(() => { if (!controller.signal.aborted) { setReceivedAt(Date.now()); setError(''); } })
      .catch(failure => { if (!controller.signal.aborted) { setError(failure instanceof Error ? failure.message : 'Refresh failed.'); throw failure; } })
      .finally(() => { signal?.removeEventListener('abort', abort); if (flight.current === task) { flight.current = null; setPending(false); } });
    flight.current = task;
    return waitForRefresh(task.promise, signal);
  }, []);
  const refreshDisplayed = useCallback((signal: AbortSignal) => {
    if (current.current.paused) return Promise.reject(new Error('Refresh paused while editing.'));
    return refresh(signal);
  }, [refresh]);
  useEffect(() => {
    setReceivedAt(snapshotKey ? cachedWorkspace(snapshotKey)?.receivedAt ?? null : null); setError('');
    const poll = () => { if (!current.current.paused && document.visibilityState !== 'hidden') void refresh().catch(() => {}); };
    // Initial load also runs for a background tab; subsequent polling resumes on focus.
    if (!current.current.paused) void refresh().catch(() => {});
    const timer = window.setInterval(poll, intervalMs);
    const tick = window.setInterval(() => setNow(Date.now()), 1000);
    window.addEventListener('focus', poll); window.addEventListener('online', poll); document.addEventListener('visibilitychange', poll);
    return () => { window.clearInterval(timer); window.clearInterval(tick); window.removeEventListener('focus', poll); window.removeEventListener('online', poll); document.removeEventListener('visibilitychange', poll); flight.current?.controller.abort(); flight.current = null; };
  }, [key, refresh, intervalMs, snapshotKey]);
  const wasPaused = useRef(paused);
  useEffect(() => { if (paused) { flight.current?.controller.abort(); flight.current=null; setPending(false); } if (wasPaused.current && !paused) void refresh().catch(() => {}); wasPaused.current = paused; }, [paused, refresh]);
  return { refresh, refreshDisplayed, receivedAt, error, pending, now, paused };
}

export function WorkspaceFreshness({ state, sourceAt, budgetMinutes = 10, sourceLabel = 'Source observed', statusLabel }: { state: ReturnType<typeof useWorkspaceRefresh>; sourceAt?: string | null; budgetMinutes?: number; sourceLabel?: string; statusLabel?: string }) {
  const age = sourceAt ? (state.now - Date.parse(sourceAt)) / 60000 : NaN;
  const stale = !Number.isFinite(age) || age < -1 || age > budgetMinutes;
  const time = (value: string | number) => new Date(value).toLocaleString('en-US', {timeZone:'America/Chicago',month:'short',day:'numeric',hour:'numeric',minute:'2-digit',second:'2-digit'});
  return <div className="workspace-freshness" role="status" aria-live="polite" style={{display:'flex',alignItems:'center',gap:8,flexWrap:'wrap',padding:'4px 0',fontSize:10}}>
    {stale && <span>{sourceAt ? 'Source may be stale' : 'Source time unavailable'}</span>}
    <details><summary>Source details</summary><p>{sourceAt ? `${sourceLabel} ${time(sourceAt)}` : 'Source time unavailable'} · {statusLabel || (stale ? 'Check source freshness' : 'Within source freshness window')}</p><p>{state.receivedAt ? `Screen retrieved ${time(state.receivedAt)}` : 'No successful screen refresh yet'}</p></details>
    {state.paused && <span>Refresh paused while editing.</span>}
    {state.error && <strong>Refresh failed. {state.receivedAt ? 'Showing saved data.' : 'No data loaded.'}</strong>}
    <Button variant="outline" size="sm" disabled={state.pending || state.paused} onClick={() => void state.refresh().catch(() => {})}>{state.pending ? 'Refreshing…' : state.error ? 'Retry' : 'Refresh data'}</Button>
  </div>;
}
