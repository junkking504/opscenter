import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { cleanJunkwareAddressText } from '../lib/junkware-address-text';
import { mergeFastScheduleRows } from '../lib/desktop-schedule-source';
import { serviceTerritory } from '../lib/service-territory';
import { planningLocation } from '../lib/planning-geocodes';
import { reviewedAddressIdentity } from '../lib/reviewed-service-address';
import { researchKey } from '../lib/address-research';
import { addressQueries, verifyAddressResult, cachedAddressVerification, ADDRESS_VERIFICATION_POLICY } from '../lib/desktop-address-verification';
import { osmServiceAddressQuery } from '../lib/osm-service-address';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'address-source-test-'));
process.env.OPSCENTER_DATA_DIR = root;
process.env.SERVICE_ADDRESS_CACHE_DIR = path.join(root, 'verifications');
const address = '100 Example Dr. Mandeville, LA 70448';
const location = { latitude: 30.38, longitude: -90.07 };
const source = { appt_id: '123456', jk_number: 'JK_TEST', address, status: 'Confirmed' };
const component = (type: string, value: string) => ({ types: [type], long_name: value, short_name: value });
const payload = { status: 'OK', results: [{ address_components: [component('street_number', '100'), component('route', 'Example Drive'), component('locality', 'Mandeville'), component('postal_code', '70448'), component('administrative_area_level_1', 'LA'), component('country', 'US')], geometry: { location: { lat: location.latitude, lng: location.longitude }, location_type: 'ROOFTOP' } }] };
try {
  const reviewDir = path.join(root, 'cache/service-address-reviews');
  fs.mkdirSync(reviewDir, { recursive: true });
  const originalAddress = '100 Example Dr., Mandeville, 70448';
  fs.writeFileSync(path.join(reviewDir, createHash('sha256').update(reviewedAddressIdentity(originalAddress)).digest('hex') + '.json'), JSON.stringify({ schema: 1, status: 'verified', originalAddress, verifiedAddress: originalAddress, location, sources: ['https://example.org/premises'] }));
  for (const suffix of ['Followup', 'Followup SMS', 'SMS Followup', 'Follow-up SMS', 'Follow up', 'More Details', 'Driver Followup', 'Followup. SMS', 'Followup\nSMS']) {
    const dirty = `${address} ${suffix}`;
    assert.equal(cleanJunkwareAddressText(dirty), address);
    const [job] = mergeFastScheduleRows([], [{ ...source, address: dirty }], [], '2026-09-15');
    assert.equal(job.address, address, 'Every source sweep cleans the address, without changing JunkWare');
    assert.equal(job.appointmentId, source.appt_id);
    assert.equal(serviceTerritory(dirty).areaCode, 'MAN');
    assert.deepEqual(planningLocation(dirty, {}), location, 'Previously verified premises survive source control changes');
    assert.deepEqual(cachedAddressVerification(dirty)?.location, location);
    assert.equal(researchKey(job.address), researchKey(originalAddress), 'Source variants retain the lifetime research identity');
    assert.deepEqual(verifyAddressResult(dirty, payload).location, location);
    assert.deepEqual(addressQueries(dirty), addressQueries(address), 'No source controls reach the provider');
    assert.equal(osmServiceAddressQuery(dirty), osmServiceAddressQuery(address));
    assert.equal(cleanJunkwareAddressText(cleanJunkwareAddressText(dirty)), address);
  }
  const facility = 'Example Facility 100 Example Rd Bldg 1 Greenwell Springs, LA 70739';
  assert.equal(serviceTerritory(`${facility} Followup`).areaCode, 'GWS');
  assert.equal(cleanJunkwareAddressText(`${facility} Followup`), facility, 'Keep business labels and building instructions');
  assert.equal(cleanJunkwareAddressText(`${address}-1234 Followup SMS`), `${address}-1234`);
  assert.equal(verifyAddressResult(`${address.replace('100', '101')} Followup SMS`, payload).location, null);
  assert.equal(verifyAddressResult(`${address.replace('70448', '70447')} Followup SMS`, payload).location, null);
  for (const input of [`${address} SMS - use the other address`, `${address} Followup 200 Other Rd Mandeville LA 70448`, `${address} Apt 2`, '100 Followup Dr', '100 SMS Rd Mandeville LA', '100 Example Dr, Mandeville Followup']) {
    assert.equal(cleanJunkwareAddressText(input), input, 'Unknown suffixes and additional premises cannot be silently discarded');
  }
  assert.equal(verifyAddressResult(`${address} Followup 200 Other Rd Mandeville LA 70448`, payload).location, null);
  const cached = { normalized_address: facility, ...location, match_confidence: 'confirmed', house_street_verified: true, verification_policy: ADDRESS_VERIFICATION_POLICY };
  assert.deepEqual(planningLocation(`${facility} Followup`, { old: cached }), location, 'Geocode cache formatting variants also recover');
  assert.equal(planningLocation(`${facility} Followup`, { old: { ...cached, house_street_verified: false } }), null);
  fs.mkdirSync(process.env.SERVICE_ADDRESS_CACHE_DIR, { recursive: true });
  const failed = '100 Cache Rd Mandeville LA 70448';
  const file = path.join(process.env.SERVICE_ADDRESS_CACHE_DIR, createHash('sha256').update(failed).digest('hex') + '.json');
  fs.writeFileSync(file, JSON.stringify({ schema: ADDRESS_VERIFICATION_POLICY - 1, address: failed, expires: Date.now() + 300_000, verified: { location: null, reason: 'Address Needs Review' } }));
  assert.equal(cachedAddressVerification(failed), undefined, 'Failures from the prior parser are eligible immediately');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
console.log('Address source regressions passed: repeated sweeps, UI controls, preserved premises, shared caches, research identity, provider queries and stale-failure recovery.');
