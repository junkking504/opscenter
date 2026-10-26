import { appointmentPartner } from './appointment-partner';

type AccountSource = {address: string; appointmentNotes?: readonly string[]; pickupItems?: readonly string[]};
const nationalAccountPhone = '8558880112';

/** Match complete phone candidates within each source description separately.
 * Country code 1 and ordinary punctuation are normalized, but longer numbers,
 * identifiers and fragments in separate notes must not produce a match. */
function hasNationalAccountPhone(text: string) {
  const candidates=text.matchAll(/(?<![\p{L}\p{N}])\+?[\d(][\d()\s.\u2010-\u2015-]*\d(?![\p{L}\p{N}])/gu);
  for (const [candidate] of candidates) {
    const digits=candidate.replace(/\D/g,'');
    if (digits===nationalAccountPhone || digits===`1${nationalAccountPhone}`) return true;
  }
  return false;
}

/** Positive display evidence only. null means no verified marker, including
 * unavailable descriptions; it does not establish that a job is non-national.
 * Amazon uses its existing business label, never a person's name. National
 * accounts use the documented number in source notes/job descriptions only. */
export function appointmentAccountLabel(job: AccountSource) {
  if (appointmentPartner({address: job.address, customerName: ''})?.name === 'Amazon') return 'Amazon';
  return [...(job.appointmentNotes || []),...(job.pickupItems || [])].some(hasNationalAccountPhone) ? 'National account' : null;
}
