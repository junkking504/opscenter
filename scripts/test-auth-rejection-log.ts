import assert from 'node:assert/strict';
import { createAuthRejectionLogger } from '../lib/auth-rejection-log';
let time = Date.parse('2026-10-09T20:00:00Z');
const events: Record<string, string | number | null>[] = [];
const logger = createAuthRejectionLogger(e => events.push(e), () => time);
const input = { reason: 'session_identity_retired', pathname: '/api/desktop/schedule/private-job-id', method: 'GET', headers: new Headers({ 'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X) Version/18.0 Safari/605.1', 'cf-ray': '0123456789abcdef-DFW', cookie: 'SECRET', host: 'private.example' }) };
for (let i = 0; i < 1000; i++) logger.record(input);
assert.equal(events.length, 1); assert.equal(events[0].route, 'control'); assert.equal(events[0].browser, 'safari');
time += 300_000; logger.record(input);
assert.equal(events.length, 2); assert.equal(events[1].total, 1000); assert.equal(events[1].suppressed, 999);
logger.record({ ...input, reason: 'session_signature_mismatch' }); assert.equal(events.length, 3);
const text = JSON.stringify(events); for (const secret of ['SECRET', 'private-job-id', 'private.example', 'Mozilla']) assert(!text.includes(secret));
time += 900_000; logger.record(input);
assert(events.some(e => e.event === 'session_rejection_summary' && e.total === 1));
assert.equal(logger.size().buckets, 1);
const uas = ['Windows Edg/123', 'Linux Firefox/123', 'Android Chrome/123', 'iPhone Version/18.0 Safari/1', 'unknown'];
for (const reason of ['session_expired','session_identity_retired','session_malformed','session_absent'])
for (const pathname of ['/command','/control','/crew','/fleet','/finance','/other'])
for (const method of ['GET','POST','PATCH','DELETE'])
for (const ua of uas) logger.record({ reason, pathname, method, headers: new Headers({'user-agent': ua, 'cf-ray': 'bad\tsecret'}) });
assert.equal(logger.size().buckets, 256); assert(logger.size().overflow <= 9);
logger.record({...input, reason:'session_payload_unreadable'});
assert(events.some(e => e.reason === 'session_payload_unreadable'));
assert(!JSON.stringify(events).includes('bad\\tsecret'));
const throwing = createAuthRejectionLogger(() => { throw new Error('sink down'); });
assert.doesNotThrow(() => throwing.record(input));
console.log('Auth log regression: bounded anonymous categories, repetition summaries, new reasons, expiry, overflow and sink failure passed.');
