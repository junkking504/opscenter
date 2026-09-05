import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from './components/ui/button';

/** One bounded request at a time; failures retain the last snapshot. Drafts pause background reads. */
export function useWorkspaceRefresh(load: (signal: AbortSignal) => Promise<void>, key: string, paused = false, intervalMs = 30_000) {
  const current = useRef({ load, paused }); current.current = { load, paused };
  const flight = useRef<{ controller: AbortController; promise: Promise<void> } | null>(null);
  const [receivedAt, setReceivedAt] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const [now, setNow] = useState(Date.now);
  const refresh = useCallback(() => {
    if (flight.current) return flight.current.promise;
    const controller = new AbortController();
    setPending(true);
    const task = { controller, promise: Promise.resolve() };
    task.promise = current.current.load(AbortSignal.any([controller.signal, AbortSignal.timeout(30_000)]))
      .then(() => { if (!controller.signal.aborted) { setReceivedAt(Date.now()); setError(''); } })
      .catch(failure => { if (!controller.signal.aborted) { setError(failure instanceof Error ? failure.message : 'Refresh failed.'); throw failure; } })
      .finally(() => { if (flight.current === task) { flight.current = null; setPending(false); } });
    flight.current = task;
    return task.promise;
  }, []);
  useEffect(() => {
    setReceivedAt(null); setError('');
    const poll = () => { if (!current.current.paused && document.visibilityState !== 'hidden') void refresh().catch(() => {}); };
    // Initial load also runs for a background tab; subsequent polling resumes on focus.
    if (!current.current.paused) void refresh().catch(() => {});
    const timer = window.setInterval(poll, intervalMs);
    const tick = window.setInterval(() => setNow(Date.now()), 1000);
    window.addEventListener('focus', poll); window.addEventListener('online', poll); document.addEventListener('visibilitychange', poll);
    return () => { window.clearInterval(timer); window.clearInterval(tick); window.removeEventListener('focus', poll); window.removeEventListener('online', poll); document.removeEventListener('visibilitychange', poll); flight.current?.controller.abort(); flight.current = null; };
  }, [key, refresh, intervalMs]);
  const wasPaused = useRef(paused);
  useEffect(() => { if (paused) { flight.current?.controller.abort(); flight.current=null; setPending(false); } if (wasPaused.current && !paused) void refresh().catch(() => {}); wasPaused.current = paused; }, [paused, refresh]);
  return { refresh, receivedAt, error, pending, now, paused };
}

export function WorkspaceFreshness({ state, sourceAt, budgetMinutes = 10 }: { state: ReturnType<typeof useWorkspaceRefresh>; sourceAt?: string | null; budgetMinutes?: number }) {
  const age = sourceAt ? (state.now - Date.parse(sourceAt)) / 60000 : NaN;
  const stale = !Number.isFinite(age) || age < -1 || age > budgetMinutes;
  const time = (value: string | number) => new Date(value).toLocaleString('en-US', {timeZone:'America/Chicago',month:'short',day:'numeric',hour:'numeric',minute:'2-digit',second:'2-digit'});
  return <div className="workspace-freshness" role="status" aria-live="polite" style={{display:'flex',alignItems:'center',gap:12,flexWrap:'wrap',padding:'8px 0',fontSize:12}}>
    <span>{sourceAt ? `Source observed ${time(sourceAt)}` : 'Source time unavailable'} · {stale ? 'Check source freshness' : 'Within source freshness window'}</span>
    <span>{state.receivedAt ? `Screen retrieved ${time(state.receivedAt)}` : 'No successful screen refresh yet'}</span>
    {state.paused && <span>Background refresh paused while editing or reviewing a record.</span>}
    {state.error && <strong>Refresh failed. Last retrieved data retained. {state.error}</strong>}
    <Button variant="outline" size="sm" disabled={state.pending || state.paused} onClick={() => void state.refresh().catch(() => {})}>{state.pending ? 'Refreshing…' : 'Refresh data'}</Button>
  </div>;
}
