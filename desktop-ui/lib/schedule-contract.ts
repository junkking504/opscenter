export type ScheduleAppointment = {
  recordId: string;
  version: string;
  callAhead: 'called' | 'not_called';
  junkwareSyncStatus?: 'pending' | 'verified' | 'manual_correction';
  junkwareSyncError?: string;
  appointmentId: string;
  sourceEstimateAppointmentId?: string;
  photoAuditAvailable?: boolean;
  photos?: Array<{ url: string; category: string; fileName: string }>;
  jkNumber: string;
  appointmentUrl: string;
  appointmentTime: string;
  appointmentStartMinutes: number | null;
  appointmentEndMinutes: number | null;
  hasScheduledTime: boolean;
  customerName: string;
  customerEmail: string;
  phone: string;
  address: string;
  territory: string;
  appointmentType: string;
  status: string;
  truck: string;
  driver: string;
  navigator: string;
  additionalCrew?: string[];
  paymentType: string;
  paymentAmount: number;
  tipAmount: number;
  junkItems: string[];
  appointmentNotes: string[];
  cancellationReason: string;
  location: { latitude: number; longitude: number } | null;
};
export type ScheduleTruck = {
  truck: string;
  latitude: number | null;
  longitude: number | null;
  lastGpsUpdate: string | null;
  freshnessLabel: string;
  driver: string;
  navigator: string;
  operationalStatus: string;
  serviceStatus: string;
};
export type MoveProposal = { job: ScheduleAppointment; truck: string; start: number | null; conflicts: string[] };
export type ScheduleSnapshot = {
  date: string;
  observedAt: string | null;
  appointments: ScheduleAppointment[];
  fleet: { isToday: boolean; trucks: ScheduleTruck[]; lastUpdatedAt: string | null };
};
export type ScheduleRouteLeg = {
  truck: string; fromAppointmentId: string; toAppointmentId: string;
  fromJk: string; toJk: string; gapMinutes: number;
  travelMinutes: number | null; miles: number | null; bufferMinutes: number | null;
  source: 'google_live_traffic' | 'unavailable';
};
export type ClosestTruck = {
  truck: string; gpsUpdatedAt: string | null; minutes: number | null; miles: number | null;
  status: 'available' | 'stale_gps' | 'gps_unavailable' | 'address_unverified' | 'routing_unavailable' | 'not_live_day';
};
export type ScheduleRouting = { date: string; calculatedAt: string; legs: ScheduleRouteLeg[]; closest: ClosestTruck[]; appointmentId: string | null };

export function unavailableRoute(leg: ScheduleRouteLeg, jobs: ScheduleAppointment[]) {
  const missing = [leg.fromAppointmentId, leg.toAppointmentId]
    .map(id => jobs.find(job => job.recordId === id))
    .filter(job => !job?.location);
  return missing.length
    ? { label: 'Verify Address', detail: `Travel time needs verified coordinates for ${missing.map(job => job?.jkNumber || 'the appointment').join(' and ')}.` }
    : { label: 'ETA Unavailable', detail: 'The route provider has not returned a travel estimate.' };
}

