import fs from 'node:fs';
import path from 'node:path';
import { closeoutSourceVersion } from './desktop-closeout-contract';

export type EstimateOutcome = {reason:'Price/Budget'|'Date/Time'|'Other'; explanation:string; noDiscountReason?:string};
export type ClassificationChange = {appointmentType:'Job'|'Estimate'; completeEstimate:boolean; expectedSourceVersion:string; truck?:string; estimateOutcome?:EstimateOutcome};
const actualTimeFields = ['actualStartHour','actualStartMinute','actualEndHour','actualEndMinute'];
export function classificationCompletionTimeWarning(before: Record<string,unknown>, after: Record<string,unknown>, change: ClassificationChange): string | undefined {
  const value = (record: Record<string,unknown>, key: string) => String((record[key] as {value?:unknown} | undefined)?.value ?? '');
  if (!change.completeEstimate || change.appointmentType !== 'Estimate' || value(before,'status') !== '1' || value(after,'status') !== '8' || actualTimeFields.some(key=>value(before,key))) return;
  const window = before.appointmentWindow as {startTime?:string;durationHours?:string} | undefined;
  if (!window || JSON.stringify(window) !== JSON.stringify(after.appointmentWindow)) return;
  const match = String(window.startTime || '').trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)?$/i);
  const duration = Number(window.durationHours);
  if (!match || !Number.isFinite(duration) || duration <= 0 || duration > 12) return;
  let hour = Number(match[1]); const minute = Number(match[2]);
  if (minute > 59 || hour > (match[3] ? 12 : 23) || match[3] && hour < 1) return;
  if (match[3]) hour = hour % 12 + (match[3].toUpperCase() === 'PM' ? 12 : 0);
  const end = hour * 60 + minute + duration * 60;
  if (!Number.isInteger(end) || end >= 1440) return;
  const expected = [hour,minute,Math.floor(end/60),end%60].map(value=>String(value).padStart(2,'0'));
  if (!actualTimeFields.every((key,index)=>value(after,key) === expected[index])) return;
  return 'JunkWare filled previously blank actual times from the appointment window. Actual visit timing still needs confirmation.';
}
export function parseClassificationChange(value: Record<string,unknown>): ClassificationChange {
  if (!['Job','Estimate'].includes(String(value.appointmentType)) || !/^[a-f0-9]{64}$/.test(String(value.expectedSourceVersion || '')) || typeof value.completeEstimate !== 'boolean' || value.completeEstimate && value.appointmentType !== 'Estimate') throw new Error('A valid appointment type and current source version are required.');
  if (value.truck !== undefined && !/^Truck [1-9]\d?$/.test(String(value.truck))) throw new Error('A valid truck is required.');
  let estimateOutcome: EstimateOutcome | undefined;
  if (value.estimateOutcome !== undefined) {
    const outcome = value.estimateOutcome as Record<string,unknown>;
    if (!outcome || typeof outcome !== 'object' || value.appointmentType !== 'Estimate' || !['Price/Budget','Date/Time','Other'].includes(String(outcome.reason)) || typeof outcome.explanation !== 'string' || !outcome.explanation.trim() || outcome.explanation.length > 2000 || outcome.noDiscountReason !== undefined && (typeof outcome.noDiscountReason !== 'string' || outcome.noDiscountReason.length > 2000)) throw new Error('A valid estimate outcome and explanation are required.');
    estimateOutcome={reason:outcome.reason as EstimateOutcome['reason'],explanation:outcome.explanation.trim(),...(typeof outcome.noDiscountReason==='string' ? {noDiscountReason:outcome.noDiscountReason.trim()} : {})};
  }
  return {...(estimateOutcome ? {estimateOutcome} : {}),...(value.truck ? {truck:String(value.truck)} : {}),appointmentType:value.appointmentType as 'Job'|'Estimate',completeEstimate:value.completeEstimate,expectedSourceVersion:String(value.expectedSourceVersion)};
}
export function verifyClassificationChange(before: Record<string,unknown>, after: Record<string,unknown>, change: ClassificationChange, verifyOutcome = true) {
  const selected = (value: unknown, field: string) => value && typeof value === 'object' ? String((value as Record<string,unknown>)[field] || '') : '';
  if (selected(after.appointmentType,'label') !== change.appointmentType || selected(after.status,'value') !== (change.completeEstimate ? '8' : selected(before.status,'value'))) throw new Error('JunkWare did not retain the requested appointment type and status.');
  if (verifyOutcome && change.estimateOutcome) {
    const previous=Array.isArray(before.appointmentNotes) ? before.appointmentNotes.map(String) : [];
    const current=Array.isArray(after.appointmentNotes) ? after.appointmentNotes.map(String) : [];
    const added=current.filter(note=>!previous.includes(note));
    const {reason,explanation,noDiscountReason}=change.estimateOutcome;
    const expected=`${reason}: ${explanation}${noDiscountReason ? `, no discount: ${noDiscountReason}` : ''}`.replace(/\s+/g,' ').trim();
    if (!previous.every(note=>current.includes(note)) || added.length!==1 || !added[0].startsWith(expected+' (')) throw new Error('JunkWare did not retain the estimate outcome notes or changed existing notes.');
  }
  // Category/status and explicitly supplied completion details may change. Verify all other captured
  // closeout fields, including money, crew, and payments, remained intact.
  const truckName = (value: unknown) => String(value || '').replace(/Truck#?\s*/i,'Truck ').trim();
  if (change.truck && (truckName(before.truck) || truckName(after.truck) !== change.truck)) throw new Error('The completion truck was not retained or would replace an existing assignment.');
  const completionTimeDefault = classificationCompletionTimeWarning(before,after,change);
  const withoutClassification = (record: Record<string,unknown>) => {
    const {appointmentType:_type,status:_status,drivers:_drivers,navigatorOptions:_navigators,paymentMethods:_methods,otherChargeOptions:_charges,truckOptions:_trucks,...fields} = record;
    if (change.truck) delete fields.truck;
    if (change.estimateOutcome) delete fields.appointmentNotes;
    if (completionTimeDefault) for (const key of actualTimeFields) delete fields[key];
    return Object.fromEntries(Object.entries(fields).map(([key,value])=>[key,value && typeof value === 'object' && !Array.isArray(value) ? Object.fromEntries(Object.entries(value).filter(([name])=>name !== 'options')) : value]));
  };
  const previousFields = withoutClassification(before), currentFields = withoutClassification(after);
  if (closeoutSourceVersion(previousFields) !== closeoutSourceVersion(currentFields)) throw new Error('JunkWare changed other appointment details ('+[...new Set([...Object.keys(previousFields),...Object.keys(currentFields)])].filter(key=>JSON.stringify(previousFields[key])!==JSON.stringify(currentFields[key])).join(', ')+'); review the source before making another change.');
}
type VerifiedClassification = {appointmentId:string; appointmentType:string; status:string; verifiedAt:string; truck?:string};
const directory = () => path.join(process.env.OPSCENTER_DATA_DIR || process.env.OPSBOT_DATA_DIR || path.join(process.cwd(),'data'),'appointment-classifications');
export function recordAppointmentClassification(date: string, record: VerifiedClassification) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{1,12}$/.test(record.appointmentId)) throw new Error('A valid operating date and appointment are required.');
  fs.mkdirSync(directory(),{recursive:true,mode:0o700});
  const target = path.join(directory(),`${date}-${record.appointmentId}.json`), temporary = `${target}.${process.pid}.tmp`;
  fs.writeFileSync(temporary,JSON.stringify(record),{mode:0o600}); fs.renameSync(temporary,target);
}
export function applyVerifiedClassifications<T extends {appointmentId:string;appointmentType:string;status:string}>(date: string, jobs:T[], sourceObservedAt:number):T[] {
  return jobs.map(job=>{
    if (!/^\d{1,12}$/.test(job.appointmentId)) return job;
    try {
      const record = JSON.parse(fs.readFileSync(path.join(directory(),`${date}-${job.appointmentId}.json`),'utf8')) as VerifiedClassification;
      return record.appointmentId === job.appointmentId && Date.parse(record.verifiedAt) > sourceObservedAt ? {...job,appointmentType:record.appointmentType,status:record.status,...(record.truck ? {truck:record.truck,assignedTruck:record.truck} : {})} : job;
    } catch {return job;}
  });
}
