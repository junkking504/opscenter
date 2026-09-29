import { randomUUID } from 'node:crypto';
import type { CrewCurrent } from './crew-dispatch';
import { readCrewDispatch, releaseCrewJob } from './crew-dispatch-store';
import { sameTruck } from './junkware-trucks';
import { chicagoDateKey } from './chicago-date';

/** The caller supplies only crewAssignedDay's fresh, server-owned truck feed.
 * Fill the next closeout slot from the full schedule without another office action.
 * An existing current-day job still requires the normal verified closeout. */
export function ensureCrewScheduleDispatch(truck: string, date: string, payload: CrewCurrent, now = new Date()) {
  const observed = Date.parse(payload.observedAt || '');
  if (date !== chicagoDateKey(now) || payload.state !== 'assigned' || !sameTruck(payload.truck,truck)
    || !Number.isFinite(observed) || observed > now.getTime() || now.getTime()-observed > 120_000) return false;
  const jobs=(payload.jobs || []).filter(job=>job.date===date && /^confirmed$/i.test(job.status));
  let changed=false;
  for(let slot=0;slot<2;slot++) {
    const state=readCrewDispatch(truck);
    if(state.current && state.current.date>date)break;
    const rollover=Boolean(state.current && state.current.date<date);
    if(!rollover && state.queued)break;
    const job=jobs.find(job=>rollover || job.appointmentId!==state.current?.appointmentId);
    if(!job)break;
    releaseCrewJob({truck,date,appointmentId:job.appointmentId,expectedVersion:state.version,requestId:randomUUID()},'verified-truck-schedule',now);
    changed=true;
  }
  return changed;
}
