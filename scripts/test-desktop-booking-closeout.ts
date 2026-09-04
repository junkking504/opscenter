import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { classifyCloseoutFailure } from '../lib/junkware-job-closeout';
import { closeoutSourceVersion, verifyCloseoutFields } from '../lib/desktop-closeout-contract';
import { parseScheduleOperation } from '../lib/desktop-schedule-operations';
import { JunkwareAppointmentCreationError } from '../lib/junkware-appointment-creation';

async function main() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'desktop-booking-test-'));
  process.env.OPSCENTER_DESKTOP_CREATIONS_DIR = directory;
  const { executeDesktopCreation, readDesktopCreation } = await import('../lib/desktop-creation');
  const date = new Date(Date.now() + 172800000).toISOString().slice(0, 10);
  const input = { requestId: randomUUID(), franchise: 'New Orleans', date, startTime: '09:00', durationHours: 1, truck: 'Truck 2', appointmentType: 'Estimate', firstName: 'Synthetic', lastName: 'Booking', business: false, company: '', phone: '5045550199', email: '', billingAddress: '100 Test Street', billingZip: '70119', billingEmail: '', howHeard: 'Referral', serviceAddress: '100 Test Street', serviceZip: '70119', serviceContactName: '', serviceContactPhone: '', estimatedPickups: 1, scope: 'Synthetic test only', notes: '', duplicateOverrideReason: '' };
  let calls = 0;
  const create = async () => { calls++; return { result: { appointmentId: '1234', jkNumber: 'JKTEST1234', appointmentUrl: 'https://example.invalid/appointment/1234', franchise: 'New Orleans' as const, date, startTime: '09:00', durationHours: 1, truck: 'Truck 2', appointmentType: 'Estimate' as const, customerMode: 'new' as const, verifiedAt: new Date().toISOString() }, replayed: false }; };
  try {
    const [first, concurrent] = await Promise.all([executeDesktopCreation(input, 'actor-a', create), executeDesktopCreation(input, 'actor-a', create)]);
    assert.equal(calls, 1); assert.equal(first.status, 'verified'); assert.ok(['pending', 'verified'].includes(concurrent.status));
    assert.equal((await executeDesktopCreation(input, 'actor-a', create)).result?.appointmentId, '1234');
    assert.equal(calls, 1, 'A reload or retry must not create again');
    assert.equal(await readDesktopCreation(input.requestId, 'actor-b'), null);
    await assert.rejects(executeDesktopCreation(input, 'actor-b', create), /different booking/);
    await assert.rejects(executeDesktopCreation({ ...input, phone: '5045550188' }, 'actor-a', create), /different booking/);
    const duplicate = await executeDesktopCreation({ ...input, requestId: randomUUID() }, 'actor-a', create); assert.equal(duplicate.status, 'failed'); assert.equal(duplicate.code, 'duplicate_appointment'); assert.equal(calls, 1);
    const uncertain = { ...input, phone: '5045550198', requestId: randomUUID() };
    await executeDesktopCreation(uncertain, 'actor-a', async () => { throw new Error('Lost connection after source write'); });
    assert.equal((await executeDesktopCreation(uncertain, 'actor-a', create)).status, 'uncertain'); assert.equal(calls, 1);
    const alternate = await executeDesktopCreation({ ...uncertain, requestId: randomUUID(), duplicateOverrideReason: 'Deliberate duplicate but unresolved source' }, 'actor-a', create); assert.equal(alternate.status, 'failed'); assert.equal(alternate.code, 'existing_unverified_booking'); assert.equal(calls, 1, 'A new UUID and override cannot bypass uncertainty');
    const failed = await executeDesktopCreation({ ...input, phone: '5045550197', requestId: randomUUID() }, 'actor-a', async () => { throw new JunkwareAppointmentCreationError('Known duplicate', 'duplicate_appointment', 'preflight'); });
    assert.equal(failed.status, 'failed'); assert.equal(failed.code, 'duplicate_appointment');
    const recovered = await executeDesktopCreation({ ...input, phone: '5045550197', requestId: randomUUID() }, 'actor-a', create); assert.equal(recovered.status, 'verified', 'Known preflight failures do not retain identity locks');
    const expired = JSON.parse(await fs.readFile(path.join(directory, `${input.requestId}.json`), 'utf8')); expired.updatedAt = new Date(Date.now() - 25 * 3600000).toISOString(); await fs.writeFile(path.join(directory, `${input.requestId}.json`), JSON.stringify(expired));
    assert.equal((await executeDesktopCreation({ ...input, requestId: randomUUID() }, 'actor-a', create)).status, 'verified', 'Expired verified protection delegates back to source duplicate checks');
    assert.equal(classifyCloseoutFailure({ stderr: JSON.stringify({ error: 'Source changed', stage: 'preflight', code: 'source_version_conflict' }) }).stage, 'preflight');
    assert.equal(classifyCloseoutFailure({ stderr: JSON.stringify({ error: 'Save lost', stage: 'uncertain' }) }).stage, 'uncertain');
    assert.equal(classifyCloseoutFailure(new Error('Timed out')).stage, 'uncertain');

    const source = { status: { value: '8' }, loadQuantity: '1', loadPrice: '$100.00', bedloadQuantity: '0', bedloadPrice: '', discount: '0', tip: '10.00', loadSize: { value: '1' }, bedloadSize: { value: '' }, jobCategory: { value: '3' }, actualStartHour: { value: '9' }, actualStartMinute: { value: '0' }, actualEndHour: { value: '10' }, actualEndMinute: { value: '0' }, appointmentType: { label: 'Estimate' }, paymentMethods: [{ value: 'cash', label: 'Cash' }, { value: 'card', label: 'Credit Card' }], payments: [{ description: 'Cash', amount: '$100.00' }], otherChargeOptions: [{ value: 'fee|20|0', label: 'Extra item' }, { value: 'percent|5|1', label: 'Percentage fee' }], otherCharges: [] };
    const payload = { loadQuantity: '1', loadPrice: '100', bedloadQuantity: '0', bedloadPrice: '', discount: '', tip: '10', loadSize: '1', bedloadSize: '', jobCategoryId: '3', actualStartHour: '9', actualStartMinute: '0', actualEndHour: '10', actualEndMinute: '0', appointmentType: 'Estimate', addPayment: { methodId: 'cash', amount: '100' } };
    const before = { ...source, payments: [], otherCharges: [] };
    verifyCloseoutFields(source, payload, before);
    assert.throws(() => verifyCloseoutFields({ ...source, tip: '0' }, payload), /retain tip/);
    assert.throws(() => verifyCloseoutFields(source, { ...payload, appointmentType: 'Job' }), /category/);
    assert.throws(() => verifyCloseoutFields(source, payload, { ...before, payments: source.payments }), /payment amount/);
    assert.throws(() => verifyCloseoutFields({ ...source, payments: [{ description: 'Credit Card', amount: '$100' }] }, payload, before), /payment method/);
    assert.throws(() => verifyCloseoutFields({ ...source, payments: [{ description: 'Cash', amount: '$50' }, { description: 'Cash', amount: '$50' }] }, payload, before), /payment amount/);
    assert.throws(() => verifyCloseoutFields({ ...source, tip: 'not-a-number' }, payload), /amount/);
    const chargePayload = { ...payload, otherChargesToAdd: [{ typeValue: 'fee|20|0', quantity: '2', price: '20' }] };
    const charged = { ...source, otherCharges: [{ label: 'Extra item', quantity: '2', price: '$20', total: '$40' }] };
    verifyCloseoutFields(charged, chargePayload, before);
    assert.throws(() => verifyCloseoutFields({ ...charged, otherCharges: [{ ...charged.otherCharges[0], label: 'Wrong fee' }] }, chargePayload, before), /charge type/);
    assert.throws(() => verifyCloseoutFields({ ...charged, otherCharges: [{ ...charged.otherCharges[0], quantity: '3' }] }, chargePayload, before), /quantity/);
    assert.throws(() => verifyCloseoutFields({ ...charged, otherCharges: [{ ...charged.otherCharges[0], price: '$25' }] }, chargePayload, before), /charge price/);
    const percentagePayload = { ...payload, otherChargesToAdd: [{ typeValue: 'percent|5|1', quantity: '1', price: '', sourceCalculatedPrice: '7.5' }] };
    verifyCloseoutFields({ ...source, otherCharges: [{ label: 'Percentage fee', quantity: '1', price: '$7.50', total: '$7.50' }] }, percentagePayload, before);
    assert.throws(() => verifyCloseoutFields({ ...source, otherCharges: [{ label: 'Percentage fee', quantity: '1', price: '$5', total: '$5' }] }, percentagePayload, before), /source-calculated/);

    assert.notEqual(closeoutSourceVersion(source), closeoutSourceVersion({ ...source, tip: '11' }));
    assert.throws(() => parseScheduleOperation({ requestId: randomUUID(), date, recordId: `${date}:appointment:1234`, expectedVersion: 'a'.repeat(64), action: 'closeout', values: {} }), /source version/);
    console.log('Desktop booking/closeout passed: concurrent idempotency, actor isolation, changed-request rejection, uncertain-write blocking, category/amount/payment read-back, and source-version gate.');
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
}
void main();
