import { lazy, Suspense, type ComponentProps } from 'react';

// The board does not need the drawer's controls or its Astryx theme. Keep the
// adopted controls intact and load their scoped styles before rendering them.
const Controls = lazy(() => import('./schedule-controls'));
export function ScheduleControls(props: ComponentProps<typeof Controls>) {
  return <Suspense fallback={<p role="status">Loading appointment controls…</p>}><Controls {...props} /></Suspense>;
}
