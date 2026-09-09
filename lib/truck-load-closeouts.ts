import { readJobRows, junkwareScheduleUpdatedAt } from './desktop-schedule-source';
import { readScheduleVisits } from './desktop-schedule-visits';
import { appointmentOnsiteTime } from './appointment-onsite-time';
import {readTruckCompletionEvidence} from './truck-load-completion-evidence';
import { geofenceLoadResets, readGeofenceEntries } from './linxup-geofence-alerts';
import { deriveTruckLoadStatus, junkwareJobLoadFraction, normalizeTruckLoadLabel, junkwareBedloadFraction, formatLoadAmount, readTruckLoadStore, recordTruckLoadFromCloseout, type TruckLoadEvent, type TruckLoadStatus } from './truck-load-status';

type LoadJob = Pick<ReturnType<typeof readJobRows>[number], 'appointmentId' | 'jkNumber' | 'truck' | 'appointmentType' | 'status' | 'closeout' | 'closeoutObservedAt' | 'chargeDetailsPending'> & {completionObservedAt?:string};
export type OperationalTruckLoad = TruckLoadStatus & {
  needsVerification: boolean; verificationNote: string;
  chargedTruckFraction: number; chargedBedloadFraction: number; chargedJobCount: number;
  chargesComplete: boolean;
  chargedLoadLabel: string; chargedLoadNote: string;
  unplacedAppointmentIds: string[];
  displayLoadLabel: string;
};

export function truckChargeSummary(load: OperationalTruckLoad): string {
  return `${load.chargesComplete ? 'Charged today' : 'Known charges today'}: ${load.chargedLoadLabel}. ${load.chargedLoadNote}`;
}

