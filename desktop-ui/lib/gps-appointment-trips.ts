import type {GpsTrip, TruckGpsRoute} from './gps-route-contract';
import {displayedOnsiteTime, scheduleCustomerLabel, truckLabel, type ScheduleAppointment} from './schedule-contract';

/** Ignition trips can contain several customer stops when the engine stays on.
 * Split their display at confirmed visits without changing source GPS/history. */
export function gpsAppointmentTrips(route: TruckGpsRoute, jobs: ScheduleAppointment[]): TruckGpsRoute {
  const visits = jobs.flatMap(job => {
    const location = job.location;
    if (!location || !job.recordId.startsWith(`${route.date}:`)) return [];
    const time = displayedOnsiteTime(job);
    const intervals = job.truckVisits?.length ? job.truckVisits : time?.intervals?.map(v=>({
      ...v, truck: time.truck || job.truck,
    })) || [];
    return intervals.flatMap(visit => {
      const start = Date.parse(visit.arrival), end = Date.parse(visit.departure || '');
      return truckLabel(visit.truck) === truckLabel(route.truck) && Number.isFinite(start) && Number.isFinite(end) && end >= start
        ? [{job,start,end,point:{...location,address:`${job.jkNumber} · ${scheduleCustomerLabel(job)}`}}] : [];
    });
  }).sort((a,b)=>a.start-b.start);
  // A truck cannot be attributed to competing appointments at the same time.
  const unambiguous = visits.filter((visit,index)=>!visits.some((other,j)=>j!==index && other.job.recordId!==visit.job.recordId
    && ((other.start<visit.end && other.end>visit.start) || (other.start===visit.start && (other.end===other.start || visit.end===visit.start)))));
  const trips = (route.trips || []).flatMap(trip => {
    const start = Date.parse(trip.departure), end = Date.parse(trip.arrival);
    const stops = unambiguous.filter(visit=>visit.start<=end && visit.end>=start);
    if (!stops.length) return [trip];
    const pieces: GpsTrip[] = [];
    let from = trip.from, departure = start, fromKey = 'start';
    for (const stop of stops) {
      if (stop.start > departure) pieces.push({...trip,
        id:`${trip.id}:${fromKey}:to:${stop.job.recordId}:${stop.start}`,
        departure:new Date(departure).toISOString(), arrival:new Date(Math.min(end,stop.start)).toISOString(), from, to:stop.point});
      from=stop.point;
      fromKey=`${stop.job.recordId}:${stop.end}`;
      departure=Math.max(departure,stop.end);
    }
    if (departure < end) pieces.push({...trip,id:`${trip.id}:${fromKey}:end`,departure:new Date(departure).toISOString(),from,to:trip.to});
    // A trip wholly inside a visit is still retained as source history.
    return pieces.length ? pieces : [trip];
  }).map((trip,index)=>({...trip,number:index+1}));
  return {...route,trips};
}
