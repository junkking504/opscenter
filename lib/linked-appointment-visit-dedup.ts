import type { AppointmentOnsiteTime } from './appointment-onsite-time';

type VisitState = {
  appointmentId: string;
  sourceEstimateAppointmentId?: string;
  appointmentType: string;
  onsiteTime?: AppointmentOnsiteTime;
  recordedOnsiteTime?: AppointmentOnsiteTime;
  hasVisit?: boolean;
  hasDepartedVisit?: boolean;
  truckOnSite?: boolean;
  onsiteTruck?: string;
  onsiteGpsAt?: string;
  onsiteGpsParked?: boolean;
  truckAtJob?: boolean;
  atJobTruck?: string;
  atJobGpsAt?: string;
  lastSeenOnsiteTruck?: string;
  lastSeenOnsiteAt?: string;
};

const unavailable: AppointmentOnsiteTime = {
  minutes: null,
  arrival: null,
  departure: null,
  label: 'Physical visit shown on linked job',
};

function closedVisit(time?: AppointmentOnsiteTime) {
  if (!time || time.minutes === null || !time.arrival || !time.departure) return null;
  const arrival = Date.parse(time.arrival);
  const departure = Date.parse(time.departure);
  if (!Number.isFinite(arrival) || !Number.isFinite(departure) || departure <= arrival) return null;
  const truck = String(time.truck || '').match(/\d+/)?.[0] || '';
  return `${truck}|${new Date(arrival).toISOString()}|${new Date(departure).toISOString()}`;
}

/**
 * A source-linked estimate and job can share one customer stop. The collector
 * may report that same physical GPS episode on both appointment IDs. Preserve
 * both JunkWare records, but let the linked job own the physical visit so the
 * truck board and appointment facts do not double-count one stop.
 */
export function dedupeLinkedAppointmentVisitState<T extends VisitState>(appointments: T[]): T[] {
  const byId = new Map(appointments.map(appointment => [appointment.appointmentId, appointment]));
  for (const job of appointments) {
    const estimateId = job.sourceEstimateAppointmentId;
    if (!estimateId || /estimate/i.test(job.appointmentType)) continue;
    const estimate = byId.get(estimateId);
    if (!estimate || !/estimate/i.test(estimate.appointmentType)) continue;
    const jobVisit = closedVisit(job.recordedOnsiteTime || job.onsiteTime);
    const estimateVisit = closedVisit(estimate.recordedOnsiteTime || estimate.onsiteTime);
    if (!jobVisit || jobVisit !== estimateVisit) continue;
    Object.assign(estimate, {
      onsiteTime: unavailable,
      recordedOnsiteTime: unavailable,
      hasVisit: false,
      hasDepartedVisit: false,
      truckOnSite: false,
      onsiteTruck: undefined,
      onsiteGpsAt: undefined,
      onsiteGpsParked: undefined,
      truckAtJob: false,
      atJobTruck: undefined,
      atJobGpsAt: undefined,
      lastSeenOnsiteTruck: undefined,
      lastSeenOnsiteAt: undefined,
    });
  }
  return appointments;
}
