import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { ADDRESS_VERIFICATION_POLICY } from '../lib/desktop-address-verification';

async function main() {
  if (process.argv[2] === '--child') {
    const root = process.argv[3];
    Date.now = () => 1_800_000_000_000;
    let calls = 0;
    globalThis.fetch = async input => {
      assert.match(String(input), /maps\.brla\.gov/, 'No paid request or browser needed even at the shared 500-call cap');
      calls++;
      return new Response(JSON.stringify({ spatialReference: { wkid: 4326 }, features: [{
        attributes: { ID: 1, ADDRESS_ID: 1, FULL_ADDRESS: '100 EXAMPLE HWY', CITY: 'BATON ROUGE', STATE: 'LA', ZIP: 70816, ADDRESS_AUTHORITY: 'PARISH' },
        geometry: { x: -91.1, y: 30.4 },
      }] }));
    };
    process.on('exit', () => fs.writeFileSync(path.join(root, 'calls.json'), JSON.stringify(calls)));
    process.argv = ['node', 'refresh-schedule-map-inputs.ts', '2026-09-21'];
    await import('./refresh-schedule-map-inputs');
    return;
  }
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'parish-preflight-test-'));
  try {
    const history = path.join(root, 'history/junkware'); fs.mkdirSync(history, { recursive: true });
    // The target day has no rows: tomorrow must be discovered from collected
    // source files, not from a browser selecting that date.
    fs.writeFileSync(path.join(history, 'junkware_live_2026-09-22_summary.csv'),
      'appt_id,jk_number,address,status\n123456,JK_TEST,100 Example Hwy Apt 4 Baton Rouge LA 70816,Confirmed\n');
    const address = '100 Example Hwy Apt 4 Baton Rouge LA 70816';
    const cache = path.join(root, 'cache/service-address-verifications'); fs.mkdirSync(cache, { recursive: true });
    const hash = (value: string) => createHash('sha256').update(value).digest('hex');
    fs.writeFileSync(path.join(cache, hash(address) + '.json'), JSON.stringify({ schema: 9, address,
      expires: 1_800_000_300_000, verified: { location: null, reason: 'No Exact Building Match' } }));
    fs.writeFileSync(path.join(root, 'cache/schedule-address-refresh.json'), JSON.stringify({ policyVersion: 9,
      attempts: { [hash(address.toUpperCase())]: 1_800_000_000_000 } }));
    const maintenance = path.join(root, 'integrations/opscenter-maintenance'); fs.mkdirSync(maintenance, { recursive: true });
    const ledger = JSON.stringify({ months: { '2026-09': { calls: 500, committedMicros: 10_000_000 } }, addressResearch: { status: 'Shared budget or address allowance reached' } });
    fs.writeFileSync(path.join(maintenance, 'state.json'), ledger);
    const run = () => {
      const result = spawnSync(process.execPath, ['--import', 'tsx', fileURLToPath(import.meta.url), '--child', root], {
        env: { ...process.env, OPSBOT_DATA_DIR: root, OPSCENTER_DATA_DIR: root, SERVICE_ADDRESS_CACHE_DIR: path.join(root, 'cache/service-address-verifications') },
        encoding: 'utf8', timeout: 10000,
      });
      assert.equal(result.status, 0, result.stdout + result.stderr);
      return JSON.parse(fs.readFileSync(path.join(root, 'calls.json'), 'utf8'));
    };
    assert.equal(run(), 1, 'Old negative cache and six-hour retry delay cannot suppress the new free provider');
    const state = JSON.parse(fs.readFileSync(path.join(root, 'cache/schedule-address-refresh.json'), 'utf8'));
    assert.equal(state.scheduleDates, 2); assert.equal(state.verified, 1);
    const pins = JSON.parse(fs.readFileSync(path.join(root, 'cache/appointment_geocodes.json'), 'utf8')).addresses;
    const pin = Object.values(pins)[0] as Record<string, unknown>;
    assert.equal(pin.verification_policy, ADDRESS_VERIFICATION_POLICY); assert.equal(pin.house_street_verified, true);
    assert.equal(pin.latitude, 30.4); assert.equal(pin.longitude, -91.1);
    assert.equal(run(), 0, 'A fresh process reuses saved evidence before service day');
    assert.equal(fs.readFileSync(path.join(maintenance, 'state.json'), 'utf8'), ledger, 'Paid ledger is untouched');
    console.log('Actual background sweep verified tomorrow without a browser at the exhausted paid cap; saved evidence survives restart. Synthetic provider only.');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
