import type { JobRow } from './desktop-schedule-source';
import type { OperationalAlert } from './operational-alert-presentation';
import { crewAppointmentFacts } from './crew-progress-details';

export const cancellationAlertId = (date: string, appointmentId: string) => `appointment-cancellation:${date}:${appointmentId}`;

/** Schedule truth must not depend on a Slack notification being delivered or
 * readable. Keep notification identities so reviews survive late delivery. */
export function commandCancellationAlerts(input: OperationalAlert[], jobs: JobRow[], date: string): OperationalAlert[] {
  const alerts = input.map(alert => ({...alert}));
  const current = jobs.filter(job => job.sourceDate === date);
  const cancellations = new Map(current.filter(job => job.appointmentId && /^cancell?ed$/i.test(job.status.trim()))
    .map(job => [job.appointmentId, job]));
  for (const job of cancellations.values()) {
    const id = cancellationAlertId(date, job.appointmentId);
    const matching = alerts.filter(alert => {
      if (alert.threadReply || alert.label !== 'Cancellation') return false;
      if (alert.id === id || alert.sourceMessageIds?.includes(id)) return true;
      let url: URL;
      try { url = new URL(alert.href, 'https://opscenter.invalid'); } catch { return false; }
      if (url.searchParams.has('date') && url.searchParams.get('date') !== date) return false;
      const appointment = url.searchParams.get('appointment');
      if (appointment) return appointment === job.appointmentId;
      const reference = alert.title.match(/\bJK\d+\b/i)?.[0]?.toUpperCase();
      return reference === job.jkNumber.toUpperCase()
        && new Set(current.filter(row => row.jkNumber.toUpperCase() === reference).map(row => row.appointmentId)).size === 1;
    });
    if (matching.length) {
      for (const alert of matching) alert.sourceMessageIds = [...new Set([...(alert.sourceMessageIds || []), id])];
      continue;
    }
    alerts.push({
      id, label: 'Cancellation', source: 'JunkWare', title: job.jkNumber,
      territory: job.territory, truck: job.truck, domain: 'Schedule', owner: 'Dispatch',
      // The appointment window and collection time are not cancellation times.
      detected: 'Time unavailable', needsAction: true,
      facts: [
        ...crewAppointmentFacts(job),
        {label: 'Window', value: job.appointmentTime || 'Not recorded'},
        {label: 'Status', value: 'Canceled in JunkWare'},
        {label: 'Reason', value: job.cancellationReason || 'Not provided'},
        {label: 'Cancellation time', value: 'Not provided by JunkWare'},
      ],
      next: 'Review the cancellation and reuse the open capacity.',
      href: `/desktop?workspace=Schedule&date=${date}&appointment=${encodeURIComponent(job.appointmentId)}`,
    });
  }
  return alerts;
}
