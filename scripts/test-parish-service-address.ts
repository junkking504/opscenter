import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parishAddressQuery, verifyParishAddress, verifyParishAddressFallback } from '../lib/parish-service-address';
import { verifyDesktopAddress } from '../lib/desktop-address-verification';

const address = '100 Example Hwy Apt 4 Baton Rouge, LA 70816';
const feature = (street = '100 EXAMPLE HWY', id = 1, x = -91.1) => ({
  attributes: { ID: id, ADDRESS_ID: id, FULL_ADDRESS: street, CITY: 'BATON ROUGE', STATE: 'LA', ZIP: 70816, ADDRESS_AUTHORITY: 'PARISH' },
  geometry: { x, y: 30.4 },
});
const payload = (...features: ReturnType<typeof feature>[]) => ({ spatialReference: { wkid: 4326 }, features });
assert.ok(verifyParishAddress(address, payload(feature('100 EXAMPLE HWY, BLDG 4', 2), feature())).location,
  'Apt 4 uses the official base point, never the separately numbered building 4');
assert.equal(verifyParishAddress(address, payload(feature('100 EXAMPLE HWY, BLDG 4'))).location, null);
assert.ok(verifyParishAddress(address.replace('Apt 4', 'Bldg 4'), payload(feature('100 EXAMPLE HWY, BLDG 4'))).location);
assert.equal(verifyParishAddress(address.replace('Apt 4', 'Bldg 4'), payload(feature())).location, null);
assert.ok(verifyParishAddress(address, payload(feature(), feature())).location, 'Identical rows share one authoritative address point');
assert.ok(verifyParishAddress(address.replace('LA ', ''), payload(feature())).location, 'JunkWare may omit the separate Louisiana state field');
for (const authority of ['PARISH', 'BATON ROUGE', 'SAINT GEORGE', 'BAKER', 'CENTRAL', 'ZACHARY']) {
  const row = feature(); row.attributes.ADDRESS_AUTHORITY = authority;
  assert.ok(verifyParishAddress(address, payload(row)).location, 'Official municipal address points are valid parish dataset evidence');
}
assert.equal(verifyParishAddress(address, payload(feature(), feature('100 EXAMPLE HWY', 2))).location, null);
assert.equal(verifyParishAddress(address, payload(feature(), feature('100 EXAMPLE HWY', 1, -91.11))).location, null);
for (const source of [address.replace('100 ', '100 1/2 '), address.replace('100 ', '98-100 '), address.replace('100 ', '100AB '),
  address.replace('LA', 'MS'), address.replace('Baton Rouge', 'New Orleans'), address + ' or 200 Other St Baton Rouge LA 70816']) {
  assert.equal(parishAddressQuery(source), null, source);
}
for (const source of [address.replace('100', '101'), address.replace('Example', 'Other'), address.replace('Hwy', 'N Hwy'),
  address.replace('70816', '70808'), address.replace('Baton Rouge', 'Zachary')]) {
  assert.equal(verifyParishAddress(source, payload(feature())).location, null, source);
}
for (const attributes of [{ CITY: 'OTHER CITY' }, { ZIP: 70808 }, { STATE: 'MS' }, { ADDRESS_AUTHORITY: 'UNKNOWN' }, { ADDRESS_ID: null }]) {
  const row = feature(); Object.assign(row.attributes, attributes);
  assert.equal(verifyParishAddress(address, payload(row)).location, null);
}
for (const geometry of [{ x: 0, y: 0 }, { x: NaN, y: 30.4 }, { x: -91.1, y: Infinity }]) {
  const row = feature(); row.geometry = geometry;
  assert.equal(verifyParishAddress(address, payload(row)).location, null);
}
assert.equal(verifyParishAddress(address, { ...payload(feature()), exceededTransferLimit: true }).location, null);
assert.equal(verifyParishAddress(address, { ...payload(feature()), spatialReference: { wkid: 3857 } }).location, null);
assert.equal(verifyParishAddress(address, { error: 'unavailable' }).location, null);
// Possessive punctuation varies between source and authoritative providers.
for (const spelling of ["SETTLER'S", 'SETTLER’S', 'SETTLER‘S', 'SETTLERʼS', 'SETTLERS']) {
  const row = feature(`7939 ${spelling} CIR`); row.attributes.ZIP = 70810;
  assert.ok(verifyParishAddress('7939 Settlers Cir BATON ROUGE, LA 70810', payload(row)).location);
  for (const wrong of ['7938 Settlers Cir BATON ROUGE, LA 70810', '7939 Settlers Cir BATON ROUGE, LA 70809',
    '7939 N Settlers Cir BATON ROUGE, LA 70810', '7939 Settler Cir BATON ROUGE, LA 70810']) {
    assert.equal(verifyParishAddress(wrong, payload(row)).location, null, wrong);
  }
}


