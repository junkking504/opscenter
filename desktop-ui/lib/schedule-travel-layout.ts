import { compareStops, stopGroupKey, stopTruck } from '../../lib/schedule-stop-order';
import { scheduleStatusTone, timelinePlacement, truckLabel, type ScheduleAppointment, type ScheduleRouteLeg } from './schedule-contract';

type Range = Parameters<typeof timelinePlacement>[1];

export const scheduleBlockMinimumWidth = (rangeDuration: number) => 15 / rangeDuration;

function stackOrderedPlacements(jobs: ScheduleAppointment[], range: Range, truck?: string, now = Date.now()) {
  const positioned = jobs.flatMap(job => {
    const position = timelinePlacement(job, range, truck, now);
    return position ? [{ job, position }] : [];
  });
  const bySavedWindow = new Map<string, typeof positioned>();
  for (const item of positioned) {
    if ((item.job.stopOrder === undefined && item.job.visitOrder === undefined) || !item.job.truck || truck && stopTruck(item.job.truck) !== stopTruck(truck)) continue;
    const key = stopGroupKey(item.job);
    bySavedWindow.set(key, [...(bySavedWindow.get(key) || []), item]);
  }

  // A saved same-window order is also the visual top-to-bottom order. Group
  // only appointments that actually overlap on this rendered timeline; a GPS
  // visit that no longer overlaps another stop remains chronologically placed.
  const unitFor = new Map<string,string>();
  for (const [groupKey, items] of bySavedWindow) {
    const pending = new Set(items.map(item => item.job.recordId));
    let component = 0;
    while (pending.size) {
      const members = [pending.values().next().value as string];
      pending.delete(members[0]);
      for (let index = 0; index < members.length; index++) {
        const current = items.find(item => item.job.recordId === members[index])!;
        for (const candidateId of [...pending]) {
          const candidate = items.find(item => item.job.recordId === candidateId)!;
          if (Math.min(current.position.end,candidate.position.end) <= Math.max(current.position.start,candidate.position.start)) continue;
          pending.delete(candidateId);
          members.push(candidateId);
        }
      }
      if (members.length > 1) members.forEach(id => unitFor.set(id,`${groupKey}:${component}`));
      component++;
    }
  }

  const units = new Map<string, typeof positioned>();
  for (const item of positioned) {
    const key = unitFor.get(item.job.recordId) || `appointment:${item.job.recordId}`;
    units.set(key,[...(units.get(key) || []),item]);
  }
  // Recorded visits reserve lanes before unvisited booked windows. GPS arrival
  // may be seconds after a booked start, but that must not push finished work
  // below future stops. Keep explicit same-window order together as one unit.
  const recorded = (unit: typeof positioned) => unit.some(({position}) =>
    position.actual && position.intervals.some(interval => interval.end > interval.start));
  const ordered = [...units.values()]
    .map(unit => unit.sort((a,b)=>compareStops(a.job,b.job)))
    .sort((a,b)=>Number(recorded(b))-Number(recorded(a)) || Math.min(...a.map(item=>item.position.start))-Math.min(...b.map(item=>item.position.start)) || compareStops(a[0].job,b[0].job))
    .flat();
  // Reserve the top lane for the truck's current appointment before packing
  // upcoming windows. Presence belongs to the physical truck, which can differ
  // from the assignment. Past visits and source status text are not presence.
  const current = ({job, position}: typeof positioned[number]) => {
    if (!truck || truckLabel(truck) === 'Unassigned' || /cancel/i.test(job.status || '')) return false;
    const same = (value: string) => truckLabel(value) === truckLabel(truck);
    return position.intervals.some(interval => interval.ongoing && !interval.complete)
      || Boolean(job.truckOnSite && same(job.onsiteTruck || job.truck))
      || Boolean(job.truckAtJob && same(job.atJobTruck || job.truck));
  };
  return [...ordered.filter(current), ...ordered.filter(item => !current(item))];
}

