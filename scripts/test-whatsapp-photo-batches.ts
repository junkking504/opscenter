import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { mock } from 'node:test';
import { createPhotoDownloadPool, createPhotoUploadBatchQueue, drainConcurrentPhotoQueue, type BatchResult } from '../lib/whatsapp-photo-batch-pipeline';
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

    const verified = (inputs: PhotoUploadInput[]): BatchResult => ({ results: inputs.map(input => ({ filePath: input.filePath, status: 'verified' as const, verification: { beforeCount: 0, afterCount: inputs.length, mediaUrls: [input.filePath], galleryUrls: inputs.map(row => row.filePath), galleryObservedAt: '2026-09-16T22:28:00Z' } })).reverse() });
    const noOp = async (inputs: PhotoUploadInput[]) => verified(inputs);
    assert.throws(() => createPhotoUploadBatchQueue([]), /one to three/);
    assert.throws(() => createPhotoUploadBatchQueue([noOp, noOp, noOp, noOp]), /one to three/);

    // A bounded first window includes originals that finish a little later;
    // fake time proves this without timing-sensitive sleeps or live uploads.
    mock.timers.enable({ apis: ['setTimeout'] });
    try {
      const coalesced: PhotoUploadInput[][] = [];
      const coalescer = createPhotoUploadBatchQueue(async inputs => { coalesced.push(inputs); return verified(inputs); });
      const first = coalescer.upload(makeInput(120));
      mock.timers.tick(499); await tick(); assert.equal(coalesced.length, 0);
      const second = coalescer.upload(makeInput(121));
      mock.timers.tick(1); await tick(); const coalescedResults = await Promise.all([first, second]);
      assert.deepEqual(coalescedResults.map(result => result.mediaUrls[0]), coalesced[0].map(input => input.filePath), 'Reversed source results match exact files');
      assert.equal(coalesced[0].length, 2, 'First group waits exactly the bounded500ms window');
      const later = coalescer.upload(makeInput(122));
      mock.timers.tick(99); await tick(); assert.equal(coalesced.length, 1);
      mock.timers.tick(1); await tick(); await later;
      assert.equal(coalesced.length, 2); await coalescer.close();
    } finally { mock.timers.reset(); }

    // Authenticate while originals accumulate, but do not freeze or submit a
    // group until BOTH the initial window and preparation have finished.
    mock.timers.enable({ apis: ['setTimeout'] });
    try {
      const preparedGroups: PhotoUploadInput[][] = [], preparationGate = deferred(); let preparations = 0;
      const preparedQueue = createPhotoUploadBatchQueue([async inputs => { preparedGroups.push(inputs); return verified(inputs); }], {
        prepare: async () => { preparations++; await preparationGate.promise; },
      });
      const preparedInputs = [makeInput(123, 100_000), ...[124, 125, 126].map(index => makeInput(index, 1024 * 1024))];
      const preparedOutcomes = [preparedQueue.upload(preparedInputs[0])];
      await tick(); assert.equal(preparations, 1, 'Preparation starts with first ready original');
      mock.timers.tick(499); await tick(); assert.equal(preparedGroups.length, 0);
      preparedOutcomes.push(...preparedInputs.slice(1).map(input => preparedQueue.upload(input)));
      mock.timers.tick(1); await tick(); assert.equal(preparedGroups.length, 0, 'Elapsed coalescing window cannot bypass preparation');
      let preparedClosed = false; const preparedClosing = preparedQueue.close().then(() => { preparedClosed = true; });
      await tick(); assert.equal(preparedClosed, false, 'Close waits for authentication');
      preparationGate.resolve(); await Promise.all([...preparedOutcomes, preparedClosing]);
      assert.equal(preparedGroups.length, 1); assert.equal(preparedGroups[0].length, 4, 'All ready originals remain packable during authentication');
      assert.equal(preparations, 1); assert.equal(preparedClosed, true);

      let fastPosts = 0;
      const fastPrepare = createPhotoUploadBatchQueue(async inputs => { fastPosts++; return verified(inputs); }, { prepare: async () => {} });
      const fastResult = fastPrepare.upload(makeInput(127)); await tick();
      const fastClose = fastPrepare.close(); mock.timers.tick(499); await tick(); assert.equal(fastPosts, 0, 'Fast authentication and close cannot bypass first window');
      mock.timers.tick(1); await Promise.all([fastResult, fastClose]); assert.equal(fastPosts, 1);
    } finally { mock.timers.reset(); }

    mock.timers.enable({ apis: ['setTimeout'] });
    try {
      let failPreparation!: (error: Error) => void, preparationCalls = 0;
      const preparationFailure = new Promise<void>((_, reject) => { failPreparation = reject; });
      const afterFailure: PhotoUploadInput[][] = [];
      const failedPrepare = createPhotoUploadBatchQueue(async inputs => { afterFailure.push(inputs); return verified(inputs); }, {
        prepare: async () => { preparationCalls++; await preparationFailure; },
      });
      const heldInput = makeInput(128), otherPreparedTarget = { ...makeInput(129), jkNumber: 'JK4088609', appointmentId: '4075431' };
      const failureOutcomes = Promise.allSettled([failedPrepare.upload(heldInput), failedPrepare.upload(otherPreparedTarget)]);
      await tick(); mock.timers.tick(500); await tick(); assert.equal(afterFailure.length, 0);
      failPreparation(new Error('authentication preparation failed')); await tick();
      await assert.rejects(failedPrepare.upload(heldInput), /authentication preparation failed/, 'Same target cannot hot-retry preparation');
      await failedPrepare.close(); const failedResults = await failureOutcomes;
      assert.equal(failedResults[0].status, 'rejected'); assert.equal(failedResults[1].status, 'fulfilled');
      assert.deepEqual(afterFailure.flatMap(group => group.map(input => input.filePath)), [otherPreparedTarget.filePath]);
      assert.equal(preparationCalls, 1, 'Failed preparation is handled once without unhandled rejection or deadlock');
    } finally { mock.timers.reset(); }

    // Three separate callbacks each own at most one group. A different target
    // waits for all writers, and results are associated by exact file, not order.
    const laneCalls: { lane: number; inputs: PhotoUploadInput[]; gate: ReturnType<typeof deferred> }[] = [];
    const laneBusy = [0, 0, 0]; let concurrentWriters = 0, highestWriters = 0;
    const originalInputs = Array.from({ length: 5 }, (_, i) => makeInput(130 + i, 3 * 1024 * 1024));
    const nextTarget = { ...makeInput(135), appointmentId: '4075431', jkNumber: 'JK4088609' };
    const backToFirst = makeInput(136);
    const allOriginals = [...originalInputs, nextTarget, backToFirst];
    const originalHashes = allOriginals.map(input => crypto.createHash('sha256').update(fs.readFileSync(input.filePath)).digest('hex'));
    const parallel = createPhotoUploadBatchQueue(laneBusy.map((_, lane) => async inputs => {
      assert.equal(laneBusy[lane], 0); laneBusy[lane]++; concurrentWriters++; highestWriters = Math.max(highestWriters, concurrentWriters);
      const call = { lane, inputs, gate: deferred() }; laneCalls.push(call); await call.gate.promise;
      laneBusy[lane]--; concurrentWriters--; return verified(inputs);
    }));
    const parallelOutcomes = Promise.all(allOriginals.map(input => parallel.upload(input)));
    let parallelClosed = false;
    const parallelClosing = parallel.close().then(() => { parallelClosed = true; });
    await tick(); assert.equal(laneCalls.length, 3); assert.equal(concurrentWriters, 3); assert.equal(parallelClosed, false);
    laneCalls[1].gate.resolve(); await tick(); assert.equal(laneCalls.length, 4); assert.equal(laneCalls[3].lane, 1);
    laneCalls[0].gate.resolve(); await tick(); assert.equal(laneCalls.length, 5);
    laneCalls[2].gate.resolve(); await tick(); assert.equal(laneCalls.length, 5, 'Other target waits despite a free lane');
    laneCalls[4].gate.resolve(); await tick(); assert.equal(laneCalls.length, 5);
    laneCalls[3].gate.resolve(); await tick(); assert.equal(laneCalls.length, 6); assert.equal(laneCalls[5].inputs[0].jkNumber, nextTarget.jkNumber);
    laneCalls[5].gate.resolve(); await tick(); assert.equal(laneCalls.length, 7); assert.equal(laneCalls[6].inputs[0].jkNumber, backToFirst.jkNumber);
    laneCalls[6].gate.resolve(); const parallelResults = await parallelOutcomes; await parallelClosing;
    assert.equal(highestWriters, 3); assert.equal(parallelClosed, true);
    parallelResults.forEach((result, index) => assert.deepEqual(result.mediaUrls, [allOriginals[index].filePath]));
    assert.deepEqual(allOriginals.map(input => crypto.createHash('sha256').update(fs.readFileSync(input.filePath)).digest('hex')), originalHashes, 'Uploaded originals remain byte-for-byte unchanged');
    assert.equal(new Set(laneCalls.flatMap(call => call.inputs.map(input => input.filePath))).size, allOriginals.length);
    await assert.rejects(parallel.upload(makeInput(137)), /closed/);

    // The production finalizer holds every promise until all same-target groups
    // finish and the owning-gallery audit succeeds. It is also a target barrier.
    const auditedCalls: { inputs: PhotoUploadInput[]; gate: ReturnType<typeof deferred> }[] = [];
    const audits: { inputs: PhotoUploadInput[]; gate: ReturnType<typeof deferred> }[] = [];
    const auditInputs = Array.from({ length: 4 }, (_, i) => makeInput(140 + i, 3 * 1024 * 1024));
    const auditOther = { ...makeInput(144), category: 'before' as const };
    const auditQueue = createPhotoUploadBatchQueue(Array.from({ length: 3 }, () => async (inputs: PhotoUploadInput[]) => {
      const call = { inputs, gate: deferred() }; auditedCalls.push(call); await call.gate.promise;
      return inputs[0].filePath === auditInputs[1].filePath ? { results: [{ filePath: inputs[0].filePath, status: 'uncertain' as const, error: 'original uncertain POST' }] } : verified(inputs);
    }), { finalize: async (inputs, result) => {
      const audit = { inputs, gate: deferred() }; audits.push(audit); await audit.gate.promise;
      const output = verified(inputs); // Even a mistaken promotion cannot erase uncertainty.
      assert.equal(result.results.length, inputs.length);
      for (const row of output.results) if (row.status === 'verified') row.verification.galleryUrls = ['final owning gallery'];
      return output;
    } });
    let settled = 0;
    const auditOutcomes = Promise.allSettled([...auditInputs, auditOther].map(input => auditQueue.upload(input).then(result => { settled++; return result; }, error => { settled++; throw error; })));
    const auditClosing = auditQueue.close(); await tick(); assert.equal(auditedCalls.length, 3);
    auditedCalls[1].gate.resolve(); await tick(); assert.equal(auditedCalls.length, 4);
    auditedCalls[0].gate.resolve(); auditedCalls[2].gate.resolve(); await tick(); assert.equal(audits.length, 0); assert.equal(settled, 0);
    auditedCalls[3].gate.resolve(); await tick(); assert.equal(audits.length, 1); assert.equal(settled, 0); assert.equal(auditedCalls.length, 4);
    audits[0].gate.resolve(); await tick(); assert.equal(settled, 4); assert.equal(auditedCalls.length, 5, 'Next category begins only after owning audit');
    auditedCalls[4].gate.resolve(); await tick(); assert.equal(audits.length, 2); audits[1].gate.resolve();
    const auditedOutcomes = await auditOutcomes; await auditClosing;
    assert.equal(auditedOutcomes[1].status, 'rejected');
    for (const result of auditedOutcomes.filter(row => row.status === 'fulfilled')) if (result.status === 'fulfilled') assert.deepEqual(result.value.galleryUrls, ['final owning gallery']);
    assert.equal(auditedCalls.flatMap(call => call.inputs).length, 5, 'Uncertain photo is not retried or promoted');

    // More downloads may finish while an audit awaits the source. They form a
    // later epoch, cannot write during that audit, and cannot deadlock close.
    mock.timers.enable({ apis: ['setTimeout'] });
    try {
      const lateAudits: ReturnType<typeof deferred>[] = []; let latePosts = 0;
      const lateQueue = createPhotoUploadBatchQueue([async inputs => { latePosts++; return verified(inputs); }], {
        finalize: async inputs => { const gate = deferred(); lateAudits.push(gate); await gate.promise; return verified(inputs); },
      });
      const beforeAudit = lateQueue.upload(makeInput(145));
      mock.timers.tick(500); await tick(); assert.equal(lateAudits.length, 1);
      const duringAudit = lateQueue.upload(makeInput(146));
      mock.timers.tick(1_000); await tick(); assert.equal(latePosts, 1, 'No writer overlaps the owning-gallery audit');
      lateAudits[0].resolve(); await tick(); assert.equal(latePosts, 2); assert.equal(lateAudits.length, 2);
      let lateClosed = false; const lateClosing = lateQueue.close().then(() => { lateClosed = true; });
      await tick(); assert.equal(lateClosed, false); lateAudits[1].resolve();
      await Promise.all([beforeAudit, duringAudit, lateClosing]); assert.equal(lateClosed, true);
    } finally { mock.timers.reset(); }

    let failedGroups = 0, failedAudits = 0;
    const failedQueue = createPhotoUploadBatchQueue([async inputs => { failedGroups++; return verified(inputs); }, async () => { failedGroups++; throw new Error('unknown POST outcome'); }], {
      finalize: async () => { failedAudits++; throw new Error('final owning audit failed'); },
    });
    const failedOutcomes = Promise.allSettled([makeInput(150, 3 * 1024 * 1024), makeInput(151, 3 * 1024 * 1024)].map(input => failedQueue.upload(input)));
    await failedQueue.close(); assert.equal(failedGroups, 2); assert.equal(failedAudits, 1);
    assert.ok((await failedOutcomes).every(row => row.status === 'rejected'), 'Audit failure holds the entire epoch without another POST');

    const write = (m: WhatsAppImageMessage) => { const file = path.join(root, 'incoming', crypto.createHash('sha256').update(m.messageId).digest('hex') + '.json'); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(m)); return file; };
    for (let i = 0; i < 101; i++) write({ ...message('queue-' + i), enqueuedAt: new Date(Date.parse('2026-09-16T21:12:54Z') + i).toISOString() });
    let processing = 0, peakProcessing = 0, attempted = 0;
    await drainConcurrentPhotoQueue(async file => { const claim = claimWhatsAppImage(file)!; processing++; peakProcessing = Math.max(peakProcessing, processing); await tick(); processing--; attempted++; requeueWhatsAppImage(claim.file, 'simulated transient error'); });
    assert.equal(attempted, 100); assert.equal(peakProcessing, 32); assert.equal(fs.readdirSync(path.join(root, 'incoming')).length, 101, 'Retries and the101st item are left for another cycle');
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
  console.log('PASS: four concurrent downloads, singleflight failures, 32 bounded photo tasks, original-byte size-bounded groups, three independent source lanes, target/audit barriers, partial uncertainty, alternate-workflow barriers and one final confirmation across held recovery');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