const northshoreAddress = '100 Example Blvd, Slidell, La SLIDELL, LA 70461';
const northshoreRow = { attributes: { OBJECTID: 7, ADDRESS: '100 EXAMPLE BLVD', CITY_L: 'SLIDELL', ZIP_CODE: 70461 }, geometry: { x: -89.76, y: 30.22 } };
const northshorePayload = { spatialReference: { wkid: 4326 }, features: [northshoreRow] };
assert.ok(verifyParishAddress(northshoreAddress, northshorePayload).location);
assert.match(parishAddressQuery(northshoreAddress)!.url, /maps.stpgov.org/);
for (const bad of [northshoreAddress.replace('100', '101'), northshoreAddress.replace('Example', 'Other'), northshoreAddress.replace('Blvd', 'N Blvd'), northshoreAddress.replace('70461', '70458'), northshoreAddress.replaceAll('Slidell', 'Mandeville').replace('SLIDELL', 'MANDEVILLE'), northshoreAddress.replace('Blvd,', 'Blvd Building 4,')]) {
  assert.equal(verifyParishAddress(bad, northshorePayload).location, null, bad);
}
for (const patch of [{ attributes: { ...northshoreRow.attributes, CITY_L: 'MANDEVILLE' } }, { attributes: { ...northshoreRow.attributes, ZIP_CODE: 70458 } }, { attributes: { ...northshoreRow.attributes, OBJECTID: null } }, { geometry: { x: 0, y: 0 } }]) {
  assert.equal(verifyParishAddress(northshoreAddress, { ...northshorePayload, features: [{ ...northshoreRow, ...patch }] }).location, null);
}
assert.equal(verifyParishAddress(northshoreAddress, { ...northshorePayload, exceededTransferLimit: true }).location, null);
assert.equal(verifyParishAddress(northshoreAddress, { ...northshorePayload, features: [northshoreRow, { ...northshoreRow, geometry: { x: -89.761, y: 30.22 } }] }).location, null);

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'parish-address-test-'));
  const previous = { root: process.env.OPSBOT_DATA_DIR, cache: process.env.SERVICE_ADDRESS_CACHE_DIR, fetch: globalThis.fetch, now: Date.now };
  let now = 1_800_000_000_000, calls = 0;
  try {
    process.env.OPSBOT_DATA_DIR = root; process.env.SERVICE_ADDRESS_CACHE_DIR = path.join(root, 'verifications');
    Date.now = () => now;
    globalThis.fetch = async (input, options) => {
      calls++; assert.match(String(input), /maps\.brla\.gov/); assert.equal(options?.redirect, 'error');
      return new Response(JSON.stringify(payload(feature(), feature('100 EXAMPLE HWY, BLDG 4', 2))));
    };
    const competing = await Promise.all([verifyParishAddressFallback(address), verifyParishAddressFallback(address.replace('100', '200'))]);
    assert.equal(calls, 1, 'Global reservation bounds competing lookups');
    assert.ok(competing[0].location); assert.ok(competing[1].retryAfterMs);
    assert.ok((await verifyParishAddressFallback(address.replace('Apt 4', 'Apt 8'))).location, 'Unit variants reuse base query cache');
    assert.equal(calls, 1);
    const recovered = await verifyDesktopAddress(address.replace('LA ', ''));
    assert.ok(recovered.location); assert.equal(recovered.source, 'East Baton Rouge Parish GIS'); assert.equal(calls, 1);
    now += 60_000;
    globalThis.fetch = async () => { calls++; return new Response('down', { status: 503 }); };
    assert.equal((await verifyParishAddressFallback(address.replace('100', '300'))).retryAfterMs, 60_000);
    assert.equal((await verifyParishAddressFallback(address.replace('100', '300'))).retryAfterMs, 60_000);
    assert.equal(calls, 2, 'Outage persists across calls');
    now += 60_000;
    globalThis.fetch = async () => { calls++; return new Response(JSON.stringify(payload(feature('300 EXAMPLE HWY')))); };
    assert.ok((await verifyParishAddressFallback(address.replace('100', '300'))).location);
    assert.equal(calls, 3, 'One-minute outage recovery');
    console.log('Parish address checks passed: exact identity, base versus building, conflicts, bounded shared requests, cache, outage recovery and automatic verifier. Synthetic providers only.');
  } finally {
    globalThis.fetch = previous.fetch; Date.now = previous.now;
    for (const [key, value] of Object.entries({ OPSBOT_DATA_DIR: previous.root, SERVICE_ADDRESS_CACHE_DIR: previous.cache })) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    fs.rmSync(root, { recursive: true, force: true });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
