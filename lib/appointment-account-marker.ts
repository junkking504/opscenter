import { appointmentPartner } from './appointment-partner';

/** Display-only account marker. Use the source business label, never a person's
 * name or an incidental brand mention in work/notes. */
export function appointmentAccountLabel(job: {address: string}) {
  return appointmentPartner({address: job.address, customerName: ''})?.name === 'Amazon' ? 'Amazon' : null;
}
