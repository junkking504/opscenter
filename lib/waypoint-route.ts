import type {CrewScheduledJob} from './crew-dispatch';
import {sameTruck} from './junkware-trucks';
export type WaypointStop={job:CrewScheduledJob;number:number};
/** Keep the server's Route Order; never sort by coordinates or renumber mapped-only stops. */
export function waypointStops(jobs:CrewScheduledJob[],truck:string):WaypointStop[] {
 return jobs.filter(job=>sameTruck(job.truck ?? truck,truck) && !/completed|cancelled/i.test(job.status))
  .map((job,index)=>({job,number:job.routePosition ?? index+1}));
}
export function hasWaypointLocation(stop:WaypointStop) {
 const point=stop.job.mapLocation;
 return Boolean(point && Number.isFinite(point.latitude) && Number.isFinite(point.longitude)
  && Math.abs(point.latitude)<=90 && Math.abs(point.longitude)<=180);
}
