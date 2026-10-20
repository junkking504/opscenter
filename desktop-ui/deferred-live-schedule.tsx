import { Suspense, type ComponentProps } from 'react';
import { preloadableWorkspace } from './lib/preloadable-workspace';
import type LiveScheduleComponent from './live-schedule';
import './live-schedule-styles';

type LiveScheduleProps = ComponentProps<typeof LiveScheduleComponent>;

// Schedule and its map (Leaflet) are about a third of the shell's script. Load
// them on demand so Command paints first; the import starts in parallel with
// the first data read wherever the map or board will be shown.
const { Component: LazyLiveSchedule, preload } = preloadableWorkspace<LiveScheduleProps>(() => import('./live-schedule'));
export const preloadLiveSchedule = preload;

export default function LiveSchedule(props: LiveScheduleProps) {
  return <Suspense fallback={<div className="workspace-loading" role="status">{props.mapOnly ? 'Loading map…' : 'Loading Control…'}</div>}><LazyLiveSchedule {...props} /></Suspense>;
}
