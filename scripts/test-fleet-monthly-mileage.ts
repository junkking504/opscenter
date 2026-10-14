import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { aggregateMonthlyMileage, mileageMonthWindow, sixMonthMileageAverage, type MileageArchive } from '../lib/fleet-monthly-mileage';
import { readMonthlyTruckMileage } from '../lib/fleet-monthly-mileage-source';

const now = new Date('2026-10-14T12:00:00Z');
const trip = (overrides = {}) => ({ personName: 'Truck #3', deviceUUID: 'device3', startDateTime: Date.parse('2026-09-01T14:00:00Z'), endDateTime: Date.parse('2026-09-01T15:00:00Z'), distanceMilesDetailed: 12.25, distanceMiles: 12, ...overrides });
const archive = (trips: unknown[], overrides = {}): MileageArchive => ({date:'2026-09-01',payload:{date:'2026-09-01',timezone:'America/Chicago',collection_timestamp:'2026-09-02T12:00:00Z',points:[{tracker_id:'device3',truck_number:'Truck 3'}],trips,...overrides}});
const calculate = (archives: MileageArchive[]) => aggregateMonthlyMileage('2026-09-15',['Truck 3','Truck 7'],archives,now);
assert.equal(calculate([])['Truck 3'].recordedMiles,null);
assert.equal(calculate([archive([])])['Truck 3'].recordedMiles,null,'empty day is not zero');
let row=calculate([archive([trip()])])['Truck 3'];
assert.equal(row.recordedMiles,12.25);assert.equal(row.expectedDays,30);assert.equal(row.tripDays,1);assert.equal(row.totalMiles,null);assert.equal(row.status,'partial');
assert.equal(calculate([archive([trip({distanceMilesDetailed:0})])])['Truck 3'].recordedMiles,0,'explicit trip zero retained');
for(const value of [null,undefined,'',false,'bad',-1,Infinity]) assert.equal(calculate([archive([trip({distanceMilesDetailed:value,distanceMiles:null})])])['Truck 3'].recordedMiles,null);
assert.equal(calculate([archive([trip({distanceMilesDetailed:null,distanceMiles:10})])])['Truck 3'].recordedMiles,10);
row=calculate([archive([trip({tripUUID:'a'}),trip({tripUUID:'b'})])])['Truck 3'];
assert.equal(row.recordedMiles,12.25);assert.equal(row.duplicateTrips,1);
assert.equal(calculate([archive([trip(),trip({startDateTime:Date.parse('2026-09-01T14:30:00Z')})])])['Truck 3'].recordedMiles,null,'overlapping observations cannot double count');
assert.equal(calculate([archive([trip(),trip({distanceMilesDetailed:22})])])['Truck 3'].recordedMiles,null,'conflicting duplicates rejected');
for(const changes of [{endDateTime:null},{startDateTime:1572109958000,endDateTime:null},{endDateTime:Date.parse('2026-09-02T06:00:00Z')},{distanceMilesDetailed:150},{personName:'Truck 7'}]) assert.equal(calculate([archive([trip(changes)])])['Truck 3'].recordedMiles,null);
assert.equal(calculate([archive([trip()],{timezone:'UTC'})])['Truck 3'].recordedMiles,null);
assert.equal(calculate([archive([trip()],{date:'2026-08-31'})])['Truck 3'].recordedMiles,null);
assert.equal(calculate([archive([trip({personName:'0'})])])['Truck 3'].recordedMiles,12.25,'same-file tracker mapping can resolve an absent label');
assert.equal(calculate([archive([trip()],{points:[{tracker_id:'device3',truck_number:'Truck 3'},{tracker_id:'device3',truck_number:'Truck 7'}]})])['Truck 3'].recordedMiles,null,'ambiguous tracker rejected');
assert.equal(calculate([archive([trip({startDateTime:Date.parse('2026-09-02T02:00:00Z'),endDateTime:Date.parse('2026-09-02T03:00:00Z')})])])['Truck 3'].recordedMiles,12.25,'Chicago date differs from UTC');
assert.equal(mileageMonthWindow('2026-10-01',now).dates.length,14);
assert.equal(mileageMonthWindow('2026-11-01',now).dates.length,0);
assert.equal(mileageMonthWindow('2028-02-10',new Date('2028-03-01T12:00:00Z')).dates.length,29);
assert.throws(()=>mileageMonthWindow('2026-02-30',now));
const months=['04','05','06','07','08','09'].map(month=>({...row,month:`2026-${month}`,totalMiles:null}));
assert.equal(sixMonthMileageAverage(months),null);
assert.equal(sixMonthMileageAverage(months.map(m=>({...m,totalMiles:60}))),60);
assert.equal(sixMonthMileageAverage(months.map(m=>({...m,month:'2026-09',totalMiles:60}))),null);
// Filesystem adapter: unreadable/missing sources, configured root, cache freshness.
const root=fs.mkdtempSync(path.join(os.tmpdir(),'monthly-mileage-')), prior=process.env.OPSCENTER_DATA_DIR;
try {
 process.env.OPSCENTER_DATA_DIR=root;
 const dir=path.join(root,'history','linxup');fs.mkdirSync(dir,{recursive:true});
 const file=path.join(dir,'linxup_location_2026-09-01.json');
 fs.writeFileSync(file,JSON.stringify(archive([trip()]).payload));
 assert.equal(readMonthlyTruckMileage('2026-09-01',['Truck 3'],now)['Truck 3'].recordedMiles,12.25);
 fs.writeFileSync(file,JSON.stringify(archive([trip({distanceMilesDetailed:20.1234})]).payload));
 assert.equal(readMonthlyTruckMileage('2026-09-01',['Truck 3'],now)['Truck 3'].recordedMiles,20.12);
 fs.writeFileSync(file,'broken');assert.equal(readMonthlyTruckMileage('2026-09-01',['Truck 3'],now)['Truck 3'].recordedMiles,null);
 fs.unlinkSync(file);
 const fallback=path.join(dir,'linxup_2026-09-01_raw.json');
 const saved={retrieved_at:'2026-09-02T12:00:00Z',window:{timezone:'America/Chicago',from_ms:Date.parse('2026-09-01T05:00:00Z'),to_ms:Date.parse('2026-09-02T04:59:59Z')},responses:{trips:{responseType:'Success',data:{trips:[trip()]}}}};
 fs.writeFileSync(fallback,JSON.stringify(saved));assert.equal(readMonthlyTruckMileage('2026-09-01',['Truck 3'],now)['Truck 3'].recordedMiles,12.25,'saved raw response recovers partial mileage without a provider call');
 saved.window.timezone='UTC';fs.writeFileSync(fallback,JSON.stringify(saved));assert.equal(readMonthlyTruckMileage('2026-09-01',['Truck 3'],now)['Truck 3'].recordedMiles,null,'raw window must verify Chicago day');

} finally {if(prior===undefined)delete process.env.OPSCENTER_DATA_DIR;else process.env.OPSCENTER_DATA_DIR=prior;fs.rmSync(root,{recursive:true,force:true});}
console.log('Monthly mileage: source, missing/zero, identity, duplicate, calendar, freshness and six-month checks passed.');
