import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Browser, BrowserContext, BrowserContextOptions, Route } from '@playwright/test';
import { createJunkwarePhotoUploadSession, persistJunkwareStorageState } from '../lib/junkware-photo-uploader';
import { drainWhatsAppPhotoQueue, queuedWhatsAppImages } from '../lib/whatsapp-job-photo-queue';

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'photo-throughput-'));
  const prior = process.env.WHATSAPP_JOB_PHOTO_STATE_DIR;
  const priorData = process.env.OPSBOT_DATA_DIR;
  process.env.WHATSAPP_JOB_PHOTO_STATE_DIR = root;
  process.env.OPSBOT_DATA_DIR = root;
  try {
    queuedWhatsAppImages();
    const queueFile = (name: string, enqueuedAt: string, receivedAt = '2026-09-16T20:00:00Z') => {
      const file = path.join(root, 'incoming', `${name.padStart(64, '0')}.json`);
      fs.writeFileSync(file, JSON.stringify({ enqueuedAt, receivedAt })); return file;
    };
    const late = queueFile('1', '2026-09-16T20:00:03Z');
    const early = queueFile('f', '2026-09-16T20:00:01Z');
    const fallback = queueFile('e', 'invalid', '2026-09-16T20:00:02Z');
    const invalid = queueFile('d', 'invalid', 'invalid');
    assert.deepEqual(queuedWhatsAppImages(4), [early, fallback, late, invalid], 'Intake time wins over hash order; provider time is a fallback');
    fs.unlinkSync(invalid);
    const attempts: string[] = [];
    let added = '';
    await drainWhatsAppPhotoQueue(async file => {
      attempts.push(file);
      if (file === early) { added = queueFile('2', '2026-09-16T20:00:04Z'); return; }
      fs.unlinkSync(file);
    });
    assert.deepEqual(attempts, [early, fallback, late, added], 'A requeued file is skipped, new arrivals drain in the same cycle');
    fs.unlinkSync(early);
    for (let i = 0; i < 101; i++) queueFile(i.toString(16), '2026-09-16T20:00:00Z');
    assert.equal(await drainWhatsAppPhotoQueue(async file => { fs.unlinkSync(file); }), 100, 'Cycle is bounded at one hundred photos');
    assert.equal(queuedWhatsAppImages().length, 1);

    const files = ['a', 'b', 'c', 'd', 'e', 'f', '9'].map(letter => {
      const file = path.join(root, `${letter.repeat(64)}.jpg`); fs.writeFileSync(file, 'fixture'); return file;
    });
    const stats = { launches: 0, closes: 0, navigations: 0, submissions: 0, persisted: 0 };
    const galleries = new Map<string, string[]>();
    let currentUrl = 'about:blank', title = '', selected = '';
    let selectedFiles: string[] = [];
    let multipleSupported = true, navigationFails = false, wrongPostIdentity = false, persistFails = false;
    let behavior: 'normal' | 'post-title' | 'wrong-title' | 'no-image' | 'human-image' | 'partial' | 'bad-post-identity' = 'normal';
    const categories: string[] = [];
    let routeHandler: ((route: Route) => Promise<void>) | undefined;
    const currentId = () => new URL(currentUrl).searchParams.get('id') || '';
    const page = {
      url: () => currentUrl,
      goto: async (url: string) => { stats.navigations++; currentUrl = url; title = `Appointment JK${Number(currentId()) + 13178}`; },
      evaluate: async (fn: unknown) => String(fn).includes('querySelectorAll') ? [...(galleries.get(currentId()) || [])] : { url: currentUrl, title: behavior === 'wrong-title' || wrongPostIdentity ? 'Appointment JK9999999' : title },
      waitForNavigation: async () => { if (navigationFails) throw new Error('Navigation timeout'); },
      locator: (selector: string) => ({
        count: async () => 1,
        setInputFiles: async (value: string | string[]) => { selectedFiles = Array.isArray(value) ? value : [value]; },
        evaluate: async () => {
          if (selector.includes('FileUpload1')) return multipleSupported;
          if (selector.includes('ImageBeforeRB') || selector.includes('ImageAfterRB') || selector.includes('ImageDonationRB')) {
            selected = selector.includes('Before') ? 'before' : selector.includes('Donation') ? 'donation' : 'after'; return true;
          }
          if (selector.includes('AddImageBtn')) {
            stats.submissions++; categories.push(selected);
            if (behavior !== 'no-image') {
              const submittedFiles = behavior === 'partial' ? selectedFiles.slice(0, 1) : selectedFiles;
              for (const file of submittedFiles) {
                const stem = behavior === 'human-image' ? 'unrelated-human' : path.parse(file).name;
                const suffix = selected === 'donation' ? 'donation-rcpt' : selected;
                const url = `https://junkware.junk-king.com/system/aspnet/local/media/2026-09/test-${currentId()}-random-${stem}-${suffix}.jpg`;
                galleries.set(currentId(), [...(galleries.get(currentId()) || []), url]);
              }
            }
            if (behavior === 'bad-post-identity') wrongPostIdentity = true;
            if (behavior === 'post-title') title = 'Image uploaded';
          }
          return undefined;
        },
      }),
    };
    const stateFile = path.join(root, 'protected', 'junkware_storage_state.json');
    fs.mkdirSync(path.dirname(stateFile), { recursive: true });
    const fixtureState = JSON.stringify({ cookies: [
      { name: 'ASP.NET_SessionId', value: 'fixture-shared-session', domain: 'junkware.junk-king.com' },
      { name: '.ASPXAUTH', value: 'fixture-authentication', domain: 'junkware.junk-king.com' },
      { name: 'ASP.NET_SessionId', value: 'unrelated', domain: 'example.com' },
    ], origins: [] });
    fs.writeFileSync(stateFile, fixtureState);
    let partialWritten!: () => void, completeWrite!: () => void;
    const partialReady = new Promise<void>(resolve => { partialWritten = resolve; });
    const finishWrite = new Promise<void>(resolve => { completeWrite = resolve; });
    const atomicSave = persistJunkwareStorageState({ storageState: async ({ path: temporary }: { path: string }) => {
      assert.notEqual(temporary, stateFile);
      assert.equal(fs.statSync(temporary).mode & 0o777, 0o600);
      fs.writeFileSync(temporary, '{'); partialWritten(); await finishWrite;
      fs.writeFileSync(temporary, fixtureState);
    } } as unknown as BrowserContext);
    await partialReady;
    assert.equal(fs.readFileSync(stateFile, 'utf8'), fixtureState, 'Concurrent lane startup cannot see partially written browser state');
    completeWrite(); await atomicSave;
    await assert.rejects(persistJunkwareStorageState({ storageState: async ({ path: temporary }: { path: string }) => {
      fs.writeFileSync(temporary, '{'); throw new Error('simulated persistence failure');
    } } as unknown as BrowserContext), /simulated persistence/);
    assert.equal(fs.readFileSync(stateFile, 'utf8'), fixtureState, 'Failed persistence retains the previous valid authentication state');
    assert.deepEqual(fs.readdirSync(path.dirname(stateFile)), [path.basename(stateFile)], 'Private temporary files are cleaned after success and failure');
    const contextOptions: BrowserContextOptions[] = [];
    const session = createJunkwarePhotoUploadSession({
      isolatedServerSession: true,
      launch: async () => {
        stats.launches++; currentUrl = 'about:blank'; title = '';
        return { newContext: async (options: BrowserContextOptions) => { contextOptions.push(options); return ({
          route: async (_pattern: string, handler: typeof routeHandler) => { routeHandler = handler; },
          newPage: async () => page,
        }); }, close: async () => { stats.closes++; } } as unknown as Browser;
      },
      persist: async () => { stats.persisted++; if (persistFails) throw new Error('Local storage unavailable'); },
    });
    const input = { appointmentId: '4075431', jkNumber: 'JK4088609', filePath: files[0], category: 'after' as const };
    await session.prepareTarget(input);
    assert.equal(stats.submissions, 0, 'Parallel startup preparation only reads the exact appointment');
    assert.equal(stats.navigations, 1);
    const firstPending = session.upload(input);
    await assert.rejects(session.upload(input), /must remain sequential/);
    const first = await firstPending;
    assert.equal(stats.navigations, 1, 'First upload reuses its prepared page without an extra GET');
    assert.equal(fs.readFileSync(stateFile, 'utf8'), fixtureState, 'Session isolation never modifies shared authentication on disk');
    const isolated = contextOptions[0].storageState;
    assert.ok(isolated && typeof isolated !== 'string');
    assert.deepEqual(isolated.cookies.map(cookie => [cookie.name, cookie.value]), [['.ASPXAUTH', 'fixture-authentication'], ['ASP.NET_SessionId', 'unrelated']], 'Only the owning server session cookie is removed; authentication remains');
    const ordered = (...values: (string | undefined)[]) => {
      const times = values.map(value => Date.parse(value || ''));
      assert.ok(times.every(Number.isFinite), 'Each recorded phase timestamp is valid');
      assert.ok(times.every((at, index) => !index || at >= times[index - 1]), 'Recorded phases preserve observed order');
    };
    ordered(first.submittedAt, first.postNavigationCompletedAt, first.galleryObservedAt);
    assert.equal(first.readbackStartedAt, undefined, 'No GET timing is invented when the POST verifies directly');
    assert.equal(first.readbackCompletedAt, undefined);
    assert.equal(first.batchBytes, fs.statSync(files[0]).size);

    assert.ok(routeHandler);
    for (const type of ['image', 'media', 'font', 'document', 'script', 'stylesheet', 'xhr', 'fetch']) {
      let action = '';
      await routeHandler({ request: () => ({ resourceType: () => type }), abort: async () => { action = 'abort'; }, continue: async () => { action = 'continue'; } } as unknown as Route);
      assert.equal(action, ['image', 'media', 'font'].includes(type) ? 'abort' : 'continue', `Source forms and DOM stay available while ${type} is handled`);
    }
    const second = await session.upload({ ...input, filePath: files[1], category: 'before' });
    assert.deepEqual([first.beforeCount, first.afterCount, second.beforeCount, second.afterCount], [0, 1, 1, 2], 'Each image uses a fresh count baseline');
    assert.equal(second.galleryUrls.length, 2, 'Each verified upload publishes the complete owning gallery');
    assert.ok(Number.isFinite(Date.parse(second.galleryObservedAt)), 'Complete gallery has its own observation timestamp');
    assert.deepEqual(categories, ['after', 'before'], 'Category resets for each photo');
    assert.deepEqual([stats.launches, stats.navigations, stats.closes], [1, 1, 0], 'Same job reuses one browser and appointment page');
    const donation = await session.upload({ ...input, appointmentId: '4075267', jkNumber: 'JK4088445', filePath: files[2], category: 'donation' });
    assert.equal(donation.mediaUrls.length, 1, 'Unique materialized hash matches independently of source category suffix spelling');
    assert.deepEqual([stats.launches, stats.navigations], [1, 2], 'Different job navigates and verifies within the same session');
    behavior = 'post-title';
    const readback = await session.upload({ ...input, filePath: files[3] });
    assert.equal(readback.identityReadbackReason, 'title JK missing');
    ordered(readback.submittedAt, readback.postNavigationCompletedAt, readback.readbackStartedAt, readback.readbackCompletedAt, readback.galleryObservedAt);
    assert.equal(stats.submissions, 4, 'Postback read-back never resubmits');
    behavior = 'no-image';
    await assert.rejects(session.upload({ ...input, filePath: files[4] }), /did not confirm a new appointment photo/);
    assert.equal(stats.closes, 1, 'An uncertain upload discards the session');
    behavior = 'normal';
    await session.upload({ ...input, filePath: files[5] });
    assert.equal(stats.launches, 2, 'A distinct next photo opens a clean session');
    behavior = 'human-image';
    await assert.rejects(session.upload({ ...input, filePath: files[6] }), /did not expose a verified new image/);
    assert.equal(stats.closes, 2, 'Concurrent unrelated human media cannot prove our upload');
    behavior = 'wrong-title';
    const beforeWrong = stats.submissions;
    await assert.rejects(session.upload(input), /different JK appointment/);
    assert.equal(stats.submissions, beforeWrong, 'Wrong job fails before submission');
    behavior = 'normal';
    const batchFile = (label: string, size = 16) => {
      const file = path.join(root, `${crypto.createHash('sha256').update(label).digest('hex')}.jpg`);
      fs.writeFileSync(file, Buffer.alloc(size, 1)); return file;
    };
    const member = (label: string, size = 16) => ({ ...input, filePath: batchFile(label, size) });
    const group = ['batch-a', 'batch-b', 'batch-c', 'batch-d', 'batch-e'].map(label => member(label));
    const beforeBatch = stats.submissions;
    behavior = 'post-title';
    const firstBatch = session.uploadBatch(group);
    await assert.rejects(session.uploadBatch([member('parallel')]), /must remain sequential/);
    await assert.rejects(session.upload(member('parallel-single')), /must remain sequential/);
    const batch = await firstBatch;
    assert.equal(stats.submissions, beforeBatch + 1, 'Five files use exactly one native form submission');
    assert.equal(batch.submitted, true);
    assert.deepEqual(batch.results.map(result => result.status), Array(5).fill('verified'));
    assert.deepEqual(batch.results.map(result => result.filePath), group.map(item => item.filePath), 'Per-file results preserve input order');
    for (const [index, result] of batch.results.entries()) {
      assert.equal(result.status, 'verified');
      if (result.status !== 'verified') throw new Error('Expected verified file');
      assert.equal(result.verification.afterCount - result.verification.beforeCount, 5);
      assert.equal(result.verification.batchBytes, group.reduce((bytes, item) => bytes + fs.statSync(item.filePath).size, 0));
      ordered(result.verification.submittedAt, result.verification.postNavigationCompletedAt, result.verification.readbackStartedAt, result.verification.readbackCompletedAt, result.verification.galleryObservedAt);
      assert.equal(result.verification.mediaUrls.length, 1);
      assert.ok(result.verification.mediaUrls[0].includes(path.parse(group[index].filePath).name));
      assert.equal(result.verification.galleryUrls.length, result.verification.afterCount);
      assert.equal(result.verification.identityReadbackReason, 'title JK missing');
    }
    const beforeReplay = stats.submissions;
    await assert.rejects(session.uploadBatch(group), /already appears/, 'Already present hashes are held instead of uploaded again');
    assert.equal(stats.submissions, beforeReplay);

    behavior = 'partial';
    const partialGroup = ['partial-a', 'partial-b', 'partial-c'].map(label => member(label));
    const beforePartial = stats.submissions;
    const partial = await session.uploadBatch(partialGroup);
    assert.deepEqual(partial.results.map(result => result.status), ['verified', 'uncertain', 'uncertain']);
    assert.equal(stats.submissions, beforePartial + 1, 'Partial server acceptance never resubmits missing files');
    const launchesAfterPartial = stats.launches;
    behavior = 'normal';
    await session.uploadBatch([member('after-partial')]);
    assert.equal(stats.launches, launchesAfterPartial + 1, 'Partial uncertainty discards the session');

    behavior = 'human-image';
    const human = await session.uploadBatch([member('human-a'), member('human-b')]);
    assert.deepEqual(human.results.map(result => result.status), ['uncertain', 'uncertain'], 'A count increase from another upload cannot verify our files');
    behavior = 'bad-post-identity';
    const badIdentity = await session.uploadBatch([member('identity-a'), member('identity-b')]);
    assert.ok(badIdentity.results.every(result => result.status === 'uncertain' && /identity did not verify/.test(result.error)));
    wrongPostIdentity = false; behavior = 'normal'; navigationFails = true;
    const beforeTimeout = stats.submissions, beforeTimeoutNavigation = stats.navigations;
    const recovered = await session.uploadBatch([member('timeout-a'), member('timeout-b')]);
    assert.ok(recovered.results.every(result => result.status === 'verified'));
    for (const result of recovered.results) {
      if (result.status !== 'verified') throw new Error('Expected read-back recovery');
      assert.equal(result.verification.postNavigationCompletedAt, undefined, 'Failed native navigation cannot acquire a POST completion stamp');
      ordered(result.verification.submittedAt, result.verification.readbackStartedAt, result.verification.readbackCompletedAt, result.verification.galleryObservedAt);
      assert.equal(result.verification.batchBytes, 32);
    }
    assert.equal(stats.submissions, beforeTimeout + 1, 'A timed-out POST is reconciled once, never submitted again');
    assert.equal(stats.navigations, beforeTimeoutNavigation + 2, 'One initial navigation and one owning GET after submission');
    navigationFails = false;

    const rejectsBeforeWrite = async (members: Parameters<typeof session.uploadBatch>[0], pattern: RegExp) => {
      const count = stats.submissions;
      await assert.rejects(session.uploadBatch(members), pattern);
      assert.equal(stats.submissions, count, 'Invalid batch cannot reach form submission');
    };
    await rejectsBeforeWrite([], /one to five/);
    await rejectsBeforeWrite(Array.from({ length: 6 }, (_, i) => member(`six-${i}`)), /one to five/);
    await rejectsBeforeWrite([member('mixed-a'), { ...member('mixed-b'), category: 'before' }], /share the exact/);
    await rejectsBeforeWrite([member('mixed-c'), { ...member('mixed-d'), appointmentId: '4075267' }], /share the exact/);
    await rejectsBeforeWrite([member('mixed-e'), { ...member('mixed-f'), jkNumber: 'JK4088445' }], /share the exact/);
    const duplicate = member('duplicate');
    await rejectsBeforeWrite([duplicate, duplicate], /duplicate message/);
    await rejectsBeforeWrite([member('aggregate-a', 3 * 1024 * 1024), member('aggregate-b', 2 * 1024 * 1024)], /aggregate upload limit/);
    await rejectsBeforeWrite([member('oversize', 5 * 1024 * 1024 + 1)], /file is invalid/);
    multipleSupported = false;
    await rejectsBeforeWrite([member('no-multiple-a'), member('no-multiple-b')], /does not support multiple/);
    multipleSupported = true;
    const edge = await session.uploadBatch([member('limit-a', 3 * 1024 * 1024), member('limit-b', 1.5 * 1024 * 1024)]);
    assert.ok(edge.results.every(result => result.status === 'verified'), 'Exactly 4.5 MiB aggregate is permitted');
    assert.equal((await session.uploadBatch([member('single-limit', 5 * 1024 * 1024)])).results[0].status, 'verified', 'One existing valid 5 MiB photo remains supported');
    persistFails = true;
    const storageFailure = await session.uploadBatch([member('persist-a'), member('persist-b')]);
    assert.ok(storageFailure.results.every(result => result.status === 'verified'), 'Local session persistence cannot erase proven source success');
    persistFails = false;

    const auditInputs = [member('audit-a'), member('audit-b')];
    const auditFirst = await session.uploadBatch(auditInputs);
    const auditPeers = [member('audit-peer-a'), member('audit-peer-b')];
    const auditSecond = await session.uploadBatch(auditPeers);
    const auditMembers = [...auditInputs, ...auditPeers];
    const priorResults = { results: [...auditFirst.results, ...auditSecond.results] };
    const beforeAuditPosts = stats.submissions, beforeAuditGets = stats.navigations;
    const audited = await session.auditVerifiedBatch(auditMembers, priorResults);
    assert.equal(stats.submissions, beforeAuditPosts, 'Final audit never uploads or repeats a POST');
    assert.equal(stats.navigations, beforeAuditGets + 1, 'One owning GET verifies the settled parallel gallery');
    const finalGallery = galleries.get(input.appointmentId)!;
    for (const result of audited.results) {
      assert.equal(result.status, 'verified');
      if (result.status !== 'verified') throw new Error('Expected final gallery verification');
      assert.deepEqual(result.verification.galleryUrls, finalGallery, 'Every lane receives one complete settled gallery');
      assert.equal(result.verification.afterCount, finalGallery.length);
      ordered(result.verification.finalAuditStartedAt, result.verification.finalAuditCompletedAt);
      assert.equal(result.verification.galleryObservedAt, result.verification.finalAuditStartedAt, 'Source observation predates the response completion');
    }
    const missingUrl = (auditFirst.results[0].status === 'verified' ? auditFirst.results[0].verification.mediaUrls[0] : '');
    galleries.set(input.appointmentId, finalGallery.filter(url => url !== missingUrl));
    const missing = await session.auditVerifiedBatch(auditMembers, priorResults);
    assert.equal(missing.results[0].status, 'uncertain', 'A missing exact original cannot pass the final audit');
    assert.ok(missing.results.slice(1).every(result => result.status === 'verified'));
    galleries.set(input.appointmentId, finalGallery);
    const uncertainOriginal = await session.auditVerifiedBatch(auditMembers, { results: priorResults.results.map((row, index) => index ? row : { filePath: row.filePath, status: 'uncertain', error: 'original uncertainty' }) });
    assert.equal(uncertainOriginal.results[0].status, 'uncertain', 'An audit cannot erase original uncertainty');
    behavior = 'wrong-title';
    await assert.rejects(session.auditVerifiedBatch(auditMembers, priorResults), /different appointment/);
    assert.equal(stats.submissions, beforeAuditPosts, 'Failed final audits cannot replay uploads');
    behavior = 'normal';

    await session.close();
    await assert.rejects(session.upload(input), /session is closed/);
    assert.equal(stats.launches, stats.closes, 'Every allocated browser was closed');
  } finally {
    if (prior === undefined) delete process.env.WHATSAPP_JOB_PHOTO_STATE_DIR; else process.env.WHATSAPP_JOB_PHOTO_STATE_DIR = prior;
    if (priorData === undefined) delete process.env.OPSBOT_DATA_DIR; else process.env.OPSBOT_DATA_DIR = priorData;
    fs.rmSync(root, { recursive: true, force: true });
  }
  console.log('Photo throughput verified: FIFO, bounded fresh queue drain, no hot retries, sequential reusable sessions, bounded native batches, per-file partial outcomes and exact media attribution.');
}
void main();
