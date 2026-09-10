import { compareStops } from '../../lib/schedule-stop-order';
import { timelinePlacement, type ScheduleAppointment, type ScheduleRouteLeg } from './schedule-contract';

type Range = Parameters<typeof timelinePlacement>[1];
type ConnectorGeometry = { reverse: boolean; left: number; width: number; top: number; height: number; labelTop: number; path?: string; arrowTop?: number };
export function scheduleTravelLayout(jobs: ScheduleAppointment[], legs: ScheduleRouteLeg[], range: Range) {
  const lanes: number[] = [];
  const placed = [...jobs].sort(compareStops).flatMap(job => {
    const position = timelinePlacement(job, range);
    if (!position) return [];
    let lane = lanes.findIndex(end => end <= job.appointmentStartMinutes!);
    if (lane < 0) lane = lanes.length;
    lanes[lane] = job.appointmentEndMinutes!;
    return [{ job, position, lane }];
  });
  const pairs = legs.flatMap(leg => {
    const from = placed.find(item => item.job.recordId === leg.fromAppointmentId);
    const to = placed.find(item => item.job.recordId === leg.toAppointmentId);
    if (!from || !to) return [];
    const overlap = Math.min(from.job.appointmentEndMinutes!, to.job.appointmentEndMinutes!) > Math.max(from.job.appointmentStartMinutes!, to.job.appointmentStartMinutes!);
    return [{ leg, from, to, vertical: overlap && from.lane !== to.lane }];
  });
  const laneStep = pairs.some(pair => pair.vertical) ? 38 : 24;
  const rowHeight = placed.length ? (Math.max(1, lanes.length) - 1) * laneStep + 42 : 32;
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
  return { placed, laneStep, rowHeight, connectors };
}
export type TimelineConnector = ReturnType<typeof scheduleTravelLayout>['connectors'][number];
