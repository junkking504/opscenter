import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {withAppointmentContinuity, withSavedAppointmentContinuity} from '../lib/appointment-continuity-evidence';
import {appointmentIntervalEvidence} from '../lib/appointment-visit-qualification';
import assert from 'node:assert/strict';
import {appointmentIntervalQualifies, qualifiedAppointmentVisits} from '../lib/appointment-visit-qualification';
import {scheduleVisitState} from '../lib/desktop-schedule-visits';
import {scheduleTruckVisits} from '../lib/schedule-visit-intervals';
import {trackAppointmentVisits} from '../lib/visit-tracking-agent';
import {appointmentOnsiteTime} from '../lib/appointment-onsite-time';
import {currentGpsPresence} from '../lib/schedule-gps-presence';
import {appointmentStatus,timelineWindow,type ScheduleAppointment} from '../desktop-ui/lib/schedule-contract';
import {buildTruckArrivalSlackNotifications,buildTruckDepartureSlackNotifications} from '../lib/slack-alerts';
const date='2026-09-14', start=Date.parse(date+'T14:28:00Z'), now=Date.parse(date+'T17:00:00Z');
const at=(seconds:number)=>new Date(start+seconds*1000).toISOString();
const interval=(seconds:number,offset=0)=>({arrival:at(offset),departure:at(offset+seconds),departure_confirmed:true,source_timestamps:[...Array(Math.floor(seconds/60)+1)].map((_,i)=>at(offset+i*60)).concat(at(offset+seconds))});
const row=(seconds:number)=>({appointment_id:'1',jk_number:'JK1000001',truck_number:'Truck 8',match_confidence:'confirmed',visit_count:1,first_arrival:at(0),visit_intervals:[interval(seconds)]});
const job={recordId:date+':appointment:1',appointmentId:'1',jkNumber:'JK1000001',truck:'Truck 8',status:'Confirmed',appointmentType:'Job',appointmentStartMinutes:900,appointmentEndMinutes:960,appointmentTime:'3:00 PM–4:00 PM',hasScheduledTime:true,location:{latitude:30,longitude:-90}} as ScheduleAppointment;
for (const seconds of [0,60,299,300,301,600]) {
 const rows=[row(seconds)], before=JSON.stringify(rows), qualifies=seconds>=300;
 const tracked=trackAppointmentVisits(date,rows,now);
 const state=scheduleVisitState(job,rows,new Date(now).toISOString(),[],now,tracked,[job]);
 const visits=scheduleTruckVisits(job,rows,[],[job],now);
 assert.equal(state.hasVisit,qualifies,String(seconds));assert.equal(state.hasDepartedVisit,qualifies);
 assert.equal(visits.length,Number(qualifies));assert.equal(tracked.length,Number(qualifies));
 assert.equal(appointmentOnsiteTime(job,rows,now).minutes!==null,qualifies);
 assert.equal(buildTruckArrivalSlackNotifications(date,rows).length,Number(qualifies));
 assert.equal(buildTruckDepartureSlackNotifications(date,rows).length,Number(qualifies));
 assert.equal(timelineWindow({...job,...state,truckVisits:visits},'Truck 8',now)?.start,900,'Open future booking remains at 3 PM even after a qualifying early visit');
 if(!qualifies)assert.equal(appointmentStatus({...job,...state}),'Confirmed');
 assert.equal(JSON.stringify(rows),before,'No rewriting operational records');
}
assert.equal(timelineWindow({...job,appointmentStartMinutes:540,appointmentEndMinutes:600,likelyStop:{truck:'Truck 8',arrival:at(0),departure:at(60),stopAddress:'100 Example St',reason:'Unconfirmed proximity',confident:false}},'Truck 8',now)?.actual,false,'A short suggested GPS stop cannot bypass the loiter rule');
const short=row(60), completed={...job,status:'Completed'};
assert.equal(appointmentOnsiteTime(completed,[short],now).minutes,1,'Source-completed timing is preserved');
const completedVisits=scheduleTruckVisits(completed,[short],[],[completed],now);
assert.equal(timelineWindow({...completed,truckVisits:completedVisits},'Truck 8',now)?.start,568);
assert.equal(appointmentStatus(completed),'Completed');
const disjoint={...row(120),visit_intervals:[interval(120),interval(120,600),interval(120,1200)]};
assert.equal(qualifiedAppointmentVisits([disjoint],'',now).length,0,'Do not sum separate passes to six minutes');
const mixed={...disjoint,visit_intervals:[interval(60),interval(300,600)]};
assert.equal(qualifiedAppointmentVisits([mixed],'',now)[0].visit_intervals.length,1);
assert.equal(trackAppointmentVisits(date,[mixed],now)[0].enteredAt,at(600));
const sparse={...interval(3600),source_timestamps:[at(0),at(3600)]};
assert.equal(appointmentIntervalQualifies(sparse,now),false,'An hour between two observations is not dwell');
assert.equal(appointmentIntervalQualifies({...interval(300),coverage_gaps:[{start:at(60),end:at(240)}]},now),false);
assert.equal(appointmentIntervalQualifies({arrival:at(0),departure:null},now),false,'Wall clock age is not dwell');
assert.equal(appointmentIntervalQualifies({...interval(300),departure:null},now),true,'An open observed five-minute interval qualifies');
assert.equal(appointmentIntervalQualifies({...interval(300),departure:null},start+299_000),false,'Ignore future evidence');
assert.equal(qualifiedAppointmentVisits([row(300)],'Canceled',now).length,0);
assert.equal(qualifiedAppointmentVisits([{...row(300),gps_coverage_gaps:[{start:at(60),end:at(240)}]}],'',now).length,0,'Legacy row-level gaps also block qualification');
assert.equal(trackAppointmentVisits(date,[{...row(300),match_confidence:'ambiguous'}],now).length,0);
assert.equal(trackAppointmentVisits(date,[{...row(300),pass_by_only:true}],now).length,0);
const points=interval(300).source_timestamps.map(timestamp=>({...job.location!,timestamp}));
const truck={truck:'Truck 8',...job.location!,lastGpsUpdate:at(300),speed:0,ignition:'ON',routePoints:points};
assert.equal(currentGpsPresence(job,[truck],[job],start+300_000)?.current,true);
assert.equal(currentGpsPresence(job,[{...truck,routePoints:[],lastGpsUpdate:at(0)}],[job],start+300_000),undefined);
assert.equal(currentGpsPresence(job,[{...truck,routePoints:points.slice(1)}],[job],start+300_000),undefined);
assert.equal(currentGpsPresence(job,[{...truck,routePoints:[points[0],{...points[1],latitude:31},points.at(-1)!]}],[job],start+300_000),undefined);
assert.equal(currentGpsPresence(job,[truck],[job,{...job,appointmentId:'2'}],start+300_000),undefined,'Overlapping appointment pins do not qualify');
assert.equal(currentGpsPresence(job,[truck],[job],start+900_000)?.current,false,'Qualified history does not make a stale report live');
const ongoing={...row(300),visit_intervals:[{...interval(300),departure:null}]};
assert.equal(trackAppointmentVisits(date,[ongoing],now).length,1,'Late-arriving evidence is still eligible');
assert.equal(buildTruckArrivalSlackNotifications(date,[ongoing]).length,1,'Arrival waits for dwell, keeping its original arrival identity');
assert.equal(buildTruckArrivalSlackNotifications(date,[ongoing])[0].fingerprint,buildTruckArrivalSlackNotifications(date,[row(300)])[0].fingerprint);
assert.equal(timelineWindow({...job,truckOnSite:true,truckVisits:scheduleTruckVisits(job,[ongoing],[],[job],now)},'Truck 8',now)?.actual,true,'An active qualified visit remains visible');
console.log('Appointment loiter passed: threshold, returns, gaps, late evidence, status/timeline/alerts, ambiguity, completed timing, and source immutability.');

