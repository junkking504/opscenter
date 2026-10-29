import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {subscribeLinxupUpdates} from '../lib/linxup-update-stream';
import {geofencePositionArrivals, geofenceLoadResets, geofenceTimelineAlerts, geofenceEntries} from '../lib/linxup-geofence-alerts';

const date = '2026-09-10', now = Date.parse(`${date}T21:00:00Z`);
const observation = {truck_number:'Truck 3',geofence_name:'Example yard',occurred_at:`${date}T20:00:00Z`};
const entered = {...observation,alert_type:'GEOFENCE_ENTERED'};
const confirmed = {...observation,occurred_at:`${date}T20:05:00Z`};
assert.equal(geofencePositionArrivals(date, [observation], [], now).length,1,'One report immediately alerts while the visit is pending');
const arrival = geofencePositionArrivals(date, [observation,confirmed], [], now);
assert.equal(arrival.length,1,'Five minutes of supported presence establishes arrival');
assert.equal(Date.parse(arrival[0].timestamp),Date.parse(observation.occurred_at));
assert.equal(geofenceLoadResets(date,arrival).length,0,'Unknown named yard does not unload');
assert.equal(geofencePositionArrivals(date,[observation,{...observation,occurred_at:`${date}T20:01:00Z`}],[],now).length,1);
assert.equal(geofencePositionArrivals(date,[observation,confirmed],[entered],now).length,0,'Native entry owns the identity');
const exit = {...entered,alert_type:'GEOFENCE_EXITED',occurred_at:`${date}T20:02:00Z`};
assert.equal(geofencePositionArrivals(date,[{...observation,occurred_at:`${date}T20:03:00Z`},observation],[exit,entered],now).length,1,'Reentry alerts immediately and must qualify separately');
assert.equal(geofenceTimelineAlerts(date,geofenceEntries(date,[entered],now),[]).length,1);

async function main() {
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'opscenter-arrival-stream-'));
fs.mkdirSync(path.join(root,'history','linxup'), {recursive:true});
let unsubscribe = () => {};
try {
  let notifications = 0;
  let resolveChange!: () => void;
  const changed = new Promise<void>(resolve => {resolveChange=resolve;});
  unsubscribe = subscribeLinxupUpdates(root, () => {notifications++;resolveChange();});
  const file=path.join(root,'history','linxup',`linxup_location_${date}.json`);
  fs.writeFileSync(`${file}.tmp`, '{}'); fs.renameSync(`${file}.tmp`, file);
  await Promise.race([changed, new Promise((_, reject) => {const timer=setTimeout(()=>reject(new Error('Source update was not delivered immediately')),2000);timer.unref();})]);
  assert.ok(notifications > 0, 'Atomic source publication immediately wakes connected screens');
  unsubscribe();
} finally {unsubscribe();fs.rmSync(root,{recursive:true,force:true});}
console.log('Immediate arrival stream passed: first facility report, retries, reconciliation, reentry, no fabricated resets and atomic source notifications.');

}
void main().catch(error => { console.error(error); process.exitCode = 1; });
