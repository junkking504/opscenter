import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { specOpsConditions, outageIsStale, stormIsStale, stormCategory } from '../desktop-ui/lib/specops-conditions';
import { readSpecOpsConditions } from '../lib/specops-conditions';
// Source links are the same explicit links already included in the authored model.
const html = fs.readFileSync('desktop-ui/specops-model.html','utf8');
const nhc = html.match(/href="([^"]*nhc.noaa.gov[^\"]*)"/)![1];
const outageSource = fs.readFileSync('docs/specops.md','utf8').match(/\(([^)]*poweroutage.us\/area\/regions\/[^)]*)\)/)![1];
const now = Date.parse('2026-01-01T12:00:00Z');
const outage = { checkedAt: '2026-01-01T12:00:00Z', sourceAgeMinutes: 5, sourceUrl: outageSource, customersOut: 15, customersTracked: 100, states: ['Alabama','Florida','Georgia','North Carolina','South Carolina'].map((name,index)=>({name, customersOut:index+1})) };
const storm = { checkedAt: outage.checkedAt, observedAt: '2026-01-01T11:30:00Z', sourceUrl: nhc, name: 'Test Storm', lat:29.5, lon:-86.9, windMph:115, heading:10, speedMph:17, pressureMb:958 };
const input = { schema:1, outage, storm };
assert.deepEqual(specOpsConditions(input, now), input);
assert.equal(specOpsConditions({...input,outage:{...outage,customersOut:14}},now).outage,null);
assert.equal(specOpsConditions({...input,outage:{...outage,states:outage.states.slice(1)}},now).outage,null);
assert.equal(specOpsConditions({...input,outage:{...outage,states:outage.states.map(()=>outage.states[0])}},now).outage,null);
assert.equal(specOpsConditions({...input,outage:{...outage,customersOut:null}},now).outage,null);
assert.equal(specOpsConditions({...input,outage:{...outage,sourceUrl:'javascript:alert(1)'}},now).outage,null);
assert.equal(specOpsConditions({...input,storm:{...storm,lat:NaN}},now).storm,null);
assert.equal(specOpsConditions({...input,storm:{...storm,checkedAt:'2026-01-02T00:00:00Z'}},now).storm,null);
assert.equal(specOpsConditions({...input,storm:{...storm,observedAt:'2026-01-01T12:01:00Z'}},now).storm,null);
assert.deepEqual(specOpsConditions({schema:3},now),{schema:1,outage:null,storm:null});
assert.equal(specOpsConditions({...input,outage:{...outage,customersOut:0,states:outage.states.map(s=>({...s,customersOut:0}))}},now).outage?.customersOut,0);
assert.equal(outageIsStale(outage,now+24*60000),false);
assert.equal(outageIsStale(outage,now+25*60000),true);
assert.equal(stormIsStale(storm,now+59*60000),false);
assert.equal(stormIsStale(storm,now+60*60000),true);
assert.deepEqual([73,74,95,96,110,111,129,130,156,157].map(stormCategory),[0,1,1,2,2,3,3,4,4,5]);
const temporary = fs.mkdtempSync(path.join(os.tmpdir(),'specops-test-'));
try {
 const file=path.join(temporary,'conditions.json');
 assert.equal(readSpecOpsConditions(file,now).outage,null);
 fs.writeFileSync(file,'malformed');assert.equal(readSpecOpsConditions(file,now).storm,null);
 fs.writeFileSync(file,JSON.stringify(input));assert.deepEqual(readSpecOpsConditions(file,now),input);
 fs.writeFileSync(file,' '.repeat(32001));assert.equal(readSpecOpsConditions(file,now).outage,null);
} finally {fs.rmSync(temporary,{recursive:true});}
console.log('SpecOps observation validation, reconciliation, freshness, category boundaries and missing-file behavior passed.');
