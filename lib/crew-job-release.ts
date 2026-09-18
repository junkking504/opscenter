import { closeoutPhotoCount, type CloseoutPhotoEvidence } from './closeout-photo-policy';

export type CrewJobRelease = {
  currentAppointmentId: string | null;
  nextAppointmentId: string | null;
  nextReleased: boolean;
};
export type CrewCompletionReceipt = {
  action?: string;
  status: string;
  sourceResult?: {
    appointmentId?: string;
    closeout?: { status?: { value?: string }; photoEvidence?: CloseoutPhotoEvidence };
  };
};

/** Server-side decision. Use only the durable operation receipt read by the server.
 * Never accept this receipt or release state from the employee request body. */
export function nextCrewJobUnlocked(release: CrewJobRelease, receipt: CrewCompletionReceipt | null): boolean {
  const id = release.currentAppointmentId;
  const source = receipt?.sourceResult;
  return Boolean(id && /^\d{1,12}$/.test(id) && receipt?.action === 'closeout'
    && receipt.status === 'verified' && source?.appointmentId === id
    && source.closeout?.status?.value === '8'
    && closeoutPhotoCount(source.closeout.photoEvidence, id) > 0);
}

/** Return only the allowed appointment. Never serialize the queued job or its metadata. */
export function visibleCrewAppointmentId(release: CrewJobRelease, receipt: CrewCompletionReceipt | null): string | null {
  if (release.currentAppointmentId && !nextCrewJobUnlocked(release, receipt)) return release.currentAppointmentId;
  return release.nextReleased ? release.nextAppointmentId : null;
}

export function projectCrewAssignment<T extends { appointmentId: string }>(
  release: CrewJobRelease, receipt: CrewCompletionReceipt | null, appointments: T[],
): { appointment: T | null; state: 'assigned' | 'waiting' | 'unavailable' } {
  const id = visibleCrewAppointmentId(release, receipt);
  if (!id) return {appointment:null,state:'waiting'};
  // Ambiguous or missing source records must not leak the queue or advance it.
  const matches = appointments.filter(job=>job.appointmentId===id);
  return matches.length===1 ? {appointment:matches[0],state:'assigned'} : {appointment:null,state:'unavailable'};
}
