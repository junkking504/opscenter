import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { applyVerifiedPhotoReceipts, newVerifiedAppointmentMedia, readRecentVerifiedPhotoReceipts, verifiedAppointmentMedia } from '../lib/verified-job-photos';

const now = Date.now();
const at = (offset: number) => new Date(now + offset).toISOString();
const url = 'https://junkware.junk-king.com/system/aspnet/local/media/2026-09/test-4075431-unique-after.jpg';
const job = { appointmentId: '4075431', jkNumber: 'JK4088609', photos: [], photoAuditAvailable: true, photoObservedAt: at(-60_000) };
const receipt = { outcome: 'completed', outcomeAt: at(-1000), match: { status: 'matched', appointmentId: job.appointmentId, jkNumber: job.jkNumber }, upload: { verified: true, beforeCount: 0, afterCount: 1, mediaUrls: [url] } };
const project = (input: unknown, override = {}) => applyVerifiedPhotoReceipts([{ ...job, ...override }], [input], now)[0];

assert.equal(project(receipt).photos.length, 1, 'Verified receipt bridges a stale photo snapshot');
for (const invalid of [
  { ...receipt, outcome: 'failed' },
  { ...receipt, outcome: 'review' },
  { ...receipt, outcomeAt: at(1000) },
  { ...receipt, outcomeAt: at(-31 * 60_000) },
  { ...receipt, upload: { ...receipt.upload, verified: false } },
  { ...receipt, upload: { ...receipt.upload, afterCount: 0 } },
  { ...receipt, upload: { ...receipt.upload, mediaUrls: undefined } },
  { ...receipt, match: { ...receipt.match, appointmentId: '4075432' } },
  { ...receipt, match: { ...receipt.match, jkNumber: 'JK4088610' } },
  { ...receipt, match: { ...receipt.match, status: 'review' } },
]) assert.equal(project(invalid).photos.length, 0, 'Unverified, legacy, expired or wrong-identity receipts cannot add photos');
for (const sourceAt of [at(0), receipt.outcomeAt]) {
  assert.equal(project(receipt, { photoObservedAt: sourceAt }).photos.length, 0, 'Newer/equal authoritative empty gallery removes receipt projection');
}
assert.equal(project(receipt, { photoObservedAt: undefined }).photos.length, 0, 'An authoritative gallery with unknown age fails closed');
assert.equal(project(receipt, { photoObservedAt: undefined, photoAuditAvailable: false }).photos.length, 1, 'Verified receipt can bridge a missing gallery audit');
const photo = verifiedAppointmentMedia([url], job.appointmentId)[0];
assert.equal(project(receipt, { photos: [{ ...photo, url: `${url}?v=source` }] }).photos.length, 1, 'Query versions do not duplicate source photos');
assert.equal(applyVerifiedPhotoReceipts([job], [receipt, receipt], now)[0].photos.length, 1, 'Duplicate receipts do not duplicate media');
for (const unsafe of [url.replace('https:', 'http:'), url.replace('junkware.junk-king.com', 'evil.example'), url.replace('https://', 'https://user:password@'), url.replace('.com/', '.com:8443/'), url.replace('/media/', '/other/'), url.replace('4075431', '4075432'), url.replace('.jpg', '.svg'), `${url}#fragment`, '/system/aspnet/local/media/test-4075431-photo.jpg']) {
  assert.equal(project({ ...receipt, upload: { ...receipt.upload, mediaUrls: [unsafe] } }).photos.length, 0, `Reject unsafe image: ${unsafe}`);
}
assert.deepEqual(newVerifiedAppointmentMedia([`${url}?v=old`], [`${url}?v=new`], job.appointmentId), [], 'Changed cache version is not a new upload');
assert.deepEqual(newVerifiedAppointmentMedia([], [url, url], job.appointmentId), [url]);

