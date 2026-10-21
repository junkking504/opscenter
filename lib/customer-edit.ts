import {spawn} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import type {CustomerChange,CustomerDetails,CustomerEstimateOutcome} from './customer-edit-contract';
export type CustomerSource={ok:boolean;customer:CustomerDetails;sourceVersion:string;protectedVersion:string;checkedAt:string;verifiedAt?:string;submitted?:boolean;error?:string;previousCustomer?:CustomerDetails;displayAddress?:string;appointmentNotes?:string[];requiresEstimateOutcome?:boolean;requiresNoDiscountReason?:boolean;estimateOutcome?:CustomerEstimateOutcome};
export function junkwareCustomer(appointmentId:string,change?:CustomerChange):Promise<CustomerSource> {
  if(!/^\d{1,12}$/.test(appointmentId))throw new Error('A valid appointment is required.');
  return new Promise((resolve,reject)=>{
    const child=spawn(process.execPath,['--import','tsx',path.join(process.cwd(),'scripts/edit-junkware-customer.ts')],{cwd:process.cwd(),env:{...process.env},stdio:['pipe','pipe','pipe']});
    let output='';const timer=setTimeout(()=>{child.kill('SIGKILL');reject(new Error('JunkWare customer result is unconfirmed.'));},180000);
    child.stdout.on('data',chunk=>{output+=chunk;if(output.length>1024*1024)child.kill('SIGKILL');});child.stderr.resume();
    child.on('error',()=>{clearTimeout(timer);reject(new Error('The customer source could not be opened.'));});
    child.on('close',()=>{clearTimeout(timer);try{resolve(JSON.parse(output));}catch{reject(new Error('JunkWare customer result is unconfirmed.'));}});
    child.stdin.end(JSON.stringify({appointmentId,change}));
  });
}
const directory=()=>path.join(process.env.OPSCENTER_DATA_DIR || process.env.OPSBOT_DATA_DIR || path.join(process.cwd(),'data'),'customer-edits');
export function recordCustomerEdit(appointmentId:string,result:CustomerSource) {
  if(!result.ok || !result.verifiedAt || !/^\d{1,12}$/.test(appointmentId))throw new Error('Verified customer information is required.');
  fs.mkdirSync(directory(),{recursive:true,mode:0o700});const file=path.join(directory(),appointmentId+'.json'),temp=file+'.'+process.pid+'.tmp';fs.writeFileSync(temp,JSON.stringify(result),{mode:0o600});fs.renameSync(temp,file);
}
export function applyCustomerEdits<T extends {appointmentId:string;customerName:string;phone:string;customerEmail:string;address:string}>(jobs:T[],sourceObservedAt:number):T[] {
  return jobs.map(job=>{try{
    if(!/^\d{1,12}$/.test(job.appointmentId))return job;
    const result=JSON.parse(fs.readFileSync(path.join(directory(),job.appointmentId+'.json'),'utf8')) as CustomerSource;
    if(!result.ok || !result.verifiedAt || Date.parse(result.verifiedAt)<=sourceObservedAt)return job;
    const c=result.customer;const sameDisplayAddress=result.displayAddress && result.displayAddress.replace(/[,\s]+/g,' ').trim().toLowerCase()===job.address.replace(/[,\s]+/g,' ').trim().toLowerCase();return {...job,customerName:`${c.firstName} ${c.lastName}`,phone:c.phone,customerEmail:c.email,customerEmailCollected:true,address:sameDisplayAddress || result.previousCustomer && result.previousCustomer.address===c.address && result.previousCustomer.zip===c.zip ? job.address : result.displayAddress || job.address};
  }catch{return job;}});
}
