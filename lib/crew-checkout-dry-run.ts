import fs from 'node:fs';
import path from 'node:path';
import {CrewPhoneError} from './crew-phone';
import type {CrewAssignment} from './crew-dispatch';

/** Server-owned, exact-assignment protection. A phone cannot enable/disable this policy. */
export function crewCheckoutDryRun(current:CrewAssignment,truck:string) {
  const file=process.env.OPS_CREW_CHECKOUT_DRY_RUN_FILE || path.join(process.env.OPSCENTER_DATA_DIR || process.env.OPSBOT_DATA_DIR || path.join(process.cwd(),'data'),'crew-checkout-dry-runs.json');
  let policy:{schema:number;assignments:Array<{assignmentId:string;appointmentId:string;date:string;truck:string}>};
  try {policy=JSON.parse(fs.readFileSync(file,'utf8'));}
  catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return false;throw new CrewPhoneError('Checkout protection could not be read. Contact the office.',503);}
  if(policy.schema!==1 || !Array.isArray(policy.assignments) || policy.assignments.some(row=>!row || !/^[a-f0-9-]{36}$/i.test(row.assignmentId) || !/^\d{1,12}$/.test(row.appointmentId) || !/^\d{4}-\d{2}-\d{2}$/.test(row.date) || !/^Truck \d+$/.test(row.truck)))throw new CrewPhoneError('Checkout protection needs office review.',503);
  const matches=policy.assignments.filter(row=>row.assignmentId===current.assignmentId);
  if(matches.some(row=>row.appointmentId!==current.appointmentId || row.date!==current.date || row.truck!==truck))throw new CrewPhoneError('Checkout protection does not match this assignment.',409);
  return matches.length>0;
}
