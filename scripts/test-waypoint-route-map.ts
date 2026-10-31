import assert from 'node:assert/strict';
import {crewAssignedDay} from '../lib/crew-assigned-day';
import {waypointStops,hasWaypointLocation} from '../lib/waypoint-route';
import type {CrewScheduledJob} from '../lib/crew-dispatch';
import type {CrewPhone} from '../lib/crew-phone';
const date='2026-10-21',now=Date.parse(date+'T17:00:00Z');
const row=(id:string,truck='Truck 2',status='Confirmed')=>({appt_id:id,job_id:'JK'+id,truck,job_status:status,customer_name:'Example '+id,address:id+' Example St',appointment_time:'08:00 AM - 09:00 AM'});
let addresses:string[]=[];
const deps={snapshot:()=>({date,scrapedAt:new Date(now).toISOString(),updatedAt:new Date(now).toISOString(),updatedAtMs:now,freshnessAtMs:now,appointments:[row('100'),row('101'),row('102','Truck 9'),row('103','Truck 2','Completed')],cancelled:[row('104','Truck 2','Cancelled')]}),rows:()=>[],overrides:()=>new Map(),dispatch:()=>({truck:'Truck 2',version:0,current:null,queued:null}),locations:(values:string[])=>{addresses=values;return new Map(values.map((address,i)=>[address,i===0?{latitude:29.95,longitude:-90.07,approximate:false}:null]));}};
const payload=crewAssignedDay({deviceId:'fixture',truck:'Truck 2'} as CrewPhone,date,deps,now);
assert.deepEqual(addresses,['100 Example St','101 Example St','103 Example St'],'Only authorized noncancelled source addresses reach cache projection');
assert.equal(payload.jobs?.[0].mapLocation?.latitude,29.95);
assert.equal(payload.jobs?.[1].mapLocation,null);
const stops=waypointStops(payload.jobs!,'Truck 2');
assert.deepEqual(stops.map(s=>s.number),[1,2]);
assert.deepEqual(stops.filter(hasWaypointLocation).map(s=>s.number),[1],'Unmapped stop retains its list number');
const ordered=[{...payload.jobs![1],routePosition:1},{...payload.jobs![0],routePosition:2}];
assert.deepEqual(waypointStops(ordered,'Truck 2').filter(hasWaypointLocation).map(s=>s.number),[2],'A missing first pin cannot renumber the second stop');
assert.equal(waypointStops([{...ordered[0],truck:'Truck 9'},...ordered],'Truck 2').length,2,'Other trucks never share route numbering');
assert.equal(waypointStops([{...ordered[0],truck:'',sharedAmazon:true}],'Truck 2').length,0,'Unassigned shared work is not presented as an assigned route stop');
assert.equal(hasWaypointLocation({number:1,job:{mapLocation:{latitude:NaN,longitude:-90,approximate:false}} as CrewScheduledJob}),false);
assert.equal(hasWaypointLocation({number:1,job:{mapLocation:{latitude:29,longitude:-90,approximate:true}} as CrewScheduledJob}),true);
console.log('Waypoint route map PASS: authorized projection, stable order/numbering, missing/approximate pins, completed and shared separation.');

// Map membership is independent of the selected truck's remaining Route Order.
import {crewMapAppointments,managerMapAppointments,hasMapLocation} from '../lib/waypoint-map';
const full=crewMapAppointments([
 {...payload.jobs![0],truck:'Truck 2',routePosition:3},
 {...payload.jobs![0],appointmentId:'other',truck:'Truck 9',routePosition:1},
 {...payload.jobs![0],appointmentId:'completed',status:'Completed'},
 {...payload.jobs![0],appointmentId:'unassigned',truck:'',sharedAmazon:true,mapLocation:null},
]);
assert.deepEqual(full.map(row=>row.id),['100','other','completed','unassigned']);
assert.deepEqual(full.map(row=>row.label),['T2·3','T9·1','T2✓','U·1']);
assert.equal(full.filter(hasMapLocation).length,3);
assert.equal(crewMapAppointments([payload.jobs![0]]).length,1,'The projection never fetches or adds unauthorized records');
const managed=managerMapAppointments([
 {recordId:'active',truck:'Truck 2',status:'Confirmed',customerName:'Active',address:'Example',location:{latitude:29,longitude:-90}},
 {recordId:'done',truck:'Truck 9',status:'Completed',customerName:'Done',address:'Example',location:{latitude:30,longitude:-90}},
 {recordId:'cancelled',truck:'',status:'Canceled',customerName:'Cancelled',address:'Example',location:null,mapFallback:{location:{latitude:31,longitude:-90}}},
 {recordId:'missing',truck:'',status:'Confirmed',customerName:'Missing',address:'',location:null},
 {recordId:'invalid',truck:'Truck 2',status:'Confirmed',customerName:'Invalid',address:'',location:{latitude:NaN,longitude:0}},
] as import('../lib/desktop-schedule').DesktopAppointment[]);
assert.equal(managed.length,5,'All statuses, trucks and unassigned records remain available');
assert.equal(managed.filter(hasMapLocation).length,3);
assert.equal(managed[2].location?.approximate,true,'Saved approximate coordinates are usable and labelled');
assert.equal(managed[1].label,'T9✓');assert.equal(managed[2].label,'U×');
console.log('Waypoint all-appointments map PASS: all supplied records, completed/cancelled/unassigned, fallback provenance, invalid locations, unchanged access scope.');

import {clusterByScreenDistance} from '../lib/waypoint-map';
{
 const pts=[{x:0,y:0,item:'a'},{x:10,y:5,item:'b'},{x:200,y:0,item:'c'},{x:205,y:3,item:'d'},{x:400,y:400,item:'e'}];
 assert.deepEqual(clusterByScreenDistance(pts,40),[['a','b'],['c','d'],['e']],'Pins closer than the gap share one group, in stable order');
 assert.deepEqual(clusterByScreenDistance(pts,1),[['a'],['b'],['c'],['d'],['e']],'A tiny gap keeps every pin separate');
 assert.deepEqual(clusterByScreenDistance([{x:5,y:5,item:'x'},{x:5,y:5,item:'y'}],40),[['x','y']],'Co-located pins always group');
 assert.deepEqual(clusterByScreenDistance([],40),[]);
 assert.deepEqual(clusterByScreenDistance([{x:0,y:0,item:'p'},{x:39,y:0,item:'q'},{x:41,y:0,item:'r'}],40),[['p','q','r']],'A point close to any member joins the group, not only the first member');
 assert.deepEqual(clusterByScreenDistance([{x:0,y:0,item:'a'},{x:60,y:0,item:'b'},{x:30,y:0,item:'c'}],40),[['a','b','c']],'A point that bridges two groups merges them, so no two markers are left overlapping');
 console.log('PASS Waypoint pin grouping: nearby pins share a count marker, distant pins stay separate, order is stable.');
}
