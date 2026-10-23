import {spawn} from 'node:child_process';
import path from 'node:path';
import type {CustomerSource,CustomerFields} from './crew-customer-contract';
export class CustomerCorrectionError extends Error {
  constructor(message:string,readonly stage:'preflight'|'uncertain'){super(message);}
}
export async function junkwareCustomerCorrection(appointmentId:string,change?:{fields:CustomerFields;expectedSourceVersion:string;date:string;truck:string}):Promise<CustomerSource>{
  if(!/^\d{1,12}$/.test(appointmentId))throw new CustomerCorrectionError('The appointment is unavailable.','preflight');
  return new Promise((resolve,reject)=>{
    const child=spawn(process.execPath,['--import','tsx',path.join(process.cwd(),'scripts/sync-junkware-job-closeout.ts'),'--appointment',appointmentId,'--mode',change?'customer-write':'customer-read'],{cwd:process.cwd(),env:{...process.env},stdio:['pipe','pipe','pipe']});
    let output='',error='',excess=false;
    const timer=setTimeout(()=>{child.kill('SIGKILL');},180_000);
    child.stdout.on('data',chunk=>{output+=chunk;if(output.length>512_000){excess=true;child.kill('SIGKILL');}});
    child.stderr.on('data',chunk=>{error+=chunk;if(error.length>64_000){excess=true;child.kill('SIGKILL');}});
    child.on('error',()=>{clearTimeout(timer);reject(new CustomerCorrectionError('Customer information could not be checked. Reload and try again.',change?'uncertain':'preflight'));});
    child.stdin.on('error',()=>{/* Child exit is classified below. */});
    child.on('close',code=>{
      clearTimeout(timer);
      if(code===0 && !excess){try{const result=JSON.parse(output);if(result.ok && result.appointmentId===appointmentId && result.customer?.appointmentId===appointmentId && /^[a-f0-9]{64}$/.test(result.customer.sourceVersion))return resolve(result.customer);}catch{/* Unreadable output is never success. */}}
      let stage:'preflight'|'uncertain'=change?'uncertain':'preflight';
      try{if(JSON.parse(error.trim().split('\n').at(-1)||'').stage==='preflight')stage='preflight';}catch{/* Preserve uncertainty. */}
      reject(new CustomerCorrectionError(stage==='preflight'?'Customer details changed or JunkWare needs an office review. Reload the details before saving.':'JunkWare has not confirmed the correction. Check the saved result before another change.',stage));
    });
    // Customer information travels over stdin, never in process arguments.
    child.stdin.end(change?JSON.stringify(change):'');
  });
}
