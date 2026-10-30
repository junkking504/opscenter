import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomBytes,randomUUID} from 'node:crypto';
import {createCrewPhoneEnrollment,enrollCrewPhone} from '../lib/crew-phone-store';
import {saveCrewDay,readCrewDay} from '../lib/crew-phone-day';
import {releaseCrewJob,readCrewDispatch} from '../lib/crew-dispatch-store';
import {previewTruckSwitch,beginTruckSwitch,continueTruckSwitch,truckSwitchSources} from '../lib/crew-truck-switch';
import {assertAppointmentNotSwitching,pendingTruckSwitch} from '../lib/crew-truck-switch-store';
import {queueScheduleOperation} from '../lib/desktop-schedule-operations';
import {chicagoDateKey} from '../lib/chicago-date';
import {truckSwitchStatus} from '../lib/crew-truck-switch-status';
import {connectInspectionPhone,submitTruckInspection} from '../lib/truck-inspection-store';
import {INSPECTION_SECTIONS} from '../lib/truck-inspection';
import {crewInspectionState,requireCrewInspection} from '../lib/crew-phone-inspection';

async function fixture(run:(f:ReturnType<typeof setup>)=>Promise<void>){
 const previous={...process.env},root=fs.mkdtempSync(path.join(os.tmpdir(),'completed-switch-'));
 try{await run(setup(root));}finally{process.env=previous;fs.rmSync(root,{recursive:true,force:true});}
}
function setup(root:string){
 Object.assign(process.env,{OPS_CREW_PHONE_DIR:path.join(root,'phones'),OPS_CREW_DISPATCH_DIR:path.join(root,'dispatch'),OPS_TRUCK_INSPECTION_DIR:path.join(root,'inspections'),OPSCENTER_DESKTOP_OPERATIONS_DIR:path.join(root,'operations'),JOB_ROUTE_ASSIGNMENTS_FILE:path.join(root,'routes','assignments.json'),OPSCENTER_LOGIN_RATE_LIMIT_FILE:path.join(root,'limits'),OPS_CREW_ROSTER_JSON:JSON.stringify([{employee:'Fixture Driver',username:'fixture.driver',active:true}])});
 const date=chicagoDateKey(),phone=enrollCrewPhone(createCrewPhoneEnrollment('Truck 3','Fixture phone','fixture').code,randomBytes(32).toString('hex'));
 saveCrewDay(phone,{date,truck:'Truck 3',expectedVersion:0,requestId:randomUUID(),driver:'Fixture Driver',responsible:'Fixture Driver',navigators:[]});
 const jobs=[1,2].map(n=>({appointmentId:`99800${n}`,recordId:`${date}:appointment:99800${n}`,version:String(n).repeat(64),truck:'Truck 3',status:n===1?'Completed Duration: 20 min(s)':'Confirmed Duration: 5 min(s)',appointmentStartMinutes:600,appointmentEndMinutes:660,junkwareSyncStatus:'verified'}));
 const state1=releaseCrewJob({truck:'Truck 3',date,appointmentId:jobs[0].appointmentId,expectedVersion:0,requestId:randomUUID()},'fixture');
 const state=releaseCrewJob({truck:'Truck 3',date,appointmentId:jobs[1].appointmentId,expectedVersion:1,requestId:randomUUID()},'fixture');
 const control={observedAt:'',snapshotDate:date,moves:0,reads:0,drop:false,completedOverride:{} as Record<string,unknown>};
 const sources={schedule:()=>({date:control.snapshotDate,observedAt:control.observedAt||new Date().toISOString(),appointments:jobs}),assignment:async(id:string)=>{control.reads++;const job=jobs.find(j=>j.appointmentId===id)!;return {...job,date,verifiedAt:new Date().toISOString(),...(id===jobs[0].appointmentId?control.completedOverride:{})};},move:async(input:{appointmentId:string;truck:string})=>{assert.equal(input.appointmentId,jobs[1].appointmentId,'Completed job is never moved');control.moves++;const job=jobs[1],previousTruck=job.truck;job.truck=input.truck;if(control.drop){control.drop=false;throw new Error('Synthetic lost move response');}return {...input,previousTruck,changed:true,verifiedAt:new Date().toISOString()};}} as unknown as typeof truckSwitchSources;
 const preview=()=>previewTruckSwitch(phone,'Truck 2',sources);
 const body=()=>({action:'confirm',to:'Truck 2',requestId:randomUUID(),fingerprint:preview().fingerprint});
 return {root,date,phone,jobs,control,sources,state,state1,preview,body};
}
async function main(){
 for(const [raw,status] of [['Confirmed','confirmed'],['Confirmed Duration: 5 min(s)','confirmed'],['Completed Duration: 20 min(s)','completed'],['canceled','cancelled']])assert.equal(truckSwitchStatus(raw),status);
 for(const raw of ['Not completed','Completed pending','Confirmed Duration: 5 min(s) Cancelled','Completed Duration: unknown min(s)','Released',''])assert.equal(truckSwitchStatus(raw),null);
 await fixture(async f=>{
  assert.equal(f.preview().count,1);assert.equal(f.preview().inspection.status,'required');assert.equal(f.control.reads,0,'Preview performs no direct source work');assert.deepEqual(readCrewDispatch('Truck 3'),f.state,'Preview never advances dispatch');
  const current={...f.jobs[0]},queued={...f.jobs[1]};
  for(const patch of [{status:'Cancelled'},{status:'Released'},{status:'Completed pending'},{truck:'Truck 8'},{junkwareSyncStatus:'pending'}]){Object.assign(f.jobs[0],patch);assert.throws(f.preview,/released assignment|unknown source status/);Object.assign(f.jobs[0],current);}
  f.jobs.shift();assert.throws(f.preview,/released assignment/);f.jobs.unshift(current);
  f.jobs.push({...current});assert.throws(f.preview,/released assignment/);f.jobs.pop();
  for(const patch of [{status:'Cancelled'},{truck:'Truck 8'}]){Object.assign(f.jobs[1],patch);assert.throws(f.preview,/released assignment/);Object.assign(f.jobs[1],queued);}
  f.jobs.push({...queued});assert.throws(f.preview,/unfinished job/);f.jobs.pop();
  f.control.observedAt=new Date(Date.now()-11*60000).toISOString();assert.throws(f.preview,/not current/);
  f.control.observedAt=new Date(Date.parse(f.state1.current!.releasedAt)-1).toISOString();assert.throws(f.preview,/released assignment/);
  f.control.observedAt='';f.control.snapshotDate='2000-01-01';assert.throws(f.preview,/not current/);f.control.snapshotDate=f.date;
  const before=f.body();f.jobs[0].version='changed';await assert.rejects(beginTruckSwitch(f.phone,before,f.sources),/changed/);f.jobs[0].version=current.version;
  assert.equal(pendingTruckSwitch(f.phone.deviceId),null);assert.deepEqual(readCrewDispatch('Truck 3'),f.state);
 });
 await fixture(async f=>{
  for(const completedOverride of [{status:'Confirmed'},{status:'Cancelled'},{truck:'Truck 8'},{date:'2000-01-01'},{appointmentId:'998099'},{verifiedAt:new Date(Date.now()-11*60000).toISOString()}]){
   f.control.completedOverride=completedOverride;await assert.rejects(beginTruckSwitch(f.phone,f.body(),f.sources),/does not verify/);assert.equal(pendingTruckSwitch(f.phone.deviceId),null);
  }
  f.control.completedOverride={};
  await queueScheduleOperation({action:'move',requestId:randomUUID(),date:f.date,recordId:f.jobs[0].recordId,expectedVersion:f.jobs[0].version,values:{truck:'Truck 3'}},'fixture',()=>f.jobs[0] as never);
  await assert.rejects(beginTruckSwitch(f.phone,f.body(),f.sources),/unverified saved result/);assert.equal(f.control.moves,0);assert.deepEqual(readCrewDispatch('Truck 3'),f.state);
 });
 await fixture(async f=>{
  const body=f.body(),[saved,duplicate]=await Promise.all([beginTruckSwitch(f.phone,body,f.sources),beginTruckSwitch(f.phone,body,f.sources)]);
  assert.equal(saved.requestId,duplicate.requestId);assert.equal(saved.jobs.length,1);assert.equal(saved.completedCurrent?.appointmentId,f.jobs[0].appointmentId);
  await assert.rejects(beginTruckSwitch(f.phone,{...body,requestId:randomUUID()},f.sources),/saved truck switch/);
  await assert.rejects(beginTruckSwitch(f.phone,{...body,to:'Truck 8'},f.sources),/already used/);
  assert.throws(()=>assertAppointmentNotSwitching(f.jobs[0].appointmentId),/switch/,'Retiring completed pointer is reserved against concurrent writes');
  assert.throws(()=>releaseCrewJob({truck:'Truck 3',date:f.date,appointmentId:'998099',expectedVersion:f.state.version,requestId:randomUUID()},'fixture'),/switch/);
  f.control.completedOverride={status:'Confirmed'};assert.equal((await continueTruckSwitch(f.phone,saved.requestId,f.sources)).status,'attention');assert.equal(f.control.moves,0,'Reopened completion blocks before moving queued work');
  f.control.completedOverride={};f.control.drop=true;
  assert.equal((await continueTruckSwitch(f.phone,saved.requestId,f.sources)).status,'attention');assert.equal(f.control.moves,1);
  await continueTruckSwitch(f.phone,saved.requestId,f.sources);assert.equal(f.control.moves,1,'Decorated source status recovers lost response without replay');
  f.control.observedAt=new Date(Date.now()-11*60000).toISOString();assert.equal((await continueTruckSwitch(f.phone,saved.requestId,f.sources)).status,'attention');assert.equal(readCrewDay(f.phone)?.truck,'Truck 3');
  f.control.observedAt='';const done=await continueTruckSwitch(f.phone,saved.requestId,f.sources);assert.equal(done.status,'complete');
  assert.equal(f.jobs[0].truck,'Truck 3');assert.deepEqual(readCrewDispatch('Truck 2').current,f.state.queued,'Queued identity and release timestamp preserved when promoted');assert.equal(readCrewDispatch('Truck 2').queued,null);assert.equal(readCrewDispatch('Truck 3').current,null);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(f.root,'dispatch/Truck-3/2.json'),'utf8')).current,f.state.current,'Prior completion pointer retained in append-only history');
  const receipts=fs.readdirSync(path.join(f.root,'operations')).filter(n=>n.endsWith('.json')).map(n=>JSON.parse(fs.readFileSync(path.join(f.root,'operations',n),'utf8')));assert.equal(receipts.length,1);assert.ok(receipts.every(r=>r.action==='move' && r.recordId===f.jobs[1].recordId),'No completion or payment receipt fabricated');
  assert.equal(crewInspectionState(f.phone).status,'required','Replacement inspection gate remains');
  assert.throws(()=>requireCrewInspection(f.phone),/Complete today/);
  const inspection=connectInspectionPhone(randomBytes(32).toString('hex'));
  submitTruckInspection({requestId:randomUUID(),truck:'Truck 2',inspector:'Fixture inspector',odometer:'12345',fuel:'Full',loadLevel:'Empty',startedAt:new Date().toISOString(),answers:INSPECTION_SECTIONS.map(section=>({id:section.id,status:'good',notes:''})),photos:[{section:'walk-around',data:'data:image/jpeg;base64,/9j/AA=='}],status:'stop',notes:'Synthetic unsafe condition',initials:'FI'},inspection.device);
  assert.equal(crewInspectionState(f.phone).status,'blocked');assert.throws(()=>requireCrewInspection(f.phone),/Do not operate/);
  await continueTruckSwitch(f.phone,saved.requestId,f.sources);assert.equal(f.control.moves,1);assert.equal(readCrewDay(f.phone)?.truck,'Truck 2');
 });
 console.log('PASS completed-pointer switching: read-only preview; verified completion without closeout receipt; queued Duration labels; cancelled/released/reassigned/unknown/duplicate/stale rejection; fresh direct source and pending-operation guards; duplicate confirmation; reopen-before-move block; lost-response recovery; append-only queue promotion and inspection gate. Synthetic stores only.');
}
void main().catch(error=>{console.error(error);process.exitCode=1;});
