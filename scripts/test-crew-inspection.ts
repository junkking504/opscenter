import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { crewInspection } from '../lib/crew-inspection';
import { CREW_PHONE_COOKIE } from '../lib/crew-phone';
import { createCrewPhoneEnrollment, enrollCrewPhone, revokeCrewPhone } from '../lib/crew-phone-store';
import { INSPECTION_SECTIONS, inspectionDate } from '../lib/truck-inspection';
import { listTruckInspections } from '../lib/truck-inspection-store';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'waypoint-inspection-'));
process.env.OPS_CREW_PHONE_DIR = path.join(dir, 'phones');
process.env.OPS_TRUCK_INSPECTION_DIR = path.join(dir, 'inspections');
process.env.OPS_CREW_ROSTER_JSON = '[]';
const origin = 'https://waypoint.junk-king.app';
const token = randomBytes(32).toString('hex');
const request = (body?: unknown, cookie = token, extra: Record<string,string> = {}, query = '') => new Request(`${origin}/api/crew-jobs/inspection${query}`, {
  method: body === undefined ? 'GET' : 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', Cookie: `${CREW_PHONE_COOKIE}=${cookie}`, ...extra },
  ...(body === undefined ? {} : {body: JSON.stringify(body)}),
});
async function main() {
  try {
    assert.equal((await crewInspection(request())).status, 401);
    const invite = createCrewPhoneEnrollment('Truck 6', 'Synthetic phone', 'test@example.invalid');
    const phone = enrollCrewPhone(invite.code, token);
    const contextResponse = await crewInspection(request());
    const context = await contextResponse.json();
    assert.equal(context.device.deviceId, phone.deviceId);
    assert.deepEqual(context.trucks, ['Truck 6']);
    assert.equal(context.truckLocked, true);
    assert.match(contextResponse.headers.get('cache-control')!, /no-store/);
    assert.equal(contextResponse.headers.get('set-cookie'), null, 'Inspections do not create another login');
    assert.equal((await crewInspection(request(undefined, token, {Cookie: `ops_truck_inspection=${token}`}))).status, 401);
    assert.equal((await crewInspection(request({action: 'connect'}))).status, 400);
    const report = {requestId: randomUUID(), truck: 'Truck 6', inspector: 'Synthetic inspector', odometer: '123456', fuel: '1/2', loadLevel: 'Empty', startedAt: new Date().toISOString(), answers: INSPECTION_SECTIONS.map(section => ({id:section.id, status:'good', notes:''})), status:'clear', notes:'', initials:'TI', photos:[]};
    const payload = {action:'submit', report};
    assert.equal((await crewInspection(request(payload, token, {Origin:'https://foreign.example.invalid'}))).status, 403);
    assert.equal((await crewInspection(request({...payload, padding:'x'.repeat(5_100_001)}))).status, 413);
    assert.equal((await crewInspection(request({...payload, report:{...report,truck:'Truck 8'}}))).status, 403);
    assert.equal((await crewInspection(request({...payload, report:{...report,answers:[]}}))).status, 400);
    assert.equal(listTruckInspections(inspectionDate()).length, 0);
    const response = await crewInspection(request(payload));
    assert.equal(response.status, 200);
    const saved = await response.json();
    assert.equal(saved.report.deviceId, phone.deviceId);
    assert.equal(saved.report.truck, 'Truck 6');
    assert.deepEqual(await (await crewInspection(request(payload))).json(), saved, 'Same report retry recovers the durable receipt');
    assert.equal((await crewInspection(request({...payload,report:{...report,odometer:'999'}}))).status, 409);
    assert.deepEqual(await (await crewInspection(request(undefined, token, {}, `?requestId=${report.requestId}`))).json(), saved);
    assert.equal(listTruckInspections(inspectionDate()).length, 1, 'One report reaches the existing Fleet report store');
    const other = randomBytes(32).toString('hex');
    enrollCrewPhone(createCrewPhoneEnrollment('Truck 8','Other phone','test@example.invalid').code, other);
    assert.equal((await (await crewInspection(request(undefined, other, {}, `?requestId=${report.requestId}`))).json()).report, null);
    revokeCrewPhone(phone.deviceId, 'test@example.invalid');
    assert.equal((await crewInspection(request(payload))).status, 401);
    assert.equal((await crewInspection(request(undefined, token, {}, `?requestId=${report.requestId}`))).status, 401);
    console.log('Unified crew inspection: enrollment, truck scope, origin, payload bounds, validation, durable retry, receipt isolation and revocation passed.');
  } finally { fs.rmSync(dir, {recursive:true,force:true}); }
}
void main();
