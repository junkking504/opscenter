import { useEffect, useRef, useState } from 'react';
import { createRouteLoader, type RouteLoadState } from './route-loader';
import type { ScheduleRouting } from './schedule-contract';

export function useRouteEstimate(url: string | null, identity: string) {
  const key = `${url || ''}:${identity}`;
  const [result, setResult] = useState<{ key: string; state: RouteLoadState<ScheduleRouting> } | null>(null);
  const loader = useRef<ReturnType<typeof createRouteLoader<ScheduleRouting>> | null>(null);
  useEffect(() => {
    if (!url) return;
    const current = createRouteLoader(async signal => {
      const response = await fetch(url, { cache: 'no-store', credentials: 'same-origin', signal: AbortSignal.any([signal, AbortSignal.timeout(60_000)]) });
      if (!response.ok) throw new Error('Route estimates unavailable');
      return await response.json() as ScheduleRouting;
    }, state => setResult({ key, state }), () => document.visibilityState !== 'hidden');
    loader.current = current;
    void current.refresh();
    const resume = () => { void current.refresh(); };
    document.addEventListener('visibilitychange', resume);
    const timer = window.setInterval(resume, 120_000);
    return () => { current.dispose(); loader.current = null; window.clearInterval(timer); document.removeEventListener('visibilitychange', resume); };
  }, [url, key]);
  const state = result?.key === key ? result.state : { data: null, loading: Boolean(url), error: false };
  return { ...state, retry: () => { void loader.current?.refresh(); } };
}
