import { useEffect, useState } from 'react';
import { OperatingTrends } from './operating-trends';
import type { AnalyticsScope, OperatingTrendsData, OperatingMetric } from '../lib/operating-trends';
import './finance-trends.css';

export type LiveAnalyticsProps = { date: string; scope: AnalyticsScope; focusMetric?: OperatingMetric };
export function LiveAnalytics({ date, scope, focusMetric }: LiveAnalyticsProps) {
  const key = `${date}:${scope}`;
  const [result, setResult] = useState<{ key: string; data: OperatingTrendsData | null; error: string } | null>(null);
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    const controller = new AbortController(); setLoading(true);
    fetch(`/api/desktop/analytics?date=${encodeURIComponent(date)}&scope=${scope}`, { signal: controller.signal, credentials: 'same-origin', cache: 'no-store' })
      .then(async response => { const body = await response.json(); if (!response.ok) throw new Error(body.error || 'Chart data unavailable.'); return body; })
      .then(body => { if (!controller.signal.aborted) setResult({ key, data: body.data, error: '' }); })
      .catch(error => { if (!controller.signal.aborted) setResult({ key, data: null, error: error instanceof Error ? error.message : 'Chart data unavailable.' }); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [date, scope, key, revision]);
  return <section className="finance-performance analytics-page" aria-label={`${scope} history charts`}>
    <button type="button" className="analytics-refresh" disabled={loading} onClick={() => setRevision(value => value + 1)}>{loading ? 'Loading charts…' : 'Refresh charts'}</button>
    {result?.key !== key ? <p role="status">Loading historical charts…</p> : result.error ? <p role="status">{result.error}</p> : <OperatingTrends key={key} data={result.data} scope={scope} focusMetric={focusMetric} />}
  </section>;
}
