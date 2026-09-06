import assert from 'node:assert/strict';
import { appointmentOnsiteTime, onsiteTimeFacts } from '../lib/appointment-onsite-time';
const now=Date.parse('2026-09-06T20:00:00Z');
const job={appointmentId:'123',jkNumber:'JK4000001',truck:'Truck# 4'};
const interval={arrival:'2026-09-06T13:26:24Z',departure:'2026-09-06T13:47:54Z'};
const row={appointment_id:'123',jk_number:job.jkNumber,truck_number:'Truck 4',match_confidence:'confirmed',visit_intervals:[interval]};
const time=appointmentOnsiteTime(job,[row],now);
assert.equal(time.minutes,21.5);assert.equal(time.label,'21.5 min');
assert.deepEqual(onsiteTimeFacts(time),[{label:'On-site time',value:'21.5 min'},{label:'Arrival',value:'8:26 AM'},{label:'Departure',value:'8:47 AM'}]);
assert.equal(appointmentOnsiteTime(job,[row,row],now).minutes,21.5,'Duplicate GPS rows count once');
assert.equal(appointmentOnsiteTime(job,[{...row,visit_intervals:[interval,{arrival:'2026-09-06T14:00:00Z',departure:'2026-09-06T14:10:00Z'}]}],now).minutes,31.5,'Time away is excluded');
assert.equal(appointmentOnsiteTime(job,[{...row,visit_intervals:[interval,{arrival:'2026-09-06T13:40:00Z',departure:'2026-09-06T13:50:00Z'}]}],now).minutes,23.6,'Overlaps count once');
for (const patch of [{appointment_id:'999'},{match_confidence:'ambiguous'},{pass_by_only:true},{truck_number:'Truck 6'}]) assert.equal(appointmentOnsiteTime(job,[{...row,...patch}],now).minutes,null);
assert.equal(appointmentOnsiteTime({jkNumber:job.jkNumber},[row,{...row,appointment_id:'999'}],now).minutes,null,'A shared JK cannot identify one appointment');
for (const departure of [null,'invalid','2026-09-06T12:00:00Z','2026-09-06T21:00:00Z']) assert.equal(appointmentOnsiteTime(job,[{...row,visit_intervals:[{...interval,departure}]}],now).minutes,null);
assert.match(appointmentOnsiteTime(job,[{...row,visit_intervals:[{...interval,departure:null}]}],now).label,/Awaiting/);
assert.equal(appointmentOnsiteTime(job,[{...row,visit_intervals:[],first_arrival:interval.arrival,final_departure:interval.departure,onsite_minutes:0}],now).minutes,21.5,'Explicit timestamps take precedence over a placeholder zero');
console.log('On-site duration passed: recorded intervals, multiple visits, duplicate/overlap handling, identity, truck, and missing timestamp guards.');

// Exercise the formatter against a real source-file boundary without publishing.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {formatTruckCloseoutSlackNotification} from '../lib/slack-alerts';
const directory=fs.mkdtempSync(path.join(os.tmpdir(),'opscenter-onsite-test-'));
const prior=process.env.OPSCENTER_DATA_DIR;
try {
 process.env.OPSCENTER_DATA_DIR=directory;
 const visitsDirectory=path.join(directory,'history','linxup','appointment_visits');
 fs.mkdirSync(visitsDirectory,{recursive:true});
 const file=path.join(visitsDirectory,'linxup_appointment_visits_2026-09-06.json');
 fs.writeFileSync(file,JSON.stringify({date:'2026-09-06',visits:[row]}));
 for(const appointment_type of ['Job','Estimate']) {
  const message=formatTruckCloseoutSlackNotification('2026-09-06',{appt_id:'123',job_id:job.jkNumber,truck:job.truck,appointment_type,closeout:{}});
  assert.ok(message); assert.match(message,/On-site time:\* 21.5 min/);assert.match(message,/Arrival:\* 8:26 AM/);assert.match(message,/Departure:\* 8:47 AM/);
 }
 fs.writeFileSync(file,JSON.stringify({date:'2026-09-06',visits:[{...row,visit_intervals:[{...interval,departure:null}]}]}));
 assert.match(formatTruckCloseoutSlackNotification('2026-09-06',{appt_id:'123',job_id:job.jkNumber,truck:job.truck,closeout:{}}) || '',/Awaiting recorded departure/);
} finally {
 if(prior===undefined) delete process.env.OPSCENTER_DATA_DIR; else process.env.OPSCENTER_DATA_DIR=prior;
 fs.rmSync(directory,{recursive:true,force:true});
}
console.log('Job and estimate alert formatters read the same recorded on-site duration; no messages sent.');
