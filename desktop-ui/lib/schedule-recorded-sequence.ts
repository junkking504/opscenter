import { timelineWindow, truckLabel, type ScheduleAppointment, type ScheduleOperationalStop } from './schedule-contract';

export type RecordedStop = { id: string; label: string; start: number; end: number; appointmentId?: string; ongoing: boolean; groupedVisits?: number };

/** Physical visits only: booked windows and proposed order are not history. */
export function recordedStopSequence(jobs: ScheduleAppointment[], stops: ScheduleOperationalStop[], truck: string, now = Date.now()): RecordedStop[] {
  const visits: RecordedStop[] = jobs.flatMap(job => {
    const window = timelineWindow(job, truckLabel(truck), now);
    return window?.actual ? window.intervals.map((visit, index) => ({
      id: `${job.recordId}:${index}`, label: `${job.jkNumber} · ${job.customerName || 'Job'}`,
      start: visit.start, end: visit.end, appointmentId: job.recordId, ongoing: Boolean(visit.ongoing),
    })) : [];
  });
  return [...visits, ...stops.filter(stop => truckLabel(stop.truck) === truckLabel(truck)).map(stop => ({
    id: stop.id, label: stop.label, start: stop.startMinutes, end: stop.endMinutes,
    ongoing: stop.ongoing, groupedVisits: stop.groupedVisits,
  }))].sort((a,b) => a.start-b.start || a.end-b.end || a.id.localeCompare(b.id));
}

/** Coalesce boundary chatter, but preserve a genuine intervening job/facility. */
export function groupNearbyHqStops(stops: ScheduleOperationalStop[], jobs: ScheduleAppointment[], truck: string, now = Date.now()) {
  const sorted = [...stops].sort((a,b) => a.startMinutes-b.startMinutes || a.id.localeCompare(b.id));
  const jobVisits = recordedStopSequence(jobs, [], truck, now);
  const result: ScheduleOperationalStop[] = [];
  for (const stop of sorted) {
    const previous = result.at(-1);
    const gap = previous ? stop.startMinutes-previous.endMinutes : Infinity;
    const interveningJob = previous && jobVisits.some(visit => visit.end > previous.endMinutes && visit.start < stop.startMinutes);
    if (previous?.kind === 'hq' && stop.kind === 'hq' && previous.name === stop.name
      && truckLabel(previous.truck) === truckLabel(stop.truck) && gap >= 0 && gap <= 20 && !interveningJob) {
      result[result.length-1] = {...previous, departedAt: stop.departedAt,
        observedThrough: stop.observedThrough, endMinutes: stop.endMinutes, ongoing: stop.ongoing,
        groupedVisits: (previous.groupedVisits || 1)+(stop.groupedVisits || 1)};
    } else result.push({...stop});
  }
  return result;
}