// Review counterexamples: preserve positive source continuity, never infer it
// from hourly engine-off fixes or a recorded long span alone.
const sparseRow={...row(2400),visit_pin:{location:job.location},visit_intervals:[{...interval(2400),source_timestamps:[at(0),at(2400)],coverage_gaps:[{start:at(0),end:at(2400)}]}]};
const sparsePoints=[0,2400].map(seconds=>({...job.location,timestamp:at(seconds),truck_number:'Truck 8',speed:0,ignition:'OFF'}));
assert.equal(qualifiedAppointmentVisits(withAppointmentContinuity([sparseRow],sparsePoints,now),'',now).length,0);
assert.equal(appointmentIntervalEvidence(sparseRow.visit_intervals[0],now),'insufficient_evidence');
const pending=scheduleVisitState(job,[sparseRow],at(2400),[],now,[]);
assert.equal(pending.visitEvidencePending,true);assert.equal(pending.hasVisit,false);
assert.equal(timelineWindow({...job,...pending},'Truck 8',now)?.start,900);
for(const seconds of [299,300,301,2400]) {
 const points=[{...sparsePoints[0],continuous_until:at(seconds)},{...sparsePoints[1],timestamp:at(seconds)}];
 const raw={...sparseRow,visit_intervals:[{...interval(seconds),source_timestamps:[at(0),at(seconds)],coverage_gaps:seconds>300?[{start:at(0),end:at(seconds)}]:[]}]};
 const before=JSON.stringify([raw,points]);
 const enriched=withAppointmentContinuity([raw],points,now);
 const qualified=seconds>=300;
 assert.equal(qualifiedAppointmentVisits(enriched,'',now).length,Number(qualified));
 assert.equal(scheduleVisitState(job,enriched,at(seconds),[],now,trackAppointmentVisits(date,enriched,now)).hasDepartedVisit,qualified);
 assert.equal(scheduleTruckVisits(job,enriched,[],[job],now).length,Number(qualified));
 assert.equal(buildTruckArrivalSlackNotifications(date,enriched).length,Number(qualified));
 const live={...truck,lastGpsUpdate:at(seconds),routePoints:points.map(p=>({...p,continuousUntil:'continuous_until' in p ? p.continuous_until as string : undefined}))};
 assert.equal(Boolean(currentGpsPresence(job,[live],[job],start+seconds*1000)),qualified,'Live and ledger agree for the same explicit continuity evidence');
 assert.equal(JSON.stringify([raw,points]),before);
}
const bridgePoints=[{...sparsePoints[0],continuous_until:at(2400)},sparsePoints[1]];
for(const contradiction of [
 {...sparsePoints[0],timestamp:at(1200),latitude:31},
 {...sparsePoints[0],timestamp:at(1200)}, // not attributed to this interval
 {...sparsePoints[0],latitude:31}, // conflicting same-time fix
]) assert.equal(qualifiedAppointmentVisits(withAppointmentContinuity([sparseRow],[...bridgePoints,contradiction],now),'',now).length,0);
assert.equal(qualifiedAppointmentVisits(withAppointmentContinuity([sparseRow],bridgePoints.map(p=>({...p,truck_number:'Truck 9'})),now),'',now).length,0);
assert.equal(qualifiedAppointmentVisits(withAppointmentContinuity([sparseRow],[{...bridgePoints[0],continuous_until:at(50000)},bridgePoints[1]],now),'',now).length,0);
assert.equal(appointmentIntervalQualifies({...interval(300),coverage_gaps:[{start:'bad',end:at(240)}]},now),false);
assert.equal(appointmentIntervalQualifies({...interval(300),source_timestamps:[at(0)]},now),true,'A confirmed last-inside endpoint supports exactly five minutes');
const legacy={...row(60),first_arrival:at(0),final_departure:at(60),visit_intervals:undefined};
const completeState=scheduleVisitState(completed,[legacy],at(60),[],now,[]);
assert.equal(completeState.hasDepartedVisit,true,'Missing tracked GPS qualification cannot erase source-completed departure');
assert.equal(completeState.recordedOnsiteTime.minutes,1);
const confirmedLegacy={...legacy,operational_confirmation:true};
const legacyTracked=trackAppointmentVisits(date,[confirmedLegacy],now);
assert.equal(legacyTracked.length,1);
assert.equal(scheduleVisitState(job,[confirmedLegacy],at(60),[],now,legacyTracked).hasDepartedVisit,true);
console.log('Review counterexamples passed: explicit stationary coverage, unknown gaps, parity, raw immutability and legacy tracked fallback.');

