import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {deriveCloseoutTruckLoads} from '../lib/truck-load-closeouts';
import {recordTruckLoadFromCloseout, readTruckLoadStore, resetTruckLoad, recordTruckLoadSnapshot} from '../lib/truck-load-status';

const root=fs.mkdtempSync(path.join(os.tmpdir(),'opscenter-load-closeouts-'));
process.env.OPSCENTER_DATA_DIR=root;
const date='2026-09-06';
const save=(id:string,size:string,patch:Partial<Parameters<typeof recordTruckLoadFromCloseout>[0]>={})=>recordTruckLoadFromCloseout({date,truck:'Truck 4',appointmentId:id,jobNumber:`JK${id}`,appointmentType:'Job',appointmentStatus:'Completed',loadSize:size,loadQuantity:'',verifiedAt:`${date}T15:00:00Z`,...patch});
const job=(id:string,size:string,patch:Partial<Parameters<typeof deriveCloseoutTruckLoads>[3][number]>={})=>({appointmentId:id,jkNumber:`JK${id}`,truck:'Truck# 4',appointmentType:'Job',status:'Completed',closeout:{loadQuantity:1,loadSize:size,loadPrice:100,bedloadQuantity:0,bedloadSize:'',bedloadPrice:0,otherCharges:[],discount:0,tip:0,total:100,payments:[],balance:0},...patch});
const load=(jobs:ReturnType<typeof job>[]=[],visits:Parameters<typeof deriveCloseoutTruckLoads>[4]=[],sourceAt=0)=>deriveCloseoutTruckLoads(date,['Truck 4'],readTruckLoadStore().events,jobs,visits,sourceAt).find(row=>row.truck==='Truck# 4')!;
try {
  assert.equal(save('1001','1/4').status?.currentLoadFraction,.25);
  assert.equal(save('1002','1/4').status?.currentLoadFraction,.5,'Each new quarter job adds to the truck');
  assert.equal(save('1002','1/4').status?.currentLoadFraction,.5,'Retries never add the same job twice');
  assert.equal(save('1003','1/2',{appointmentType:'Estimate'}).updated,false);
  assert.equal(load().currentLoadFraction,.5,'Quoted estimates add no physical load');
  assert.equal(save('1004','1/4',{appointmentStatus:'Confirmed'}).updated,false);
  assert.equal(save('1004','1/4',{appointmentStatus:'Not Completed'}).updated,false);
  assert.equal(save('1004','1/4',{appointmentType:''}).updated,false);
  assert.equal(save('1002','1/8').status?.currentLoadFraction,.375,'Corrections replace the original contribution');
  assert.equal(save('1002','1/8',{appointmentType:'Estimate'}).status?.currentLoadFraction,.25,'Converting a closed job to estimate retracts its contribution');
  assert.equal(readTruckLoadStore().events.filter(event=>event.appointmentId==='1002').length,1,'The estimate correction retains the event');
  assert.equal(save('1002','1/4').status?.currentLoadFraction,.5,'A completed estimate converted to job contributes once');
  assert.equal(save('1002','1/4',{truck:'Truck 6'}).status?.currentLoadFraction,.25);
  assert.equal(load().currentLoadFraction,.25,'A truck correction moves the contribution');
  const sourceJobs=[job('1001','1/4'),job('1005','1/4'),job('1005','1/4'),job('1006','1/2',{appointmentType:'Estimate'}),job('1007','1/2',{status:'Cancelled'}),job('1008','1/2',{status:'Confirmed'})];
  assert.equal(load(sourceJobs).currentLoadFraction,.5,'Direct JunkWare jobs and saved closeouts merge by appointment ID');
  assert.equal(load(sourceJobs).needsVerification,false,'Without unloads, job order does not affect the total');
  const correctionAt=Date.now()+1000;
  assert.equal(load([job('1001','1/2')],[],correctionAt).currentLoadFraction,.5,'A newer source correction replaces the prior amount');
  assert.equal(load([job('1001','1/2',{appointmentType:'Estimate'})],[],correctionAt).currentLoadFraction,0,'A newer source estimate removes an old job load');
  resetTruckLoad({date,truck:'Truck 4',location:'dump',recordedBy:'test',occurredAt:`${date}T16:00:00Z`});
  assert.equal(save('1001','1/3',{verifiedAt:`${date}T17:00:00Z`}).status?.currentLoadFraction,0,'Editing a pre-dump closeout cannot refill the truck');
  const visit={appointment_id:'1005',truck_number:4,match_confidence:'confirmed',first_arrival:`${date}T16:30:00Z`,final_departure:`${date}T17:00:00Z`};
  assert.equal(load([job('1005','1/4')],[visit]).currentLoadFraction,.25,'A confirmed job after unloading starts the next load');
  assert.equal(load([job('1005','1/4')]).needsVerification,true,'An unplaced load cannot silently fall on the wrong side of a dump');
  recordTruckLoadSnapshot({date,truck:'Truck 4',loadFraction:.5,contents:'household items',messageId:'observation',occurredAt:`${date}T18:00:00Z`});
  assert.equal(load([job('1005','1/4')],[visit]).currentLoadFraction,.5,'An observation replaces earlier accumulated loads');
  assert.equal(load([job('1005','1/4')],[{...visit,final_departure:`${date}T19:00:00Z`}]).currentLoadFraction,.75);
  assert.equal(load([job('1005','unrecognized')]).needsVerification,true);
  assert.equal(load([job('1005','1/4'),job('1005','1/2')]).needsVerification,true,'Conflicting source copies cannot be counted arbitrarily');
  assert.equal(load([job('1005','Full truck')],[{...visit,final_departure:`${date}T19:00:00Z`}]).isOverCapacity,true,'Over-capacity totals stay visible');
  resetTruckLoad({date,truck:'Truck 4',location:'dump',recordedBy:'test',occurredAt:`${date}T20:00:00Z`,coveredAppointmentIds:['1005']});
  assert.equal(load([job('1005','1/4')]).needsVerification,false,'A present-time unload explicitly covers the jobs already closed on that truck');
  assert.equal(load([job('1005','1/4')]).currentLoadFraction,0);
  assert.equal(load([job('1005','1/2')]).currentLoadFraction,0,'A later correction to an unloaded job does not refill the truck');
  assert.equal(save('1005','1/2',{verifiedAt:`${date}T21:00:00Z`}).status?.currentLoadFraction,0,'The first OpsCenter edit of a source-only unloaded job stays before the unload');
  const physicalVisit = {appointment_id:'2001',truck_number:'Truck 4',match_confidence:'confirmed',
    visit_intervals:[{arrival:`${date}T21:38:16Z`,departure:`${date}T22:10:16Z`,departure_confirmed:true}]};
  const misassigned = job('2001','1/4',{truck:'Truck# 9'});
  const resets = [4,9].map(truck=>({...readTruckLoadStore().events.find(event=>event.kind==='yard_reset')!,
    eventId:`reset-${truck}`,truck:`Truck# ${truck}`,occurredAt:`${date}T21:00:00Z`,coveredAppointmentIds:[]}));
  const physicalLoads = (jobs=[misassigned],visits:Parameters<typeof deriveCloseoutTruckLoads>[4]=[physicalVisit],stored:Parameters<typeof deriveCloseoutTruckLoads>[2]=resets)=>
    deriveCloseoutTruckLoads(date,['Truck 4','Truck 9'],stored,jobs,visits);
  const correct = physicalLoads();
  assert.equal(correct.find(row=>row.truck==='Truck# 4')?.currentLoadFraction,.25,'The truck that performed the visit receives the completed pickup');
  assert.equal(correct.find(row=>row.truck==='Truck# 9')?.chargedJobCount,0,'The source route cannot also receive the same load');
  assert.equal(correct.find(row=>row.truck==='Truck# 4')?.needsVerification,false,'Confirmed carrier and departure resolve reset ordering');
  assert.match(correct.find(row=>row.truck==='Truck# 4')!.chargedLoadNote,/GPS-confirmed pickup.*Truck# 4.*JunkWare assignment: Truck# 9/);
  assert.equal(physicalLoads([{...misassigned,truck:'Unassigned'}])[0].currentLoadFraction,.25,'Unassigned source jobs can have a confirmed physical carrier');
  for (const visits of [[],[{...physicalVisit,pass_by_only:true}],[{...physicalVisit,match_confidence:'possible'}],
    [{...physicalVisit,visit_intervals:[{arrival:`${date}T21:38:16Z`}]}],
    [{...physicalVisit,visit_intervals:[{arrival:`${date}T21:38:16Z`,departure:`${date}T22:10:16Z`,departure_confirmed:false}]}],
    [physicalVisit,{...physicalVisit,truck_number:'Truck 9'}],
    [{...physicalVisit,appointment_id:'2002'}],
    [{...physicalVisit,visit_intervals:[{arrival:'2026-09-05T21:38:16Z',departure:'2026-09-05T22:10:16Z'}]}]]) {
    assert.equal(physicalLoads([misassigned],visits)[0].currentLoadFraction,0,'Incomplete, ambiguous, wrong-day or unrelated visits cannot move a pickup');
  }
  for (const patch of [{appointmentType:'Estimate'},{status:'Canceled'},{status:'Confirmed'}])
    assert.equal(physicalLoads([{...misassigned,...patch}])[0].currentLoadFraction,0,'Visits alone never add a load');
  const saved = {...correct[0].events.find(event=>event.kind==='job_closeout')!,truck:'Truck# 9',loadFraction:.5,recordedAt:`${date}T23:00:00Z`,occurredAt:`${date}T19:00:00Z`};
  const localEvents = [...resets,saved];
  const before = JSON.stringify(localEvents);
  const reconciled = physicalLoads([misassigned],[physicalVisit],localEvents);
  assert.equal(reconciled[0].currentLoadFraction,.5,'A newer saved amount is retained and placed on the physical truck after its reset');
  assert.equal(reconciled[1].chargedJobCount,0);
  assert.equal(JSON.stringify(localEvents),before,'Physical carrier reconciliation does not rewrite the source ledger');
  assert.equal(physicalLoads([misassigned,misassigned],[physicalVisit,physicalVisit])[0].currentLoadFraction,.25,'Duplicate source/visit observations do not duplicate pickup volume');
  const emptiedCarrier = physicalLoads([misassigned],[physicalVisit],[...resets,{...resets[0],eventId:'later-unload',occurredAt:`${date}T22:30:00Z`}]);
  assert.equal(emptiedCarrier[0].currentLoadFraction,0,'The physical carrier unloads the pickup normally');
  console.log('Closeout load checks passed: cumulative quarters, estimates, conversions, retries, corrections, source merge, physical trucks, unloads, observations, uncertain timing, and over-capacity.');
} finally {fs.rmSync(root,{recursive:true,force:true});}
