import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { reviewedServiceAddress, reviewedAddressIdentity } from '../lib/reviewed-service-address';
import { planningLocation } from '../lib/planning-geocodes';
const root = fs.mkdtempSync(path.join(os.tmpdir(),'address-review-test-'));
const prior = process.env.OPSCENTER_DATA_DIR;
process.env.OPSCENTER_DATA_DIR = root;
try {
  const address = '100 Example St, New Orleans, LA 70125';
  const dir = path.join(root,'cache/service-address-reviews'); fs.mkdirSync(dir,{recursive:true});
  const file = path.join(dir,createHash('sha256').update(reviewedAddressIdentity(address)).digest('hex')+'.json');
  const row = {schema:1,status:'verified',originalAddress:address,verifiedAddress:address,location:{latitude:29.95,longitude:-90.1},sources:['https://example.org/verified-property']};
  fs.writeFileSync(file,JSON.stringify(row));
  assert.deepEqual(reviewedServiceAddress('100 Example St New Orleans 70125')?.location,row.location);
  assert.equal(reviewedServiceAddress('101 Example St New Orleans 70125'),undefined);
  assert.deepEqual(planningLocation(address,{old:{normalized_address:address,match_confidence:'confirmed',house_street_verified:true,latitude:30.1,longitude:-90.2}}),row.location,'Recorded correction takes precedence over stale cache');
  for (const bad of [{...row,status:'pending'},{...row,sources:[]},{...row,location:{latitude:40,longitude:-80}},{...row,originalAddress:'101 Example St New Orleans 70125'}]) {
    fs.writeFileSync(file,JSON.stringify(bad));assert.equal(reviewedServiceAddress(address),undefined);
  }
} finally { fs.rmSync(root,{recursive:true,force:true}); if(prior===undefined) delete process.env.OPSCENTER_DATA_DIR;else process.env.OPSCENTER_DATA_DIR=prior; }
console.log('Reviewed addresses: exact identity, source evidence, valid area and precedence passed.');
