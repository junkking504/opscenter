import assert from 'node:assert/strict';
import {stopOrderMap,stopOrderTrucks,stopOrderTruckBadges} from '../desktop-ui/lib/stop-order-map';
import type {ScheduleAppointment,ScheduleRouteLeg,ScheduleTruck} from '../desktop-ui/lib/schedule-contract';
const jobs=[0,1,2].map(n=>({recordId:String(n),location:{latitude:30+n*.01,longitude:-90+n*.01}} as ScheduleAppointment));
const legs=[0,1].map(n=>({fromAppointmentId:String(n),toAppointmentId:String(n+1),source:'osm_road_estimate',geometry:[jobs[n].location!,jobs[n+1].location!]} as ScheduleRouteLeg));
const original=stopOrderMap(jobs,legs);assert.equal(original.paths.length,2);assert.deepEqual(original.stops.map(s=>s.number),[1,2,3]);
const reverse=stopOrderMap([...jobs].reverse(),legs);assert.equal(reverse.paths.length,0,'Old direction routes cannot appear after reorder');assert.equal(reverse.stops[0].job.recordId,'2');assert.equal(reverse.stops[0].number,1);
const missing=stopOrderMap([jobs[0],{...jobs[1],location:null},jobs[2]],legs);assert.equal(missing.paths.length,0,'Never bridge an appointment without a verified pin');assert.equal(missing.missingPins,1);assert.deepEqual(missing.stops.map(s=>s.number),[1,3]);
assert.equal(stopOrderMap(jobs,[{...legs[0],source:'unavailable'},legs[1]]).paths.length,1);
assert.equal(stopOrderMap(jobs,[{...legs[0],geometry:[{latitude:NaN,longitude:-90},jobs[1].location!]}]).paths.length,0);
console.log('Stop order map: numbering, reversed drafts, missing pins, unavailable routes and malformed geometry passed.');
const now=Date.parse('2026-10-09T16:00:00Z');
const truck={truck:'Truck# 2',latitude:30.4,longitude:-91.1,lastGpsUpdate:'2026-10-09T15:59:00Z',speed:12} as ScheduleTruck;
const fleet={isToday:true,lastUpdatedAt:null,trucks:[truck,{...truck,truck:'Truck 3',lastGpsUpdate:'2026-10-09T15:30:00Z'},...[null,NaN,91,Infinity].map(latitude=>({...truck,latitude})),{...truck,longitude:181},{...truck,latitude:0,longitude:0}]};
const pins=stopOrderTrucks(fleet,'Truck 2',now);
assert.equal(pins.length,2,'Invalid positions must not become truck markers');
assert.equal(pins[0].selected,true,'JunkWare and canonical truck labels identify the same truck');
assert.equal(pins[1].selected,false);
assert.equal(pins[0].gps.label,'Driving');
assert.equal(pins[1].gps.stale,true);
assert.match(pins[1].gps.label,/last known/);
assert.match(pins[0].reportedAt,/10:59 AM CDT/);
assert.equal(stopOrderTrucks({...fleet,isToday:false},'Truck 2',now).length,0,'Never show current fleet positions on a historical or future schedule');
assert.equal(stopOrderTrucks({...fleet,trucks:[{...truck,latitude:null}]},'Truck 2',now).length,0,'Unavailable selected truck cannot be guessed');
assert.equal(stopOrderTrucks({...fleet,trucks:[{...truck,lastGpsUpdate:null}]},'Truck 2',now)[0].gps.stale,true);
assert.equal(stopOrderTrucks({...fleet,trucks:[{...truck,speed:0,ignition:'OFF',lastGpsUpdate:'2026-10-09T15:30:00Z'}]},'Truck 2',now)[0].gps.label,'Parked · ignition off','Honor existing parked reporting cadence');
console.log('Job Order fleet: coordinate validation, truck identity, freshness, parked reporting and date boundaries passed.');

for(const size of [{x:680,y:340},{x:330,y:230}]) {
 const points=[2,3,4,6,8,9].map((id,index)=>({id:`Truck ${id}`,x:size.x/2+(index<2?0:index),y:size.y/2+(index<2?0:index),selected:id===8,stale:id===3||id===8||id===9}));
 const before=JSON.stringify(points),badges=stopOrderTruckBadges(points,size);
 assert.equal(badges[0].id,'Truck 8','Selected truck gets first placement');
 assert.equal(JSON.stringify(points),before,'Layout cannot change observed coordinates');
 for(const [index,badge] of badges.entries()) {
  assert(badge.left>=0&&badge.top>=0&&badge.left+badge.width<=size.x&&badge.top+badge.height<=size.y);
  for(const other of badges.slice(index+1)) assert(badge.left+badge.width<=other.left||other.left+other.width<=badge.left||badge.top+badge.height<=other.top||other.top+other.height<=badge.top,'Every co-located or nearby truck remains readable');
 }
 assert.deepEqual(stopOrderTruckBadges([...points].reverse(),size),badges,'Source ordering cannot jitter labels');
}
const offscreen=stopOrderTruckBadges([{id:'Truck 2',x:-200,y:50,selected:false,stale:false}],{x:680,y:340})[0];
assert.equal(offscreen.left,-247,'Never pull an offscreen truck into a manual viewport');
console.log('Truck badges: co-located and nearby labels, selected priority, immutable positions, resize and offscreen behavior passed.');
