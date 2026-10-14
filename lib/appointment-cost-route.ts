import {scheduleDisplayTruck,type ScheduleAppointment} from '../desktop-ui/lib/schedule-contract';
import {costOnsiteMinutes} from './appointment-cost-recorded';

// Project the card's verified truck into cost planning without changing source assignments.
export function appointmentCostRoute<T extends ScheduleAppointment>(jobs:T[]):T[]{
 return jobs.map(job=>({...job,truck:scheduleDisplayTruck(job)}));
}
export function appointmentCostOnsite(job:ScheduleAppointment){
 return [job.onsiteTime,job.recordedOnsiteTime].find(time=>costOnsiteMinutes(time,job.truck)!==null);
}
