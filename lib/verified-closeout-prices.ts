import fs from 'node:fs';
import path from 'node:path';
import type {JobRow} from './desktop-schedule-source';
import {sourceFileMemo} from './source-file-memo';

type Row = Record<string, unknown>;
type VerifiedCloseout = {appointmentId:string; date:string; verifiedAt:string; appointmentType:string; status:string; closeout:NonNullable<JobRow['closeout']>};
const row=(value:unknown):Row=>value && typeof value==='object' && !Array.isArray(value)?value as Row:{};
const text=(value:unknown)=>typeof value==='string'||typeof value==='number'?String(value).trim():'';
const selected=(value:unknown)=>text(row(value).label || row(value).value);
function amount(value:unknown,optional=true):number {
  const raw=text(value).replace(/[$,]/g,'');
  if(!raw && optional)return 0;
  if(!/^-?\d+(?:\.\d+)?$/.test(raw) || !Number.isFinite(Number(raw)))throw new Error('Invalid source amount');
  return Number(raw);
}
/** Read verified source evidence only; no replay, expiry back to old prices, or archive writes. */
export function verifiedCloseoutPrice(value:unknown,now=Date.now()):VerifiedCloseout|null {
  const receipt=row(value), source=row(receipt.sourceResult), closeout=row(source.closeout);
  const appointmentId=text(source.appointmentId), date=text(receipt.date), verifiedAt=text(source.verifiedAt), at=Date.parse(verifiedAt);
  if(receipt.action!=='closeout'||receipt.status!=='verified'||receipt.dryRun===true||source.ok!==true||source.mode!=='write'
    ||!/^\d{1,12}$/.test(appointmentId)||!/^\d{4}-\d{2}-\d{2}$/.test(date)||receipt.recordId!==`${date}:appointment:${appointmentId}`
    ||!Number.isFinite(at)||at>now||!Array.isArray(closeout.otherCharges)||!Array.isArray(closeout.payments))return null;
  const appointmentType=selected(closeout.appointmentType), status=selected(closeout.status);
  if(!['Job','Estimate'].includes(appointmentType)||!['Completed','Confirmed'].includes(status))return null;
  try {
    const loadSize=selected(closeout.loadSize),bedloadSize=selected(closeout.bedloadSize);
    return {appointmentId,date,verifiedAt,appointmentType,status,closeout:{
      loadSize,loadQuantity:text(closeout.loadQuantity)?amount(closeout.loadQuantity):loadSize?1:0,loadPrice:amount(closeout.loadPrice),
      bedloadSize,bedloadQuantity:text(closeout.bedloadQuantity)?amount(closeout.bedloadQuantity):bedloadSize?1:0,bedloadPrice:amount(closeout.bedloadPrice),
      otherCharges:closeout.otherCharges.map(value=>{const charge=row(value),name=text(charge.label);if(!name)throw new Error('Missing charge');return {name,quantity:amount(charge.quantity),unitPrice:amount(charge.price),total:amount(charge.total,false)};}),
      payments:closeout.payments.map(value=>{const payment=row(value),method=text(payment.description);if(!method)throw new Error('Missing payment');return {method,detail:'',amount:amount(payment.amount,false)};}),
      discount:amount(closeout.discount),tip:amount(closeout.tip),total:amount(closeout.total,false),balance:amount(closeout.balance),
    }};
  }catch{return null;}
}
export function applyVerifiedCloseoutPrices<T extends Pick<JobRow,'appointmentId'|'appointmentType'|'status'|'closeout'|'closeoutObservedAt'|'paymentAmount'|'tipAmount'|'chargeDetailsPending'>>(date:string,jobs:T[],receipts:unknown[],now=Date.now()):T[] {
  const latest=new Map<string,VerifiedCloseout>();
  for(const value of receipts){const entry=verifiedCloseoutPrice(value,now);if(entry?.date===date && Date.parse(entry.verifiedAt)>(Date.parse(latest.get(entry.appointmentId)?.verifiedAt || '')||0))latest.set(entry.appointmentId,entry);}
  return jobs.map(job=>{
    const entry=latest.get(job.appointmentId);
    // Never resurrect a canceled appointment or overwrite newer classification.
    if(!entry||entry.appointmentType.toLowerCase()!==job.appointmentType.toLowerCase()||entry.status.toLowerCase()!==job.status.trim().split(/\s+/)[0].toLowerCase()
      ||Date.parse(job.closeoutObservedAt || '')>=Date.parse(entry.verifiedAt))return job;
    return {...job,closeout:entry.closeout,closeoutObservedAt:entry.verifiedAt,paymentAmount:entry.closeout.total,tipAmount:entry.closeout.tip,chargeDetailsPending:false};
  });
}
const memo=sourceFileMemo<unknown[]>(2000,1);
export function readVerifiedCloseoutPriceReceipts():unknown[] {
  const directory=process.env.OPSCENTER_DESKTOP_OPERATIONS_DIR || path.join(process.cwd(),'data','desktop-operations');
  return memo(directory,[directory],()=>{
    try{return fs.readdirSync(directory).filter(name=>/^[0-9a-f-]{36}\.json$/i.test(name)).flatMap(name=>{
      try{const file=path.join(directory,name);if(fs.statSync(file).size>256*1024)return [];const value:unknown=JSON.parse(fs.readFileSync(file,'utf8'));return verifiedCloseoutPrice(value)?[value]:[];}catch{return [];}
    });}catch{return [];}
  });
}
