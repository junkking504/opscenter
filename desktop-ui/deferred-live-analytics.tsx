import { Suspense } from 'react';
import { preloadableWorkspace } from './lib/preloadable-workspace';
import type { LiveAnalyticsProps } from './live-analytics';

// Charts (Recharts) cost more than most workspaces; load them only where shown.
const { Component: LazyAnalytics } = preloadableWorkspace<LiveAnalyticsProps>(() => import('./live-analytics').then(module => ({ default: module.LiveAnalytics })));
export function LiveAnalytics(props: LiveAnalyticsProps) { return <Suspense fallback={<p role="status">Loading charts…</p>}><LazyAnalytics {...props} /></Suspense>; }
