import fs from 'node:fs';
import path from 'node:path';
import { closeoutSourceVersion } from './desktop-closeout-contract';

export type ClassificationChange = {appointmentType:'Job'|'Estimate'; completeEstimate:boolean; expectedSourceVersion:string};
export function parseClassificationChange(value: Record<string,unknown>): ClassificationChange {
  if (!['Job','Estimate'].includes(String(value.appointmentType)) || !/^[a-f0-9]{64}$/.test(String(value.expectedSourceVersion || '')) || typeof value.completeEstimate !== 'boolean' || value.completeEstimate && value.appointmentType !== 'Estimate') throw new Error('A valid appointment type and current source version are required.');
  return {appointmentType:value.appointmentType as 'Job'|'Estimate',completeEstimate:value.completeEstimate,expectedSourceVersion:String(value.expectedSourceVersion)};
}
export function verifyClassificationChange(before: Record<string,unknown>, after: Record<string,unknown>, change: ClassificationChange) {
  const selected = (value: unknown, field: string) => value && typeof value === 'object' ? String((value as Record<string,unknown>)[field] || '') : '';
  if (selected(after.appointmentType,'label') !== change.appointmentType || selected(after.status,'value') !== (change.completeEstimate ? '8' : selected(before.status,'value'))) throw new Error('JunkWare did not retain the requested appointment type and status.');
  // Category/status are the only intended changes. Verify all other captured
  // closeout fields, including money, crew, and payments, remained intact.
  const withoutClassification = (record: Record<string,unknown>) => {
    const {appointmentType:_type,status:_status,...fields} = record;
    return closeoutSourceVersion(fields);
  };
  if (withoutClassification(before) !== withoutClassification(after)) throw new Error('JunkWare changed other appointment details; review the source before making another change.');
}
type VerifiedClassification = {appointmentId:string; appointmentType:string; status:string; verifiedAt:string};
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
      return record.appointmentId === job.appointmentId && Date.parse(record.verifiedAt) > sourceObservedAt ? {...job,appointmentType:record.appointmentType,status:record.status} : job;
    } catch {return job;}
  });
}
