import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {trackedGeofenceVisits,readGeofenceEntries,geofenceTimelineAlerts} from '../lib/linxup-geofence-alerts';
import {qualifiedGeofenceVisit,shortGeofenceVisit} from '../lib/visit-tracking-agent';
import {projectUnloadEvents,runUnloadCostAgent} from '../lib/unload-cost-agent';
import {defaultDumpFeePolicy} from '../lib/dump-expenses';
import {scheduleOperationalStops} from '../lib/schedule-operational-stops';
import {readOperationalTruckLoads} from '../lib/truck-load-closeouts';
const day='2026-09-20',next='2026-09-21',now=Date.parse(next+'T15:00:00Z');
const at=(seconds:number)=>new Date(Date.parse(day+'T15:00:00Z')+seconds*1000).toISOString();
const point=(seconds:number,name='EMR')=>({truck_number:'Truck 9',geofence_name:name,occurred_at:at(seconds)});
const event=(seconds:number,type='entered',name='EMR')=>({...point(seconds,name),alert_type:`geofence_${type}`});
for(const name of ['EMR','Gentilly']) {
  const raw=trackedGeofenceVisits(day,[point(0,name),point(150,name),point(300,name),point(360,'Warehouse')],[event(0,'entered',name),event(420,'exited',name)],now);
  const visit=raw.find(v=>v.name===name)!;
  assert.equal(visit.conflict,true);assert.equal(qualifiedGeofenceVisit(visit),true,'A departure conflict cannot undo proven dwell');
  assert.equal(shortGeofenceVisit(visit),false);
  const result=runUnloadCostAgent(day,raw,[],defaultDumpFeePolicy,now);
  assert.equal(result.unloads.length,1,'Keep the supported unload');
  assert.equal(result.records.length,name==='Gentilly'?1:0,'Keep the supported dump estimate');
  assert.equal(scheduleOperationalStops(day,raw).length,1,'Keep the established Schedule stop');
}
for(const seconds of [299,300]) {
  const native=trackedGeofenceVisits(day,[],[event(0),event(seconds,'exited')],now)[0];
  assert.equal(shortGeofenceVisit(native),seconds<300);
  const gps=trackedGeofenceVisits(day,[point(0)],[event(seconds,'exited')],now)[0];
  assert.equal(qualifiedGeofenceVisit(gps),seconds>=300,'Fix-to-native-exit boundary is supported');
  assert.equal(shortGeofenceVisit(gps),false,'GPS-only first arrival is a lower bound, not proof of a short visit');
}
const laterDuplicate=trackedGeofenceVisits(day,[point(0),point(150),point(300)],[event(0),event(301)],now)[0];
assert.equal(laterDuplicate.conflict,true);
assert.equal(qualifiedGeofenceVisit(laterDuplicate),true,'A later ambiguous native entry cannot erase an already proven five-minute interval');
assert.match(laterDuplicate.id,/^linxup-geofence-[a-f0-9]{32}$/,'Provider episode IDs contain no fingerprint separators');
const sparse=trackedGeofenceVisits(day,[point(0),point(61),point(3600,'Warehouse')],[],now).find(v=>v.name==='EMR')!;
assert.equal(shortGeofenceVisit(sparse),false,'A short observed lower bound cannot authorize deleting an uncertain longer visit');
const duplicate=trackedGeofenceVisits(day,[],[event(0),event(20),event(61,'exited')],now)[0];
assert.equal(shortGeofenceVisit(duplicate),false,'Ambiguous native arrivals cannot authorize deletion');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'geofence-review-')),original={...process.env};
process.env.OPSCENTER_DATA_DIR=root;process.env.OPSCENTER_TRUCK_LOADS_FILE=path.join(root,'loads.json');
const write=(date:string,alerts:unknown[])=>{
  const file=path.join(root,'history/linxup/alerts',`linxup_alerts_${date}.json`);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,JSON.stringify({date,alerts}));
};
try {
  const entered={...event(0),occurred_at:next+'T04:57:00Z'};
  write(day,[entered]);
  assert.equal(readGeofenceEntries(day).trackedVisits.length,0,'No invented overnight dwell before evidence arrives');
  write(next,[]);
  assert.equal(readGeofenceEntries(day).trackedVisits.length,0,'An empty next-day file does not change qualification');
  write(next,[{...entered,alert_type:'geofence_exited',occurred_at:next+'T05:10:00Z'}]);
  const before=readGeofenceEntries(day),after=readGeofenceEntries(next);
  assert.equal(before.trackedVisits.length,1);assert.equal(after.trackedVisits.length,1);
  assert.equal(before.trackedVisits[0].id,after.trackedVisits[0].id,'Both daily views share one overnight episode');
  const unloads=[...projectUnloadEvents(day,before.trackedVisits,now),...projectUnloadEvents(next,after.trackedVisits,now)];
  assert.equal(unloads.length,1,'23:57–00:10 produces exactly one unload across midnight');
  assert.equal(unloads[0].date,day);assert.equal(unloads[0].occurredAt,entered.occurred_at.replace('Z','.000Z'));
  assert.equal(readOperationalTruckLoads(day,['9'],[])[0].events.filter(e=>e.kind==='yard_reset').length,1,'Actual load reader gets the arrival-day unload');
  assert.equal(readOperationalTruckLoads(next,['9'],[])[0].events.filter(e=>e.kind==='yard_reset').length,0,'Actual next-day load reader does not repeat the unload');
  assert.equal(before.nativeVisits.length,0,'No next-day departure announcement on the arrival day');
  assert.equal(after.nativeVisits.length,1);
  write(day,[event(0),event(20),event(61,'exited')]);
  const uncertain=readGeofenceEntries(day);
  assert.equal(uncertain.trackedVisits.length,0);
  assert.equal(geofenceTimelineAlerts(day,uncertain.arrivals,[...uncertain.visits,...uncertain.reviewVisits])[0].needsAction,true,'Uncertain closed episode remains reviewable, not discarded');
  console.log('PASS confirmed conflict retention, positive short-stay proof, fix/exit boundary, uncertain review cards and one overnight unload through actual load reader');
} finally {
  for(const key of ['OPSCENTER_DATA_DIR','OPSCENTER_TRUCK_LOADS_FILE'])if(original[key]===undefined)delete process.env[key];else process.env[key]=original[key];
  fs.rmSync(root,{recursive:true,force:true});
}
