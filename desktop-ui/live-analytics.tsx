import { useCallback, useEffect, useRef, useState } from 'react';
import { OperatingTrends } from './operating-trends';
import { useRegisterDisplayedRefresh } from './displayed-refresh';
import type { AnalyticsScope, OperatingTrendsData, OperatingMetric } from '../lib/operating-trends';
import './finance-trends.css';

export type LiveAnalyticsProps = { date: string; scope: AnalyticsScope; focusMetric?: OperatingMetric; refreshWorkspace?: string };
export function LiveAnalytics({ date, scope, focusMetric, refreshWorkspace }: LiveAnalyticsProps) {
  const key = `${date}:${scope}`;
  const [result, setResult] = useState<{ key: string; data: OperatingTrendsData | null; error: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const flight = useRef<{ key: string; controller: AbortController; promise: Promise<void> } | null>(null);
  const read = useCallback((signal?: AbortSignal): Promise<void> => {
    signal?.throwIfAborted();
    const existing = flight.current;
    if (existing?.key === key && !existing.controller.signal.aborted) return existing.promise;
    existing?.controller.abort();
    const controller = new AbortController();
    const requestSignal = signal ? AbortSignal.any([controller.signal, signal]) : controller.signal;
    setLoading(true);
    const promise = fetch(`/api/desktop/analytics?date=${encodeURIComponent(date)}&scope=${scope}`, { signal: requestSignal, credentials: 'same-origin', cache: 'no-store' })
      .then(async response => { const body = await response.json(); if (!response.ok) throw new Error(body.error || 'Chart data unavailable.'); return body; })
      .then(body => { requestSignal.throwIfAborted(); setResult({ key, data: body.data, error: '' }); })
      .catch(error => {
        if (!requestSignal.aborted) setResult(previous => ({ key, data: previous?.key === key ? previous.data : null, error: error instanceof Error ? error.message : 'Chart data unavailable.' }));
        throw error;
      })
      .finally(() => { if (flight.current?.promise === promise) { flight.current = null; setLoading(false); } });
    flight.current = { key, controller, promise };
    return promise;
  }, [date, scope, key]);
  useEffect(() => {
    void read().catch(() => { /* The visible error is set by the reader. */ });
    return () => { flight.current?.controller.abort(); flight.current = null; };
  }, [read]);
  // Only rereads the existing local analytics snapshot; no collection or model run.
  useRegisterDisplayedRefresh(refreshWorkspace, read, false, key);
  const current = result?.key === key ? result : null;
  return <section className="finance-performance analytics-page" aria-label={`${scope} history charts`}>
    <button type="button" className="analytics-refresh" disabled={loading} onClick={() => void read().catch(() => {})}>{loading ? 'Loading charts…' : 'Refresh charts'}</button>
    {!current ? <p role="status">Loading historical charts…</p> : <>
      {current.error && <p role="status">{current.error}{current.data ? ' Showing the previous chart data.' : ''}</p>}
      {(!current.error || current.data) && <OperatingTrends key={key} data={current.data} scope={scope} focusMetric={focusMetric} />}
    </>}
  </section>;
}
