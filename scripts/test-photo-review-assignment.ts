import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import ts from 'typescript';
import * as assignments from '../lib/whatsapp-photo-review-assignment';
import * as queue from '../lib/whatsapp-job-photo-queue';
import * as matching from '../lib/whatsapp-job-photo-matching';
import * as reviews from '../lib/desktop-photo-review';
import { withPhotoContextClaimLock } from '../lib/whatsapp-photo-trailing-context';
import { isDesktopWriteOriginAllowed } from '../lib/desktop-request-origin';
import { opsRoleCan } from '../lib/ops-roles';
import type { PhotoAppointmentOptions, PhotoAssignmentInput } from '../desktop-ui/lib/photo-review-contract';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'photo-assignment-'));
process.env.WHATSAPP_JOB_PHOTO_STATE_DIR = root;
const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');
const options: PhotoAppointmentOptions = { date: '2026-09-27', sourceAt: '2026-09-28T12:00:00Z', appointments: [
  { appointmentId: '12345', jk: 'JK1234567', date: '2026-09-27', truck: 'Truck# 4', customer: 'Synthetic customer', address: 'Test address', time: '9–10 AM', status: 'Completed' },
  { appointmentId: '54321', jk: 'JK1234567', date: '2026-09-27', truck: 'Truck# 8', customer: 'Synthetic other appointment', address: 'Other address', time: '1–2 PM', status: 'Confirmed' },
] };
for (const state of ['review', 'failed', 'incoming', 'assigned', 'processing', 'completed', 'media']) fs.mkdirSync(path.join(root, state));
function seed(name: string, extra: Record<string, unknown> = {}, state: 'review' | 'failed' = 'review'): PhotoAssignmentInput {
  const row = { version: 1, messageId: name, senderPhone: '15550001111', receivedAt: '2026-09-28T14:13:00Z', phoneNumberId: '111', mediaId: '222', mimeType: 'image/png', sha256: hash(png), caption: '', enqueuedAt: '2026-09-28T14:13:01Z', matchingContext: { version: 1, text: '', sourceMessageIds: [], capturedAt: '2026-09-28T14:13:01Z' }, review: { reason: 'sender_not_mapped_to_truck' }, ...extra };
  const id = hash(name); fs.writeFileSync(path.join(root, state, `${id}.json`), JSON.stringify(row)); fs.writeFileSync(path.join(root, 'media', `${id}.png`), png);
  return { id, state, revision: assignments.photoRevision(row), requestId: randomUUID(), date: options.date, appointmentId: '54321', jk: 'JK1234567', category: 'before', confirmed: true };
}
const assign = (input: PhotoAssignmentInput) => assignments.assignReviewedPhoto(input, 'fixture-manager', root, date => { assert.equal(date, options.date); return options; });
const file = (input: PhotoAssignmentInput, state = 'assigned') => path.join(root, state, `${input.id}.json`);
function compile(source: string, dependencies: Record<string, unknown>) {
  const output: Record<string, any> = {};
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  new Function('require', 'exports', compiled)((name: string) => {
    if (name in dependencies) return dependencies[name];
    // Unused worker integrations must never make an external call in this test.
    return new Proxy({}, { get: (_target, prop) => { throw new Error(`Unexpected dependency ${name}.${String(prop)}`); } });
  }, output);
  return output;
}
async function main() {
  const input = seed('manual-selection');
  assert.equal(assign(input).state, 'assigned'); assert.equal(assign(input).verified, false);
  assert.equal(fs.existsSync(file(input, 'review')), false);
  assert.equal(fs.readdirSync(path.join(root, 'incoming')).length, 0, 'Older workers cannot see reviewed assignments');
  assert.ok(queue.queuedWhatsAppImages().includes(file(input)), 'Updated worker claims reviewed assignments');
  const projection = reviews.readPhotoReview(new URLSearchParams('state=assigned'), root).records[0];
  assert.equal(projection.jk, input.jk); assert.equal(projection.jobDate, input.date); assert.equal(projection.category, input.category);
  const staged = JSON.parse(fs.readFileSync(file(input), 'utf8'));
  assert.equal(staged.caption, ''); assert.equal(staged.senderPhone, '15550001111');
  assert.equal(staged.manualAssignment.actor, 'fixture-manager'); assert.equal(staged.manualAssignment.prior.review.reason, 'sender_not_mapped_to_truck');
  assert.equal(assignments.reviewedPhotoMatch(staged)?.appointmentId, '54321', 'Repeated JK references retain the chosen exact appointment');
  assert.equal(assignments.reviewedPhotoMatch(staged)?.category, 'before');
  assert.throws(() => assign({ ...input, category: 'after' }), /different assignment/);
  assert.throws(() => assign({ ...input, requestId: randomUUID() }), /changed/);
  const locked = seed('locked');
  withPhotoContextClaimLock(root, `${locked.id}.json`, () => assert.throws(() => assign(locked), /being updated/));
  for (const extra of [{ match: { appointmentId: '12345' } }, { upload: { verified: false } }, { timing: { uploadStartedAt: '2026-09-28T15:00:00Z' } }, { review: { reason: 'upload_outcome_uncertain' } }, { review: { reason: 'processing_interrupted_outcome_unknown' } }, { recycling: {} }, { version: 0 }]) {
    assert.throws(() => assign(seed(randomUUID(), extra)), assignments.PhotoAssignmentError);
  }
  const badMedia = seed('bad-media'); fs.writeFileSync(file(badMedia, 'media').replace(/json$/, 'png'), Buffer.from('not an image'));
  assert.throws(() => assign(badMedia), /original photo/);
  const stale = seed('stale'); const changed = JSON.parse(fs.readFileSync(file(stale, 'review'), 'utf8')); changed.attempts = 3; fs.writeFileSync(file(stale, 'review'), JSON.stringify(changed));
  assert.throws(() => assign(stale), /changed/);
  const cancelled = seed('cancelled');
  assert.throws(() => assignments.assignReviewedPhoto(cancelled, 'fixture-manager', root, () => ({ ...options, appointments: options.appointments.map(row => ({ ...row, status: 'Cancelled' })) })), /unavailable/);
  assert.throws(() => assign({ ...seed('tampered'), appointmentId: '999' }), /unavailable/);
  assert.throws(() => assign({ ...seed('traversal'), id: '../bad' }), /valid|Confirm/);
  const failed = seed('failed-before-upload', { review: undefined, error: 'Media download failed', attempts: 3 }, 'failed'); assert.equal(assign(failed).state, 'assigned');
  // Simulate a server interruption after durable assignment but before queue move.
  const interrupted = seed('interrupted-save'); assign(interrupted); fs.renameSync(file(interrupted), file(interrupted, 'review'));
  assert.equal(assign(interrupted).state, 'assigned');
  assert.equal(queue.recoverMappedWhatsAppPhotoHolds({ '5550001111': 'Truck# 3' }, 0), 0);

  const workerSource = fs.readFileSync(new URL('./process-whatsapp-job-photos.ts', import.meta.url), 'utf8').replace('async function processOne(', 'export async function processOne(').replace(/main\(\)\.catch\([\s\S]*$/, '');
  const worker = compile(workerSource, {
    '@/lib/whatsapp-photo-review-assignment': assignments,
    '@/lib/whatsapp-job-photo-queue': queue,
    '@/lib/whatsapp-job-photo-matching': matching,
    '@/lib/opsData': { readMetrics: () => ({ appointments: [] }) },
  });
  let uploads = 0;
  const upload = async (payload: any) => { uploads++; assert.equal(payload.appointmentId, '54321'); assert.equal(payload.jkNumber, 'JK1234567'); assert.equal(payload.category, 'before'); assert.deepEqual(fs.readFileSync(payload.filePath), png); return { beforeCount: 0, afterCount: 1, mediaUrls: [] }; };
  const forbidden = () => { throw new Error('Unexpected provider download or JK lookup'); };
  assert.equal(await worker.processOne(file(input), {}, upload, { download: forbidden }, forbidden), 'completed');
  assert.equal(uploads, 1); assert.equal(assign(input).verified, true, 'Idempotent replay reads completed verification without upload');
  assert.equal(await worker.processOne(file(input), {}, upload, { download: forbidden }, forbidden), 'skipped'); assert.equal(uploads, 1);
  const uncertain = seed('worker-uncertain'); assign(uncertain);
  assert.equal(await worker.processOne(file(uncertain), {}, async () => { throw new Error('Connection lost after submission'); }, { download: forbidden }, forbidden), 'review');
  assert.equal(assign(uncertain).verified, false); assert.equal(assign(uncertain).state, 'review'); assert.equal(fs.existsSync(file(uncertain)), false, 'Same request cannot replay uncertain upload');
  const lost = seed('lost-original'); assign(lost); fs.unlinkSync(file(lost, 'media').replace(/json$/, 'png'));
  assert.equal(await worker.processOne(file(lost), {}, upload, { download: forbidden }, forbidden), 'review'); assert.equal(uploads, 1);

  let signedIn = true, role = 'admin';
  const handlers = compile(fs.readFileSync(new URL('../app/api/desktop/photos/route.ts', import.meta.url), 'utf8'), {
    'next/headers': { cookies: async () => ({ get: () => ({ value: 'synthetic' }) }) },
    '@/lib/auth': { AUTH_SESSION_COOKIE: 'test', verifyAuthSessionCookie: async () => signedIn ? { email: 'fixture-manager', role } : null },
    '@/lib/ops-roles': { opsRoleCan }, '@/lib/desktop-request-origin': { isDesktopWriteOriginAllowed },
    '@/lib/desktop-photo-review': reviews, '@/lib/desktop-photo-appointments': { photoAppointmentOptions: () => options }, '@/lib/whatsapp-photo-review-assignment': assignments,
  });
  const apiInput = seed('http-test');
  const send = (body: unknown = apiInput, origin = 'https://fixture.invalid') => handlers.POST(new Request('https://fixture.invalid/api/desktop/photos', { method: 'POST', headers: { origin, 'Content-Type': 'application/json' }, body: typeof body === 'string' ? body : JSON.stringify(body) }));
  signedIn = false; assert.equal((await send()).status, 401); signedIn = true;
  role = 'operator'; assert.equal((await send()).status, 403); role = 'admin';
  assert.equal((await send(apiInput, 'https://other.invalid')).status, 403);
  assert.equal((await send('{bad')).status, 400); assert.equal((await send('x'.repeat(4097))).status, 413);
  assert.equal(fs.existsSync(file(apiInput, 'review')), true);
  const accepted = await send(); assert.equal(accepted.status, 200); assert.match(accepted.headers.get('cache-control') || '', /no-store/);
  const status = await handlers.GET(new Request(`https://fixture.invalid/api/desktop/photos?record=${apiInput.id}`)); const json = await status.json();
  assert.equal(json.state, 'assigned'); assert.equal(json.verified, false);
  for (const secret of ['senderPhone', 'mediaId', 'phoneNumberId', 'fingerprint', 'fixture-manager']) assert.equal(JSON.stringify(json).includes(secret), false);
  console.log('PASS: exact appointment/category assignment, audit provenance, stale/conflicting/unsafe rejection, lock exclusion, crash recovery, idempotency, worker upload/verification, uncertain hold, cached original, HTTP auth/origin/body limits and privacy.');
}
void main().finally(() => fs.rmSync(root, { recursive: true, force: true })).catch(error => { console.error(error); process.exitCode = 1; });