/** Read projection only: include source closeouts without rewriting the operational ledger. */
export function deriveCloseoutTruckLoads(date: string, trucks: string[], stored: TruckLoadEvent[], jobs: LoadJob[], visits: Parameters<typeof appointmentOnsiteTime>[1] = [], sourceObservedAt = 0): OperationalTruckLoad[] {
  let events = stored.filter(event => event.date === date);
  const unplaced = new Set<string>();
  const incomplete = new Set<string>();
  const issues = new Map<string, Set<string>>();
  const issue = (truck: string, message: string) => {const notes = issues.get(truck) || new Set<string>(); notes.add(message); issues.set(truck, notes);};
  const byId = new Map<string, LoadJob[]>();
  for (const job of jobs) if (/^\d{1,12}$/.test(job.appointmentId)) byId.set(job.appointmentId, [...(byId.get(job.appointmentId) || []), job]);
  for (const [id, copies] of byId) {
    const job = copies[0], truck = normalizeTruckLoadLabel(job.truck);
    if (!/^Truck# [1-9]\d*$/.test(truck)) continue;
    if (copies.some(copy => JSON.stringify([copy.truck,copy.appointmentType,copy.status,copy.closeout]) !== JSON.stringify([job.truck,job.appointmentType,job.status,job.closeout]))) {
      for (const copy of copies) { incomplete.add(normalizeTruckLoadLabel(copy.truck)); issue(normalizeTruckLoadLabel(copy.truck), `${job.jkNumber}: conflicting closeout records.`); }
      continue;
    }
    const existing = events.find(event => event.kind === 'job_closeout' && event.appointmentId === id);
    // A fresh verified save wins until the collected schedule catches up.
    const chargeObservedAt = Date.parse(job.closeoutObservedAt || '') || sourceObservedAt;
    if (existing && (!chargeObservedAt || Date.parse(existing.recordedAt) >= chargeObservedAt)) continue;
    const completedJob = /^job$/i.test(job.appointmentType) && /^(?:completed|closed)\b/i.test(job.status);
    if (!completedJob) {
      if (/^estimate$/i.test(job.appointmentType) || /cancel/i.test(job.status) || /^job$/i.test(job.appointmentType)) events = events.filter(event => event !== existing);
      continue;
    }
    if (job.chargeDetailsPending) { incomplete.add(truck); issue(truck, `${job.jkNumber}: latest charge detail is refreshing; total may be incomplete.`); }
    const fraction = job.closeout && junkwareJobLoadFraction(job.closeout.loadSize, job.closeout.loadQuantity);
    const bedloadFraction = job.closeout && junkwareBedloadFraction(job.closeout.bedloadSize, job.closeout.bedloadQuantity);
    if (fraction === null || bedloadFraction === null) { incomplete.add(truck); issue(truck, `${job.jkNumber}: charge details pending; billed load is not yet included.`); continue; }
    const visit = appointmentOnsiteTime(job, visits);
    // Schedule "completed_at" can be the scheduled window end, so it is not
    // evidence that a load belongs before or after an unload/observation.
    const completedBy = Date.parse(job.completionObservedAt || '');
    const coveredBy = events.filter(event=> {
      if (event.truck !== truck || !['yard_reset','manual_snapshot'].includes(event.kind)) return false;
      // A posted completed-job receipt proves the load predates a later reset,
      // but does not prove pickup occurred after any earlier reset.
      return event.coveredAppointmentIds?.includes(id) || (!existing?.occurredAt && !visit.departure && Number.isFinite(completedBy) && completedBy < Date.parse(event.occurredAt));
    }).sort((a,b)=>a.occurredAt.localeCompare(b.occurredAt)).at(-1);
    const occurredAt = coveredBy ? new Date(Date.parse(coveredBy.occurredAt)-1).toISOString() : existing?.occurredAt || visit.departure || '';
    if (!occurredAt && events.some(event => event.truck === truck && ['yard_reset','manual_snapshot'].includes(event.kind))) {
      unplaced.add(id);
      issue(truck, `${job.jkNumber}: billed load retained; confirm whether pickup was before or after the unload or load observation.`);
    }
    events = events.filter(event => event !== existing);
    events.push({eventId:`job-closeout:${id}`,date,truck,kind:'job_closeout',loadFraction:fraction,bedloadFraction,
      occurredAt,recordedAt:chargeObservedAt ? new Date(chargeObservedAt).toISOString() : '',
      recordedBy:coveredBy && job.completionObservedAt && !coveredBy.coveredAppointmentIds?.includes(id) ? `JunkWare completed by ${job.completionObservedAt}; covered by later load reset or observation` : 'JunkWare completed job',appointmentId:id,jobNumber:job.jkNumber,
      loadSize:job.closeout!.loadSize,loadQuantity:String(job.closeout!.loadQuantity),contents:'',resetLocation:'',
      appointmentType:job.appointmentType,appointmentStatus:job.status});
  }
  const names = [...new Set([...trucks.map(normalizeTruckLoadLabel),...events.map(event=>event.truck),...issues.keys()])].filter(name=>/^Truck# [1-9]\d*$/.test(name)).sort((a,b)=>a.localeCompare(b,undefined,{numeric:true}));
  return names.map(truck => {
    const truckEvents = events.filter(event=>event.truck === truck);
    const charges = truckEvents.filter(event=>event.kind === 'job_closeout');
    const chargedTruckFraction = charges.reduce((sum,event)=>sum+event.loadFraction,0);
    const chargedBedloadFraction = charges.reduce((sum,event)=>sum+(event.bedloadFraction || 0),0);
    const pending = [...unplaced].filter(id=>charges.some(event=>event.appointmentId === id));
    const status = deriveTruckLoadStatus(date,truck,truckEvents.filter(event=>!unplaced.has(event.appointmentId)));
    return {...status,events:truckEvents.slice().sort((a,b)=>b.occurredAt.localeCompare(a.occurredAt)),
      // Unknown-time charges stay in the audit and daily sum, never at an invented midnight.
      needsVerification:issues.has(truck),verificationNote:[...(issues.get(truck) || [])].join(' '),
      displayLoadLabel:!status.events.length ? (issues.has(truck) ? 'Load pending' : 'Load not recorded') : `${status.currentLoadLabel}${issues.has(truck) ? ' · provisional' : ''}`,
      chargesComplete:!incomplete.has(truck),chargedTruckFraction,chargedBedloadFraction,chargedJobCount:charges.length,
      chargedLoadLabel:`${formatLoadAmount(chargedTruckFraction)} truck${chargedBedloadFraction ? ` + ${formatLoadAmount(chargedBedloadFraction)} bedload` : ''}`,
      chargedLoadNote:charges.map(event=>`${event.jobNumber || event.appointmentId}: ${formatLoadAmount(event.loadFraction)} truck${event.bedloadFraction ? ` + ${formatLoadAmount(event.bedloadFraction)} bedload` : ''}`).join('; '),
      unplacedAppointmentIds:pending,
    };
  });
}

export function readOperationalTruckLoads(date: string, trucks: string[] = [], jobs = readJobRows(date)) {
  const events = [...readTruckLoadStore().events,...geofenceLoadResets(date,readGeofenceEntries(date).entries)];
  const completions = readTruckCompletionEvidence(date,jobs);
  return deriveCloseoutTruckLoads(date,trucks,events,jobs.map(job=>({...job,completionObservedAt:completions.get(job.appointmentId)})),readScheduleVisits(date).visits,Date.parse(junkwareScheduleUpdatedAt(date) || '') || 0);
}

/** A present-time observation/unload explicitly covers jobs already closed on that truck. */
export function completedTruckJobIds(date: string, truck: string) {
  return readJobRows(date).filter(job=>normalizeTruckLoadLabel(job.truck) === normalizeTruckLoadLabel(truck) && /^job$/i.test(job.appointmentType) && /^(?:completed|closed)\b/i.test(job.status)).map(job=>job.appointmentId);
}

export function updateVerifiedCloseoutLoad(date: string, appointmentId: string, closeout: Record<string,unknown>, verifiedAt: string, actor: string) {
  const label = (value: unknown) => value && typeof value === 'object' ? String((value as {label?:string}).label || '') : String(value || '');
  try {
    const result = recordTruckLoadFromCloseout({date,appointmentId,truck:label(closeout.truck),jobNumber:label(closeout.jobNumber),
      appointmentType:label(closeout.appointmentType),appointmentStatus:label(closeout.status),loadSize:label(closeout.loadSize),
      loadQuantity:closeout.loadQuantity,bedloadSize:label(closeout.bedloadSize),bedloadQuantity:closeout.bedloadQuantity,verifiedAt,recordedBy:actor});
    if (result.status) {
      const status = readOperationalTruckLoads(date,[result.status.truck]).find(row=>row.truck === result.status!.truck);
      if (status) return {...result,status, ...(status.needsVerification ? {updated:false,reason:status.verificationNote} : {})};
    }
    return result;
  } catch(error) {
    return {updated:false,status:null,reason:error instanceof Error ? error.message : 'Truck load could not be updated.'};
  }
}
