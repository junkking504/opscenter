import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { claimWhatsAppImage, enqueueWhatsAppImage, finishWhatsAppImage, recordWhatsAppTextContext, type WhatsAppImageMessage, type WhatsAppTextMessage } from '../lib/whatsapp-job-photo-queue';
import { applyTrailingPhotoJobBinding, bindTrailingPhotoJobText, withPhotoContextClaimLock } from '../lib/whatsapp-photo-trailing-context';
import { readJobPhotoPrefetchCandidate } from '../lib/whatsapp-photo-prefetch';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'trailing-photo-context-'));
const saved = { WHATSAPP_JOB_PHOTO_STATE_DIR: process.env.WHATSAPP_JOB_PHOTO_STATE_DIR, OPSBOT_DATA_DIR: process.env.OPSBOT_DATA_DIR, WHATSAPP_PHONE_NUMBER_ID: process.env.WHATSAPP_PHONE_NUMBER_ID };
const base = Date.now() - 15_000;
const stamp = (seconds: number) => new Date(base + seconds * 1_000).toISOString();
const hash = (value: string) => crypto.createHash('sha256').update(value).digest('hex');
let current = root;
const photo = (id: string, seconds = 0, patch: Partial<WhatsAppImageMessage> = {}): WhatsAppImageMessage => ({ version: 1, messageId: id, senderPhone: '5045550100', phoneNumberId: '123', receivedAt: stamp(seconds), timestampSource: 'provider', enqueuedAt: new Date().toISOString(), mediaId: '456', mimeType: 'image/jpeg', sha256: 'a'.repeat(64), caption: '', ...patch });
const text = (id: string, seconds = 7, body = 'JK4088445', patch: Partial<WhatsAppTextMessage> = {}): WhatsAppTextMessage => ({ messageId: id, senderPhone: '5045550100', phoneNumberId: '123', receivedAt: stamp(seconds), timestampSource: 'provider', text: body, ...patch });
const file = (id: string, state = 'incoming') => path.join(current, state, `${hash(id)}.json`);
const read = (id: string, state = 'incoming') => JSON.parse(fs.readFileSync(file(id, state), 'utf8'));
function scenario(name: string, run: () => void) { current = path.join(root, name); process.env.WHATSAPP_JOB_PHOTO_STATE_DIR = current; process.env.OPSBOT_DATA_DIR = current; process.env.WHATSAPP_PHONE_NUMBER_ID = '123'; run(); }
try {
  scenario('album-then-text', () => {
    for (let i = 0; i < 19; i++) enqueueWhatsAppImage(photo(`album-${i}`, Math.floor(i / 4)));
    const processing = claimWhatsAppImage(file('album-0'))!;
    const before = fs.readFileSync(processing.file, 'utf8');
    const held = claimWhatsAppImage(file('album-1'))!; finishWhatsAppImage(held.file, 'review', { review: { reason: 'sender_not_mapped_to_truck' } });
    recordWhatsAppTextContext(text('album-jk'));
    assert.equal(fs.readFileSync(processing.file, 'utf8'), before, 'Existing processing record is never rebound');
    assert.equal(read('album-2').matchingContext.text, '', 'Incoming original remains frozen until normal claim');
    assert.equal(readJobPhotoPrefetchCandidate(file('album-2'))?.matchingContext?.text, 'JK4088445', 'Read-only projection enables concurrent photo lanes');
    assert.ok(fs.existsSync(file('album-1'))); assert.equal(fs.existsSync(file('album-1', 'review')), false);
    finishWhatsAppImage(processing.file, 'review', { review: { reason: 'sender_not_mapped_to_truck' } });
    for (let i = 0; i < 19; i++) {
      const claim = claimWhatsAppImage(file(`album-${i}`))!;
      assert.equal(claim.message.matchingContext?.text, 'JK4088445');
      const proof = claim.message.trailingJobBinding as { text: WhatsAppTextMessage; originalMatchingContext: { text: string } };
      assert.equal(proof.text.messageId, 'album-jk'); assert.equal(proof.originalMatchingContext.text, '');
      assert.equal(claimWhatsAppImage(file(`album-${i}`)), null, 'A queue member has only one claim');
      finishWhatsAppImage(claim.file, 'completed', { match: { status: 'matched' }, upload: { verified: true } });
    }
  });
  for (const variant of ['same-context', 'same-assigned', 'different-text', 'different-job', 'workflow', 'assigned-conflict', 'caption-conflict']) scenario(`mixed-${variant}`, () => {
    enqueueWhatsAppImage(photo('earlier', 0));
    const earlier = claimWhatsAppImage(file('earlier'))!;
    enqueueWhatsAppImage(photo('bound', 1));
    recordWhatsAppTextContext(text('shared-job', 3));
    assert.equal(readJobPhotoPrefetchCandidate(file('bound'))?.matchingContext?.text, 'JK4088445');
    enqueueWhatsAppImage(photo('normal', 3));
    const normal = read('normal');
    assert.equal(normal.matchingContext.sourceMessageIds[0], 'shared-job');
    assert.equal(normal.trailingJobBinding, undefined, 'Last photo uses normal intake context');
    if (variant === 'different-text') normal.matchingContext.sourceMessageIds = ['another-text'];
    if (variant === 'different-job') normal.matchingContext.text = 'JK9999999';
    if (variant === 'workflow') normal.matchingContext.resale = { text: 'resale', messageId: 'resale-text' };
    if (variant === 'assigned-conflict') normal.match = { status: 'matched', jkNumber: 'JK9999999' };
    if (variant === 'caption-conflict') normal.caption = 'JK9999999';
    fs.writeFileSync(file('normal'), JSON.stringify(normal));
    const inFlight = claimWhatsAppImage(file('normal'))!;
    let preservedFile = inFlight.file;
    if (variant === 'same-assigned') preservedFile = finishWhatsAppImage(inFlight.file, 'completed', { match: { status: 'matched', jkNumber: 'JK4088445' }, upload: { verified: true } });
    const original = fs.readFileSync(preservedFile, 'utf8');
    finishWhatsAppImage(earlier.file, 'review', { review: { reason: 'sender_not_mapped_to_truck' } });
    assert.equal(fs.readFileSync(preservedFile, 'utf8'), original, 'Consistent processing/assigned members are never rewritten');
    if (variant === 'same-context' || variant === 'same-assigned') {
      assert.ok(fs.existsSync(file('earlier')), 'Same exact normal context cannot strand an earlier missing-context review');
      assert.equal(claimWhatsAppImage(file('earlier'))!.message.matchingContext?.text, 'JK4088445');
    } else {
      assert.equal(fs.existsSync(file('earlier')), false, 'Different provenance, job, workflow or assignment keeps review held');
      assert.ok(fs.existsSync(file('earlier', 'review')));
    }
  });
  scenario('delayed-image-webhook', () => { recordWhatsAppTextContext(text('earlier-arrival')); enqueueWhatsAppImage(photo('late-image')); assert.equal(claimWhatsAppImage(file('late-image'))!.message.matchingContext?.text, 'JK4088445'); });
  scenario('later-conflicting-job', () => {
    enqueueWhatsAppImage(photo('ambiguous')); recordWhatsAppTextContext(text('job-a')); recordWhatsAppTextContext(text('job-b', 8, 'JK9999999'));
    assert.equal(claimWhatsAppImage(file('ambiguous'))!.message.matchingContext?.text, '', 'Conflicting trailing text before claim invalidates existing sidecar');
  });
  scenario('two-bursts', () => { enqueueWhatsAppImage(photo('first')); enqueueWhatsAppImage(photo('second', 6)); recordWhatsAppTextContext(text('job', 8)); assert.equal(claimWhatsAppImage(file('second'))!.message.matchingContext?.text, ''); });
  scenario('old-hold', () => { enqueueWhatsAppImage(photo('old', -60)); enqueueWhatsAppImage(photo('new')); recordWhatsAppTextContext(text('job')); assert.equal(claimWhatsAppImage(file('old'))!.message.matchingContext?.text, ''); assert.equal(claimWhatsAppImage(file('new'))!.message.matchingContext?.text, 'JK4088445'); });
  const exclusions: Partial<WhatsAppImageMessage>[] = [
    { caption: 'JK9999999' }, { caption: 'resale chair' }, { caption: 'recycling' }, { caption: 'Truck 2 50%' }, { timestampSource: 'intake-fallback' }, { timestampSource: undefined },
    { matchingContext: { version: 1, text: 'JK9999999', sourceMessageIds: ['other-job'], capturedAt: stamp(0) } },
  ];
  for (const [index, patch] of exclusions.entries()) scenario(`excluded-${index}`, () => { enqueueWhatsAppImage(photo('excluded')); const row = read('excluded'); fs.writeFileSync(file('excluded'), JSON.stringify({ ...row, ...patch })); recordWhatsAppTextContext(text('job')); assert.equal(applyTrailingPhotoJobBinding(read('excluded'), current).trailingJobBinding, undefined); });
  for (const [name, patch] of Object.entries({ inbox: { phoneNumberId: '999' }, sender: { senderPhone: '5045550199' }, fallback: { timestampSource: 'intake-fallback' as const }, caption: { sourceType: 'image-caption' as const } })) scenario(name, () => { enqueueWhatsAppImage(photo('p')); recordWhatsAppTextContext(text('job', 7, 'JK4088445', patch)); assert.equal(claimWhatsAppImage(file('p'))!.message.matchingContext?.text, ''); });
  scenario('uncertain-write', () => { enqueueWhatsAppImage(photo('p')); const claim = claimWhatsAppImage(file('p'))!; finishWhatsAppImage(claim.file, 'review', { review: { reason: 'upload_outcome_uncertain' }, upload: { verified: false } }); recordWhatsAppTextContext(text('job')); assert.equal(fs.existsSync(file('p')), false); assert.ok(fs.existsSync(file('p', 'review'))); });
  scenario('completed-stale-review', () => {
    enqueueWhatsAppImage(photo('p')); const claim = claimWhatsAppImage(file('p'))!; const review = finishWhatsAppImage(claim.file, 'review', { review: { reason: 'sender_not_mapped_to_truck' } });
    fs.copyFileSync(review, file('p', 'completed')); recordWhatsAppTextContext(text('job')); assert.equal(fs.existsSync(file('p')), false, 'Stale review cannot republish a completed message');
  });
  scenario('no-clobber', () => {
    enqueueWhatsAppImage(photo('p')); const claim = claimWhatsAppImage(file('p'))!; const review = finishWhatsAppImage(claim.file, 'review', { review: { reason: 'sender_not_mapped_to_truck' } });
    fs.copyFileSync(review, file('p')); const original = fs.readFileSync(file('p'), 'utf8'); recordWhatsAppTextContext(text('job'));
    assert.equal(fs.readFileSync(file('p'), 'utf8'), original); assert.ok(fs.existsSync(review), 'Existing incoming file is never overwritten or removed');
  });
  scenario('claim-binding-lock', () => {
    enqueueWhatsAppImage(photo('p'));
    withPhotoContextClaimLock(current, `${hash('p')}.json`, () => {
      assert.equal(claimWhatsAppImage(file('p')), null, 'Claim cannot race a binding publication');
      assert.ok(fs.existsSync(file('p')));
    });
    const claim = claimWhatsAppImage(file('p'))!;
    fs.copyFileSync(claim.file, file('p'));
    assert.equal(claimWhatsAppImage(file('p')), null, 'Duplicate incoming cannot overwrite active processing');
    finishWhatsAppImage(claim.file, 'completed', { upload: { verified: true } });
    assert.equal(claimWhatsAppImage(file('p')), null, 'Duplicate incoming cannot replay a completed upload');
  });
  scenario('out-of-order-and-duplicate-text', () => {
    enqueueWhatsAppImage(photo('p')); recordWhatsAppTextContext(text('modifier', 9, 'After'));
    recordWhatsAppTextContext(text('job', 7)); assert.ok(readJobPhotoPrefetchCandidate(file('p')));
    const sidecar = path.join(current, 'context-bindings', `${hash('p')}.json`); fs.unlinkSync(sidecar);
    recordWhatsAppTextContext(text('job', 7)); assert.ok(fs.existsSync(sidecar), 'Duplicate identical text retries a previously interrupted binding');
    const original = read('p'); assert.equal(applyTrailingPhotoJobBinding(original, current, Date.now() + 61_000), original, 'Unapplied sidecar expires instead of guessing a stale job');
  });
  scenario('changed-payload', () => {
    enqueueWhatsAppImage(photo('p')); recordWhatsAppTextContext(text('job')); const original = read('p');
    for (const patch of [{ mediaId: '999' }, { sha256: 'b'.repeat(64) }, { mimeType: 'image/png' }, { timestampSource: undefined }]) {
      const changed = { ...original, ...patch }; assert.equal(applyTrailingPhotoJobBinding(changed, current), changed, 'A changed media payload cannot inherit an association');
    }
  });
  scenario('text-changed', () => {
    enqueueWhatsAppImage(photo('p')); const job = text('job'); recordWhatsAppTextContext(job);
    const entry = path.join(current, 'context-history', hash(job.senderPhone), hash(job.phoneNumberId), `${Date.parse(job.receivedAt)}-${hash(job.messageId)}.json`);
    fs.writeFileSync(entry, JSON.stringify({ ...job, text: 'JK9999999' })); const original = read('p'); assert.equal(applyTrailingPhotoJobBinding(original, current), original);
  });
  scenario('expired-text', () => { enqueueWhatsAppImage(photo('p', -100)); const job = text('job', -93); recordWhatsAppTextContext(job); assert.equal(bindTrailingPhotoJobText(current, job), 0); assert.equal(claimWhatsAppImage(file('p'))!.message.matchingContext?.text, ''); });
  console.log('PASS: trailing standalone JK binds one recent album, preserves original provenance, never rewrites processing, recovers safe holds without clobber, and rejects conflicts, stale context, alternate workflows and untrusted timestamps');
} finally {
  for (const [key, value] of Object.entries(saved)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  fs.rmSync(root, { recursive: true, force: true });
}
