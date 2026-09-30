import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {ensureCrewScheduleDispatch} from '../lib/crew-schedule-dispatch';
import {readCrewDispatch,releaseCrewJob,advanceCrewDispatch} from '../lib/crew-dispatch-store';
import {closeoutPhotoEvidence} from '../lib/closeout-photo-policy';
import type {CrewCurrent} from '../lib/crew-dispatch';

const dir=fs.mkdtempSync(path.join(os.tmpdir(),'waypoint-schedule-'));
process.env.OPS_CREW_DISPATCH_DIR=path.join(dir,'dispatch');
process.env.OPS_CREW_TRUCK_SWITCH_DIR=path.join(dir,'switches');
const now=new Date('2026-09-29T14:00:00Z'),date='2026-09-29',truck='Truck 1';
const payload:CrewCurrent={state:'assigned',truck,observedAt:now.toISOString(),job:null,jobs:['100','101','102'].map(appointmentId=>({appointmentId,date,status:'Confirmed',jkNumber:appointmentId,customerName:'Synthetic',phone:'(225) 555-0100',address:'Synthetic',appointmentTime:'9–10 AM',junkItems:[],appointmentNotes:[],driver:'',navigator:''}))};
try {
  releaseCrewJob({truck,date:'2026-09-22',appointmentId:'900',expectedVersion:0,requestId:randomUUID()},'test',now);
  releaseCrewJob({truck,date:'2026-09-22',appointmentId:'100',expectedVersion:1,requestId:randomUUID()},'test',now);
  assert.equal(ensureCrewScheduleDispatch(truck,date,{...payload,observedAt:'2026-09-29T13:00:00Z'},now),false);
  assert.equal(ensureCrewScheduleDispatch(truck,date,{...payload,truck:'Truck 2'},now),false);
  assert.equal(ensureCrewScheduleDispatch(truck,'2026-09-30',payload,now),false);
  assert.equal(readCrewDispatch(truck).version,2,'Stale, wrong-truck and future-day feeds cannot release');
  ensureCrewScheduleDispatch(truck,date,payload,now);
  let state=readCrewDispatch(truck);
  assert.equal(state.current?.appointmentId,'100','Today recovers even if the job was queued behind last week');
  assert.equal(state.queued?.appointmentId,'101');
  ensureCrewScheduleDispatch(truck,date,payload,now);
  assert.equal(readCrewDispatch(truck).version,state.version,'Refresh is idempotent');
  const completed=new Date(now.getTime()+1000);
  const source={appointmentId:'100',closeout:{truck,status:{value:'8'},photoEvidence:closeoutPhotoEvidence('100',['https://junkware.junk-king.com/system/aspnet/local/media/photo-100-test.jpg'])}};
  advanceCrewDispatch(state,{requestId:randomUUID(),action:'closeout',status:'verified',date,recordId:`${date}:appointment:100`,createdAt:now.toISOString(),updatedAt:completed.toISOString(),sourceResult:source},source,completed);
  ensureCrewScheduleDispatch(truck,date,{...payload,jobs:payload.jobs!.map(job=>job.appointmentId==='100'?{...job,status:'Completed'}:job)},completed);
  state=readCrewDispatch(truck);
  assert.equal(state.current?.appointmentId,'101');
  assert.equal(state.queued?.appointmentId,'102','Third appointment follows verified completion without an office release');
  console.log('PASS daily schedule recovery, stale queued rollover, full-day progression, fresh-source boundaries and idempotent refresh. Synthetic only.');
} finally {fs.rmSync(dir,{recursive:true,force:true});}
