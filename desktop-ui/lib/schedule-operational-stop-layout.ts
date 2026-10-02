import type { ScheduleOperationalStop } from './schedule-contract';

export type ScheduleOperationalStopPlacement = {
  stop: ScheduleOperationalStop;
  lane: number;
};

export type ScheduleOperationalStopIcon = 'house' | 'dump' | 'steel-beam' | null;

export const operationalStopIcon = (stop: ScheduleOperationalStop): ScheduleOperationalStopIcon => {
  if (stop.kind === 'hq' || stop.kind === 'departure') return 'house';
  if (stop.kind === 'dump') return 'dump';
  if (stop.name.trim().toUpperCase() === 'EMR') return 'steel-beam';
  return null;
};

export const stopMinimumWidth = (stop: ScheduleOperationalStop) =>
  operationalStopIcon(stop) ? 24 : 50;

/** Share appointment lanes when a facility pill fits; add a lane only for a real collision. */
export function scheduleOperationalStopLayout(
  stops: ScheduleOperationalStop[],
  range: { start: number; duration: number },
  timelineWidth = 640,
  occupied: Array<Array<{ left: number; right: number }>> = [],
  gap = 0,
): { placements: ScheduleOperationalStopPlacement[]; laneCount: number } {
  const width = Number.isFinite(timelineWidth) && timelineWidth > 0 ? timelineWidth : 640;
  const laneIntervals = occupied.map(lane => lane.map(interval => ({ left: interval.left * width, right: interval.right * width })));
  const placements = [...stops]
    .sort((a, b) => a.startMinutes - b.startMinutes || a.id.localeCompare(b.id))
    .map(stop => {
      const left = (stop.startMinutes - range.start) / range.duration * width;
      const durationWidth = Math.max(0, stop.endMinutes - stop.startMinutes) / range.duration * width;
      const right = left + Math.max(stopMinimumWidth(stop), durationWidth);
      let lane = laneIntervals.findIndex(intervals => intervals.every(interval => right + gap <= interval.left || left >= interval.right + gap));
      if (lane < 0) lane = laneIntervals.length;
      (laneIntervals[lane] ||= []).push({ left, right });
      return { stop, lane };
    });
  return { placements, laneCount: laneIntervals.length };
}
