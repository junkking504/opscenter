import { summarizeAppointmentNotes } from '../../lib/appointment-note-summary';
import { appointmentStatus, type ScheduleAppointment } from './schedule-contract';

type WorkSource = Pick<ScheduleAppointment, 'pickupItems' | 'junkItems' | 'appointmentNotes'>;
const clean = (text: string) => text.replace(/\s+/g, ' ').trim();
const unavailable = /^(?:none|n\/a|not (?:provided|recorded|documented)|unavailable|—|-)[.!]?$/i;

/** Display-only extraction. Never infer inventory, quantities, or appointment status. */
export function appointmentSummaryWork(job: WorkSource): string {
  const categories = new Set(job.junkItems.map(value => clean(value).toLowerCase()));
  const pickup = (job.pickupItems || []).map(clean).filter(value => value && !unavailable.test(value));
  const notes = summarizeAppointmentNotes(job.appointmentNotes)
    .map(value => clean(value.replace(/^(?:Note|Online request):\s*/i, '')));
  const details = notes
    // Prefer source sentences describing the request over call-center/access chatter.
    // Retain the entire sentence, including negations, estimates, weights and qualifiers.
    .filter(value => !/^(?:call|text|contact)\b.*\b(?:before|ahead|arrival|pickup|price|quote)\b/i.test(value))
    .filter(value => /\b(?:dispos(?:ing|e|al)|remov(?:e|al|ing)|haul(?:ing)?|pick(?:ing)?[ -]?up|items?\s*(?:include|like)|needs?\s+.*(?:gone|taken|removed))\b|\bitems?\s*:|^(?:(?:about|approximately|roughly)\s+)?(?:\d+|one|two|three|four|five|six|several)\s+[a-z]/i.test(value));
  const explicitPickup = pickup.filter(value => !categories.has(value.toLowerCase()));
  const source = explicitPickup.length ? explicitPickup : details.length ? details : pickup.length ? pickup : job.junkItems.length ? job.junkItems : notes;
  const seen = new Set<string>();
  return source.map(value => clean(value)
    .replace(/^(?:Online request|Note):\s*/i, '')
    .replace(/^(?:(?:The )?(?:customer|caller) (?:would like|wants|needs) (?:us )?to |Please )(?=(?:remove|haul|pick up|dispose)\b)/i, '')
    .replace(/^Disposing\s+(?:of\s+)?/i, '')
    .replace(/\bitems like\b/i, 'items:'))
    .filter(value => {
      const key = value.toLowerCase().replace(/[.!]+$/, '');
      if (!value || unavailable.test(value) || seen.has(key)) return false;
      seen.add(key); return true;
    }).join(' · ');
}

export function appointmentSummaryCancellation(job: Pick<ScheduleAppointment, 'status' | 'appointmentType' | 'cancellationReason'>): string | null {
  if (appointmentStatus(job) !== 'Canceled') return null;
  const reason = clean(job.cancellationReason || '');
  return !reason || unavailable.test(reason) || /^Cancellation reason unavailable[.!]?$/i.test(reason)
    ? 'Cancellation reason unavailable' : `Cancellation reason: ${reason}`;
}

export function appointmentSummaryPhoneHref(phone: string): string | null {
  const value = phone.trim();
  const extension = value.match(/\s*(?:ext\.?|extension|x|#)\s*(\d+)\s*$/i);
  const number = extension ? value.slice(0, extension.index).trim() : value;
  if (!/^\+?[\d\s().-]+$/.test(number)) return null;
  const digits = number.replace(/\D/g, '');
  if (digits.length < 7 || digits.length > 15) return null;
  const dial = number.startsWith('+') ? `+${digits}` : digits.length === 10 ? `+1${digits}` : digits.length === 11 && digits.startsWith('1') ? `+${digits}` : digits;
  return `tel:${dial}${extension ? `;ext=${extension[1]}` : ''}`;
}