export const territoryLabels: Record<string, string> = { NO: 'New Orleans', JP: 'Jefferson Parish', NS: 'Northshore', BR: 'Baton Rouge', LF: 'Lafayette', UNK: 'Unclassified' };
export const territoryOrder = ['NO', 'JP', 'NS', 'BR', 'LF', 'UNK'];
export function appointmentRegion(job: Pick<ScheduleAppointment, 'address' | 'territory'>) {
  const territory = job.territory.toLowerCase();
  const location = job.address;
  // Preserve source territory. Westbank remains an area within Jefferson Parish
  // in the approved desktop presentation; the original source label is retained.
  let code = /westbank|jefferson/.test(territory) ? 'JP' : /north.?shore/.test(territory) ? 'NS' : /baton/.test(territory) ? 'BR' : /lafayette/.test(territory) ? 'LF' : /new orleans/.test(territory) ? 'NO' : 'UNK';
  const areas: Array<[RegExp, string, string, string]> = [
    [/\b(?:gretna|harvey|marrero|terrytown|westwego|algiers)\b/i, 'WB', 'Westbank', 'JP'],
    [/\b(?:chalmette|new orleans east)\b/i, 'EM', 'East Metro', 'NO'],
    [/\b(?:laplace|la place)\b/i, 'RP', 'River Parishes', 'NO'],
    [/\b(?:prairieville|gonzales)\b/i, 'ASC', 'Ascension', 'BR'],
    [/\bdenham springs\b/i, 'LIV', 'Livingston', 'BR'],
    [/\bcovington\b/i, 'COV', 'Covington', 'NS'], [/\bmandeville\b/i, 'MAN', 'Mandeville', 'NS'],
    [/\bslidell\b/i, 'SLI', 'Slidell', 'NS'], [/\bhammond\b/i, 'HAM', 'Hammond', 'NS'],
    [/\bmetairie\b/i, 'MET', 'Metairie', 'JP'], [/\bkenner\b/i, 'KEN', 'Kenner', 'JP'],
    [/\bharahan\b/i, 'HAR', 'Harahan', 'JP'], [/\bnew orleans\b/i, 'NO', 'New Orleans', 'NO'],
    [/\bbaton rouge\b/i, 'BR', 'Baton Rouge', 'BR'], [/\blafayette\s*,\s*(?:la\s*)?705\d{2}/i, 'LAF', 'Lafayette', 'LF'],
  ];
  // Prefer the service locality after the first comma, not street names.
  const locality = location.includes(',') ? location.slice(location.indexOf(',') + 1) : '';
  const area = areas.find(([pattern]) => pattern.test(locality));
  if (area && code === 'UNK') code = area[3];
  return { code, label: territoryLabels[code], areaCode: area?.[1] || (territory === 'westbank' ? 'WB' : 'UNK'), area: area?.[2] || (territory === 'westbank' ? 'Westbank' : 'Area Not Specified') };
}
export function appointmentCategory(job: Pick<ScheduleAppointment, 'appointmentType'>) {
  return /estimate/i.test(job.appointmentType) ? 'Estimate' : /job|junk|removal/i.test(job.appointmentType) ? 'Job' : job.appointmentType || 'Unspecified';
}
export function appointmentStatus(job: Pick<ScheduleAppointment, 'appointmentType' | 'status'>) {
  if (/cancel/i.test(job.status)) return 'Canceled';
  if (/complete|closed/i.test(job.status)) return appointmentCategory(job) === 'Estimate' ? 'Estimate Closed' : 'Completed';
  return job.status || 'Status Unavailable';
}
export function isClosed(job: Pick<ScheduleAppointment, 'appointmentType' | 'status'>) { return /complete|closed|cancel/i.test(job.status); }
export function assignmentNeedsVerification(job: Pick<ScheduleAppointment, 'junkwareSyncStatus'>) { return Boolean(job.junkwareSyncStatus && job.junkwareSyncStatus !== 'verified'); }
export function scheduleMoveWindow(job: Pick<ScheduleAppointment, 'appointmentStartMinutes' | 'appointmentEndMinutes' | 'appointmentTime'>, start: number | null) {
  const changed = start !== null && start !== job.appointmentStartMinutes;
  const duration = job.appointmentStartMinutes !== null && job.appointmentEndMinutes !== null ? job.appointmentEndMinutes - job.appointmentStartMinutes : null;
  const supported = !changed || duration !== null && Number.isInteger(duration / 60) && duration >= 60 && duration <= 720 && start! % 60 === 0 && start! >= 0 && start! + duration <= 1440;
  const format = (minutes: number) => new Date(Date.UTC(2000, 0, 1, 0, minutes)).toLocaleTimeString('en-US', { timeZone: 'UTC', hour: 'numeric', minute: '2-digit' });
  return { changed, supported, durationHours: duration === null ? null : duration / 60, label: !changed ? job.appointmentTime || 'Time Not Set' : `${format(start!)}${duration === null ? '' : `–${format(start! + duration)}`}` };
}
export function truckLabel(value: string) { const match = value.match(/^(?:truck\s*#?\s*|t\s*|#\s*)?(\d+)$/i); return match ? `Truck ${Number(match[1])}` : !value || /unassigned|virtual|^—$/i.test(value) ? 'Unassigned' : value; }
export function timelineRange(jobs: ScheduleAppointment[]) {
  const timed = jobs.filter(job => job.hasScheduledTime && job.appointmentStartMinutes !== null && job.appointmentEndMinutes !== null);
  const start = Math.min(480, ...timed.map(job => Math.floor(job.appointmentStartMinutes! / 60) * 60));
  const end = Math.max(1020, ...timed.map(job => Math.ceil(job.appointmentEndMinutes! / 60) * 60));
  return { start, end, duration: end - start };
}
export function timelinePlacement(job: ScheduleAppointment, range: ReturnType<typeof timelineRange>) {
  if (!job.hasScheduledTime || job.appointmentStartMinutes === null || job.appointmentEndMinutes === null) return null;
  return { left: (job.appointmentStartMinutes - range.start) / range.duration, width: Math.max(0, job.appointmentEndMinutes - job.appointmentStartMinutes) / range.duration };
}

export type ScheduleFollowupFlags = { estimates: boolean; closed: boolean; unclosed: boolean; photos: boolean; linkedBooking: ScheduleAppointment | null };
export function scheduleFollowupFlags(job: ScheduleAppointment, jobs: ScheduleAppointment[]): ScheduleFollowupFlags {
  const canceled = /cancel/i.test(job.status);
  const estimate = appointmentCategory(job) === 'Estimate';
  const closed = isClosed(job) || /paid/i.test(job.status);
  const linkedBooking = estimate && job.appointmentId ? jobs.find(candidate => candidate.sourceEstimateAppointmentId === job.appointmentId && appointmentCategory(candidate) === 'Job' && !/cancel/i.test(candidate.status)) || null : null;
  return {
    estimates: !canceled && estimate && !closed,
    closed: !canceled && estimate && closed,
    unclosed: !canceled && appointmentCategory(job) === 'Job' && !closed,
    photos: !canceled && closed && job.photoAuditAvailable === true && Array.isArray(job.photos) && job.photos.length === 0,
    linkedBooking,
  };
}

export function scheduleMatchesQuery(job: ScheduleAppointment, query: string): boolean {
  const normalized = query.trim().toLocaleLowerCase();
  if (!normalized) return true;
  return [job.recordId, job.appointmentId, job.jkNumber, job.customerName, job.phone, job.address, job.territory, job.truck, job.driver, job.navigator]
    .some(value => String(value || '').toLocaleLowerCase().includes(normalized));
}
export function resolveScheduleDeepLink(jobs: ScheduleAppointment[], queryValue: string, appointmentValue: string) {
  const query = queryValue.trim().length <= 200 ? queryValue.trim() : '';
  const appointment = appointmentValue.trim();
  if (appointment) {
    if (!/^(?:\d{4}-\d{2}-\d{2}:appointment:)?\d{1,12}$/.test(appointment)) return { query, recordId: null, notice: 'The appointment link is invalid. Choose a source record.' };
    const matches = jobs.filter(job => job.recordId === appointment || job.appointmentId === appointment);
    return matches.length === 1
      ? { query: matches[0].appointmentId, recordId: matches[0].recordId, notice: '' }
      : { query, recordId: null, notice: 'The linked appointment is not uniquely available on this operating date.' };
  }
  if (!query) return { query, recordId: null, notice: queryValue.trim() ? 'The search link is too long. Enter a shorter search.' : '' };
  const exact = query.toLocaleLowerCase();
  const matches = jobs.filter(job => [job.appointmentId, job.recordId, job.jkNumber, job.customerName].some(value => value.toLocaleLowerCase() === exact));
  return { query, recordId: matches.length === 1 ? matches[0].recordId : null, notice: matches.length > 1 ? 'Several appointments match this reference. Choose the intended source appointment.' : '' };
}
