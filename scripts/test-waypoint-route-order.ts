import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {crewAssignedDay} from '../lib/crew-assigned-day';
import {applyStopOrders,saveStopOrder} from '../lib/desktop-stop-order-store';
import {orderGroups,orderGroupKey,orderSourceKey} from '../lib/schedule-stop-order';
import {mergeFastScheduleRows} from '../lib/desktop-schedule-source';
import type {CrewPhone} from '../lib/crew-phone';

const directory=fs.mkdtempSync(path.join(os.tmpdir(),'waypoint-route-order-'));
const prior=process.env.SCHEDULE_STOP_ORDER_DIR;
process.env.SCHEDULE_STOP_ORDER_DIR=directory;
try {
 const date='2026-10-19',now=Date.parse(`${date}T17:00:00Z`);
 const rows=['08:00 AM - 09:00 AM','09:00 AM - 10:00 AM','10:00 AM - 11:00 AM'].map((time,i)=>({appt_id:String(100+i),job_id:`JK${100+i}`,truck:'Truck# 9',job_status:'Confirmed',customer_name:`Test ${i}`,address:`${100+i} Example St`,appointment_time:time}));
 const snapshot={date,scrapedAt:new Date(now).toISOString(),updatedAt:new Date(now).toISOString(),updatedAtMs:now,freshnessAtMs:now,appointments:rows,cancelled:[]};
 const dispatch={truck:'Truck 9',version:1,current:{assignmentId:'existing-current',appointmentId:'100',date,releasedAt:new Date(now).toISOString()},queued:null};
 const deps={snapshot:()=>snapshot,rows:()=>[],overrides:()=>new Map(),dispatch:()=>dispatch};
 const phone={deviceId:'test-phone',truck:'Truck 9'} as CrewPhone;
 const read=()=>applyStopOrders(date,mergeFastScheduleRows([],rows,[],date).map(row=>({...row,recordId:`${date}:appointment:${row.appointmentId}`,version:''})));
 const before=crewAssignedDay(phone,date,deps,now);
 const group=orderGroups(read(),'remaining')[0];
 // The 10 AM stop precedes 8 AM, followed by 9 AM.
 const ids=['102','100','101'].map(id=>`${date}:appointment:${id}`);
 saveStopOrder({date,scope:'remaining',groupKey:orderGroupKey(group[0],'remaining'),sourceKey:orderSourceKey(group,'remaining'),ids,actor:'test'},read);
 const after=crewAssignedDay(phone,date,deps,now);
 assert.deepEqual(after.jobs!.map(job=>job.appointmentId),['102','100','101']);
 assert.deepEqual(after.jobs!.map(job=>job.routePosition),[1,2,3]);
 assert.notEqual(before.updateToken,after.updateToken,'Connected phones detect the changed order');
 for(const job of after.jobs!){
  const old=before.jobs!.find(item=>item.appointmentId===job.appointmentId)!;
  assert.equal(job.appointmentTime,old.appointmentTime,'Booked window stays intact');
  assert.equal(job.assignmentId,old.assignmentId,'Dispatch identity stays intact');
  assert.equal(job.draftScope,old.draftScope,'Closeout draft survives reordering');
 }
 assert.deepEqual(crewAssignedDay(phone,date,deps,now).jobs,after.jobs,'Separate read preserves order');
 assert.equal(crewAssignedDay({...phone,truck:'Truck 4'},date,deps,now).jobs!.length,0,'Another truck gains no customer scope');
 assert.equal(crewAssignedDay(phone,date,{...deps,snapshot:()=>({...snapshot,freshnessAtMs:now-120001})},now).state,'unavailable','Stale source remains unavailable');
 console.log('Waypoint route order PASS: 10 AM → 8 AM → 9 AM, numbered stops, refresh detection, unchanged windows/identities, scope and freshness.');
} finally {
 if(prior===undefined)delete process.env.SCHEDULE_STOP_ORDER_DIR;else process.env.SCHEDULE_STOP_ORDER_DIR=prior;
 fs.rmSync(directory,{recursive:true,force:true});
}
