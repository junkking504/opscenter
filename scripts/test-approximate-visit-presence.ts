import assert from 'node:assert/strict';
import React, {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import ScheduleVisitBlock from '../desktop-ui/schedule-visit-block';
import {timelinePlacement,type ScheduleAppointment} from '../desktop-ui/lib/schedule-contract';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {currentGpsPresence,currentGpsJobLocation} from '../lib/schedule-gps-presence';
import {appointmentVisitPin,ambiguousVisitPin} from '../lib/appointment-visit-pin';
import {scheduleVisitState} from '../lib/desktop-schedule-visits';
import {scheduleTruckVisits} from '../lib/schedule-visit-intervals';
import {trackAppointmentVisits} from '../lib/visit-tracking-agent';
import {reconcileAppointmentPositions} from '../lib/appointment-position-tracking';
import {appointmentVisitAlerts} from '../lib/appointment-visit-alerts';
import {buildTruckArrivalSlackNotifications,buildTruckDepartureSlackNotifications} from '../lib/slack-alerts';
import {visitedAssignmentTruck} from '../lib/gps-visit-assignment';
import type {DesktopAppointment} from '../lib/desktop-schedule';
import {hasVisitIntervalEvidence} from '../lib/schedule-visit-evidence';
const root=fs.mkdtempSync(path.join(os.tmpdir(),'approximate-presence-'));
process.env.OPSCENTER_DATA_DIR=root;process.env.OPSBOT_DATA_DIR=root;
process.env.SLACK_OPS_DISPATCH_CHANNEL_ID='C_TEST';
const date='2026-09-08', now=Date.parse('2026-09-08T15:10:00Z');
const location={latitude:30,longitude:-90};
const fallback={location,source:'Synthetic parish',sourceUrl:'https://example.invalid',matchedAddress:'123 Example Blvd',detail:'Unit unverified',stale:false};
const job={appointmentId:'101',jkNumber:'JK1000001',address:'123 Example Blvd Unit 26-107',customerName:'Synthetic',territory:'Test',truck:'Truck 3',status:'Confirmed',location:null,mapFallback:fallback};
const stamp=(m:number)=>`2026-09-08T15:${String(m).padStart(2,'0')}:00Z`;
const truck={truck:'Truck 3',...location,lastGpsUpdate:stamp(9),speed:0,ignition:'OFF',routePoints:[1,2,3,4,5,6,7,8,9].map(m=>({...location,timestamp:stamp(m)}))};
const unchanged=JSON.stringify(job);
try {
 assert.deepEqual(appointmentVisitPin(job)?.location,location);
 assert.equal(appointmentVisitPin({...job,location})?.approximate,false,'Verified coordinates win');
 assert.equal(currentGpsPresence(job,[truck],[job],now)?.current,true);
 assert.equal(currentGpsJobLocation(job,[truck],[job],now)?.truck,'Truck 3');
 const neighbor={...job,appointmentId:'102',location:{latitude:30.003,longitude:-90},mapFallback:null,status:'Completed'};
 assert.equal(ambiguousVisitPin(job,[job,neighbor]),true,'Overlapping locations are ambiguous regardless of labels');
 // A historical ledger remains readable with its original provenance.
 const pin={...fallback,approximate:true};
 const row={appointment_id:'101',jk_number:'JK1000001',truck_number:'Truck 3',match_confidence:'confirmed',visit_count:1,visit_pin:pin,visit_intervals:[{arrival:stamp(1),departure:null,source_timestamps:[stamp(1),stamp(6)]}]};
 assert.equal(scheduleVisitState(job,[row],stamp(9),[truck],now).truckOnSite,true,'Recorded GPS remains usable regardless of pin label');
 assert.equal(scheduleVisitState(job,[row],stamp(9),[truck],now,undefined,[job,neighbor]).truckOnSite,true,'A unique observed point remains attributable when circles overlap elsewhere');
 assert.equal(scheduleVisitState(job,[row],stamp(9),[truck],now+2*3600_000).truckOnSite,false);
 const tracked=trackAppointmentVisits(date,[row,row],now);
 assert.equal(tracked.length,1);assert.equal(tracked[0].visitPin?.approximate,true);
 const outside={...truck,latitude:30.01,lastGpsUpdate:stamp(9),routePoints:[{latitude:30.01,longitude:-90,timestamp:stamp(8)}]};
 // A later changed display pin must not manufacture or prevent departure.
 const moved={...job,mapFallback:{...fallback,location:{latitude:30.01,longitude:-90}}};
 const departure=reconcileAppointmentPositions(tracked,[moved],[outside],now);
 assert.equal(departure[0].departedAt,new Date(stamp(8)).toISOString(),'Departure uses recorded coordinates and two later outside fixes');
 assert.equal(departure[0].durationSeconds,null);
 assert.equal(reconcileAppointmentPositions(tracked,[job],[{...outside,routePoints:[]}],now)[0].departedAt,null);
 const arrivalAlert=appointmentVisitAlerts([], [row], [job], date,now)[0];
 const departedAlert=appointmentVisitAlerts([], [row], [job], date,now,departure)[0];
 assert.equal(arrivalAlert.id,departedAlert.id);
 assert.match(departedAlert.facts.find(f=>f.label==='Map pin')!.value,/Approximate/);
 const closed={...row,visit_intervals:[{arrival:stamp(1),departure:stamp(6),departure_confirmed:true}]};
 for(const build of [buildTruckArrivalSlackNotifications,buildTruckDepartureSlackNotifications]) {
   const alerts=build(date,[closed,closed]);assert.equal(alerts.length,1);
   assert.match(alerts[0].plainText!,/Map pin.*Approximate/);
   assert.equal(alerts[0].fingerprint,build(date,[closed])[0].fingerprint);
 }
 const zero={...closed,visit_intervals:[{arrival:stamp(1),departure:stamp(1),departure_confirmed:true}]};
 assert.equal(hasVisitIntervalEvidence(zero),true);
 assert.equal(buildTruckDepartureSlackNotifications(date,[zero]).length,0);
 assert.equal(scheduleTruckVisits(job,[zero],[],[job],now).length,0);
 const visits=scheduleTruckVisits(job,[closed],[],[job],now);
 assert.equal(visits[0].approximate,true);
 const renderJob={...job,recordId:`${date}:appointment:101`,appointmentType:'Job',hasScheduledTime:true,truckVisits:visits,appointmentStartMinutes:540,appointmentEndMinutes:600} as ScheduleAppointment;
 const position=timelinePlacement(renderJob,{start:480,end:1080,duration:600},'Truck 3',now)!;
 // tsx respects the desktop's preserve-JSX setting; provide the classic runtime for this isolated server render.
 Object.assign(globalThis,{React});
 const html=renderToStaticMarkup(createElement(ScheduleVisitBlock,{job:renderJob,truck:'Truck 3',position,segmentIndex:0,top:0,selected:false,muted:false,matched:false,dragging:false,busy:false,onPointerDown:()=>{},onSelect:()=>{}}));
 assert.match(html,/Approximate pin/,'Accessible visit details preserve provenance');
 assert.match(html,/≈5m/,'Visible visit duration carries approximation');
 const zeroPosition=timelinePlacement({...renderJob,truckVisits:scheduleTruckVisits(job,[zero],[],[job],now)},{start:480,end:1080,duration:600},'Truck 3',now);
 assert.equal(zeroPosition?.actual,false,'A short proximity observation does not become a visit block');
 assert.equal(visitedAssignmentTruck({...job,recordId:`${date}:appointment:101`,truck:'Unassigned',location,truckVisits:visits} as DesktopAppointment,date,now),'Truck 3','Unique visit evidence can support assignment regardless of pin label');
 for(const value of [job,{...job,location,mapFallback:null}]) {
   assert.equal(currentGpsPresence(value,[truck],[value],now)?.current,true);
   assert.equal(currentGpsJobLocation(value,[truck],[value],now)?.truck,'Truck 3');
   assert.equal(currentGpsPresence(value,[{...truck,latitude:30.01}],[value],now),undefined,'Outside radius cannot arrive');
   assert.equal(currentGpsPresence(value,[{...truck,lastGpsUpdate:stamp(11)}],[value],now),undefined,'Future GPS cannot arrive');
   assert.equal(currentGpsJobLocation(value,[truck],[value],now+2*3600_000),undefined,'Expired parked heartbeat cannot locate truck');
   assert.equal(currentGpsPresence(value,[truck],[value,{...neighbor,location}],now),undefined,'Label does not resolve co-located appointments');
 }
 // Two sites 360m apart overlap only around their midpoint.
 const adjacent={...neighbor,location:{latitude:30.00324,longitude:-90}};
 const midpoint={...truck,latitude:30.00162};
 for (const value of [job,{...job,location,mapFallback:null}]) {
   const appointments=[value,adjacent];
   assert.equal(ambiguousVisitPin(value,appointments,truck),false);
   assert.equal(currentGpsPresence(value,[truck],appointments,now)?.truck,'Truck 3');
   assert.equal(currentGpsJobLocation(value,[truck],appointments,now)?.truck,'Truck 3');
   assert.equal(scheduleVisitState(value,[row],stamp(9),[truck],now,undefined,appointments).truckOnSite,true);
   assert.equal(currentGpsPresence(value,[midpoint],appointments,now),undefined,'Completed neighbors still compete at a shared point');
   assert.equal(currentGpsJobLocation(value,[midpoint],appointments,now),undefined);
   assert.equal(scheduleVisitState(value,[row],stamp(9),[midpoint],now,undefined,appointments).truckOnSite,false);
   assert.equal(scheduleVisitState(value,[row],stamp(9),[midpoint],now,undefined,appointments).lastSeenOnsiteTruck,undefined);
   const canceled=[value,{...adjacent,status:'Canceled'}];
   assert.equal(currentGpsPresence(value,[midpoint],canceled,now)?.truck,'Truck 3');
   const approaching={...truck,routePoints:[{...midpoint,timestamp:stamp(7)},{...truck,timestamp:stamp(8)}]};
   assert.equal(currentGpsPresence(value,[approaching],appointments,now),undefined,'Ambiguous approach resets the required dwell');
   assert.equal(currentGpsPresence(value,[{...truck,latitude:adjacent.location.latitude}],appointments,now),undefined,'A point at the neighbor cannot be assigned here');
 }
 assert.equal(appointmentVisitPin({...job,mapFallback:{...fallback,location:{latitude:NaN,longitude:-90}}}),null);
 assert.equal(appointmentVisitPin({...job,mapFallback:null}),null);
 assert.equal(JSON.stringify(job),unchanged,'No address or assignment promotion');
} finally {fs.rmSync(root,{recursive:true,force:true});}
console.log('PASS label-independent GPS operations and historical UI/alerts: current/stale/future GPS, ambiguity, pin provenance, bounded departure, stable alert identities, zero-duration exit, verified precedence and assignment parity; no sends.');
