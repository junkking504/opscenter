import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {deriveCloseoutTruckLoads} from '../lib/truck-load-closeouts';
import {truckLoadTrackingAlerts} from '../lib/truck-load-tracking-alerts';
import type {TruckLoadEvent} from '../lib/truck-load-status';

const day='2026-09-09',next='2026-09-10';
const job=(id:string,size:string)=>({appointmentId:id,jkNumber:`JK${id}`,truck:'Truck# 6',appointmentType:'Job',status:'Completed',closeout:{loadSize:size,loadQuantity:1,loadPrice:100,bedloadSize:'',bedloadQuantity:0,bedloadPrice:0,otherCharges:[],discount:0,tip:0,total:100,payments:[],balance:0}});
const event=(date:string,kind:TruckLoadEvent['kind'],loadFraction=0):TruckLoadEvent=>({date,truck:'Truck# 6',eventId:`${date}:${kind}`,kind,loadFraction,bedloadFraction:.25,occurredAt:`${date}T13:00:00Z`,recordedAt:`${date}T13:00:00Z`,recordedBy:'fixture',appointmentId:'',jobNumber:'',loadSize:'',loadQuantity:'',contents:'mixed items',resetLocation:kind==='yard_reset'?'dump':''});
const yesterday=deriveCloseoutTruckLoads(day,['6'],[event(day,'day_start')],[job('1001','3/8')]);
const morning=deriveCloseoutTruckLoads(next,['6'],[],[],[],0,yesterday)[0];
assert.equal(morning.currentLoadFraction,3/8,'Midnight cannot erase yesterday’s remaining load');
assert.equal(morning.currentBedloadFraction,.25,'Bedloads also carry forward');
assert.equal(morning.chargedTruckFraction,0,'Prior charges must not become today’s revenue volume');
const afterJob=deriveCloseoutTruckLoads(next,['6'],[],[job('1002','1/4')],[],0,yesterday)[0];
assert.equal(afterJob.currentLoadFraction,5/8,'A newly completed job adds to the carried load without manual intervention');
assert.equal(afterJob.chargedTruckFraction,1/4);
assert.equal(deriveCloseoutTruckLoads(next,['6'],[],[job('1002','1/4'),job('1002','1/4')],[],0,yesterday)[0].currentLoadFraction,5/8);
assert.equal(deriveCloseoutTruckLoads('2026-09-14',['6'],[],[],[],0,[afterJob])[0].currentLoadFraction,5/8,'Load survives nonworking days');
assert.equal(deriveCloseoutTruckLoads(next,['6'],[event(next,'yard_reset')],[],[],0,yesterday)[0].currentLoadFraction,0);
assert.equal(deriveCloseoutTruckLoads(next,['6'],[event(next,'manual_snapshot',1)],[],[],0,yesterday)[0].currentLoadFraction,1,'A current observation overrides carry');
assert.equal(deriveCloseoutTruckLoads(next,['6'],[event(next,'day_start',.5)],[],[],0,yesterday)[0].currentLoadFraction,.5,'An explicit start replaces carry');
const uncertain={...yesterday[0],needsVerification:true,verificationNote:'Old pickup timing unresolved'};
const inherited=deriveCloseoutTruckLoads(next,['6'],[],[],[],0,[uncertain])[0];
assert.equal(inherited.needsVerification,true);
assert.equal(truckLoadTrackingAlerts(next,[inherited]).length,1,'Unresolved loads create an internal action automatically');
assert.equal(deriveCloseoutTruckLoads(next,['6'],[event(next,'yard_reset')],[],[],0,[uncertain])[0].needsVerification,false);
const missing=deriveCloseoutTruckLoads(next,['6'],[],[{...job('1003','1/2'),closeout:null}])[0];
assert.equal(truckLoadTrackingAlerts(next,[missing]).length,1,'Missing completed-job sizes are surfaced without waiting for an operator');
assert.equal(truckLoadTrackingAlerts(next,[afterJob]).length,0);

const root=fs.mkdtempSync(path.join(os.tmpdir(),'truck-load-carry-'));
try {
  const markets=[['352','Junk King New Orleans'],['477','Junk King Northshore'],['399','Junk King Baton Rouge'],['484','Junk King Jefferson Parish']];
  for(const [market,name] of markets){
    const dir=path.join(root,'history','junkware','schedule-watchers',market);fs.mkdirSync(dir,{recursive:true});
    fs.writeFileSync(path.join(dir,`junkware_schedule_fast_${day}.json`),JSON.stringify({date:day,scraped_at:`${day}T20:00:00Z`,markets_scraped:[name],appointments:market==='399'?[{appt_id:'1001',job_id:'JK1001',truck:'Truck# 6',appointment_type:'Job',job_status:'Completed',closeout:job('1001','3/8').closeout}]:[],cancelled:[]}));
  }
  const source=`const {readOperationalTruckLoads}=require('./lib/truck-load-closeouts.ts');console.log(JSON.stringify(readOperationalTruckLoads('${next}',['6','9'],[])));`;
  const loads=JSON.parse(execFileSync(process.execPath,['--import','tsx','-e',source],{encoding:'utf8',env:{...process.env,OPSCENTER_DATA_DIR:root,OPSBOT_DATA_DIR:root}}));
  assert.equal(loads.find((x:any)=>x.truck==='Truck# 6').currentLoadFraction,3/8,'The runtime discovers prior fast-only closeouts');
  const unknown=loads.find((x:any)=>x.truck==='Truck# 9');assert.equal(unknown.displayLoadLabel,'Load unknown');assert.equal(unknown.needsVerification,true);
} finally {fs.rmSync(root,{recursive:true,force:true});}
console.log('Truck load continuity passed: overnight and weekend carry, new jobs, duplicate protection, bedloads, dumps, observations, source-only history and automatic exceptions.');
