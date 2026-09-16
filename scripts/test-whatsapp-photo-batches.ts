import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { createPhotoDownloadPool, createPhotoUploadBatchQueue, drainConcurrentPhotoQueue } from '../lib/whatsapp-photo-batch-pipeline';
import { claimWhatsAppImage, finishWhatsAppImage, requeueWhatsAppImage, recordWhatsAppTextContext, type WhatsAppImageMessage } from '../lib/whatsapp-job-photo-queue';
import { recordVerifiedWhatsAppJobPhoto, queueVerifiedWhatsAppJobPhotoBatchConfirmations } from '../lib/whatsapp-job-photo-confirmations';
import type { PhotoUploadInput } from '../lib/junkware-photo-uploader';

const deferred = () => { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; };
const tick = () => new Promise<void>(resolve => setImmediate(resolve));
const message = (id: string): WhatsAppImageMessage => ({ version: 1, messageId: id, mediaId: '12345', phoneNumberId: '12345', senderPhone: '5045550100', receivedAt: '2026-09-16T21:12:50Z', enqueuedAt: '2026-09-16T21:12:54Z', sha256: 'a'.repeat(64), mimeType: 'image/jpeg', caption: '', matchingContext: { version: 1, text: 'JK4088445', sourceMessageIds: [], capturedAt: '2026-09-16T21:12:54Z' } });

