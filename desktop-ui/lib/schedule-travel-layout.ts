import { compareStops, stopGroupKey, stopTruck } from '../../lib/schedule-stop-order';
import { scheduleStatusTone, timelinePlacement, truckLabel, type ScheduleAppointment, type ScheduleRouteLeg } from './schedule-contract';

type Range = Parameters<typeof timelinePlacement>[1];
type ConnectorGeometry = { reverse: boolean; left: number; width: number; top: number; height: number; labelTop: number; path?: string; arrowTop?: number };

export const scheduleBlockMinimumWidth = (rangeDuration: number) => 15 / rangeDuration;

function stackOrderedPlacements(jobs: ScheduleAppointment[], range: Range, truck?: string, now = Date.now()) {
  const positioned = jobs.flatMap(job => {
    const position = timelinePlacement(job, range, truck, now);
    return position ? [{ job, position }] : [];
  });
  const bySavedWindow = new Map<string, typeof positioned>();
  for (const item of positioned) {
    if (item.job.stopOrder === undefined || !item.job.truck || truck && stopTruck(item.job.truck) !== stopTruck(truck)) continue;
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
    position.actual && position.intervals.some(interval => interval.complete && interval.end > interval.start));
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
    // Unassigned windows can share a lane at touching edges; there is no travel
    // connector between them that needs the extra horizontal gutter.
    // Render and pack the same fifteen-minute minimum footprint.
    const minimumFraction = scheduleBlockMinimumWidth(range.duration);
    const footprints = position.segments.map(segment => ({
      left: segment.left,
      right: segment.left + Math.max(segment.width, minimumFraction) + (timelineWidth && !separateCanceled ? 8/timelineWidth : 0),
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
  const centerY = mobile ? 24 : 13;
  let rowHeight = placed.length ? (Math.max(1, lanes.length) - 1) * laneStep + cardHeight : mobile ? 44 : compact ? 28 : 32;
  const connectors = pairs.map((pair): typeof pair & ConnectorGeometry => {
    const { from, to, vertical } = pair;
    const reverse = vertical ? from.lane > to.lane : from.position.left > to.position.left;
    if (vertical) {
      const left = Math.max(from.position.left, to.position.left);
      const right = Math.min(from.position.left + from.position.width, to.position.left + to.position.width);
      const top = Math.min(from.lane, to.lane) * laneStep + centerY;
      const labelY = (reverse ? from.lane : from.lane + 1) * laneStep - 13;
      return { ...pair, reverse, left, width: right - left, top, height: Math.abs(from.lane - to.lane) * laneStep, labelTop: labelY - top };
    }
    // A gap joins the actual source and destination lanes. Using the row's
    // bottom gutter would falsely point at the last appointment in a stack.
    const sourceEdge = reverse ? from.position.left : from.position.left + from.position.width;
    const targetEdge = reverse ? to.position.left + to.position.width : to.position.left;
    if (reverse ? sourceEdge > targetEdge : targetEdge > sourceEdge) {
      const sourceY = from.lane * laneStep + centerY;
      const targetY = to.lane * laneStep + centerY;
      const top = Math.min(sourceY, targetY);
      const height = Math.max(1, Math.abs(targetY - sourceY));
      const startX = reverse ? 100 : 0;
      const endX = reverse ? 0 : 100;
      return { ...pair, reverse, left: Math.min(sourceEdge, targetEdge), width: Math.abs(targetEdge - sourceEdge), top, height,
        path: `${startX},${sourceY-top} 50,${sourceY-top} 50,${targetY-top} ${endX},${targetY-top}`,
        arrowTop: targetY - top - 7, labelTop: targetY - top + 2 };
    }
    // Adjacent windows use the space beneath their centers, so zero gap
    // does not hide required travel.
    const gapStart = from.position.left + from.position.width;
    const gapEnd = to.position.left;
    const a = gapEnd > gapStart ? gapStart : from.position.left + from.position.width / 2;
    const b = gapEnd > gapStart ? gapEnd : to.position.left + to.position.width / 2;
    return { ...pair, reverse, left: Math.min(a, b), width: Math.abs(b - a), top: rowHeight - 16, height: 15, labelTop: 2 };
  });
  if (!mobile) {
    // Time-only labels use the existing gutter beneath their source lane.
    // Route estimates must not change appointment packing or truck height.
    const labelWidth = Math.min(1, 36 / (timelineWidth || 640));
    return { placed, laneStep, rowHeight, laneCount: lanes.length, occupiedLanes: lanes,
      connectors: connectors.map(c => ({...c,
        labelLeft: Math.max(0, Math.min(1-labelWidth, c.left+c.width/2-labelWidth/2)),
        labelWidth, labelTop: c.from.lane*laneStep+25-c.top,
      })) };
  }
  // Travel labels have their own collision-packed rows beneath appointment
  // cards. Their readable pixel width must not depend on a tiny time gap.
  const labelRows: Array<Array<{left:number;right:number}>> = [];
  const labelWidth = Math.min(1, (mobile ? 44 : 96) / (timelineWidth || 640));
  const labelStep = 22;
  const labelBase = rowHeight + 4;
  const readableConnectors = connectors.map(connector => {
    const center = connector.left + connector.width / 2;
    const left = Math.max(0, Math.min(1-labelWidth, center-labelWidth/2));
    const right = left + labelWidth;
    let row = labelRows.findIndex(intervals => intervals.every(interval => right <= interval.left || left >= interval.right));
    if (row < 0) row = labelRows.length;
    (labelRows[row] ||= []).push({left,right});
    return {...connector, labelLeft:left, labelWidth, labelTop:labelBase + row*labelStep - connector.top};
  });
  // Reserve each label in the appointment lanes it actually crosses. Labels
  // have a smaller row step; their array index is not a facility-lane index.
  const occupiedLanes = lanes.map(lane => [...lane]);
  readableConnectors.forEach(connector => {
    const top = connector.top + connector.labelTop;
    const first = Math.floor((top - 2) / laneStep);
    const last = Math.floor((top + 18 - 2 - .001) / laneStep);
    for (let lane = first; lane <= last; lane++)
      (occupiedLanes[lane] ||= []).push({left:connector.labelLeft,right:connector.labelLeft+connector.labelWidth});
  });
  if (labelRows.length) rowHeight = labelBase + (labelRows.length-1)*labelStep + 20;
  return { placed, laneStep, rowHeight, connectors:readableConnectors, laneCount: lanes.length, occupiedLanes };
}
export type TimelineConnector = ReturnType<typeof scheduleTravelLayout>['connectors'][number];