const fixtureRoot=fs.mkdtempSync(path.join(os.tmpdir(),'appointment-continuity-'));
try {
 const history=path.join(fixtureRoot,'history','linxup');fs.mkdirSync(history,{recursive:true});
 fs.writeFileSync(path.join(history,`linxup_location_${date}.json`),JSON.stringify({points:bridgePoints}));
 const original=fs.readFileSync(path.join(history,`linxup_location_${date}.json`),'utf8');
 const unresolvedReturns={...sparseRow,visit_count:2,visit_intervals:undefined,first_arrival:at(0),final_departure:at(2400)};
 const unchanged=withSavedAppointmentContinuity([unresolvedReturns],date,fixtureRoot,now);
 assert.equal(unchanged[0],unresolvedReturns,'Enrichment must not synthesize a single interval for legacy separate passes');
 assert.equal(qualifiedAppointmentVisits(unchanged,'',now).length,0);
 assert.equal(buildTruckArrivalSlackNotifications(date,unchanged).length,0);
 assert.equal(scheduleTruckVisits(job,unchanged,[],[job],now).length,0);
 const saved=withSavedAppointmentContinuity([sparseRow],date,fixtureRoot,now);
 assert.equal(qualifiedAppointmentVisits(saved,'',now).length,1);
 assert.equal(buildTruckArrivalSlackNotifications(date,saved).length,1);
 assert.equal(fs.readFileSync(path.join(history,`linxup_location_${date}.json`),'utf8'),original);
 assert.equal(withSavedAppointmentContinuity([sparseRow],date+'-missing',fixtureRoot,now)[0],sparseRow);
}finally{fs.rmSync(fixtureRoot,{recursive:true,force:true});}
assert.equal(scheduleVisitState({...job,status:'Canceled'},[sparseRow],at(2400),[],now,[]).visitEvidencePending,false);
console.log('Saved continuity reader passed with synthetic local files, no writes to evidence and missing-file fallback.');
