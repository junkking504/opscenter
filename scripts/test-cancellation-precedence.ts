import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { appointmentStatus, scheduleDisplayTruck, scheduleBoardJobs, type ScheduleAppointment } from '../desktop-ui/lib/schedule-contract';

async function main() {
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'cancellation-precedence-'));
process.env.OPSBOT_DATA_DIR = temporary;
process.env.OPSCENTER_DATA_DIR = temporary;
process.env.JOB_CANCELLATIONS_FILE = path.join(temporary, 'cancellations.json');
const date = '2026-09-22';
const old = '2026-09-23T05:00:00Z';
const verified = '2026-09-23T13:30:00Z';
const later = '2026-09-23T14:00:00Z';
const directory = path.join(temporary, 'history', 'junkware');
const markets = ['Junk King New Orleans', 'Junk King Northshore', 'Junk King Baton Rouge', 'Junk King Jefferson Parish'];
const row = { appt_id: '12345', job_id: 'JKTEST', customer_name: 'Synthetic cancellation', job_status: 'Confirmed', truck: 'Truck 1', collection_timestamp: old };
const snapshot = (rows: unknown[], scrapedAt = old) => ({ date, scraped_at: scrapedAt, markets_scraped: markets, appointments: rows, cancelled: [] });
fs.mkdirSync(directory, { recursive: true });
const raw = path.join(directory, `junkware_${date}_raw.json`);
const fast = path.join(directory, `junkware_schedule_fast_${date}.json`);
fs.writeFileSync(raw, JSON.stringify(snapshot([row])));
fs.writeFileSync(path.join(directory, `junkware_live_${date}_summary.csv`), 'appt_id,job_id,customer_name,job_status,truck,collection_timestamp\n12345,JKTEST,Synthetic cancellation,Confirmed,Truck 1,' + old + '\n');
fs.utimesSync(raw, new Date(old), new Date(old));
fs.utimesSync(path.join(directory, `junkware_live_${date}_summary.csv`), new Date(old), new Date(old));
function writeFast(rows: unknown[], scrapedAt = old) {
  fs.writeFileSync(fast, JSON.stringify(snapshot(rows, scrapedAt)));
  // A fresh file write is not a fresh appointment observation.
  fs.utimesSync(fast, new Date(later), new Date(later));
}
try {
  const { saveVerifiedJobCancellation, applyVerifiedJobCancellations } = await import('../lib/job-cancellations');
  const { readJobRows } = await import('../lib/desktop-schedule-source');
  const entry = saveVerifiedJobCancellation({ date, appointmentId: '12345', jobKey: 'appt:12345', jkNumber: 'JKTEST', customerName: 'Synthetic cancellation', cancellationReason: 'Training only', canceledAt: verified, junkwareVerifiedAt: verified });
  const assertCanceled = (label: string) => {
    const job = readJobRows(date).find(value => value.appointmentId === '12345')!;
    assert.equal(job.status, 'Canceled', label);
    assert.equal(job.cancellationReason, 'Training only');
    const displayed: ScheduleAppointment = { ...job, recordId: `${date}:appointment:12345`, version: 'test', callAhead: 'not_called', location: null, hasVisit: true, hasDepartedVisit: false, truckOnSite: true, lastSeenOnsiteTruck: 'Truck 1' };
    assert.equal(appointmentStatus(displayed), 'Canceled', 'Cancellation outranks GPS on-site evidence');
    assert.equal(scheduleDisplayTruck(displayed), 'Unassigned', 'Leaves active truck lane');
    assert.deepEqual(scheduleBoardJobs([displayed], 'Truck 1'), [], 'Not an active truck stop');
  };
  assertCanceled('Canonical snapshot cannot undo cancellation after 30 minutes');
  writeFast([row]);
  assertCanceled('Fast snapshot merge cannot overwrite verified cancellation');
  writeFast([{ ...row, collection_timestamp: '' }]);
  assertCanceled('Market scrape timestamp is retained when row timestamp is missing');
  writeFast([row], later);
  assertCanceled('Newer aggregate scrape cannot freshen a stale appointment row');
  writeFast([{ ...row, collection_timestamp: later }], later);
  assert.equal(readJobRows(date)[0].status, 'Confirmed', 'Later source restoration wins');
  writeFast([{ ...row, collection_timestamp: '', job_status: 'Confirmed' }], later);
  assert.equal(readJobRows(date)[0].status, 'Confirmed', 'Later own-market observation wins');
  const plain = { appointmentId: '12345', status: 'Confirmed', cancellationReason: '', statusObservedAt: 'invalid' };
  assert.equal(applyVerifiedJobCancellations([plain], [entry])[0].status, 'Canceled');
  assert.equal(plain.status, 'Confirmed', 'Overlay does not mutate cached inputs');
  assert.equal(applyVerifiedJobCancellations([{ ...plain, statusObservedAt: verified }], [entry])[0].status, 'Canceled', 'Equal timestamps favor verified cancellation');
  assert.equal(applyVerifiedJobCancellations([{ ...plain, appointmentId: '98765' }], [entry])[0].status, 'Confirmed', 'Unrelated appointments unchanged');
  assert.equal(applyVerifiedJobCancellations([plain], [{ ...entry, junkwareVerifiedAt: '' }])[0].status, 'Confirmed', 'Unverified receipt ignored');
  console.log('Cancellation precedence: canonical, fast merge, delayed history, restoration, GPS and isolation passed.');
} finally {
  fs.rmSync(temporary, { recursive: true, force: true });
}
}
void main();
