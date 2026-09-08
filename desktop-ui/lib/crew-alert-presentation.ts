import type { CrewProgressJob } from './crew-progress-contract';
import type { DesktopAlert } from './live-contract';

export type CrewAlertCardPresentation = {
  kind: 'new-appointment' | 'cancellation' | 'completed';
  label: 'New Appointment' | 'Cancellation' | 'Completed';
  territory: string;
  territoryTone: 'new-orleans' | 'jefferson' | 'westbank' | 'east-metro' | 'northshore' | 'baton-rouge' | 'lafayette' | 'unknown';
  jobNumber: string;
  timeSlot: string;
  href: string;
};

const territoryTones: Array<[RegExp, CrewAlertCardPresentation['territoryTone']]> = [
  [/\b(?:east metro|new orleans east|chalmette)\b/i, 'east-metro'],
  [/\bnew orleans\b/i, 'new-orleans'],
  [/\bjefferson\b/i, 'jefferson'],
  [/\bwest\s*bank\b/i, 'westbank'],
  [/\bnorth\s*shore\b/i, 'northshore'],
  [/\bbaton rouge\b/i, 'baton-rouge'],
  [/\blafayette\b/i, 'lafayette'],
];

const appointmentWindow = (value: string) => value.match(/\b\d{1,2}:\d{2}\s*(?:AM|PM)\s*[–-]\s*\d{1,2}:\d{2}\s*(?:AM|PM)\b/i)?.[0];

export function crewAlertCardPresentation(
  alert: DesktopAlert,
  job?: CrewProgressJob,
): CrewAlertCardPresentation | null {
  const kind = alert.label === 'New Appointment'
    ? 'new-appointment'
    : alert.label === 'Cancellation'
      ? 'cancellation'
      : ['Job Closed', 'Estimate Closed', 'Completed'].includes(alert.label)
        ? 'completed'
        : null;
  if (!kind) return null;

  const jobNumber = job?.jobNumber || alert.title.match(/\bJK\d+\b/i)?.[0]?.toUpperCase();
  if (!jobNumber) return null;
  const territory = job?.territory || alert.territory || 'Territory unavailable';
  const timeSlot = job?.window
    || appointmentWindow(alert.title)
    || alert.facts.find(fact => /^(?:Time|Window)$/i.test(fact.label))?.value
    || 'Time unavailable';

  return {
    kind,
    label: kind === 'new-appointment' ? 'New Appointment' : kind === 'cancellation' ? 'Cancellation' : 'Completed',
    territory,
    territoryTone: territoryTones.find(([pattern]) => pattern.test(territory))?.[1] || 'unknown',
    jobNumber,
    timeSlot,
    href: job?.href || alert.href,
  };
}
