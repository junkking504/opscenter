import type { readJobRows } from './desktop-schedule-source';
import type { DesktopAlert } from '../desktop-ui/lib/live-contract';
import type { CrewProgressSnapshot, CrewStep } from '../desktop-ui/lib/crew-progress-contract';
import { desktopAppointmentHref } from '../desktop-ui/lib/desktop-links';
import { isClosedAppointment, isEstimateAppointment } from './job-audit-rules';
import { appointmentOnsiteTime, onsiteTimeFacts } from './appointment-onsite-time';
import { crewPaymentFacts, crewCloseoutFacts, crewAppointmentFacts } from './crew-progress-details';

type Job = ReturnType<typeof readJobRows>[number];
type Visit = { appointment_id?: string; appt_id?: string; truck_number?: string | number; truck?: string; match_confidence?: string; pass_by_only?: boolean; first_arrival?: string; arrival_at?: string; final_departure?: string; departure_at?: string; visit_intervals?: Array<{arrival?: string; departure?: string | null}> };
const truckKey = (value: unknown) => String(value || '').match(/\d+/)?.[0]?.replace(/^0+/, '') || '';
const truckName = (value: unknown) => truckKey(value) ? `Truck ${truckKey(value)}` : 'Unassigned';
const jk = (alert: DesktopAlert) => alert.title.match(/\bJK\d+\b/i)?.[0]?.toUpperCase();

