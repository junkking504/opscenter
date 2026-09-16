import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createWhatsAppPhotoPrefetch, jobPhotoPrefetchEligible, readJobPhotoPrefetchCandidate } from '../lib/whatsapp-photo-prefetch';
import { claimWhatsAppImage, drainWhatsAppPhotoQueue, finishWhatsAppImage, hasUnfinishedWhatsAppPhotosForSender, queuedWhatsAppImages, requeueWhatsAppImage, type WhatsAppImageMessage } from '../lib/whatsapp-job-photo-queue';
import { downloadWhatsAppImage } from '../lib/whatsapp-photo-media';

function deferred() { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; }
const tick = () => new Promise<void>(resolve => setImmediate(resolve));
const fixture = (id: string): WhatsAppImageMessage => ({ version: 1, messageId: id, senderPhone: '5045550101', phoneNumberId: '123', mediaId: '456', receivedAt: '2026-09-16T20:00:00Z', enqueuedAt: '2026-09-16T20:00:00Z', mimeType: 'image/jpeg', sha256: 'a'.repeat(64), caption: '', matchingContext: { version: 1, text: '#JK4088609', sourceMessageIds: ['context'], capturedAt: '2026-09-16T19:59:00Z' } });
async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'photo-prefetch-'));
  const keys = ['WHATSAPP_JOB_PHOTO_STATE_DIR', 'OPSBOT_DATA_DIR', 'WHATSAPP_PHONE_NUMBER_ID', 'WHATSAPP_ACCESS_TOKEN', 'WHATSAPP_ACCESS_TOKEN_BASE64', 'WHATSAPP_GRAPH_API_VERSION'];
  const saved = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  const originalFetch = globalThis.fetch;
  process.env.WHATSAPP_JOB_PHOTO_STATE_DIR = root; process.env.OPSBOT_DATA_DIR = root; process.env.WHATSAPP_PHONE_NUMBER_ID = '123';
  const write = (message: WhatsAppImageMessage) => { queuedWhatsAppImages(); const file = path.join(root, 'incoming', `${crypto.createHash('sha256').update(message.messageId).digest('hex')}.json`); fs.writeFileSync(file, JSON.stringify(message)); return file; };
  try {
    const one = fixture('one'), two = fixture('two');
    assert.equal(jobPhotoPrefetchEligible(one), true);
    for (const patch of [{ caption: 'resale chair' }, { caption: 'recycling' }, { caption: 'Truck 8 50%' }, { caption: '#JK111111 #JK222222' }, { receivedAt: 'bad' }, { sha256: '' }, { phoneNumberId: '999' }, { matchingContext: undefined }, { matchingContext: { ...one.matchingContext!, recycling: { text: 'recycling', messageId: 'x' } } }, { matchingContext: { ...one.matchingContext!, resale: { text: 'resale', messageId: 'x' } } }, { matchingContext: { ...one.matchingContext!, reviewReason: 'ambiguous_context' as const } }]) {
      assert.equal(jobPhotoPrefetchEligible({ ...one, ...patch }), false, JSON.stringify(patch));
    }
    const firstFile = write(one), secondFile = write(two);
    assert.deepEqual(readJobPhotoPrefetchCandidate(secondFile), two);
    assert.equal(readJobPhotoPrefetchCandidate(path.join(root, 'missing.json')), null);
    fs.writeFileSync(secondFile, JSON.stringify({ ...two, messageId: 'wrong-name' }));
    assert.equal(readJobPhotoPrefetchCandidate(secondFile), null); write(two);
    const gate = deferred(); let active = 0, peak = 0; const calls: string[] = [];
    const media = createWhatsAppPhotoPrefetch(async message => { calls.push(message.messageId); peak = Math.max(peak, ++active); if (message.messageId === 'two') await gate.promise; active--; return `${message.messageId}.jpg`; });
    await media.download(one);
    let uploading = true;
    assert.equal(media.prefetch(two), true); assert.equal(media.prefetch(fixture('third')), false);
    await tick(); assert.equal(active, 1); assert.equal(uploading, true, 'Next media downloads while current upload is outstanding');
    const batch = { senderPhone: one.senderPhone, phoneNumberId: one.phoneNumberId, jobDate: '2026-09-16' };
    const current = claimWhatsAppImage(firstFile)!; finishWhatsAppImage(current.file, 'completed', {}); uploading = false;
    gate.resolve(); await tick();
    assert.equal(hasUnfinishedWhatsAppPhotosForSender(batch), true, 'Ready prefetch remains incoming and blocks premature confirmation');
    assert.ok(fs.existsSync(secondFile));
    const timing: Record<string, string> = {};
    const claim = claimWhatsAppImage(secondFile)!;
    assert.equal(await media.download(claim.message, timing), 'two.jpg');
    assert.deepEqual(calls, ['one', 'two'], 'Consumption reuses the exact download'); assert.equal(peak, 1);
    assert.ok(Date.parse(timing.mediaPrefetchStartedAt) <= Date.parse(timing.mediaPrefetchReadyAt));
    finishWhatsAppImage(claim.file, 'completed', {});
    assert.equal(hasUnfinishedWhatsAppPhotosForSender(batch), false);
    await media.close();

    const duplicateGate = deferred(); let duplicateCalls = 0;
    const singleflight = createWhatsAppPhotoPrefetch(async () => { duplicateCalls++; await duplicateGate.promise; return 'shared.jpg'; });
    singleflight.prefetch(one);
    const duplicateA = singleflight.download(one), duplicateB = singleflight.download(one);
    await tick(); assert.equal(duplicateCalls, 1, 'Concurrent consumption shares the same active download');
    duplicateGate.resolve(); assert.deepEqual(await Promise.all([duplicateA, duplicateB]), ['shared.jpg', 'shared.jpg']);
    await singleflight.close();

    // Failed lookahead is consumed once through normal retry accounting, never retried in the same drain.
    const failureFile = write(fixture('failure')); let failures = 0;
    const failed = createWhatsAppPhotoPrefetch(async () => { failures++; throw new Error('checksum rejected'); });
    assert.equal(failed.prefetch(fixture('failure')), true); await tick();
    assert.equal(await drainWhatsAppPhotoQueue(async file => {
      const item = claimWhatsAppImage(file)!;
      await assert.rejects(failed.download(item.message), /checksum rejected/);
      assert.equal(requeueWhatsAppImage(item.file, 'checksum rejected'), true);
    }), 1);
    assert.equal(failures, 1); assert.equal(JSON.parse(fs.readFileSync(failureFile, 'utf8')).attempts, 1);
    await failed.close(); fs.unlinkSync(failureFile);

    // Disappeared reservation drains safely, and alternate workflow downloads share serialization.
    const orphanGate = deferred(); let orphanActive = 0, orphanPeak = 0; const orphanCalls: string[] = [];
    const orphan = createWhatsAppPhotoPrefetch(async message => { orphanCalls.push(message.messageId); orphanPeak = Math.max(orphanPeak, ++orphanActive); if (message.messageId === 'orphan') await orphanGate.promise; orphanActive--; return 'ready.jpg'; });
    const orphanFile = write(fixture('orphan'));
    orphan.prefetch(readJobPhotoPrefetchCandidate(orphanFile)!); await tick(); fs.unlinkSync(orphanFile);
    assert.equal(claimWhatsAppImage(orphanFile), null);
    let drained = false; const drain = orphan.discardExcept().then(() => { drained = true; });
    const alternate = orphan.download({ ...fixture('alternate'), caption: 'recycling' });
    await tick(); assert.equal(drained, false); assert.deepEqual(orphanCalls, ['orphan']);
    orphanGate.resolve(); await drain; await alternate; await orphan.close();
    assert.equal(orphanPeak, 1); assert.deepEqual(orphanCalls, ['orphan', 'alternate']);
    const closeGate = deferred(); const closing = createWhatsAppPhotoPrefetch(async () => { await closeGate.promise; throw new Error('orphan failure'); });
    closing.prefetch(one); let closed = false; const close = closing.close().then(() => { closed = true; });
    await tick(); assert.equal(closed, false); closeGate.resolve(); await close; assert.equal(closed, true);

    // Reservation follows the 100-item budget and attempted set, without moving queue files.
    for (let i = 0; i < 101; i++) write(fixture(`cap-${i}`));
    const reserved: string[] = []; let count = 0;
    await drainWhatsAppPhotoQueue(async (file, next) => {
      count++; const candidate = next();
      if (count === 100) assert.equal(candidate, undefined, 'Never prefetch item 101');
      if (candidate) { assert.notEqual(candidate, file); assert.ok(fs.existsSync(candidate)); reserved.push(candidate); }
      fs.unlinkSync(file);
    });
    assert.equal(count, 100); assert.equal(reserved.length, 99); assert.equal(queuedWhatsAppImages().length, 1);

    // The actual downloader retains the same request count, checksum, size and inbox gates behind prefetch.
    process.env.WHATSAPP_ACCESS_TOKEN = 'mock-only'; delete process.env.WHATSAPP_ACCESS_TOKEN_BASE64; process.env.WHATSAPP_GRAPH_API_VERSION = 'v24.0';
    const bytes = Buffer.from([255, 216, 255, 224]); const hash = crypto.createHash('sha256').update(bytes).digest('base64');
    const validated = { ...fixture('validated'), sha256: hash }; let requests = 0;
    globalThis.fetch = async () => { requests++; return requests % 2 ? new Response(JSON.stringify({ url: 'https://lookaside.fbsbx.com/image', mime_type: 'image/jpeg', file_size: 4, sha256: hash })) : new Response(bytes); };
    const actual = createWhatsAppPhotoPrefetch(downloadWhatsAppImage);
    actual.prefetch(validated); const cached = await actual.download(validated); assert.equal(requests, 2); assert.deepEqual(fs.readFileSync(cached), bytes);
    assert.equal(await actual.download(validated), cached); assert.equal(requests, 2, 'Verified cache causes no extra requests');
    assert.equal(actual.prefetch({ ...validated, phoneNumberId: '999' }), false);
    await assert.rejects(actual.download({ ...validated, phoneNumberId: '999' }), /mismatch/); assert.equal(requests, 2);
    actual.prefetch({ ...validated, messageId: 'bad-sha', sha256: 'b'.repeat(64) });
    await assert.rejects(actual.download({ ...validated, messageId: 'bad-sha', sha256: 'b'.repeat(64) }), /checksum/); assert.equal(requests, 4);
    globalThis.fetch = async () => { requests++; return new Response(JSON.stringify({ url: 'https://lookaside.fbsbx.com/image', file_size: 6 * 1024 * 1024 })); };
    actual.prefetch({ ...validated, messageId: 'oversize' }); await assert.rejects(actual.download({ ...validated, messageId: 'oversize' }), /5 MB/); assert.equal(requests, 5);
    await actual.close();
    console.log('PASS: bounded photo prefetch overlap, singleflight, original media guards, retry accounting, orphan cleanup, incoming confirmation guard, and cycle cap');
  } finally {
    globalThis.fetch = originalFetch;
    for (const key of keys) { if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key]; }
    fs.rmSync(root, { recursive: true, force: true });
  }
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
