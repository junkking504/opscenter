import { compareStops, stopGroupKey, stopTruck } from '../../lib/schedule-stop-order';
import { appointmentPartner } from '../../lib/appointment-partner';
import { timelinePlacement, type ScheduleAppointment, type ScheduleRouteLeg } from './schedule-contract';

type Range = Parameters<typeof timelinePlacement>[1];
type ConnectorGeometry = { reverse: boolean; left: number; width: number; top: number; height: number; labelTop: number; path?: string; arrowTop?: number };

export const scheduleBlockMinimumWidth = (actual: boolean, hasPartner: boolean) => actual ? (hasPartner ? 54 : 48) : (hasPartner ? 34 : 22);

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
  return [...units.values()]
    .map(unit => unit.sort((a,b)=>compareStops(a.job,b.job)))
    .sort((a,b)=>Math.min(...a.map(item=>item.position.start))-Math.min(...b.map(item=>item.position.start)) || compareStops(a[0].job,b[0].job))
    .flat();
}

export function scheduleTravelLayout(jobs: ScheduleAppointment[], legs: ScheduleRouteLeg[], range: Range, truck?: string, now = Date.now(), timelineWidth?: number, compact = false) {
  const lanes: Array<Array<{ left: number; right: number }>> = [];
  const placed = stackOrderedPlacements(jobs,range,truck,now).map(({job,position}) => {
    // Cards retain a usable tap target even when a GPS visit or booked window
    // is very short. On a narrow phone timeline that minimum pixel width can
    // extend well past the underlying time window, so lane packing must use the
    // rendered footprint instead of allowing visually overlapping cards.
    const minimumFraction = timelineWidth && timelineWidth > 0
      ? (scheduleBlockMinimumWidth(position.actual, Boolean(job.address && appointmentPartner(job)))) / timelineWidth
      : 0;
    const footprints = position.segments.map(segment => ({
      left: segment.left,
      right: segment.left + Math.max(segment.width, minimumFraction) + (timelineWidth ? 8/timelineWidth : 0),
    }));
    // Pack every segment, including segments belonging to the same job.
    const segmentLanes = footprints.map(footprint => {
      let lane = lanes.findIndex(intervals => intervals.every(
        interval => footprint.right <= interval.left || footprint.left >= interval.right,
      ));
      if (lane < 0) lane = lanes.length;
      (lanes[lane] ||= []).push(footprint);
      return lane;
    });
    const lane = segmentLanes[0] ?? 0;
    const renderedEnd = Math.max(position.end, ...footprints.map(interval => range.start + interval.right * range.duration));
    return { job, position, lane, segmentLanes, renderedEnd };
  });
  const pairs = legs.flatMap(leg => {
    const from = placed.find(item => item.job.recordId === leg.fromAppointmentId);
    const to = placed.find(item => item.job.recordId === leg.toAppointmentId);
    if (!from || !to) return [];
    const overlap = Math.min(from.position.end, to.position.end) > Math.max(from.position.start, to.position.start);
    return [{ leg, from, to, vertical: overlap && from.lane !== to.lane }];
  });
  const laneStep = pairs.some(pair => pair.vertical) ? (compact ? 32 : 38) : 30;
  let rowHeight = placed.length ? (Math.max(1, lanes.length) - 1) * laneStep + (compact ? 30 : 42) : compact ? 28 : 32;
  const connectors = pairs.map((pair): typeof pair & ConnectorGeometry => {
    const { from, to, vertical } = pair;
    const reverse = vertical ? from.lane > to.lane : from.position.left > to.position.left;
    if (vertical) {
      const left = Math.max(from.position.left, to.position.left);
      const right = Math.min(from.position.left + from.position.width, to.position.left + to.position.width);
      const top = Math.min(from.lane, to.lane) * laneStep + 13;
      const labelY = (reverse ? from.lane : from.lane + 1) * laneStep - 13;
      return { ...pair, reverse, left, width: right - left, top, height: Math.abs(from.lane - to.lane) * laneStep, labelTop: labelY - top };
    }
    // A gap joins the actual source and destination lanes. Using the row's
    // bottom gutter would falsely point at the last appointment in a stack.
    const sourceEdge = reverse ? from.position.left : from.position.left + from.position.width;
    const targetEdge = reverse ? to.position.left + to.position.width : to.position.left;
    if (reverse ? sourceEdge > targetEdge : targetEdge > sourceEdge) {
      const sourceY = from.lane * laneStep + 13;
      const targetY = to.lane * laneStep + 13;
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
  // Travel labels have their own collision-packed rows beneath appointment
  // cards. Their readable pixel width must not depend on a tiny time gap.
  const labelRows: Array<Array<{left:number;right:number}>> = [];
  const labelWidth = Math.min(1, 96 / (timelineWidth || 640));
  const labelBase = Math.max(1, lanes.length) * laneStep + 2;
  const readableConnectors = connectors.map(connector => {
    const center = connector.left + connector.width / 2;
    const left = Math.max(0, Math.min(1-labelWidth, center-labelWidth/2));
    const right = left + labelWidth;
    let row = labelRows.findIndex(intervals => intervals.every(interval => right <= interval.left || left >= interval.right));
    if (row < 0) row = labelRows.length;
    (labelRows[row] ||= []).push({left,right});
    return {...connector, labelLeft:left, labelWidth, labelTop:labelBase + row*laneStep - connector.top};
  });
  // Reserve whole label rows so warehouse/dump cards cannot enter them.
  const occupiedLanes = [...lanes, ...labelRows.map(()=>[{left:0,right:1}])];
  if (labelRows.length) rowHeight = labelBase + (labelRows.length-1)*laneStep + 30;
  return { placed, laneStep, rowHeight, connectors:readableConnectors, laneCount: lanes.length, occupiedLanes };
}
export type TimelineConnector = ReturnType<typeof scheduleTravelLayout>['connectors'][number];
