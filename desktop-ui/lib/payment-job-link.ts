/** Open the dated Control record and its existing editable closeout. */
export function paymentJobHref(date: string, jkNumber: string, appointmentId?: string | null): string {
  const params = new URLSearchParams({data:'live', workspace:'Schedule', scheduleView:'board', scheduleDay:'today', date});
  if (appointmentId) params.set('appointment', appointmentId);
  else params.set('q', jkNumber);
  return `/desktop?${params}`;
}
