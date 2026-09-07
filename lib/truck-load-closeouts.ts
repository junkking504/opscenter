import { readJobRows, junkwareScheduleUpdatedAt } from './desktop-schedule-source';
import { readScheduleVisits } from './desktop-schedule-visits';
import { appointmentOnsiteTime } from './appointment-onsite-time';
import { geofenceLoadResets, readGeofenceEntries } from './linxup-geofence-alerts';
import { deriveTruckLoadStatus, junkwareJobLoadFraction, normalizeTruckLoadLabel, readTruckLoadStore, recordTruckLoadFromCloseout, type TruckLoadEvent, type TruckLoadStatus } from './truck-load-status';

type LoadJob = Pick<ReturnType<typeof readJobRows>[number], 'appointmentId' | 'jkNumber' | 'truck' | 'appointmentType' | 'status' | 'closeout'>;
export type OperationalTruckLoad = TruckLoadStatus & { needsVerification: boolean; verificationNote: string };

/** Read projection only: include source closeouts without rewriting the operational ledger. */
export function deriveCloseoutTruckLoads(date: string, trucks: string[], stored: TruckLoadEvent[], jobs: LoadJob[], visits: Parameters<typeof appointmentOnsiteTime>[1] = [], sourceObservedAt = 0): OperationalTruckLoad[] {
  let events = stored.filter(event => event.date === date);
  const issues = new Map<string, Set<string>>();
  const issue = (truck: string, message: string) => {const notes = issues.get(truck) || new Set<string>(); notes.add(message); issues.set(truck, notes);};
  const byId = new Map<string, LoadJob[]>();
  for (const job of jobs) if (/^\d{1,12}$/.test(job.appointmentId)) byId.set(job.appointmentId, [...(byId.get(job.appointmentId) || []), job]);
  for (const [id, copies] of byId) {
    const job = copies[0], truck = normalizeTruckLoadLabel(job.truck);
    if (!/^Truck# [1-9]\d*$/.test(truck)) continue;
    if (copies.some(copy => JSON.stringify([copy.truck,copy.appointmentType,copy.status,copy.closeout]) !== JSON.stringify([job.truck,job.appointmentType,job.status,job.closeout]))) {
      for (const copy of copies) issue(normalizeTruckLoadLabel(copy.truck), `${job.jkNumber}: conflicting closeout records.`);
      continue;
    }
    const existing = events.find(event => event.kind === 'job_closeout' && event.appointmentId === id);
    // A fresh verified save wins until the collected schedule catches up.
    if (existing && (!sourceObservedAt || Date.parse(existing.recordedAt) >= sourceObservedAt)) continue;
    const completedJob = /^job$/i.test(job.appointmentType) && /^(?:completed|closed)\b/i.test(job.status);
    if (!completedJob) {
      if (/^estimate$/i.test(job.appointmentType) || /cancel/i.test(job.status) || /^job$/i.test(job.appointmentType)) events = events.filter(event => event !== existing);
      continue;
    }
    const fraction = job.closeout && junkwareJobLoadFraction(job.closeout.loadSize, job.closeout.loadQuantity);
    if (fraction === null) { issue(truck, `${job.jkNumber}: load size needs verification.`); continue; }
    const visit = appointmentOnsiteTime(job, visits);
    // Schedule "completed_at" can be the scheduled window end, so it is not
    // evidence that a load belongs before or after an unload/observation.
    const coveredBy = events.filter(event=>event.truck === truck && ['yard_reset','manual_snapshot'].includes(event.kind) && event.coveredAppointmentIds?.includes(id)).sort((a,b)=>a.occurredAt.localeCompare(b.occurredAt)).at(-1);
    const occurredAt = coveredBy ? new Date(Date.parse(coveredBy.occurredAt)-1).toISOString() : existing?.occurredAt || visit.departure || '';
    if (!occurredAt && events.some(event => event.truck === truck && ['yard_reset','manual_snapshot'].includes(event.kind))) {
      issue(truck, `${job.jkNumber}: confirm whether this load was before or after the unload or load observation.`);
    }
    events = events.filter(event => event !== existing);
    events.push({eventId:`job-closeout:${id}`,date,truck,kind:'job_closeout',loadFraction:fraction,
      occurredAt:occurredAt || `${date}T00:00:00`,recordedAt:sourceObservedAt ? new Date(sourceObservedAt).toISOString() : '',
      recordedBy:'JunkWare completed job',appointmentId:id,jobNumber:job.jkNumber,
      loadSize:job.closeout!.loadSize,loadQuantity:String(job.closeout!.loadQuantity),contents:'',resetLocation:'',
      appointmentType:job.appointmentType,appointmentStatus:job.status});
  }
  const names = [...new Set([...trucks.map(normalizeTruckLoadLabel),...events.map(event=>event.truck),...issues.keys()])].filter(name=>/^Truck# [1-9]\d*$/.test(name)).sort((a,b)=>a.localeCompare(b,undefined,{numeric:true}));
  return names.map(truck => ({...deriveTruckLoadStatus(date,truck,events),needsVerification:issues.has(truck),verificationNote:[...(issues.get(truck) || [])].join(' ')}));
}

export function readOperationalTruckLoads(date: string, trucks: string[] = [], jobs = readJobRows(date)) {
  const events = [...readTruckLoadStore().events,...geofenceLoadResets(date,readGeofenceEntries(date).entries)];
  return deriveCloseoutTruckLoads(date,trucks,events,jobs,readScheduleVisits(date).visits,Date.parse(junkwareScheduleUpdatedAt(date) || '') || 0);
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
      loadQuantity:closeout.loadQuantity,verifiedAt,recordedBy:actor});
    if (result.status) {
      const status = readOperationalTruckLoads(date,[result.status.truck]).find(row=>row.truck === result.status!.truck);
      if (status) return {...result,status, ...(status.needsVerification ? {updated:false,reason:status.verificationNote} : {})};
    }
    return result;
  } catch(error) {
    return {updated:false,status:null,reason:error instanceof Error ? error.message : 'Truck load could not be updated.'};
  }
}
