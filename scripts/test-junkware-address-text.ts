import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { cleanJunkwareAddressText, cleanServiceAddressForVerification } from '../lib/junkware-address-text';
import { mergeFastScheduleRows } from '../lib/desktop-schedule-source';
import { serviceTerritory } from '../lib/service-territory';
import { planningLocation } from '../lib/planning-geocodes';
import { reviewedAddressIdentity } from '../lib/reviewed-service-address';
import { researchKey } from '../lib/address-research';
import { addressQueries, verifyAddressResult, cachedAddressVerification, ADDRESS_VERIFICATION_POLICY } from '../lib/desktop-address-verification';
import { osmServiceAddressQuery } from '../lib/osm-service-address';
import { parishAddressQuery, verifyParishAddress } from '../lib/parish-service-address';
import { cleanServiceQuery } from '../lib/service-address-format';
import { geocodioAddressQuery, verifyGeocodioAddress } from '../lib/geocodio-service-address';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'address-source-test-'));
process.env.OPSCENTER_DATA_DIR = root;
process.env.OPSBOT_DATA_DIR = root;
process.env.SERVICE_ADDRESS_CACHE_DIR = path.join(root, 'verifications');
const address = '100 Example Dr. Mandeville, LA 70448';
const location = { latitude: 30.38, longitude: -90.07 };
const source = { appt_id: '123456', jk_number: 'JK_TEST', address, status: 'Confirmed' };
const component = (type: string, value: string) => ({ types: [type], long_name: value, short_name: value });
const payload = { status: 'OK', results: [{ address_components: [component('street_number', '100'), component('route', 'Example Drive'), component('locality', 'Mandeville'), component('postal_code', '70448'), component('administrative_area_level_1', 'LA'), component('country', 'US')], geometry: { location: { lat: location.latitude, lng: location.longitude }, location_type: 'ROOFTOP' } }] };
try {
  const canonical = '100 Example Ave, Baton Rouge, LA 70817';
  const parishPoint = { latitude: 30.4, longitude: -91.1 };
  const parishPayload = { spatialReference: { wkid: 4326 }, features: [{
    attributes: { FULL_ADDRESS: '100 EXAMPLE AVE', CITY: 'BATON ROUGE', STATE: 'LA', ZIP: 70817, ADDRESS_AUTHORITY: 'SAINT GEORGE', ADDRESS_ID: 1 },
    geometry: { x: parishPoint.longitude, y: parishPoint.latitude },
  }] };
  const providerPayload = { results: [{ address_components: { number: '100', formatted_street: 'Example Ave', city: 'Baton Rouge',
    postal_code: '70817', state_province: 'LA', country: 'US' }, location: { lat: 30.4, lng: -91.1 }, accuracy: 1, accuracy_type: 'rooftop' }] };
  for (const dirty of [
    '100 Example Ave, Baton Rouge, La Baton Rouge, LA 70817',
    '100 Example Ave, Baton Rouge, La, Baton Rouge, 70817',
    '100 EXAMPLE AVE BATON ROUGE LA BATON ROUGE 70817',
    '100 Example Ave Baton Rouge Louisiana Baton Rouge LA 70817',
    '100 Example Ave, Baton Rouge, LA 70817 Baton Rouge, Louisiana 70817',
    '100 Example Ave, Baton Rouge, LA 70817-1234 Baton Rouge, LA 70817-1234',
    '100 Example Ave Apt #2 Baton Rouge LA Baton Rouge LA 70817',
    'Example Facility, 100 Example Ave, Baton Rouge, La Baton Rouge, LA 70817 Followup SMS',
  ]) {
    const cleaned = cleanServiceAddressForVerification(dirty);
    assert.notEqual(cleaned, dirty, 'Duplicate complete locality is removed');
    assert.equal(cleanServiceAddressForVerification(cleaned), cleaned, 'Locality cleanup is idempotent');
    assert.equal(parishAddressQuery(dirty)?.expected, '100 EXAMPLE AVE');
    assert.deepEqual(verifyParishAddress(dirty, parishPayload).location, parishPoint, 'Existing parish evidence verifies the complete premises');
    assert.deepEqual(verifyGeocodioAddress(dirty, providerPayload).location, parishPoint, 'Returned provider components use the same correction');
    assert.equal(geocodioAddressQuery(dirty), geocodioAddressQuery(cleaned));
    assert.equal(osmServiceAddressQuery(dirty), osmServiceAddressQuery(cleaned));
    assert.equal(cleanServiceQuery(dirty), cleanServiceQuery(cleaned));
    const [job] = mergeFastScheduleRows([], [{ ...source, address: dirty }], [], '2026-09-28');
    assert.equal(job.address, cleanJunkwareAddressText(dirty), 'Schedule retains source address and instructions');
    if (dirty.includes('Apt #2')) assert.ok(cleaned.includes('Apt #2'), 'Source unit survives cleanup');
  }
  assert.equal(cleanServiceAddressForVerification('100 Example Ave, Baton Rouge, La Baton Rouge, LA 70817'), canonical);
  for (const dirty of [
    '100 Example Ave, Baton Rouge, LA Zachary, LA 70817',
    '100 Example Ave, Baton Rouge, MS Baton Rouge, LA 70817',
    '100 Example Ave, Baton Rouge, LA Baton Rouge, MS 70817',
    '100 Example Ave, Baton Rouge, LA 70816 Baton Rouge, LA 70817',
    '100 Example Ave, Baton Rouge, LA 70817-1234 Baton Rouge, LA 70817-5678',
    '100 Example Ave North Baton Rouge LA Baton Rouge LA 70817',
    '100 Example Ave, Baton Rouge, LA or Baton Rouge, LA 70817',
    '100 Example Ave, Baton Rouge, LA Apt 2 Baton Rouge, LA 70817',
  ]) {
    assert.equal(cleanServiceAddressForVerification(dirty), dirty, 'Conflicting or qualified localities cannot be erased');
    assert.equal(verifyParishAddress(dirty, parishPayload).location, null);
    assert.equal(verifyGeocodioAddress(dirty, providerPayload).location, null);
  }
  const duplicate = '100 Example Ave, Baton Rouge, La Baton Rouge, LA 70817';
  assert.equal(researchKey(duplicate), createHash('sha256').update('100 EXAMPLE AVE BATON ROUGE LA BATON ROUGE 70817').digest('hex'), 'Existing lifetime research keys cannot reset after verification cleanup');
  for (const dirty of [duplicate.replace('100 ', '101 '), duplicate.replace('Example', 'Other'),
    duplicate.replace('Example', 'N Example'), duplicate.replace('70817', '70816'),
    `200 Other Rd Baton Rouge LA 70817 or ${duplicate}`, duplicate.replace('Ave,', 'Ave Bldg 2,')]) {
    assert.equal(verifyParishAddress(dirty, parishPayload).location, null, 'Correcting locality never weakens house, street, ZIP, building or multiple-address checks');
  }
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
