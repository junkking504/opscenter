import { useEffect, useState } from 'react';

let sequence = 0;
let pending: { workspace: string; started: number; sequence: number; kind: string } | null = {
  workspace: new URLSearchParams(window.location.search).get('workspace') || 'Command', started: 0, sequence, kind: 'Page load',
};
const enabled = new URLSearchParams(window.location.search).get('performance') === '1';
const samples: string[] = [];
const listeners = new Set<() => void>();

export function startWorkspaceNavigation(workspace: string) {
  pending = { workspace, started: performance.now(), sequence: ++sequence, kind: 'Navigation' };
}

/** Called after records commit; the timer runs after the next paint opportunity. */
export function workspaceReady(workspace: string) {
  const target = pending;
  if (!target || target.workspace !== workspace) return;
  requestAnimationFrame(() => setTimeout(() => {
    if (pending !== target) return;
    const duration = performance.now() - target.started;
    performance.measure(`opscenter:${workspace}:ready`, { start: target.started, end: performance.now() });
    performance.clearMeasures(`opscenter:${workspace}:ready`);
    pending = null;
    if (enabled) {
      samples.push(`${target.kind}: ${workspace} records visible in ${Math.round(duration)} ms`);
      if (samples.length > 12) samples.shift();
      listeners.forEach(listener => listener());
    }
  }, 0));
}

/** Explicit opt-in, local-only diagnostic. No performance reports are uploaded. */
export function NavigationDiagnostics() {
  const [, update] = useState(0);
  useEffect(() => { const notify = () => update(value => value + 1); listeners.add(notify); return () => { listeners.delete(notify); }; }, []);
  if (!enabled) return null;
  const navigation = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
  const resources = performance.getEntriesByType('resource') as PerformanceResourceTiming[];
  const assets = resources.filter(entry => entry.name.includes('/desktop-assets/assets/'));
  const request = resources.filter(entry => /\/api\/desktop\/(fleet|finance|marketing|krewe|schedule|command)\?/.test(entry.name)).at(-1);
  return <aside aria-label="Navigation timings" style={{position:'fixed',right:8,bottom:8,zIndex:10000,background:'#fff',color:'#17251d',border:'1px solid #829084',padding:10,maxWidth:400,fontSize:12}}>
    <strong>Navigation timings · this browser</strong>
    <p>Document wait: {Math.round(navigation?.responseStart || 0)} ms · Slowest asset: {Math.round(Math.max(0,...assets.map(entry => entry.duration)))} ms{request ? ` · Last data request: ${Math.round(request.duration)} ms` : ''}</p>
    <ul>{samples.map((sample,index) => <li key={index}>{sample}</li>)}</ul>
  </aside>;
}
