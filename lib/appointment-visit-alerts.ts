import { createHash } from 'node:crypto';
import { consolidateConfirmedVisitAlerts } from './confirmed-visit-alerts';
import type { OperationalAlert } from './operational-alert-presentation';

type Interval = {arrival?: string; departure?: string | null; departure_confirmed?: boolean};
type Visit = {
  appointment_id?: string; appt_id?: string; jk_number?: string; job_id?: string;
  truck_number?: string | number; truck?: string; match_confidence?: string; pass_by_only?: boolean;
  first_arrival?: string; final_departure?: string; visit_count?: number; visit_intervals?: Interval[];
  operational_confirmation?: boolean;
};
type Appointment = {appointmentId: string; jkNumber: string; customerName: string; address: string; territory: string};
const truckKey = (value: unknown) => String(value || '').match(/\d+/)?.[0]?.replace(/^0+/, '') || '';
const day = (stamp: string) => new Intl.DateTimeFormat('en-CA', {timeZone:'America/Chicago'}).format(new Date(stamp));
const clock = (stamp: string) => new Intl.DateTimeFormat('en-US', {timeZone:'America/Chicago',hour:'numeric',minute:'2-digit'}).format(new Date(stamp));
const time = (stamp: string) => new Intl.DateTimeFormat('en-US', {timeZone:'America/Chicago',month:'short',day:'numeric',hour:'numeric',minute:'2-digit',second:'2-digit'}).format(new Date(stamp));
const duration = (milliseconds: number) => {
  const seconds = Math.floor(milliseconds / 1000), hours = Math.floor(seconds / 3600), minutes = Math.floor(seconds % 3600 / 60), rest = seconds % 60;
  return [hours ? `${hours}h` : '',minutes ? `${minutes}m` : '',rest || (!hours && !minutes) ? `${rest}s` : ''].filter(Boolean).join(' ');
};

/** One alert per confirmed physical visit, independent of Slack publication.
 * Keep the arrival identity through departure, and preserve legacy review aliases.
 * A return visit gets its own identity and never includes time away from the site.
 */
export function appointmentVisitAlerts(input: OperationalAlert[], visits: Visit[], appointments: Appointment[], date: string, now = Date.now()): OperationalAlert[] {
  const candidates = new Map<string, {reference: string; truck: string; appointment: string; start: string; end: string | null; operational: boolean; conflict: boolean}>();
  for (const visit of visits) {
    if (visit.match_confidence !== 'confirmed' || visit.pass_by_only) continue;
    const reference = String(visit.jk_number || visit.job_id || '').toUpperCase();
    const truck = truckKey(visit.truck_number || visit.truck), appointment = String(visit.appointment_id || visit.appt_id || '');
    if (!/^JK\d+$/.test(reference) || !truck || !appointment) continue;
    const intervals = visit.visit_intervals?.length ? visit.visit_intervals : visit.visit_count === 1 ? [{arrival:visit.first_arrival,departure:visit.final_departure}] : [];
    for (const interval of intervals) {
      const startMs = Date.parse(interval.arrival || ''), endMs = Date.parse(interval.departure || '');
      if (!Number.isFinite(startMs) || startMs > now) continue;
      const start = new Date(startMs).toISOString();
      const end = interval.departure_confirmed !== false && Number.isFinite(endMs) && endMs > startMs && endMs <= now ? new Date(endMs).toISOString() : null;
      if (day(end || start) !== date) continue;
      const key = JSON.stringify([appointment,reference,truck,start]);
      const previous = candidates.get(key);
      // Conflicting duplicate records cannot establish a precise departure.
      candidates.set(key,{reference,truck,appointment,start,end,operational:!!visit.operational_confirmation || !!previous?.operational,
        conflict:!!previous?.conflict || !!previous && previous.end !== end});
    }
  }
  const sources = consolidateConfirmedVisitAlerts(input, [...candidates.values()].filter(visit=>!visit.operational && !visit.conflict).map(visit=>({
    appointment_id:visit.appointment,jk_number:visit.reference,truck_number:visit.truck,match_confidence:'confirmed',visit_count:1,
    visit_intervals:[{arrival:visit.start,departure:visit.end,departure_confirmed:!!visit.end}],
  })), now);
  const matched = new Map<string, OperationalAlert[]>(), unmatched: OperationalAlert[] = [];
  for (const alert of sources) {
    const stamp = alert.timestamp || '', reference = alert.title.match(/\bJK\d+\b/i)?.[0]?.toUpperCase();
    const truck = truckKey(alert.truck || alert.title.match(/\bTruck\s*#?\s*\d+/i)?.[0]);
    const fact = (label: string) => alert.facts.find(f=>f.label.toLowerCase() === label.toLowerCase())?.value.replace(/\s*(?:CT|CDT|CST)$/i,'').trim();
    const matches = !alert.threadReply && ['Arrival','Duration'].includes(alert.label) && Number.isFinite(Date.parse(stamp))
      ? [...candidates].filter(([,visit])=> !visit.conflict && !visit.operational && visit.reference === reference && visit.truck === truck
        && day(stamp) === day(visit.start) && (!visit.end || day(visit.end) === day(visit.start))
        && fact('Arrival') === clock(visit.start)
        && (alert.label === 'Arrival' || visit.end && fact('Departure') === clock(visit.end))) : [];
    if (matches.length !== 1) {unmatched.push(alert);continue;}
    const key = matches[0][0];
    matched.set(key,[...(matched.get(key) || []),alert]);
  }
  for (const [key,visit] of candidates) {
    const end = visit.conflict ? null : visit.end;
    const jobs = appointments.filter(job=>job.appointmentId === visit.appointment && job.jkNumber.toUpperCase() === visit.reference);
    const job = jobs.length === 1 ? jobs[0] : undefined;
    const aliases = matched.get(key) || [];
    const timestamp = end || visit.start;
    unmatched.push({
      id:`appointment-visit-${createHash('sha256').update(key).digest('hex').slice(0,24)}`,
      sourceMessageIds:[...new Set(aliases.flatMap(alert=>[alert.id,...(alert.sourceMessageIds || [])]))],
      source:visit.operational ? 'Operational confirmation' : 'LinxUp',
      timestamp, updatedAt:timestamp, label:end ? 'Departure' : 'Arrival',
      truck:`Truck ${visit.truck}`, territory:job?.territory, domain:'Dispatch', owner:'Dispatch',
      title:`Truck ${visit.truck} - ${visit.reference}${job?.customerName ? ` · ${job.customerName}` : ''}`,
      detected:clock(timestamp),needsAction:false,
      facts:[
        ...(end ? [
        {label:'Time on site',value:visit.operational ? 'Unavailable · GPS coverage gap' : duration(Date.parse(end)-Date.parse(visit.start))}] : []),
        {label:'Arrived',value:time(visit.start)},
        {label:'Departed',value:end ? time(end) : visit.conflict ? 'Awaiting verification · conflicting records' : 'Awaiting confirmed departure'},
        ...(job?.address ? [{label:'Location',value:job.address}] : []),
        ...(visit.operational ? [{label:'Visit verification',value:'Operationally confirmed; precise GPS visit timing is unavailable.'}] : [])],
      next:end ? 'Visit recorded. Appointment closeout is tracked separately.' : 'Arrival recorded; this alert updates when departure is confirmed.',
      href:`/desktop?workspace=Schedule&date=${encodeURIComponent(date)}&appointment=${encodeURIComponent(visit.appointment)}`,
    });
  }
  return unmatched.sort((a,b)=>(b.timestamp || '').localeCompare(a.timestamp || ''));
}