export function scheduleTravelLayout(jobs: ScheduleAppointment[], legs: ScheduleRouteLeg[], range: Range, truck?: string, now = Date.now(), timelineWidth?: number, compact = false, mobile = false) {
  const lanes: Array<Array<{ left: number; right: number }>> = [];
  const ordered = stackOrderedPlacements(jobs,range,truck,now);
  const separateCanceled = truck === 'Unassigned';
  const isCanceled = (job: ScheduleAppointment) => scheduleStatusTone(job) === 'canceled';
  const placements = separateCanceled
    ? [...ordered.filter(item => !isCanceled(item.job)), ...ordered.filter(item => isCanceled(item.job))]
    : ordered;
  let canceledLaneStart: number | undefined;
  const placed = placements.map(({job,position}) => {
    // Cancellations stay below every active appointment, even at different times.
    if (separateCanceled && isCanceled(job)) canceledLaneStart ??= lanes.length;
    const firstLane = canceledLaneStart ?? 0;
    // Pack the rendered footprint only, so back-to-back appointments can
    // share a lane. Travel labels reserve their own space below the blocks.
    // Preserve the fifteen-minute minimum for short visit blocks.
    const minimumFraction = scheduleBlockMinimumWidth(range.duration);
    const footprints = position.segments.map(segment => ({
      left: segment.left,
      right: segment.left + Math.max(segment.width, minimumFraction),
    }));
    // Pack every segment, including segments belonging to the same job.
    const segmentLanes = footprints.map(footprint => {
      let lane = lanes.findIndex((intervals, index) => index >= firstLane && intervals.every(
        interval => footprint.right <= interval.left + 1e-9 || footprint.left >= interval.right - 1e-9,
      ));
      if (lane < 0) lane = lanes.length;
      (lanes[lane] ||= []).push(footprint);
      return lane;
    });
    const gapLanes = position.gapSegments.map((segment,index) => {
      const footprint = {left:segment.left,right:segment.left+(position.gaps[index].kind==='dump' ? 24/(timelineWidth || 640) : segment.width)};
      let lane = lanes.findIndex((intervals, index) => index >= firstLane && intervals.every(interval =>
        footprint.right <= interval.left + 1e-9 || footprint.left >= interval.right - 1e-9,
      ));
      if (lane < 0) lane = lanes.length;
      (lanes[lane] ||= []).push(footprint);
      return lane;
    });
    const lane = segmentLanes[0] ?? 0;
    const renderedEnd = Math.max(position.end, ...footprints.map(interval => range.start + interval.right * range.duration));
    return { job, position, lane, segmentLanes, gapLanes, renderedEnd };
  });
  const pairs = legs.flatMap(leg => {
    const from = placed.find(item => item.job.recordId === leg.fromAppointmentId);
    const to = placed.find(item => item.job.recordId === leg.toAppointmentId);
    if (!from || !to) return [];
    const overlap = Math.min(from.position.end, to.position.end) > Math.max(from.position.start, to.position.start);
    return [{ leg, from, to, vertical: overlap && from.lane !== to.lane }];
  });
  const laneStep = mobile ? 48 : 22;
  const cardHeight = mobile ? 46 : 24;
  let rowHeight = placed.length ? (Math.max(1, lanes.length) - 1) * laneStep + cardHeight : mobile ? 44 : compact ? 28 : 32;
  const connectors = pairs;
  // Travel is an ordered, named sequence beneath the time grid. Its cards
  // describe endpoints explicitly: a planned sequence is not a time interval.
  const availableWidth = timelineWidth || 640;
  const columns = Math.max(1, Math.floor(availableWidth / 220));
  const labelWidth = 1 / columns - 6 / availableWidth;
  const labelStep = 42;
  const labelBase = rowHeight + 6;
  const readableConnectors = connectors.map((connector,index) => ({...connector,
    labelLeft: (index % columns) / columns, labelWidth,
    top: 0, labelTop: labelBase + Math.floor(index / columns) * labelStep,
    sequence: index + 1,
  }));
  // Reserve each label in the appointment lanes it actually crosses. Labels
  // have a smaller row step; their array index is not a facility-lane index.
  const occupiedLanes = lanes.map(lane => [...lane]);
  readableConnectors.forEach(connector => {
    const top = connector.top + connector.labelTop;
    const first = Math.floor((top - 2) / laneStep);
    const last = Math.floor((top + 38 - 2 - .001) / laneStep);
    for (let lane = first; lane <= last; lane++)
      (occupiedLanes[lane] ||= []).push({left:connector.labelLeft,right:connector.labelLeft+connector.labelWidth});
  });
  if (connectors.length) rowHeight = labelBase + Math.ceil(connectors.length / columns)*labelStep;
  return { placed, laneStep, rowHeight, connectors:readableConnectors, laneCount: lanes.length, occupiedLanes };
}
export type TimelineConnector = ReturnType<typeof scheduleTravelLayout>['connectors'][number];
