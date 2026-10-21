import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { historyDateValid, historySource, readCustomerHistory, relatedHistory } from '../lib/customer-history';
import { desktopAppointmentHref } from '../desktop-ui/lib/desktop-links';

const raw = (id: string, extra: Record<string, unknown> = {}) => ({ appt_id: id, job_id: `JK${id}`, customer_name: 'Synthetic Customer', phone: '(504) 555-0123', customerEmail: '', address: '10 Example Road', appointment_type: 'Job', appointment_date: '2026-10-20', final_status: 'Confirmed', ...extra });
const source = (id: string, extra: Record<string, unknown> = {}) => historySource(raw(id, extra), '2026-10-20', '2026-10-20T12:00:00Z')!;
assert.equal(historyDateValid('2026-02-30'), false);
assert.equal(historyDateValid('2026-10-20'), true);
assert.equal(historySource(raw('../../1'), '2026-10-20', ''), null);
const rows = [
  source('1', { source_estimate_appointment_id: '2' }),
  source('2', { appointment_type: 'Estimate', customer_name: 'Old spelling', phone: '', closeout: { total: '650.00', payments: [{ method: 'Cash', amount: '650.00' }] } }),
  source('3', { source_estimate_appointment_id: '2', customer_name: 'Different contact', phone: '' }),
  source('4', { phone: '+1 504 555 0123', final_status: 'Completed', closeout: { total: '100', payments: [{ method: 'Bill', amount: '100' }] } }),
  source('4', { collection_timestamp: '2026-10-21T12:00:00Z', final_status: 'Cancelled' }),
  source('5', { phone: '', customerEmail: '' }), // name and address alone do not match
  source('6', { customer_name: 'Another customer' }), // shared contact alone does not match
  source('7', { phone: '0000000000' }),
];
const result = relatedHistory(rows, '1')!;
assert.deepEqual(result.map(row => [row.id, row.relationship]), [['2', 'estimate'], ['3', 'job'], ['4', 'contact']]);
assert.equal(result.find(row => row.id === '4')!.status, 'Cancelled');
assert.deepEqual(result[0].amounts, ['Quote $650.00']);
assert.deepEqual(relatedHistory(rows, '2')!.filter(row => row.relationship === 'job').map(row => row.id), ['1', '3']);
assert.equal(relatedHistory(rows, '999'), null);
assert.equal(JSON.stringify(result).includes('phone'), false, 'contact match keys are not sent to the browser');
assert.deepEqual(source('8', { closeout: { total: 'bad', payments: [{ method: 'Cash', amount: '25' }, { method: 'Bill', amount: '50' }, { method: 'Card', amount: 'bad' }] } }).amounts, ['Recorded payment $25.00 · Cash', 'Billed $50.00 · Bill']);
assert.deepEqual(source('8', { closeout_refresh_pending: true, closeout: { total: '75', payments: [{ method: 'Cash', amount: '75' }] } }).amounts, ['Charges $75.00']);
assert.equal(new URL(desktopAppointmentHref('JK4', '2026-10-20', '4'), 'https://example.com').searchParams.get('appointment'), '4');
assert.equal(relatedHistory([source('1', { phone: '', customerEmail: 'Person@Example.com' }), source('2', { phone: '', customerEmail: 'person@example.com' })], '1')!.length, 1);

async function main() {
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'opscenter-customer-history-'));
try {
  const history = path.join(directory, 'history/junkware'); fs.mkdirSync(history, { recursive: true });
  fs.writeFileSync(path.join(history, 'junkware_2026-10-20_raw.json'), JSON.stringify({ scraped_at: '2026-10-20T12:00:00Z', appointments: [raw('1'), raw('2')] }));
  fs.writeFileSync(path.join(history, 'junkware_2026-10-19_raw.json'), '{broken');
  const [saved, concurrent] = await Promise.all([readCustomerHistory('1', '2026-10-20', directory), readCustomerHistory('1', '2026-10-20', directory)]);
  assert.deepEqual(saved, concurrent);
  assert.equal(saved!.total, 1); assert.equal(saved!.coverage.unreadable, 1);
  assert.equal(await readCustomerHistory('999', '2026-10-20', directory), null);
  fs.writeFileSync(path.join(history, 'junkware_schedule_fast_2026-10-20.json'), JSON.stringify({ date: '2026-10-20', scraped_at: '2026-10-21T12:00:00Z', markets_scraped: ['Junk King New Orleans', 'Junk King Northshore', 'Junk King Baton Rouge', 'Junk King Jefferson Parish'], appointments: [], cancelled: [raw('2', { final_status: 'Cancelled', appointment_date: '2026-10-22' })] }));
  const updated = await readCustomerHistory('1', '2026-10-20', directory);
  assert.equal(updated!.records[0].date, '2026-10-22'); assert.equal(updated!.records[0].status, 'Cancelled');
  const empty = path.join(directory, 'empty'); fs.mkdirSync(path.join(empty, 'history/junkware'), { recursive: true });
  await assert.rejects(readCustomerHistory('1', '2026-10-20', empty));
  fs.writeFileSync(path.join(empty, 'history/junkware/junkware_2026-10-20_raw.json'), '{}');
  await assert.rejects(readCustomerHistory('1', '2026-10-20', empty));
} finally { fs.rmSync(directory, { recursive: true, force: true }); }
}
main().then(() => console.log('Customer history PASS: explicit links, cautious contact matching, latest status, quote/payment separation, canonical links, partial/unavailable archives and concurrent reads.')).catch(error => { console.error(error); process.exitCode = 1; });
