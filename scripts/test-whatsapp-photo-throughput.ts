import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Browser } from '@playwright/test';
import { createJunkwarePhotoUploadSession } from '../lib/junkware-photo-uploader';
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
    let currentUrl = 'about:blank', title = '', selected = '', file = '';
    let behavior: 'normal' | 'post-title' | 'wrong-title' | 'no-image' | 'human-image' = 'normal';
    const categories: string[] = [];
    const currentId = () => new URL(currentUrl).searchParams.get('id') || '';
    const page = {
      url: () => currentUrl,
      goto: async (url: string) => { stats.navigations++; currentUrl = url; title = `Appointment JK${Number(currentId()) + 13178}`; },
      evaluate: async (fn: unknown) => String(fn).includes('querySelectorAll') ? [...(galleries.get(currentId()) || [])] : { url: currentUrl, title: behavior === 'wrong-title' ? 'Appointment JK9999999' : title },
      waitForNavigation: async () => {},
      locator: (selector: string) => ({
        count: async () => 1,
        setInputFiles: async (value: string) => { file = value; },
        evaluate: async () => {
          if (selector.includes('ImageBeforeRB') || selector.includes('ImageAfterRB') || selector.includes('ImageDonationRB')) {
            selected = selector.includes('Before') ? 'before' : selector.includes('Donation') ? 'donation' : 'after'; return true;
          }
          if (selector.includes('AddImageBtn')) {
            stats.submissions++; categories.push(selected);
            if (behavior !== 'no-image') {
              const stem = behavior === 'human-image' ? 'unrelated-human' : path.parse(file).name;
              const suffix = selected === 'donation' ? 'donation-rcpt' : selected;
              const url = `https://junkware.junk-king.com/system/aspnet/local/media/2026-09/test-${currentId()}-random-${stem}-${suffix}.jpg`;
              galleries.set(currentId(), [...(galleries.get(currentId()) || []), url]);
            }
            if (behavior === 'post-title') title = 'Image uploaded';
          }
          return undefined;
        },
      }),
    };
    const session = createJunkwarePhotoUploadSession({
      launch: async () => {
        stats.launches++; currentUrl = 'about:blank'; title = '';
        return { newContext: async () => ({ newPage: async () => page }), close: async () => { stats.closes++; } } as unknown as Browser;
      },
      persist: async () => { stats.persisted++; },
    });
    const input = { appointmentId: '4075431', jkNumber: 'JK4088609', filePath: files[0], category: 'after' as const };
    const firstPending = session.upload(input);
    await assert.rejects(session.upload(input), /must remain sequential/);
    const first = await firstPending;
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
    await session.close();
    await assert.rejects(session.upload(input), /session is closed/);
    assert.equal(stats.launches, stats.closes, 'Every allocated browser was closed');
  } finally {
    if (prior === undefined) delete process.env.WHATSAPP_JOB_PHOTO_STATE_DIR; else process.env.WHATSAPP_JOB_PHOTO_STATE_DIR = prior;
    if (priorData === undefined) delete process.env.OPSBOT_DATA_DIR; else process.env.OPSBOT_DATA_DIR = priorData;
    fs.rmSync(root, { recursive: true, force: true });
  }
  console.log('Photo throughput verified: FIFO, bounded fresh queue drain, no hot retries, sequential reusable sessions and exact media attribution.');
}
void main();
