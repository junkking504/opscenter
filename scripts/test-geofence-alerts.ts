import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {geofenceEntries,geofenceFacility,geofenceLoadResets,geofenceOperationalAlert,readGeofenceEntries} from '../lib/linxup-geofence-alerts';
import {deriveTruckLoadStatus,type TruckLoadEvent} from '../lib/truck-load-status';
import {commandAlertWorkItemForSource} from '../lib/command-alert-workflow';
import type {WorkItem} from '../lib/platform/contracts';

const date='2026-09-06';
const row=(name:string,time='2026-09-06T16:00:00Z',extra:Record<string,unknown>={})=>({alert_type:'GEOFENCE_ENTERED',truck_number:'Truck# 4',geofence_name:name,occurred_at:time,...extra});
const entries=geofenceEntries(date,[row('Warehouse'),row('Warehouse',undefined,{alert_id:'retry'}),row('Warehouse','2026-09-06T17:00:00Z'),row('Gentilly Landfill'),row('Stranco Transfer Station'),row('EMR Metal Recycling'),row('Customer property'),row('Landfill',undefined,{alert_type:'GEOFENCE_EXITED'}),row('Landfill',undefined,{truck_number:'Unknown vehicle 4'}),row('Landfill','invalid'),row('Landfill','2026-09-07T16:00:00Z')],Date.parse('2026-09-06T23:00:00Z'));
assert.equal(entries.length,6,'Retries combine while actual reentries remain');
assert.equal(geofenceEntries(date,[row('Warehouse','2026-09-07T04:59:00Z')]).length,1,'Operating date follows Chicago, not UTC');
assert.equal(geofenceEntries(date,[row('Warehouse','2026-09-07T05:00:00Z')]).length,0);
assert.equal(geofenceEntries(date,[row('Landfill',undefined,{alert_type:'IGNITION_OFF'})]).length,0,'A stop does not establish entry');
for(const name of ['Warehouse','Junk King warehouse','NOHQ','BRHQ','Junk King warehouse metal yard']) assert.equal(geofenceFacility(name).resetLocation,null,`${name} does not empty the truck`);
for(const name of ['Gentilly','River Birch','Baton Rouge Landfill','GL','RBL','BRL','STS','Stranco','GMTS','Green Meadow','Mengel']) assert.equal(geofenceFacility(name).resetLocation,'dump');
for(const name of ['EMR','Scrap yard','Metal recycling yard']) assert.equal(geofenceFacility(name).resetLocation,'metal_yard');
assert.equal(geofenceFacility('Unrecognized industrial yard').resetLocation,null);
assert.equal(geofenceLoadResets(date,entries).length,3);
const pickup=(id:string,time:string,load=.25):TruckLoadEvent=>({eventId:id,date,truck:'Truck# 4',kind:'job_closeout',loadFraction:load,occurredAt:time,recordedAt:time,recordedBy:'test',appointmentId:id,jobNumber:id,loadSize:'1/4',loadQuantity:'1',contents:'',resetLocation:''});
const first=pickup('first','2026-09-06T15:00:00Z');
const later=pickup('later','2026-09-06T18:00:00Z');
const warehouse=entries.filter(entry=>entry.facility==='Junk King warehouse');
assert.equal(deriveTruckLoadStatus(date,'Truck 4',[first,...geofenceLoadResets(date,warehouse)]).currentLoadFraction,.25,'Warehouse entry retains the current load');
for(const facility of ['Gentilly Landfill','Stranco Transfer Station','EMR Metal Recycling']) {
  const resets=geofenceLoadResets(date,geofenceEntries(date,[row(facility),row(facility)]));
  assert.equal(resets.length,1);
  assert.equal(deriveTruckLoadStatus(date,'Truck 4',[first,...resets]).currentLoadFraction,0);
  assert.equal(deriveTruckLoadStatus(date,'Truck 4',[first,...resets,later]).currentLoadFraction,.25,'A later job starts a new load');
  assert.equal(deriveTruckLoadStatus(date,'Truck 4',[{...first,loadFraction:.5},...resets,later]).currentLoadFraction,.25,'A correction before entry cannot refill the truck');
}
const alert=geofenceOperationalAlert(warehouse[0],date);
assert.equal(alert.source,'LinxUp');
assert.equal(alert.facts.find(f=>f.label==='Truck load')?.value,'Unchanged');
assert.match(alert.href,/workspace=Fleet/);
const reviewed={entity:{id:alert.id},status:'acknowledged',version:1} as WorkItem;
assert.equal(commandAlertWorkItemForSource([reviewed],alert),reviewed,'Native source identity retains review state');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'geofence-alert-test-'));
process.env.OPSCENTER_DATA_DIR=root;
try {
  assert.equal(readGeofenceEntries(date).available,false);
  const dir=path.join(root,'history','linxup','alerts');fs.mkdirSync(dir,{recursive:true});
  const file=path.join(dir,`linxup_alerts_${date}.json`);
  fs.writeFileSync(file,JSON.stringify({date,alerts:[row('Warehouse')],pagination_completed:false,validation_status:'partial'}));
  assert.equal(readGeofenceEntries(date).entries.length,1,'Known events survive incomplete collection');
  assert.equal(readGeofenceEntries(date).complete,false);
  fs.writeFileSync(file,JSON.stringify({date,alerts:[],pagination_completed:true,validation_status:'passed'}));
  assert.equal(readGeofenceEntries(date).complete,true,'An empty complete collection differs from unavailable');
  fs.writeFileSync(file,JSON.stringify({date:'wrong',alerts:[row('Warehouse')]}));
  assert.equal(readGeofenceEntries(date).available,false);
} finally {fs.rmSync(root,{recursive:true,force:true});delete process.env.OPSCENTER_DATA_DIR;}
console.log('Geofence checks passed: native entries, dates, identity, retries, warehouse preservation, disposal resets, subsequent jobs, source coverage and review identity.');