export function buildCrewProgress(input: {
  date: string; appointments: Job[]; visits: Visit[]; alerts: DesktopAlert[];
  scheduleCurrent: boolean; visitsCurrent: boolean; updatesComplete: boolean; now?: number;
}): CrewProgressSnapshot {
  const now = input.now ?? Date.now();
  const clock = new Intl.DateTimeFormat('en-CA', {timeZone:'America/Chicago',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(now);
  const part = (name: string) => clock.find(p => p.type === name)?.value || '';
  const today = `${part('year')}-${part('month')}-${part('day')}`;
  const minutes = Number(part('hour')) * 60 + Number(part('minute'));
  const validTime = (stamp?: string | null) => Number.isFinite(Date.parse(stamp || '')) && Date.parse(stamp!) <= now;
  const time = (stamp: string) => new Intl.DateTimeFormat('en-US',{timeZone:'America/Chicago',hour:'numeric',minute:'2-digit'}).format(new Date(stamp));
  const linked = new Set<string>();
  // Repeated Schedule copies are one appointment. Ambiguous JK-only alerts stay
  // in Other updates instead of being attached to the wrong job or estimate.
  const jobs = [...new Map(input.appointments.map(job => [`${job.sourceDate || input.date}:${job.appointmentId || `${job.jkNumber}:${job.appointmentType}`}`, job])).entries()];
  const matches = (alert: DesktopAlert) => {
    const candidates = jobs.filter(([, job]) => job.jkNumber.toUpperCase() === jk(alert));
    if (candidates.length <= 1) return candidates;
    if (['Job Closed', 'Estimate Closed', 'Job Completed', 'Estimate Completed'].includes(alert.label)) {
      return candidates.filter(([, job]) => isEstimateAppointment(job.appointmentType) === /estimate/i.test(alert.label));
    }
    return candidates;
  };
  const progressJobs = jobs.map(([id, job]) => {
      const updates = input.alerts.filter(alert => { const candidates = matches(alert); return candidates.length === 1 && candidates[0][0] === id; });
      updates.forEach(alert => linked.add(alert.id));
      const canceled = /cancel/i.test(job.status);
      const closed = !canceled && isClosedAppointment(job.status);
      const estimate = isEstimateAppointment(job.appointmentType);
      const intervals = input.visits.filter(visit => job.appointmentId && String(visit.appointment_id || visit.appt_id || '') === job.appointmentId
        && visit.match_confidence === 'confirmed' && !visit.pass_by_only && truckKey(job.truck)
        && truckKey(visit.truck_number || visit.truck) === truckKey(job.truck))
        .flatMap(visit => visit.visit_intervals?.length ? visit.visit_intervals : [{arrival:visit.first_arrival || visit.arrival_at, departure:visit.final_departure || visit.departure_at}])
        .filter(visit => validTime(visit.arrival) && (!visit.departure || validTime(visit.departure) && Date.parse(visit.departure) > Date.parse(visit.arrival!)))
        .sort((a,b) => Date.parse(b.arrival!) - Date.parse(a.arrival!));
      const arrived = intervals.length > 0;
      const departed = Boolean(intervals[0]?.departure);
      const pastWindow = job.appointmentEndMinutes != null && (input.date < today || input.date === today && minutes > job.appointmentEndMinutes);
      const steps: CrewStep[] = [];
      const step = (label: string, state: CrewStep['state'], detail: string, extra: Partial<CrewStep> = {}) => steps.push({label,state,detail,...extra});
      const awaiting = (missing: boolean): CrewStep['state'] => !input.scheduleCurrent ? 'unknown' : missing ? 'missing' : 'next';
      if (canceled) {
        step('Appointment', 'not-required', 'Canceled · confirm the route change.');
      } else {
        const duration = appointmentOnsiteTime(job,input.visits,now);
        if (departed && duration.minutes !== null) {
          step('Duration','complete','Recorded time on site.',{facts:onsiteTimeFacts(duration).map(fact=>({...fact,label:fact.label === 'On-site time' ? 'Duration' : fact.label}))});
        } else {
          step('Arrival', arrived ? 'complete' : !input.visitsCurrent ? 'unknown' : !closed && pastWindow ? 'missing' : closed ? 'unknown' : 'next',
            arrived ? 'Awaiting a confirmed departure.' : !input.visitsCurrent ? 'Visit source unavailable or stale.' : pastWindow ? 'No confirmed arrival recorded after the window; confirm crew status.' : 'Awaiting a confirmed arrival.',
            arrived ? {facts:[{label:'Arrival',value:time(intervals[0].arrival!)}]} : {});
        }
        step('Photos', job.photos.length ? 'complete' : !job.photoAuditAvailable ? 'unknown' : awaiting(closed),
          job.photos.length ? estimate ? 'Review the estimate photos.' : 'Review before and after coverage.' : !job.photoAuditAvailable ? 'Photo collection has not been verified.' : closed ? 'No uploaded photos found for this closed appointment.' : 'Upload the required job photos.',{photos:job.photos});
        const payments = job.closeout?.payments || [];
        const paid = payments.reduce((sum, payment) => sum + (Number.isFinite(payment.amount) && payment.amount > 0 ? payment.amount : 0), 0);
        const due = job.closeout?.total;
        const balance = job.closeout?.balance;
        const paymentComplete = Boolean(payments.length && payments.every(payment => payment.method?.trim()) && paid > 0 && typeof due === 'number' && due > 0 && paid + .01 >= due && typeof balance === 'number' && balance <= .01);
        step('Payment', estimate ? 'not-required' : paymentComplete ? 'complete' : awaiting(closed),
          estimate ? 'Payment is not required for an estimate.' : paymentComplete ? 'Recorded in JunkWare; settlement verification is separate.' : typeof balance === 'number' && balance > .01 ? `Recorded balance: $${balance.toFixed(2)}. Confirm remaining payment.` : 'Confirm payment details or document why no payment is due.',{facts:crewPaymentFacts(job)});
        step('Closeout', closed ? 'complete' : awaiting(departed), closed ? `${estimate ? 'Estimate' : 'Job'} closed in JunkWare.` : departed ? 'Departure recorded; the appointment remains open.' : 'Complete the appointment closeout.',{facts:estimate ? [{label:'Outcome',value:closed?'Estimate completed':'Estimate pending'},...(job.paymentAmount>0?[{label:'Quote',value:`$${job.paymentAmount.toFixed(2)}`}]:[])] : crewCloseoutFacts(job)});
      }
      const nextStep = steps.find(s => s.state === 'missing') || steps.find(s => s.state === 'unknown' || s.state === 'next');
      for (const item of steps) if (item.state === 'next' && item !== nextStep) item.state = 'pending';
      return {
        id, jobNumber:job.jkNumber, truck:truckName(job.truck), crew:[job.driver,job.navigator,...(job.additionalCrew || [])].filter(Boolean).join(' · ') || 'Crew not recorded',
        territory:job.territory || 'Territory unavailable', window:job.appointmentTime || 'Time not recorded', status:estimate ? closed ? 'Estimate completed' : `Estimate · ${job.status}` : job.status || 'Status unavailable',
        href:desktopAppointmentHref(job.jkNumber,job.sourceDate || input.date,job.appointmentId), customerFacts:crewAppointmentFacts(job), steps,
        next:canceled ? 'Review cancellation and the next stop.' : nextStep?.detail || (estimate ? 'Estimate completed. Review the quote and customer follow-up.' : 'All tracked steps recorded. Review photo coverage and payment verification.'),
        needsFollowUp:steps.some(s => s.state === 'missing'),
        updateIds:updates.sort((a,b) => (a.timestamp || '').localeCompare(b.timestamp || '')).map(alert => alert.id),
      };
    });
  return {
    scheduleCurrent: input.scheduleCurrent, visitsCurrent: input.visitsCurrent, updatesComplete: input.updatesComplete,
    jobs: progressJobs, unlinkedUpdateIds: input.alerts.filter(alert => !linked.has(alert.id)).map(alert => alert.id),
  };
}
