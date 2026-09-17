import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {runAddressVerificationAgent,stopAnchorForJob} from '../lib/address-verification-agent';
const date='2026-09-17',now=Date.parse('2026-09-17T16:00:00Z');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'address-agent-'));
const jobs=[1,2,3].map(n=>({address:`${n} Example Lane Slidell LA 70461`,appointmentId:`job${n}`,truck:'Truck 4',status:'Completed'}));
const write=(file:string,value:unknown)=>{fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,JSON.stringify(value));};
const file=path.join(root,'addresses/agent/state.json');let ordinary=0,parcels=0;
const options={root,now,readJobs:()=>jobs,snapshot:()=>null,cached:()=>undefined,lookup:async()=>{ordinary++;return {location:null,reason:'No match'};},parcel:async()=>{parcels++;return {location:{latitude:30.2,longitude:-89.8},reason:'Synthetic parcel evidence',matchedAddress:jobs[0].address,sources:['https://opscenter.invalid/parcel']};}};
async function main(){try {
 let state=await runAddressVerificationAgent(date,options);assert.equal(ordinary,2);assert.equal(state.checked,2);assert.equal(Object.keys(state.items).length,3,'Completed jobs remain in worklist');
 state=await runAddressVerificationAgent(date,{...options,now:now+60000});assert.equal(ordinary,3,'Fair rotation reaches deferred address');
 state=await runAddressVerificationAgent(date,{...options,now:now+120000});assert.equal(ordinary,3,'Restart and tick preserve failure backoff');
 const visit={appointment_id:'job1',truck_number:'Truck 4',match_confidence:'confirmed',match_reason:'exact_address_native_stop_with_gps_dwell',location_evidence:{source:'LinxUp native stop address',address_identity:['1 EXAMPLE LN','SLIDELL','70461'],latitude:30.2,longitude:-89.8}};
 assert.ok(stopAnchorForJob(jobs[0],[visit]));assert.equal(stopAnchorForJob({...jobs[0],truck:'Truck 9'},[visit]),undefined);
 assert.equal(stopAnchorForJob(jobs[0],[visit,visit]),undefined);
 write(path.join(root,'history/linxup/appointment_visits',`linxup_appointment_visits_${date}.json`),{visits:[visit]});
 state=await runAddressVerificationAgent(date,{...options,now:now+180000});assert.equal(parcels,1,'New stop bypasses six-hour failed-lookup backoff');assert.equal(state.verified,1);
 const pins=JSON.parse(fs.readFileSync(path.join(root,'cache/appointment_geocodes.json'),'utf8')).addresses;assert.equal(Object.values(pins).length,1);
 assert.equal(Object.values(state.items).find(i=>i.address===jobs[0].address)?.status,'verified');
 state=await runAddressVerificationAgent(date,{...options,now:now+240000});assert.equal(parcels,1,'No repeated request for resolved premises');
 // Persisted cap is enforced without a provider call, including after restart.
 const capped=JSON.parse(fs.readFileSync(file,'utf8'));capped.parcelBudget.requests=100;for(const i of Object.values(capped.items) as any[])i.nextAttemptAt=0;write(file,capped);
 write(path.join(root,'history/linxup/appointment_visits',`linxup_appointment_visits_${date}.json`),{visits:[{...visit,appointment_id:'job2',location_evidence:{...visit.location_evidence,address_identity:['2 EXAMPLE LN','SLIDELL','70461']}}]});
 await runAddressVerificationAgent(date,{...options,now:now+300000});assert.equal(parcels,1,'Daily parcel cap survives restart');
 // Concurrent unrelated geocode entries survive publication through the bridge.
 const cacheFile=path.join(root,'cache/appointment_geocodes.json'),cache=JSON.parse(fs.readFileSync(cacheFile,'utf8'));cache.addresses.unrelated={latitude:30.5,longitude:-90.5};write(cacheFile,cache);
 await runAddressVerificationAgent(date,{...options,now:now+7*3600000,lookup:async()=>({location:{latitude:30.21,longitude:-89.81},reason:'Synthetic verified geocoder'})});
 assert.ok(JSON.parse(fs.readFileSync(cacheFile,'utf8')).addresses.unrelated);
 console.log('Address agent passed: completed-job worklist, fair rotation, durable backoff, new-evidence recovery, daily cap, and transactional cache publication.');
}finally{fs.rmSync(root,{recursive:true,force:true});}}
main().catch(error=>{console.error(error);process.exitCode=1;});
