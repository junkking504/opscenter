import assert from 'node:assert/strict';
import { rotationReceiptHealth } from '../lib/log-rotation-health';
const now = Date.parse('2026-10-09T20:00:00Z');
const check=(status:string, age:number)=>rotationReceiptHealth({status,checkedAt:new Date(now-age).toISOString()},now);
for (const status of ['rotated','below_threshold']) { assert.equal(check(status,0).status,'ok');assert.equal(check(status,48*3600_000).status,'ok'); assert.equal(check(status,48*3600_000+1).status,'warn'); }
for (const status of ['failed','retry']) assert.equal(check(status,0).status,'warn');
for (const status of ['busy','missing','would_rotate','unknown']) assert.equal(check(status,0).status,'unknown');
assert.equal(check('rotated',-1).status,'unknown');assert.equal(rotationReceiptHealth(null,now).status,'unknown');
assert.equal(rotationReceiptHealth({status:'rotated',checkedAt:'invalid'},now).status,'unknown');
console.log('Log rotation health: failed/retry, 48-hour boundary, future, missing and unsupported receipts passed.');
