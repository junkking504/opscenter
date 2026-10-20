import { desktopAppointmentHref } from './desktop-links';

/** Open the dated Control record and its existing editable closeout. */
export function paymentJobHref(date: string, jkNumber: string, appointmentId?: string | null): string {
  return desktopAppointmentHref(jkNumber, date, appointmentId ?? undefined);
}