async function main() {
  const oldState = process.env.WHATSAPP_JOB_PHOTO_STATE_DIR, oldExpense = process.env.WHATSAPP_CREW_EXPENSE_STATE_DIR, oldPhone = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'photo-batch-'));
  process.env.WHATSAPP_JOB_PHOTO_STATE_DIR = root; process.env.WHATSAPP_CREW_EXPENSE_STATE_DIR = root; delete process.env.WHATSAPP_PHONE_NUMBER_ID;
  try {
    let active = 0, peak = 0, requests = 0;
    const gates = Array.from({ length: 9 }, deferred);
    const pool = createPhotoDownloadPool(async m => { const index = Number(m.messageId); requests++; active++; peak = Math.max(peak, active); await gates[index].promise; active--; if (index === 8) throw new Error('one failed attempt'); return m.messageId; });
    const downloads = Array.from({ length: 8 }, (_, i) => pool.download(message(String(i))));
    const duplicate = pool.download(message('0'));
    await tick(); assert.equal(active, 4); assert.equal(requests, 4);
    gates[0].resolve(); await downloads[0]; await tick(); assert.equal(active, 4);
    for (const gate of gates) gate.resolve(); await Promise.all([...downloads, duplicate]);
    assert.equal(requests, 8); assert.equal(peak, 4);
    await assert.rejects(pool.download(message('8')), /one failed attempt/);
    await assert.rejects(pool.download(message('8')), /one failed attempt/); assert.equal(requests, 9, 'Failure is shared, never retried by scheduler');
    await pool.close(); await assert.rejects(pool.download(message('new')), /closed/);

    const makeInput = (index: number, bytes = 100): PhotoUploadInput => { const filePath = path.join(root, `${String(index).padStart(64, '0')}.jpg`); fs.writeFileSync(filePath, Buffer.alloc(bytes)); return { appointmentId: '4075267', jkNumber: 'JK4088445', category: 'after', filePath }; };
    const groups: PhotoUploadInput[][] = []; let writers = 0, peakWriters = 0;
    const batcher = createPhotoUploadBatchQueue(async inputs => {
      writers++; peakWriters = Math.max(peakWriters, writers); groups.push(inputs); await tick(); writers--;
      return { results: inputs.map((input, index) => input.filePath.endsWith('9.jpg') ? { filePath: input.filePath, status: 'uncertain' as const, error: 'source missing exact file' } : { filePath: input.filePath, status: 'verified' as const, verification: { beforeCount: 0, afterCount: inputs.length, mediaUrls: [String(index)], galleryUrls: inputs.map((_, i) => String(i)), galleryObservedAt: new Date().toISOString() } }) };
    });
    const small = Array.from({ length: 6 }, (_, i) => makeInput(i));
    const large = [makeInput(6, 3 * 1024 * 1024), makeInput(7, 3 * 1024 * 1024)];
    const other = { ...makeInput(8), category: 'before' as const };
    const outcomes = await Promise.allSettled([...small, ...large, other, makeInput(9)].map(input => batcher.upload(input)));
    await batcher.close(); assert.equal(peakWriters, 1); assert.equal(outcomes.filter(r => r.status === 'fulfilled').length, 9); assert.equal(outcomes[9].status, 'rejected');
    assert.equal(groups.flat().length, 10, 'Each file submitted once, including uncertain result');
    assert.equal(groups[0].length, 5);
    for (const group of groups) {
      assert.ok(group.length <= 5);
      assert.ok(group.length === 1 || group.reduce((sum, input) => sum + fs.statSync(input.filePath).size, 0) <= 4.5 * 1024 * 1024);
      assert.equal(new Set(group.map(input => `${input.appointmentId}:${input.jkNumber}:${input.category}`)).size, 1);
    }

    const packed: PhotoUploadInput[][] = [];
    const packer = createPhotoUploadBatchQueue(async inputs => {
      packed.push(inputs);
      return { results: inputs.map(input => ({ filePath: input.filePath, status: 'verified' as const, verification: { beforeCount: 0, afterCount: inputs.length, mediaUrls: [input.filePath], galleryUrls: inputs.map(row => row.filePath), galleryObservedAt: new Date().toISOString() } })) };
    });
    const packingInputs = [makeInput(110, 3 * 1024 * 1024), makeInput(111, 4 * 1024 * 1024), makeInput(112, 1024 * 1024), { ...makeInput(113, 100), category: 'before' as const }, makeInput(114, 100)];
    await Promise.all(packingInputs.map(input => packer.upload(input))); await packer.close();
    assert.deepEqual(packed.map(group => group.map(input => input.filePath)), [
      [packingInputs[0].filePath, packingInputs[2].filePath], [packingInputs[1].filePath], [packingInputs[3].filePath], [packingInputs[4].filePath],
    ], 'Fill spare capacity around a large ready photo, preserving oldest first and category barriers');

    const write = (m: WhatsAppImageMessage) => { const file = path.join(root, 'incoming', crypto.createHash('sha256').update(m.messageId).digest('hex') + '.json'); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(m)); return file; };
    for (let i = 0; i < 101; i++) write({ ...message('queue-' + i), enqueuedAt: new Date(Date.parse('2026-09-16T21:12:54Z') + i).toISOString() });
    let processing = 0, peakProcessing = 0, attempted = 0;
    await drainConcurrentPhotoQueue(async file => { const claim = claimWhatsAppImage(file)!; processing++; peakProcessing = Math.max(peakProcessing, processing); await tick(); processing--; attempted++; requeueWhatsAppImage(claim.file, 'simulated transient error'); });
    assert.equal(attempted, 100); assert.equal(peakProcessing, 8); assert.equal(fs.readdirSync(path.join(root, 'incoming')).length, 101, 'Retries and the101st item are left for another cycle');
    fs.rmSync(path.join(root, 'incoming'), { recursive: true });
    write({ ...message('first'), enqueuedAt: '2026-09-16T21:12:54.001Z' });
    write({ ...message('special'), enqueuedAt: '2026-09-16T21:12:54.002Z', caption: 'resale chair' });
    write({ ...message('last'), enqueuedAt: '2026-09-16T21:12:54.003Z' });
    await drainConcurrentPhotoQueue(async file => { const claim = claimWhatsAppImage(file)!; if (claim.message.caption) assert.equal(processing, 0, 'Alternate workflow waits for all photo tasks'); processing++; await tick(); processing--; finishWhatsAppImage(claim.file, 'completed', {}); });

    // One send with2successes and17held photos stays one pending completion.
    const confirmation = { messageId: 'verified-1', jkNumber: 'JK4088445', jobDate: '2026-09-16', senderPhone: '5045550100', phoneNumberId: '12345', receivedAt: '2026-09-16T21:12:53Z' };
    const now = new Date('2026-09-16T21:13:30Z');
    recordVerifiedWhatsAppJobPhoto({ ...confirmation, now }); recordVerifiedWhatsAppJobPhoto({ ...confirmation, messageId: 'verified-2', now });
    for (let i = 0; i < 17; i++) { const claim = claimWhatsAppImage(write({ ...message('held-' + i), matchingContext: undefined }))!; finishWhatsAppImage(claim.file, 'review', { review: { reason: 'sender_not_mapped_to_truck' } }); }
    assert.equal(queueVerifiedWhatsAppJobPhotoBatchConfirmations(now).queued, 0);
    assert.equal(queueVerifiedWhatsAppJobPhotoBatchConfirmations(now).queued, 0);
    const outbox = path.join(root, 'outbox-incoming'); assert.equal(fs.readdirSync(outbox).length, 1, 'One review notice, no false success');
    for (const file of fs.readdirSync(path.join(root, 'review'))) { const full = path.join(root, 'review', file); const held = JSON.parse(fs.readFileSync(full, 'utf8')); fs.renameSync(full, path.join(root, 'completed', file)); recordVerifiedWhatsAppJobPhoto({ ...confirmation, messageId: held.messageId, receivedAt: held.receivedAt, now }); }
    // Old and explicitly other-job holds must not block the completed send.
    for (const m of [{ ...message('old-hold'), receivedAt: '2026-09-16T20:00:00Z' }, { ...message('other-job'), caption: 'JK9999999' }, { ...message('other-job-category'), caption: 'after', matchingContext: { ...message('x').matchingContext!, text: 'JK9999999' } }]) { const claim = claimWhatsAppImage(write(m))!; finishWhatsAppImage(claim.file, 'review', {}); }
    assert.equal(queueVerifiedWhatsAppJobPhotoBatchConfirmations(now).queued, 1);
    const replies = fs.readdirSync(outbox).map(file => JSON.parse(fs.readFileSync(path.join(outbox, file), 'utf8')).text);
    assert.ok(replies.includes('19 photos for JK4088445 uploaded and verified in JunkWare.'));
    assert.equal(replies.filter(text => text.endsWith('uploaded and verified in JunkWare.')).length, 1);

    // A safe hold resolved by a trailing job text must not wait through another
    // worker sleep. Once bound, a transient retry still waits for the next cycle.
    const burstAt = new Date(Date.now() - 2_000).toISOString();
    write({ ...message('same-cycle'), timestampSource: 'provider', receivedAt: burstAt, enqueuedAt: burstAt, matchingContext: { version: 1, text: '', sourceMessageIds: [], capturedAt: burstAt } });
    let reboundAttempts = 0;
    const cycleAttempts = await drainConcurrentPhotoQueue(async file => {
      const claim = claimWhatsAppImage(file)!; reboundAttempts++;
      if (reboundAttempts === 1) {
        finishWhatsAppImage(claim.file, 'review', { review: { reason: 'sender_not_mapped_to_truck' } });
        recordWhatsAppTextContext({ messageId: 'same-cycle-job', senderPhone: claim.message.senderPhone, phoneNumberId: claim.message.phoneNumberId, receivedAt: new Date().toISOString(), timestampSource: 'provider', text: 'JK4088445' });
      } else {
        assert.equal(claim.message.matchingContext?.text, 'JK4088445');
        requeueWhatsAppImage(claim.file, 'simulated transient failure');
      }
    });
    assert.equal(cycleAttempts, 2); assert.equal(reboundAttempts, 2, 'One newly bound attempt runs immediately; its unchanged retry cannot loop');
  } finally {
    for (const [key, value] of Object.entries({ WHATSAPP_JOB_PHOTO_STATE_DIR: oldState, WHATSAPP_CREW_EXPENSE_STATE_DIR: oldExpense, WHATSAPP_PHONE_NUMBER_ID: oldPhone })) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    fs.rmSync(root, { recursive: true, force: true });
  }
  console.log('PASS: four concurrent downloads, singleflight failures, eight bounded photo tasks, same-job size-bounded groups, one source writer, partial uncertainty, alternate-workflow barriers and one final confirmation across held recovery');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
