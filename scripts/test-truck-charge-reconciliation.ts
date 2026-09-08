import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {deriveCloseoutTruckLoads} from '../lib/truck-load-closeouts';
import {formatLoadAmount, formatTruckLoadFraction, junkwareBedloadFraction, type TruckLoadEvent} from '../lib/truck-load-status';

const date='2026-09-08';
const closed=(id:string,load:string,bed='',quantity=1)=>({appointmentId:id,jkNumber:`JK${id}`,truck:'Truck# 3',appointmentType:'Job',status:'Completed',closeoutObservedAt:`${date}T17:00:00Z`,closeout:{loadSize:load,loadQuantity:quantity,loadPrice:100,bedloadSize:bed,bedloadQuantity:bed?1:0,bedloadPrice:bed?50:0,otherCharges:[],discount:0,tip:0,total:150,payments:[],balance:0}});
const reset:TruckLoadEvent={eventId:'reset',date,truck:'Truck# 3',kind:'yard_reset',loadFraction:0,occurredAt:`${date}T13:30:00Z`,recordedAt:`${date}T13:30:00Z`,recordedBy:'test',appointmentId:'',jobNumber:'',loadSize:'',loadQuantity:'',contents:'',resetLocation:'dump'};
const jobs=[closed('1001','3/8'),closed('1002','3/4','1/4')];
const load=deriveCloseoutTruckLoads(date,['3'],[reset],jobs)[0];
assert.equal(load.chargedTruckFraction,1.125);
assert.equal(load.chargedBedloadFraction,.25);
assert.equal(load.chargedJobCount,2);
assert.equal(load.needsVerification,true);
assert.equal(load.events.filter(e=>e.kind==='job_closeout').every(e=>e.occurredAt===''),true,'Missing timing is never replaced by midnight');
assert.equal(load.unplacedAppointmentIds.length,2);
const visits=jobs.map(job=>({appointment_id:job.appointmentId,truck_number:3,match_confidence:'confirmed',first_arrival:`${date}T14:00:00Z`,final_departure:`${date}T15:00:00Z`}));
const placed=deriveCloseoutTruckLoads(date,['3'],[reset],jobs,visits)[0];
assert.equal(placed.currentLoadFraction,1.125);
assert.equal(placed.currentBedloadFraction,.25);
assert.equal(placed.isOverCapacity,true);
assert.equal(placed.needsVerification,false);
const emptied=deriveCloseoutTruckLoads(date,['3'],[{...reset,occurredAt:`${date}T18:00:00Z`,coveredAppointmentIds:['1001','1002']}],jobs)[0];
assert.equal(emptied.currentLoadFraction,0);
assert.equal(emptied.currentBedloadFraction,0);
assert.equal(emptied.chargedTruckFraction,1.125,'A dump never erases charged daily volume');
assert.equal(emptied.chargedBedloadFraction,.25);
assert.equal(deriveCloseoutTruckLoads(date,['3'],[],[jobs[0],jobs[0]])[0].chargedJobCount,1);
assert.equal(deriveCloseoutTruckLoads(date,['3'],[],[{...jobs[0],appointmentType:'Estimate'}])[0].chargedTruckFraction,0);
assert.equal(deriveCloseoutTruckLoads(date,['3'],[],[{...jobs[0],status:'Cancelled'}])[0].chargedTruckFraction,0);
assert.equal(junkwareBedloadFraction('1/4',''),.25);
assert.equal(junkwareBedloadFraction('1/4',2),.5);
assert.equal(junkwareBedloadFraction('1/4',0),0);
assert.equal(junkwareBedloadFraction('1',1),1,'Bedload 1 is one bedload, not 1/6 truck');
assert.equal(junkwareBedloadFraction('unknown',1),null);
assert.equal(formatLoadAmount(1/3+1/12),'5/12');
assert.equal(formatTruckLoadFraction(1/3+1/12),'5/12 full');
assert.equal(deriveCloseoutTruckLoads(date,['3'],[],[closed('2000','','1/4',0)])[0].currentBedloadFraction,.25);

async function sourceMerge() {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'truck-charge-source-'));
  process.env.OPSBOT_DATA_DIR=root;
  process.env.OPSCENTER_DATA_DIR=root;
  try {
    const directory=path.join(root,'history','junkware');fs.mkdirSync(directory,{recursive:true});
    const row={appt_id:'1002',job_id:'JK1002',truck:'Truck# 3',appointment_type:'Job',job_status:'Completed',market:'Junk King New Orleans',revenue:'$150',closeout:{loadSize:'3/4',loadQuantity:'',loadPrice:'$100',bedloadSize:'1/4',bedloadQuantity:'',bedloadPrice:'$50',total:'$150'},closeout_verified_at:`${date}T18:00:00Z`};
    const payload={date,scraped_at:`${date}T18:00:00Z`,markets_scraped:['Junk King New Orleans','Junk King Northshore','Junk King Baton Rouge','Junk King Jefferson Parish'],appointments:[row],cancelled:[]};
    fs.writeFileSync(path.join(directory,`junkware_schedule_fast_${date}.json`),JSON.stringify(payload));
    // The process importing this module must use the fixture root from startup.
    const {execFileSync}=await import('node:child_process');
    const result=JSON.parse(execFileSync(process.execPath,['--import','tsx','--input-type=module','-e',`import {readJobRows} from './lib/desktop-schedule-source.ts';console.log(JSON.stringify(readJobRows('${date}')))`],{env:{...process.env,OPSBOT_DATA_DIR:root},encoding:'utf8'}));
    assert.equal(result[0].closeout.loadQuantity,1);
    assert.equal(result[0].closeout.bedloadQuantity,1);
    assert.equal(result[0].closeout.loadSize,'3/4','A fast-only completion includes verified details');
    assert.equal(result[0].closeoutObservedAt,row.closeout_verified_at);
  } finally {fs.rmSync(root,{recursive:true,force:true});}
}
sourceMerge().then(()=>console.log('Truck charge reconciliation passed: exact sums, bedloads, missing timing, reset preservation, duplicates, excluded estimates, and fresh source details.')).catch(error=>{console.error(error);process.exitCode=1;});
