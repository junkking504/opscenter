import type { ScheduleOperationalStop } from './schedule-contract';

export type ScheduleOperationalStopPlacement = {
  stop: ScheduleOperationalStop;
  lane: number;
};

const stopMinimumWidth = (stop: ScheduleOperationalStop) => stop.endMinutes === stop.startMinutes ? 90 : 50;

/** Put facility stops on separate rows whenever their rendered pills would collide. */
export function scheduleOperationalStopLayout(
  stops: ScheduleOperationalStop[],
  range: { start: number; duration: number },
  timelineWidth = 640,
  gap = 6,
): { placements: ScheduleOperationalStopPlacement[]; laneCount: number } {
  const width = Number.isFinite(timelineWidth) && timelineWidth > 0 ? timelineWidth : 640;
  const laneEnds: number[] = [];
  const placements = [...stops]
    .sort((a, b) => a.startMinutes - b.startMinutes || a.id.localeCompare(b.id))
    .map(stop => {
      const left = (stop.startMinutes - range.start) / range.duration * width;
      const durationWidth = Math.max(0, stop.endMinutes - stop.startMinutes) / range.duration * width;
      const right = left + Math.max(stopMinimumWidth(stop), durationWidth);
      let lane = laneEnds.findIndex(end => left >= end + gap);
      if (lane < 0) lane = laneEnds.length;
      laneEnds[lane] = right;
      return { stop, lane };
    });
  return { placements, laneCount: laneEnds.length };
}
