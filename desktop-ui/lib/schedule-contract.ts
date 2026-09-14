import {appointmentServiceAddress} from '../../lib/service-address-format';
export type ScheduleTruckVisit = { truck: string; arrival: string; departure: string | null; observedThrough: string; currentUntil?: string };
import { appointmentPartner } from '../../lib/appointment-partner';
import { serviceTerritory } from '../../lib/service-territory';
import type { AppointmentOnsiteTime } from '../../lib/appointment-onsite-time';
import { JUNKWARE_DISPATCH_TRUCKS } from '../../lib/junkware-trucks';
export type SourceEstimate = {
  appointmentId: string; jkNumber: string; date: string; total: number | null;
  chargeSummary: string; observedAt: string; photoAuditAvailable: boolean;
  photos: Array<{ url: string; category: string; fileName: string }>;
};
export type ScheduleAppointment = {
  recordId: string;
  version: string;
  stopOrder?: number;
  callAhead: 'called' | 'not_called';
  junkwareSyncStatus?: 'pending' | 'verified' | 'manual_correction';
  junkwareSyncError?: string;
  appointmentId: string;
  sourceEstimateAppointmentId?: string;
  sourceEstimate?: SourceEstimate | null;
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
  mapAddress?: string;
  addressCheckPending?: boolean;
  territory: string;
  sourceTerritory?: string;
  appointmentType: string;
  status: string;
  hasVisit?: boolean;
  lastSeenOnsiteTruck?: string;
  lastSeenOnsiteAt?: string;
  truckOnSite?: boolean;
  // The physically verified truck can differ from the pending JunkWare assignment.
  onsiteTruck?: string;
  onsiteGpsAt?: string;
  onsiteGpsParked?: boolean;
  onsiteTime?: AppointmentOnsiteTime;
  truckVisits?: ScheduleTruckVisit[];
  truck: string;
  driver: string;
  navigator: string;
  additionalCrew?: string[];
  paymentType: string;
  paymentAmount: number;
  tipAmount: number;
  chargeDetailsPending?: boolean;
  closeout?: { total: number; tip: number; balance: number; payments: Array<{ method: string; detail: string; amount: number }> } | null;
  junkItems: string[];
  pickupItems?: string[];
  appointmentNotes: string[];
  cancellationReason: string;
  location: { latitude: number; longitude: number } | null;
};
export type ScheduleTruck = {
  lastKnownAddress?: string|null;
  ignition?: string;
  speed?: number | null;
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
  sourceRequest?: {state:'ready'|'loading'|'queued'|'failed';message:string};
  assignmentRecoveryNotices?: Array<{requestId:string;recordId:string;message:string}>;
  appointments: ScheduleAppointment[];
  truckLoads?: Array<{truck:string;label:string;percent:number|null;needsVerification:boolean;note:string}>;
  fleet: { isToday: boolean; trucks: ScheduleTruck[]; lastUpdatedAt: string | null };
};
export type ScheduleRouteLeg = {
  truck: string; fromAppointmentId: string; toAppointmentId: string;
  fromJk: string; toJk: string; gapMinutes: number | null;
  travelMinutes: number | null; miles: number | null; bufferMinutes: number | null;
  source: 'google_live_traffic' | 'osm_road_estimate' | 'unavailable';
};
export type ClosestTruck = {
  truck: string; gpsUpdatedAt: string | null; minutes: number | null; miles: number | null;
  status: 'available' | 'stale_gps' | 'gps_unavailable' | 'address_unverified' | 'routing_unavailable' | 'not_live_day';
};
export type ScheduleRouting = { truckProgress?: import('../../lib/schedule-next-stop').TruckProgress[]; date: string; calculatedAt: string; legs: ScheduleRouteLeg[]; closest: ClosestTruck[]; appointmentId: string | null };

export function unavailableRoute(leg: ScheduleRouteLeg, jobs: ScheduleAppointment[]) {
  const missing = [leg.fromAppointmentId, leg.toAppointmentId]
    .map(id => jobs.find(job => job.recordId === id))
    .filter(job => !job?.location);
  return missing.length
    ? { label: 'Location pending', detail: `OpsCenter automatically resolves verified coordinates for ${missing.map(job => job?.jkNumber || 'the appointment').join(' and ')}.` }
    : { label: 'ETA Unavailable', detail: 'The route provider has not returned a travel estimate.' };
}