async function main() {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'verified-photo-'));
  const previous = process.env.OPSBOT_DATA_DIR;
  const previousState = process.env.WHATSAPP_JOB_PHOTO_STATE_DIR;
  process.env.OPSBOT_DATA_DIR = temp;
  delete process.env.WHATSAPP_JOB_PHOTO_STATE_DIR;
  try {
    const completed = path.join(temp, 'integrations/whatsapp-job-photos/completed');
    const history = path.join(temp, 'history/junkware');
    fs.mkdirSync(completed, { recursive: true }); fs.mkdirSync(history, { recursive: true });
    const name = `${'a'.repeat(64)}.json`;
    fs.writeFileSync(path.join(completed, name), JSON.stringify(receipt));
    fs.writeFileSync(path.join(completed, `${'b'.repeat(64)}.json`), 'invalid JSON');
    fs.symlinkSync(path.join(completed, name), path.join(completed, `${'c'.repeat(64)}.json`));
    assert.equal(readRecentVerifiedPhotoReceipts(temp, now).length, 1, 'Malformed records and symlinks are ignored');
    const newFile = path.join(completed, `${'d'.repeat(64)}.json`);
    fs.writeFileSync(newFile, JSON.stringify(receipt));
    assert.equal(readRecentVerifiedPhotoReceipts(temp, now).length, 2, 'A new receipt is visible immediately despite the directory index');
    fs.unlinkSync(newFile);
    assert.equal(readRecentVerifiedPhotoReceipts(temp, now).length, 1, 'Removed receipt does not remain cached');
    fs.writeFileSync(path.join(completed, name), JSON.stringify({ ...receipt, outcome: 'review' }));
    assert.equal(applyVerifiedPhotoReceipts([job], readRecentVerifiedPhotoReceipts(temp, now), now)[0].photos.length, 0, 'A recent receipt correction is re-read without a cache delay');
    fs.writeFileSync(path.join(completed, name), JSON.stringify(receipt));
    const date = '2026-09-16';
    const raw = { appt_id: job.appointmentId, job_id: job.jkNumber, photos: [], collection_timestamp: job.photoObservedAt };
    const rawFile = path.join(history, `junkware_${date}_raw.json`);
    const writeRaw = (row: object) => fs.writeFileSync(rawFile, JSON.stringify({ date, scraped_at: at(0), appointments: [row] }));
    writeRaw(raw);
    fs.writeFileSync(path.join(history, `junkware_live_${date}_summary.csv`), `appt_id,job_id,customer_name,appointment_type,job_status,appointment_time,truck\n${job.appointmentId},${job.jkNumber},Fixture,Job,Confirmed,1:00 PM-2:00 PM,Truck 9\n`);
    const { readJobRows, mergeFastScheduleRows } = await import('../lib/desktop-schedule-source');
    assert.equal(readJobRows(date)[0].photos.length, 1, 'Actual Schedule source publishes receipt without waiting for collector');
    writeRaw({ ...raw, photos: [url], collection_timestamp: at(0) });
    assert.equal(readJobRows(date)[0].photos.length, 1, 'Collector catches up without duplicate');
    writeRaw({ ...raw, photos: [], collection_timestamp: at(0) });
    assert.equal(readJobRows(date)[0].photos.length, 0, 'A later source deletion remains removed on subsequent reads');
    writeRaw({ ...raw, photos: [url] });
    const base = readJobRows(date);
    const merged = mergeFastScheduleRows(base, [{ ...raw, photos: [], collection_timestamp: at(0) }], [], date);
    assert.equal(merged[0].photos.length, 0, 'A newer authoritative fast snapshot with an explicit empty gallery wins');
    const noAudit = { ...raw, photos: undefined, collection_timestamp: at(0) };
    delete noAudit.photos;
    assert.equal(mergeFastScheduleRows(base, [noAudit], [], date)[0].photos.length, 1, 'Schedule-only polling never pretends to refresh the gallery');
  } finally {
    if (previous === undefined) delete process.env.OPSBOT_DATA_DIR; else process.env.OPSBOT_DATA_DIR = previous;
    if (previousState === undefined) delete process.env.WHATSAPP_JOB_PHOTO_STATE_DIR; else process.env.WHATSAPP_JOB_PHOTO_STATE_DIR = previousState;
    fs.rmSync(temp, { recursive: true, force: true });
  }
  console.log('Verified photo projection passed: identity, source catch-up/removal, safety, duplicates and fresh Schedule reads.');
}
void main();
