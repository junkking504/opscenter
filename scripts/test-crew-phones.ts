import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { NextRequest } from 'next/server';
import { createCrewPhoneEnrollment, enrollCrewPhone, crewPhone, listCrewPhones, revokeCrewPhone } from '../lib/crew-phone-store';
import { CREW_PHONE_COOKIE } from '../lib/crew-phone';
import { crewPhoneSession } from '../lib/crew-phone-http';
import { publicAuthRoute } from '../lib/auth';
import { authorizeOpsRequest } from '../lib/ops-roles';
import { middleware } from '../middleware';

const key = () => randomBytes(32).toString('hex');
const manager = 'synthetic-manager@example.invalid';
const origin = 'https://ops.example.invalid';
const request = (body?: unknown, headers: Record<string, string> = {}, base = origin) => new Request(`${base}/api/crew-jobs/session`, {
  method: body === undefined ? 'GET' : 'POST', headers: { Origin: base, 'Content-Type': 'application/json', ...headers },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});
async function main() {
  if (process.argv[2] === '--race') {
    try { enrollCrewPhone(process.argv[3], process.argv[4]); process.stdout.write('connected'); }
    catch { process.stdout.write('rejected'); }
    return;
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crew-phone-tests-'));
  process.env.OPS_CREW_PHONE_DIR = dir;
  process.env.OPSCENTER_LOGIN_RATE_LIMIT_FILE = path.join(dir, 'attempts.json');
  try {
    const now = new Date();
    assert.equal(crewPhone(key()), null, 'Unknown/self-issued/inspection key cannot connect');
    assert.throws(() => createCrewPhoneEnrollment('Truck 99', 'Phone', manager), /Choose a truck/);
    assert.throws(() => createCrewPhoneEnrollment('Truck 6', '', manager), /phone name/);
    assert.throws(() => createCrewPhoneEnrollment('Truck 6', 'Phone', ''), /Manager/);
    const setup = createCrewPhoneEnrollment('Truck 6', 'Company phone 6', manager, now);
    assert.match(setup.code, /^[0-9]{6}$/);
    const token = key();
    const phone = enrollCrewPhone(setup.code, token, now);
    assert.equal(phone.truck, 'Truck 6');
    assert.deepEqual(crewPhone(token, now), phone);
    assert.deepEqual(enrollCrewPhone(setup.code, token, now), phone, 'Retry returns same enrollment');
    assert.deepEqual(enrollCrewPhone(setup.code, token, new Date(now.getTime() + 600_001)), phone, 'Original phone can recover a lost response after code expiry');
    assert.throws(() => enrollCrewPhone(setup.code, key(), now), /already used/);
    assert.equal(crewPhone(token, new Date(Date.parse(phone.expiresAt))), null);
    const expired = createCrewPhoneEnrollment('Truck 1', 'Expired invite', manager, now);
    assert.throws(() => enrollCrewPhone(expired.code, key(), new Date(now.getTime() + 600_000)), /expired/);
    const reassignment = createCrewPhoneEnrollment('Truck 2', 'Other truck', manager, now);
    assert.throws(() => enrollCrewPhone(reassignment.code, token, now), /new connection/);
    assert.equal(crewPhone(token, now)?.truck, 'Truck 6', 'Existing key cannot change trucks');
    const canceled = createCrewPhoneEnrollment('Truck 1', 'Canceled invite', manager);
    revokeCrewPhone(canceled.deviceId, manager);
    assert.throws(() => enrollCrewPhone(canceled.code, key()), /removed/);
    revokeCrewPhone(phone.deviceId, manager);
    assert.equal(crewPhone(token), null);
    assert.throws(() => enrollCrewPhone(setup.code, token), /removed/);
    assert.equal(listCrewPhones().find(item => item.deviceId === phone.deviceId)?.state, 'revoked');

    // Two distinct processes compete for the same one-use code.
    const contested = createCrewPhoneEnrollment('Truck 3', 'Concurrent phones', manager);
    const contenders = [key(), key()];
    const outcomes = await Promise.all(contenders.map(value => promisify(execFile)(process.execPath,
      ['--import', 'tsx', path.resolve('scripts/test-crew-phones.ts'), '--race', contested.code, value], { env: process.env })));
    assert.deepEqual(outcomes.map(value => value.stdout).sort(), ['connected', 'rejected']);
    assert.equal(contenders.filter(value => crewPhone(value)).length, 1, 'Only the winner authenticates');

    assert.equal((await crewPhoneSession(request())).status, 401);
    assert.equal((await crewPhoneSession(request(undefined, {Cookie:'ops_truck_inspection=' + key()}))).status, 401);
    const apiInvite = createCrewPhoneEnrollment('Truck 4', 'API phone', manager);
    const apiKey = key();
    const payload = { action: 'enroll', code: apiInvite.code, connectionKey: apiKey };
    assert.equal((await crewPhoneSession(request(payload, { Origin: 'https://foreign.example.invalid' }))).status, 403);
    assert.equal((await crewPhoneSession(request(payload, { Origin: '' }))).status, 403);
    assert.equal((await crewPhoneSession(request(payload, {}, 'http://ops.example.invalid'))).status, 403);
    assert.equal((await crewPhoneSession(request({ ...payload, truck: 'Truck 9' }))).status, 400, 'Phone cannot supply its own truck');
    assert.equal((await crewPhoneSession(request({ ...payload, padding: 'x'.repeat(5000) }))).status, 413);
    assert.equal((await crewPhoneSession(request(payload, { 'Content-Type': 'text/plain' }))).status, 415);
    const response = await crewPhoneSession(request(payload));
    assert.equal(response.status, 200);
    const cookie = response.headers.get('set-cookie')!;
    for (const expected of ['HttpOnly', 'Secure', 'SameSite=Strict', 'Path=/api/crew-jobs']) assert.ok(cookie.includes(expected));
    assert.match(response.headers.get('cache-control')!, /private, no-store/);
    const json = await response.json();
    assert.equal(json.phone.truck, 'Truck 4');
    assert.equal(JSON.stringify(json).includes(apiKey), false, 'Key is never returned in JSON');
    assert.deepEqual(await (await crewPhoneSession(request(payload))).json(), json, 'Lost response can be recovered by the same phone');
    const cookieHeader = { Cookie: `${CREW_PHONE_COOKIE}=${apiKey}` };
    assert.equal((await crewPhoneSession(request(undefined, cookieHeader))).status, 200);
    assert.equal((await crewPhoneSession(request(undefined, { Cookie: `${cookieHeader.Cookie}; ${cookieHeader.Cookie}` }))).status, 401);
    assert.equal((await crewPhoneSession(request({ action: 'disconnect' }, cookieHeader))).status, 200);
    assert.equal((await crewPhoneSession(request(undefined, cookieHeader))).status, 401);
    assert.equal((await crewPhoneSession(request(payload))).status, 403, 'Revoked code/key cannot reconnect');

    // Rotating codes/connection keys cannot bypass the shared persistent limit.
    const nextInvite = createCrewPhoneEnrollment('Truck 5', 'Rate limit test', manager);
    const recoveryKey = key();
    const recoverable = enrollCrewPhone(nextInvite.code, recoveryKey);
    for (let i=0;i<8;i++) assert.throws(() => enrollCrewPhone('x'.repeat(24), key()));
    const blockedInvite = createCrewPhoneEnrollment('Truck 5', 'Blocked invite', manager);
    assert.throws(() => enrollCrewPhone(blockedInvite.code, key()), /Too many/);
    assert.equal((await crewPhoneSession(request({action:'enroll',code:blockedInvite.code,connectionKey:key()}, {'cf-connecting-ip':'203.0.113.42'}))).status,429);
    const restarted=await promisify(execFile)(process.execPath,['--import','tsx',path.resolve('scripts/test-crew-phones.ts'),'--race',blockedInvite.code,key()],{env:process.env});
    assert.equal(restarted.stdout,'rejected','A new process cannot reset the guess limit');
    assert.deepEqual(enrollCrewPhone(nextInvite.code, recoveryKey), recoverable, 'Already-bound recovery bypasses guess lockout');
    const later = new Date(Date.now()+15*60_000+1);
    const laterInvite = createCrewPhoneEnrollment('Truck 5', 'After lockout', manager, later);
    assert.equal(enrollCrewPhone(laterInvite.code,key(),later).truck,'Truck 5');

    const zeroInvite = createCrewPhoneEnrollment('Truck 5', 'Leading zeros', manager);
    const digest=(value:string)=>createHash('sha256').update(value).digest('hex');
    fs.copyFileSync(path.join(dir,'enrollments',`${digest(zeroInvite.code)}.json`),path.join(dir,'enrollments',`${digest('000123')}.json`));
    assert.equal(enrollCrewPhone('000123',key()).deviceId,zeroInvite.deviceId,'Six-digit codes retain leading zeros');
    const damaged = createCrewPhoneEnrollment('Truck 5', 'Damaged record', manager);
    const damagedKey = key();
    const damagedPhone = enrollCrewPhone(damaged.code, damagedKey);
    const bindingFile = path.join(dir, 'bindings', `${damagedPhone.deviceId}.json`);
    const binding = JSON.parse(fs.readFileSync(bindingFile, 'utf8'));
    binding.phone.expiresAt = 'invalid';
    fs.writeFileSync(bindingFile, JSON.stringify(binding));
    assert.equal(crewPhone(damagedKey), null, 'Corrupt expiry fails closed');
    fs.writeFileSync(bindingFile, '{broken');
    assert.equal((await crewPhoneSession(request(undefined, { Cookie: `${CREW_PHONE_COOKIE}=${damagedKey}` }))).status, 503, 'Damaged storage is unavailable, not a new setup');

    const enrollmentFiles = fs.readdirSync(path.join(dir, 'enrollments')).map(name => fs.readFileSync(path.join(dir, 'enrollments', name), 'utf8')).join('');
    assert.equal(enrollmentFiles.includes(setup.code), false);
    const phoneFiles = fs.readdirSync(path.join(dir, 'bindings')).map(name => fs.readFileSync(path.join(dir, 'bindings', name), 'utf8')).join('');
    assert.equal(phoneFiles.includes(token), false);
    assert.ok(fs.existsSync(path.join(dir, 'keys', `${createHash('sha256').update(token).digest('hex')}.json`)));
    for (const route of ['/crew-jobs', '/api/crew-jobs/session']) assert.equal(publicAuthRoute(route), true);
    for (const route of ['/crew-phones', '/api/crew-phones', '/api/crew-jobs/session/admin', '/api/crew-jobs/operations']) assert.equal(publicAuthRoute(route), false);
    for (const route of ['/crew-phones', '/api/crew-phones']) for (const method of ['GET', 'POST']) {
      assert.equal(authorizeOpsRequest('operator', route, method).allowed, false);
      assert.equal(authorizeOpsRequest('manager', route, method).allowed, true);
    }
    delete process.env.OPS_ACCESS_TEAM_DOMAIN; delete process.env.OPS_ACCESS_AUD;
    const unauthorized = await middleware(new NextRequest(`${origin}/api/crew-phones`, { headers: cookieHeader }));
    assert.equal(unauthorized.status, 401, 'Phone cookie never authenticates a manager request');
    for (const host of ['inspect.junk-king.app', 'hooks.junk-king.app']) {
      const denied = await middleware(new NextRequest(`https://${host}/api/crew-jobs/session`));
      assert.equal(denied.status, 404, 'Inspection/webhook origins do not expose crew job sessions');
    }
    console.log('PASS: manager-only access, fixed truck, one-phone enrollment race, retry recovery, expiry, revocation, private cookies, bounded same-origin requests, no credential storage, corrupt-storage denial. No browser or live writes.');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