export const territoryLabels: Record<string, string> = { NO: 'New Orleans', JP: 'Jefferson Parish', NS: 'Northshore', RP: 'River Parishes', BR: 'Baton Rouge', LF: 'Lafayette', UNK: 'Unclassified' };
export const territoryOrder = ['NO', 'JP', 'NS', 'RP', 'BR', 'LF', 'UNK'];
export function appointmentRegion(job: Pick<ScheduleAppointment, 'address' | 'mapAddress' | 'territory' | 'sourceTerritory'>) {
  return serviceTerritory(appointmentServiceAddress(job), job.sourceTerritory || job.territory);
}
// Color is a dispatch-area cue, not franchise ownership or territory grouping.
export function appointmentColorClass(job: Pick<ScheduleAppointment, 'address' | 'mapAddress' | 'territory' | 'sourceTerritory'>) {
  const region = appointmentRegion(job);
  return `territory-${(['WB', 'EM'].includes(region.areaCode) ? region.areaCode : region.code).toLowerCase()}`;
}
export function appointmentCategory(job: Pick<ScheduleAppointment, 'appointmentType'>) {
  return /estimate/i.test(job.appointmentType) ? 'Estimate' : /job|junk|removal/i.test(job.appointmentType) ? 'Job' : job.appointmentType || 'Unspecified';
}
export function appointmentStatus(job: Pick<ScheduleAppointment, 'appointmentType' | 'status' | 'hasVisit' | 'truckOnSite' | 'lastSeenOnsiteTruck'>) {
  if (/cancel/i.test(job.status)) return 'Canceled';
  if (/complete|closed/i.test(job.status)) return appointmentCategory(job) === 'Estimate' ? 'Estimate Closed' : 'Completed';
  if (job.truckOnSite) return 'On Site';
  if (job.lastSeenOnsiteTruck) return 'Last reported on site';
  if (job.hasVisit) return 'Visited · Closeout Pending';
  return job.status || 'Status Unavailable';
}
export function scheduleStatusTone(job: Pick<ScheduleAppointment, 'status' | 'hasVisit' | 'truckOnSite'>) {
  if (/cancel/i.test(job.status)) return 'canceled';
  if (/complete|closed/i.test(job.status)) return 'completed';
  if (job.truckOnSite || /on[ _-]?site|on location/i.test(job.status)) return 'on-site';
  if (job.hasVisit || /visited/i.test(job.status)) return 'visited';
  return 'waiting';
}
export function needsScheduleAddressVerification(job: Pick<ScheduleAppointment, 'status' | 'location'>) { return !/cancel/i.test(job.status) && !job.location; }
export function isClosed(job: Pick<ScheduleAppointment, 'appointmentType' | 'status'>) { return /complete|closed|cancel/i.test(job.status); }
export function assignmentNeedsVerification(job: Pick<ScheduleAppointment, 'junkwareSyncStatus'>) { return Boolean(job.junkwareSyncStatus && job.junkwareSyncStatus !== 'verified'); }
export function scheduleMoveRestriction(job: ScheduleAppointment) {
  if (/cancel/i.test(job.status)) return 'Canceled appointments must be restored before moving through dispatch.';
  if (assignmentNeedsVerification(job)) return 'Verify the previous assignment change in JunkWare before moving this appointment again.';
  return null;
}
export function scheduleCustomerLabel(job: Pick<ScheduleAppointment, 'customerName' | 'phone'>) {
  // Some source cancellation labels append the phone, address and notes to
  // the name. Split only when that phone matches the appointment contact.
  const name = job.customerName.trim();
  const contact = job.phone.replace(/\D/g, '').slice(-10);
  const embedded = /\s+(?:\+?1[ .-]?)?\(?\d{3}\)?[ .-]?\d{3}[ .-]?\d{4}\b/.exec(name);
  return embedded && contact.length === 10 && embedded[0].replace(/\D/g, '').slice(-10) === contact
    ? name.slice(0, embedded.index).trim() || name
    : name || 'Customer Unavailable';
}
export function scheduleMoveWindow(job: Pick<ScheduleAppointment, 'appointmentStartMinutes' | 'appointmentEndMinutes' | 'appointmentTime'>, start: number | null) {
  const changed = start !== null && start !== job.appointmentStartMinutes;
  const duration = job.appointmentStartMinutes !== null && job.appointmentEndMinutes !== null ? job.appointmentEndMinutes - job.appointmentStartMinutes : null;
  const supported = !changed || duration !== null && Number.isInteger(duration / 60) && duration >= 60 && duration <= 720 && start! % 60 === 0 && start! >= 0 && start! + duration <= 1440;
  const format = (minutes: number) => new Date(Date.UTC(2000, 0, 1, 0, minutes)).toLocaleTimeString('en-US', { timeZone: 'UTC', hour: 'numeric', minute: '2-digit' });
  return { changed, supported, durationHours: duration === null ? null : duration / 60, label: !changed ? job.appointmentTime || 'Time Not Set' : `${format(start!)}${duration === null ? '' : `–${format(start! + duration)}`}` };
}
export function truckLabel(value: string) { const raw=value.trim(); const match = raw.match(/^(?:truck\s*#?\s*|t\s*|#\s*)?(\d+)$/i); return match ? Number(match[1])===0?'Unassigned':`Truck ${Number(match[1])}` : !raw || /unassigned|virtual|^—$/i.test(raw) ? 'Unassigned' : raw; }
/** Empty trucks are still dispatch destinations. Source-only trucks are retained
 * and Unassigned stays available even after its last appointment is assigned. */
export function scheduleTruckNames(snapshot?: Pick<ScheduleSnapshot,'fleet'|'appointments'>): string[] {
  return [...new Set([...JUNKWARE_DISPATCH_TRUCKS,...(snapshot?.fleet.trucks.map(truck=>truck.truck)||[]),...(snapshot?.appointments.flatMap(job=>[job.truck,...(job.truckVisits || []).map(v=>v.truck)])||[]),'Unassigned'].map(truckLabel))]
    .sort((a,b)=>a===b?0:a==='Unassigned'?1:b==='Unassigned'?-1:a.localeCompare(b,undefined,{numeric:true}));
}
/** Completed blocks use confirmed visit intervals; source appointment windows remain unchanged. */
export function timelineWindow(job: ScheduleAppointment, truck = truckLabel(job.truck || ''), now = Date.now()) {
  if (job.truckVisits?.length) {
    const day = job.recordId.slice(0,10);
    const local = (value: string) => {
      const stamp = Date.parse(value);
      if (!Number.isFinite(stamp)) return NaN;
      const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'America/Chicago',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(stamp).map(p=>[p.type,p.value]));
      return (Date.parse(`${parts.year}-${parts.month}-${parts.day}`)-Date.parse(day))/86400000*1440 + +parts.hour*60 + +parts.minute + +parts.second/60;
    };
    const intervals = job.truckVisits.filter(v=>truckLabel(v.truck)===truckLabel(truck)).flatMap(visit=>{
      const ongoing = Boolean(visit.currentUntil && now <= Date.parse(visit.currentUntil));
      const start = Math.max(0,local(visit.arrival));
      const end = Math.min(2880,local(ongoing ? new Date(now).toISOString() : visit.departure || visit.observedThrough));
      return Number.isFinite(start) && Number.isFinite(end) && end>start ? [{start,end,ongoing,complete:Boolean(visit.departure)}] : [];
    }).sort((a,b)=>a.start-b.start);
    if (!intervals.length) return null;
    const minutes = intervals.reduce((sum,v)=>sum+v.end-v.start,0);
    return {actual:true,start:intervals[0].start,end:intervals.at(-1)!.end,intervals,
      label:`${minutes<1?'<1':Math.round(minutes)} min on site${intervals.some(v=>v.ongoing)?' · ongoing':intervals.some(v=>!v.complete)?' · departure unconfirmed':''}${intervals.length>1?` · ${intervals.length} visits`:''}`};
  }
  if (truckLabel(job.truck || '')!==truckLabel(truck)) return null;
  const time = job.onsiteTime;
  if (!/cancel/i.test(job.status) && time && time.minutes !== null && Number.isFinite(time.minutes) && time.minutes > 0 && time.arrival && time.departure) {
    const source = time.intervals?.length ? time.intervals : [{ arrival: time.arrival, departure: time.departure }];
    const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
    const local = (value: string) => {
      const ms = Date.parse(value);
      if (!Number.isFinite(ms)) return null;
      const parts = Object.fromEntries(formatter.formatToParts(ms).map(p => [p.type,p.value]));
      return { date: `${parts.year}-${parts.month}-${parts.day}`, minute: +parts.hour * 60 + +parts.minute + +parts.second / 60 };
    };
    const first = local(time.arrival);
    const day = /^\d{4}-\d{2}-\d{2}:/.test(job.recordId) ? job.recordId.slice(0,10) : first?.date;
    const intervals = source.map(row => {
      const arrival = local(row.arrival), departure = local(row.departure);
      if (!arrival || !departure || !day || arrival.date !== day) return null;
      const end = departure.minute + (Date.parse(departure.date) - Date.parse(day)) / 86400000 * 1440;
      return end > arrival.minute && end <= 2880 ? { start: arrival.minute, end } : null;
    });
    if (intervals.every((row): row is {start:number;end:number} => row !== null)) {
      const ordered = intervals.sort((a,b) => a.start - b.start);
      const minutes = ordered.reduce((sum,row) => sum + row.end - row.start, 0);
      if (Math.abs(minutes - time.minutes) <= 0.11 && ordered.every((row,i) => !i || row.start >= ordered[i-1].end)) {
        return { actual: true, start: ordered[0].start, end: ordered.at(-1)!.end, intervals: ordered.map(row=>({...row,ongoing:false,complete:true})),
          label: `${time.minutes < 1 ? '<1' : Math.round(time.minutes)} min on site${ordered.length > 1 ? ` · ${ordered.length} visits` : ''}` };
      }
    }
  }
  if (!job.hasScheduledTime || job.appointmentStartMinutes === null || job.appointmentEndMinutes === null) return null;
  return { actual: false, start: job.appointmentStartMinutes, end: job.appointmentEndMinutes,
    intervals: [{start:job.appointmentStartMinutes,end:job.appointmentEndMinutes,ongoing:false,complete:false}], label: 'Planned · booked window' };
}
export function timelineRange(jobs: ScheduleAppointment[], now = Date.now()) {
  const windows = jobs.flatMap(job => {
    if (job.truckVisits?.length) return [...new Set(job.truckVisits.map(v=>v.truck))].flatMap(truck=>{
      const window=timelineWindow(job,truck,now); return window?[window]:[];
    });
    const display = timelineWindow(job,undefined,now);
    const booked = job.hasScheduledTime && job.appointmentStartMinutes !== null && job.appointmentEndMinutes !== null
      ? [{start:job.appointmentStartMinutes,end:job.appointmentEndMinutes}] : [];
    return display ? [...booked,display] : booked;
  });
  const start = Math.min(480, ...windows.map(row => Math.floor(row.start / 60) * 60));
  const end = Math.max(1020, ...windows.map(row => Math.ceil(row.end / 60) * 60));
  return { start, end, duration: end - start };
}
export function timelinePlacement(job: ScheduleAppointment, range: ReturnType<typeof timelineRange>, truck?: string, now = Date.now()) {
  const window = timelineWindow(job, truck, now);
  if (!window) return null;
  const place = (row: {start:number;end:number}) => ({ left: (row.start - range.start) / range.duration, width: Math.max(0,row.end-row.start) / range.duration });
  return { ...window, ...place(window), segments: window.intervals.map(place) };
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
  return [appointmentPartner(job)?.name, appointmentPartner(job)?.short, job.recordId, job.appointmentId, job.jkNumber, job.customerName, job.phone, job.address, job.mapAddress, job.territory, job.truck, job.driver, job.navigator]
    .some(value => String(value || '').toLocaleLowerCase().includes(normalized));
}
export function resolveScheduleDeepLink(jobs: ScheduleAppointment[], queryValue: string, appointmentValue: string) {
  const query = queryValue.trim().length <= 200 ? queryValue.trim() : '';
  const appointment = appointmentValue.trim();
  if (appointment) {
    if (!/^(?:\d{4}-\d{2}-\d{2}:appointment:)?\d{1,12}$/.test(appointment)) return { query:'', recordId: null, notice: 'The appointment link is invalid. Choose a source record.' };
    const matches = jobs.filter(job => job.recordId === appointment || job.appointmentId === appointment);
    return matches.length === 1
      ? { query: matches[0].appointmentId, recordId: matches[0].recordId, notice: '' }
      : { query:'', recordId: null, notice: 'The linked appointment is not uniquely available on this operating date. Showing the full schedule.' };
  }
  if (!query) return { query, recordId: null, notice: queryValue.trim() ? 'The search link is too long. Enter a shorter search.' : '' };
  const exact = query.toLocaleLowerCase();
  const matches = jobs.filter(job => [job.appointmentId, job.recordId, job.jkNumber, job.customerName].some(value => value.toLocaleLowerCase() === exact));
  return { query, recordId: matches.length === 1 ? matches[0].recordId : null, notice: matches.length > 1 ? 'Several appointments match this reference. Choose the intended source appointment.' : '' };
}
