import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { reviewedServiceAddress, reviewedAddressIdentity } from '../lib/reviewed-service-address';
import { planningLocation } from '../lib/planning-geocodes';
import {cachedAddressVerification} from '../lib/desktop-address-verification';
const root = fs.mkdtempSync(path.join(os.tmpdir(),'address-review-test-'));
const prior = process.env.OPSCENTER_DATA_DIR;
process.env.OPSCENTER_DATA_DIR = root;
try {
  const address = '100 Example St, New Orleans, LA 70125';
  const dir = path.join(root,'cache/service-address-reviews'); fs.mkdirSync(dir,{recursive:true});
  const file = path.join(dir,createHash('sha256').update(reviewedAddressIdentity(address)).digest('hex')+'.json');
  const row = {schema:1,status:'verified',originalAddress:address,verifiedAddress:address,location:{latitude:29.95,longitude:-90.1},sources:['https://example.org/verified-property']};
  fs.writeFileSync(file,JSON.stringify(row));
  assert.equal(cachedAddressVerification(address)?.matchedAddress,row.verifiedAddress,'Reviewed spelling reaches the same display field as provider corrections');
  assert.deepEqual(reviewedServiceAddress('100 Example St New Orleans 70125')?.location,row.location);
  assert.deepEqual(reviewedServiceAddress('Example Business 100 Example St New Orleans LA 70125')?.location,row.location);
  assert.equal(reviewedServiceAddress('101 Example St New Orleans 70125'),undefined);
  assert.deepEqual(planningLocation(address,{old:{normalized_address:address,match_confidence:'confirmed',house_street_verified:true,latitude:30.1,longitude:-90.2}}),row.location,'Recorded correction takes precedence over stale cache');
  assert.equal(reviewedServiceAddress('100 Example St B115 New Orleans LA 70125'),undefined,'Legacy records cannot be reused for a different unit scope');
  fs.writeFileSync(file,JSON.stringify({...row,scope:'premises'}));
  for (const unit of ['B115','Apt B115','Unit B210']) assert.deepEqual(reviewedServiceAddress(`100 Example St ${unit} New Orleans LA 70125`)?.location,row.location,'Explicit property evidence can serve its source units');
  for (const other of ['100 E Example St B115 New Orleans LA 70125','101 Example St B115 New Orleans LA 70125','100 Example St B115 Other City LA 70125','100 Example St B115 New Orleans LA 70124']) assert.equal(reviewedServiceAddress(other),undefined,'Property scope never changes premises identity');
  const exact='100 Example St B115 New Orleans LA 70125';
  const exactFile=path.join(dir,createHash('sha256').update(reviewedAddressIdentity(exact)).digest('hex')+'.json');
  fs.writeFileSync(exactFile,JSON.stringify({...row,originalAddress:exact,location:{latitude:29.951,longitude:-90.101}}));
  assert.equal(reviewedServiceAddress(exact)?.location.latitude,29.951,'More specific unit evidence takes precedence');
  fs.writeFileSync(exactFile,'{');
  assert.equal(reviewedServiceAddress(exact),undefined,'Damaged specific evidence cannot be hidden by a property fallback');
  for (const bad of [{...row,status:'pending'},{...row,sources:[]},{...row,location:{latitude:40,longitude:-80}},{...row,originalAddress:'101 Example St New Orleans 70125'}]) {
    fs.writeFileSync(file,JSON.stringify(bad));assert.equal(reviewedServiceAddress(address),undefined);
  }
} finally { fs.rmSync(root,{recursive:true,force:true}); if(prior===undefined) delete process.env.OPSCENTER_DATA_DIR;else process.env.OPSCENTER_DATA_DIR=prior; }
console.log('Reviewed addresses: exact identity, source evidence, valid area and precedence passed.');
