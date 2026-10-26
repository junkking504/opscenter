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
  // The ruler owns recorded chronology. A short observation can have a larger
  // hit area, but that padding must stop before the next recorded arrival.
  const recordedStarts = placements.flatMap(({position}) => position.actual
    ? position.segments.map(segment => segment.left) : []).sort((a,b) => a-b);
  let canceledLaneStart: number | undefined;
  const placed = placements.map(({job,position}) => {
    // Cancellations stay below every active appointment, even at different times.
    if (separateCanceled && isCanceled(job)) canceledLaneStart ??= lanes.length;
    const firstLane = canceledLaneStart ?? 0;
    // Pack the rendered footprint only, so back-to-back appointments can
    // share a lane. Travel labels reserve their own space below the blocks.
    // Planned cards keep their minimum; recorded padding yields to later arrivals.
    const minimumFraction = scheduleBlockMinimumWidth(range.duration);
    const renderedSegments = position.segments.map(segment => {
      const next = position.actual ? recordedStarts.find(left => left > segment.left + 1e-9) : undefined;
      const padding = next === undefined ? minimumFraction : Math.min(minimumFraction, next-segment.left);
      return {...segment, width:Math.max(segment.width,padding)};
    });
    const footprints = renderedSegments.map(segment => ({left:segment.left,right:segment.left+segment.width}));
    // Pack every segment, including segments belonging to the same job.
    const segmentLanes = footprints.map(footprint => {
      let lane = lanes.findIndex((intervals, index) => index >= firstLane && intervals.every(
        interval => footprint.right <= interval.left + 1e-9 || footprint.left >= interval.right - 1e-9,
      ));
      if (lane < 0) lane = lanes.length;
      (lanes[lane] ||= []).push(footprint);
      return lane;
    });
    const lane = segmentLanes[0] ?? 0;
    const renderedEnd = Math.max(position.end, ...footprints.map(interval => range.start + interval.right * range.duration));
    return { job, position, lane, segmentLanes, renderedSegments, gapLanes:[] as number[], renderedEnd };
  });
  // An annotation about being away from one job must not displace an actual
  // appointment in that interval. Reserve all appointment footprints first.
  for (const item of placed) {
    item.gapLanes = item.position.gapSegments.map((segment,index) => {
      const footprint = {left:segment.left,right:segment.left+(item.position.gaps[index].kind==='dump' ? 24/(timelineWidth || 640) : segment.width)};
      const firstLane = separateCanceled && isCanceled(item.job) ? canceledLaneStart ?? 0 : 0;
      let lane = lanes.findIndex((intervals, index) => index >= firstLane && intervals.every(interval =>
        footprint.right <= interval.left + 1e-9 || footprint.left >= interval.right - 1e-9,
      ));
      if (lane < 0) lane = lanes.length;
      (lanes[lane] ||= []).push(footprint);
      return lane;
    });
  }
  const pairs = legs.flatMap(leg => {
    const from = placed.find(item => item.job.recordId === leg.fromAppointmentId);
    const to = placed.find(item => item.job.recordId === leg.toAppointmentId);
    if (!from || !to) return [];
    let sourceIndex = from.position.intervals.length-1;
    const targetIndex = 0;
    const targetStart = to.position.intervals[targetIndex].start;
    const recordedOrder = from.position.actual && to.position.actual;
    // A proposed future stop cannot point back into already recorded history.
    if (!from.position.actual && to.position.actual) return [];
    if (from.position.actual) {
      if (recordedOrder) {
        sourceIndex = from.position.intervals.findLastIndex(interval => interval.end <= targetStart);
        if (sourceIndex < 0 || from === to) return [];
        const sourceEnd = from.position.intervals[sourceIndex].end;
        const interveningVisit = placed.some(item => item !== from && item !== to && item.position.actual
          && item.position.intervals.some(interval => interval.start < targetStart && interval.end > sourceEnd));
        if (interveningVisit) return [];
      } else if (from.position.intervals[sourceIndex].end > targetStart) return [];
    }
    const sourceInterval = from.position.intervals[sourceIndex];
    const targetInterval = to.position.intervals[targetIndex];
    const overlap = Math.min(sourceInterval.end,targetInterval.end) > Math.max(sourceInterval.start,targetInterval.start);
    return [{ leg, from, to, sourceIndex, targetIndex, recordedOrder,
      vertical: overlap && from.segmentLanes[sourceIndex] !== to.segmentLanes[targetIndex] }];
  });
  const laneStep = mobile ? 48 : 22;
  const cardHeight = mobile ? 46 : 24;
  let rowHeight = placed.length ? (Math.max(1, lanes.length) - 1) * laneStep + cardHeight : mobile ? 44 : compact ? 28 : 32;
  // Keep minutes attached to a continuous line between the rendered blocks.
  // Wide gaps use the appointment lane. Below crowded blocks, pack the labels
  // rather than the full connector spans: overlapping dotted lines must not
  // create a new row for every leg. Labels can slide along the shared rail.
  const availableWidth = timelineWidth || 640;
  const labelWidth = Math.min(1, 32 / availableWidth);
  const labelHeight = 14;
  const trackStep = 18;
  const trackBase = rowHeight + 10;
  const tracks: Array<Array<{left:number;right:number}>> = [];
  const occupiedLanes = lanes.map(lane => [...lane]);
  const readableConnectors = pairs.map(pair => {
    const {from,to} = pair;
    const source = from.renderedSegments[pair.sourceIndex];
    const target = to.renderedSegments[pair.targetIndex];
    const sourceLane = from.segmentLanes[pair.sourceIndex] ?? from.lane;
    const targetLane = to.segmentLanes[pair.targetIndex] ?? to.lane;
    const sourceRight = source.left + source.width;
    const targetRight = target.left + target.width;
    const forwardGap = target.left >= sourceRight;
    const reverseGap = source.left >= targetRight;
    const separated = forwardGap || reverseGap;
    const sourceX = forwardGap ? sourceRight : reverseGap ? source.left : (source.left + sourceRight)/2;
    const targetX = forwardGap ? target.left : reverseGap ? targetRight : (target.left + targetRight)/2;
    const sourceY = sourceLane*laneStep + (separated ? 13 : cardHeight);
    const targetY = targetLane*laneStep + (separated ? 13 : cardHeight);
    let labelLeft = Math.max(0,Math.min(1-labelWidth,(sourceX+targetX-labelWidth)/2));
    let footprint = {left:Math.min(sourceX,targetX,labelLeft),right:Math.max(sourceX,targetX,labelLeft+labelWidth)};
    const clearGap = separated && sourceLane === targetLane
      && Math.abs(targetX-sourceX)*availableWidth >= 40
      && lanes[sourceLane].every(interval => interval.right <= footprint.left+1e-9 || interval.left >= footprint.right-1e-9);
    let railY = sourceY;
    if (!clearGap) {
      const gap = 4/availableWidth;
      let track = 0;
      for (; track < tracks.length; track++) {
        const items = [...tracks[track]].sort((a,b)=>a.left-b.left);
        let start = 0;
        const candidates: number[] = [];
        for (const item of [...items,{left:1+gap,right:1+gap}]) {
          const end = item.left-gap;
          if (end-start >= labelWidth-1e-9) candidates.push(Math.max(start,Math.min(end-labelWidth,labelLeft)));
          start = item.right+gap;
        }
        if (candidates.length) {
          labelLeft = candidates.sort((a,b)=>Math.abs(a-labelLeft)-Math.abs(b-labelLeft))[0];
          break;
        }
      }
      (tracks[track] ||= []).push({left:labelLeft,right:labelLeft+labelWidth});
      railY = trackBase+track*trackStep;
      footprint = {left:Math.min(sourceX,targetX,labelLeft),right:Math.max(sourceX,targetX,labelLeft+labelWidth)};
    }
    const left = footprint.left;
    const width = Math.max(footprint.right-left,.0001);
    const top = Math.min(sourceY,targetY,railY-labelHeight/2);
    const height = Math.max(sourceY,targetY,railY+labelHeight/2)-top;
    const x = (value:number) => (value-left)*100/width;
    const path = `${x(sourceX)},${sourceY-top} ${x(sourceX)},${railY-top} ${x(labelLeft+labelWidth/2)},${railY-top} ${x(targetX)},${railY-top} ${x(targetX)},${targetY-top}`;
    const labelTop = railY-labelHeight/2-top;
    // Reserve the rail against facility markers, including its minute label.
    const first = Math.max(0,Math.floor((railY-labelHeight/2-2)/laneStep));
    const lastLane = Math.floor((railY+labelHeight/2-2-.001)/laneStep);
    for(let lane=first;lane<=lastLane;lane++) (occupiedLanes[lane] ||= []).push(footprint);
    return {...pair,left,width,top,height,path,labelLeft,labelWidth,labelTop,
      arrowLeft:x(targetX),arrowTop:targetY-top,
      arrow:clearGap ? (forwardGap ? '→' : '←') : '↑'};
  });
  if(tracks.length) rowHeight = trackBase+(tracks.length-1)*trackStep+labelHeight/2+3;
  return { placed, laneStep, rowHeight, connectors:readableConnectors, laneCount: lanes.length, occupiedLanes };
}
export type TimelineConnector = ReturnType<typeof scheduleTravelLayout>['connectors'][number];
