import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { geocodioAddressJson } from '../lib/geocodio-free-transport';
import { geocodioAddressQuery, verifyGeocodioAddress } from '../lib/geocodio-service-address';
import { verifyDesktopAddress } from '../lib/desktop-address-verification';

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'geocodio-free-test-'));
  const originalFetch = globalThis.fetch, originalNow = Date.now;
  const originalConfig = process.env.GEOCODIO_FREE_CONFIG_FILE, originalState = process.env.GEOCODIO_FREE_STATE_FILE;
  const originalData = process.env.OPSBOT_DATA_DIR, originalCache = process.env.SERVICE_ADDRESS_CACHE_DIR;
  let now = 1_800_000_000_000, calls = 0;
  Date.now = () => now;
  const configFile = path.join(root, 'config.json'), ledgerFile = path.join(root, 'ledger.json');
  process.env.GEOCODIO_FREE_CONFIG_FILE = configFile;
  process.env.GEOCODIO_FREE_STATE_FILE = ledgerFile;
  process.env.OPSBOT_DATA_DIR = root;
  process.env.SERVICE_ADDRESS_CACHE_DIR = path.join(root, 'verification-cache');
  const address = '100 Example Loop, Madisonville, 70447';
  const row = { address_components: { number: '100', formatted_street: 'Example Lp', city: 'Madisonville',
    state_province: 'LA', postal_code: '70447', country: 'US' },
    location: { lat: 30.4, lng: -90.2 }, accuracy: 1, accuracy_type: 'rooftop', match_type: 'building_centroid' };
  const payload = { results: [row] };
  const config = { schema: 1, enabled: true, provider: 'geocodio', maxSpendMicros: 0,
    maxRequests: 2, noPaymentMethod: true, verifiedAt: new Date(now - 1000).toISOString(),
    validUntil: new Date(now + 30 * 86_400_000).toISOString(), apiKey: 'synthetic-test-key' };
  const writeConfig = (change = {}) => fs.writeFileSync(configFile, JSON.stringify({ ...config, ...change }));
  const empty = () => fs.writeFileSync(ledgerFile, JSON.stringify({ schema: 1, lastAt: 0, attempts: [], blockedUntil: 0, cache: {} }));
  const read = () => JSON.parse(fs.readFileSync(ledgerFile, 'utf8'));
  const request = (identity = 'example') => geocodioAddressJson(address, identity, 8000);
  globalThis.fetch = async (input, init) => {
    calls++;
    const url = new URL(String(input));
    assert.equal(url.origin, 'https://api.geocod.io'); assert.equal(url.pathname, '/v2/geocode');
    assert.deepEqual([...url.searchParams.keys()].sort(), ['country', 'q']);
    assert.equal(new Headers(init?.headers).get('Authorization'), 'Bearer synthetic-test-key');
    assert.equal(init?.redirect, 'error');
    assert.equal(read().attempts.length, calls, 'Reservation precedes every network request');
    return new Response(JSON.stringify(payload));
  };
  try {
    assert.ok(verifyGeocodioAddress(address, payload).location);
    assert.match(verifyGeocodioAddress(address.replace('Loop', 'Loop Apt 4'), payload).reason, /Unit Entrance Not Located/);
    assert.equal(verifyGeocodioAddress(address.replace('Loop', 'Loop Bldg 4'), payload).location, null);
    for (const accuracy_type of ['nearest_rooftop_match', 'range_interpolation', 'point', 'street_center', 'place']) {
      assert.equal(verifyGeocodioAddress(address, { results: [{ ...row, accuracy_type }] }).location, null);
    }
    for (const change of [{ accuracy: 0.99 }, { location: { lat: 0, lng: 0 } }, { match_type: 'unit' }]) {
      assert.equal(verifyGeocodioAddress(address, { results: [{ ...row, ...change }] }).location, null);
    }
    for (const change of [{ number: '101' }, { formatted_street: 'Example Lane' }, { city: 'Covington' },
      { postal_code: '70448' }, { state_province: 'TX' }, { country: 'CA' }, { unit_number: '5' }]) {
      assert.equal(verifyGeocodioAddress(address, { results: [{ ...row, address_components: { ...row.address_components, ...change } }] }).location, null);
    }
    assert.equal(verifyGeocodioAddress(address, { results: [row, row] }).location, null);
    assert.equal(geocodioAddressQuery('100 Example Loop or 200 Other St, Madisonville, 70447'), null);
    assert.equal(geocodioAddressQuery('Business Name, 100 Example Loop Apt 4, Madisonville, 70447'), '100 Example Loop Madisonville, LA 70447');
    assert.equal(await request(), null); assert.equal(calls, 0);
    for (const change of [{ noPaymentMethod: false }, { maxSpendMicros: 1 }, { maxRequests: 2501 }, { enabled: false }, { validUntil: new Date(now - 1).toISOString() }]) {
      writeConfig(change); assert.equal(await request(), null); assert.equal(calls, 0);
    }
    writeConfig();
    assert.match((await request())!.reason!, /History/); assert.equal(calls, 0, 'Missing history fails closed');
    fs.writeFileSync(ledgerFile, '{broken'); assert.match((await request())!.reason!, /History/); assert.equal(calls, 0);
    empty();
    const parallel = await Promise.all([request(), request()]);
    assert.ok(parallel[0]?.payload); assert.match(parallel[1]!.reason!, /Guard/); assert.equal(calls, 1);
    assert.ok((await request())?.payload); assert.equal(calls, 1, 'Cached evidence avoids repeat request');
    now += 11_000;
    await request('second'); assert.equal(calls, 2);
    now += 11_000;
    assert.match((await request('third'))!.reason!, /Limit/); assert.equal(calls, 2);
    now += 25 * 60 * 60_000;
    globalThis.fetch = async () => { calls++; throw new Error('Synthetic timeout'); };
    assert.match((await request('after-window'))!.reason!, /Temporarily/);
    assert.equal(read().attempts.length, 1, 'Failure remains reserved after rolling-window reset');
    now += 11_000;
    globalThis.fetch = async () => { calls++; return new Response('', { status: 429 }); };
    await request('quota'); const before = calls;
    assert.ok(read().blockedUntil > now);
    now += 11_000;
    assert.match((await request('paused'))!.reason!, /Paused/); assert.equal(calls, before);
    fs.writeFileSync(`${ledgerFile}.lock`, '');
    assert.match((await request('locked'))!.reason!, /Guard/); assert.equal(calls, before);
    fs.unlinkSync(`${ledgerFile}.lock`);
    now -= 60_000;
    assert.match((await request('clock-backwards'))!.reason!, /History/); assert.equal(calls, before);
    // Exercise the actual pipeline: unresolved/ambiguous free results must
    // reach Geocodio, but a successful Census result must not consume it.
    empty(); now = 1_800_000_000_000;
    let geocodioCalls = 0;
    globalThis.fetch = async input => {
      const url = new URL(String(input));
      if (url.hostname === 'api.geocod.io') { geocodioCalls++; return new Response(JSON.stringify(payload)); }
      assert.equal(url.hostname, 'geocoding.geo.census.gov');
      return new Response(JSON.stringify({ result: { addressMatches: [
        { matchedAddress: '100 OTHER ST, MADISONVILLE, LA, 70447', coordinates: { x: -90.2, y: 30.4 } },
        { matchedAddress: '101 OTHER ST, MADISONVILLE, LA, 70447', coordinates: { x: -90.3, y: 30.4 } },
      ] } }));
    };
    assert.ok((await verifyDesktopAddress(address)).location); assert.equal(geocodioCalls, 1);
    assert.ok((await verifyDesktopAddress(address)).location); assert.equal(geocodioCalls, 1);
    globalThis.fetch = async input => {
      const url = new URL(String(input)); assert.equal(url.hostname, 'geocoding.geo.census.gov');
      return new Response(JSON.stringify({ result: { addressMatches: [{ matchedAddress: '200 EXAMPLE LOOP, MADISONVILLE, LA, 70447',
        addressComponents: { city: 'MADISONVILLE', state: 'LA', zip: '70447' }, coordinates: { x: -90.2, y: 30.4 } }] } }));
    };
    assert.ok((await verifyDesktopAddress(address.replace('100', '200'))).location); assert.equal(geocodioCalls, 1);
    console.log('Geocodio: exact premises only, privacy, free-only configuration, cache, concurrency, durable reservation, caps, errors and corrupt-history denial passed. No live provider requests.');
  } finally {
    globalThis.fetch = originalFetch; Date.now = originalNow;
    if (originalConfig === undefined) delete process.env.GEOCODIO_FREE_CONFIG_FILE; else process.env.GEOCODIO_FREE_CONFIG_FILE = originalConfig;
    if (originalState === undefined) delete process.env.GEOCODIO_FREE_STATE_FILE; else process.env.GEOCODIO_FREE_STATE_FILE = originalState;
    if (originalData === undefined) delete process.env.OPSBOT_DATA_DIR; else process.env.OPSBOT_DATA_DIR = originalData;
    if (originalCache === undefined) delete process.env.SERVICE_ADDRESS_CACHE_DIR; else process.env.SERVICE_ADDRESS_CACHE_DIR = originalCache;
    fs.rmSync(root, { recursive: true, force: true });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
