import { timelinePlacement, type ScheduleAppointment, type ScheduleRouteLeg } from './schedule-contract';

type Range = Parameters<typeof timelinePlacement>[1];
export function scheduleTravelLayout(jobs: ScheduleAppointment[], legs: ScheduleRouteLeg[], range: Range) {
  const lanes: number[] = [];
  const placed = [...jobs].sort((a, b) => (a.appointmentStartMinutes ?? Infinity) - (b.appointmentStartMinutes ?? Infinity)).flatMap(job => {
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
  const connectors = pairs.map(pair => {
    const { from, to, vertical } = pair;
    const reverse = vertical ? from.lane > to.lane : from.position.left > to.position.left;
    if (vertical) {
      const left = Math.max(from.position.left, to.position.left);
      const right = Math.min(from.position.left + from.position.width, to.position.left + to.position.width);
      const top = Math.min(from.lane, to.lane) * laneStep + 13;
      const labelY = (reverse ? from.lane : from.lane + 1) * laneStep - 13;
      return { ...pair, reverse, left, width: right - left, top, height: Math.abs(from.lane - to.lane) * laneStep, labelTop: labelY - top };
    }
    // Positive gaps retain their real bounds. Adjacent windows use the space
    // beneath their centers, so zero gap does not hide required travel.
    const gapStart = from.position.left + from.position.width;
    const gapEnd = to.position.left;
    const a = gapEnd > gapStart ? gapStart : from.position.left + from.position.width / 2;
    const b = gapEnd > gapStart ? gapEnd : to.position.left + to.position.width / 2;
    return { ...pair, reverse, left: Math.min(a, b), width: Math.abs(b - a), top: rowHeight - 16, height: 15, labelTop: 2 };
  });
  return { placed, laneStep, rowHeight, connectors };
}
export type TimelineConnector = ReturnType<typeof scheduleTravelLayout>['connectors'][number];
