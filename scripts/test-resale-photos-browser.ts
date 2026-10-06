import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium, type Page, type Route } from 'playwright';
import sharp from 'sharp';
import { resaleTestRoutes } from './resale-photo-test-support';
import { readResaleStore } from '../lib/resale-items';
import { commercialVersion } from '../lib/desktop-marketing';

async function main() {
  const original = process.cwd(), directory = fs.mkdtempSync(path.join(os.tmpdir(), 'resale-browser-test-'));
  const evidence = path.join(original, 'tmp/resale-photo-evidence'); fs.mkdirSync(evidence, { recursive: true });
  const routes = resaleTestRoutes(); process.chdir(directory);
  const browser = await chromium.launch({ headless: true });
  let page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const base = process.env.RESALE_PHOTO_PREVIEW_URL || 'http://127.0.0.1:4179/desktop-assets/tests/resale-photos.html';
  const image = await sharp({ create: { width: 360, height: 260, channels: 3, background: '#c4a476' } }).composite([{ input: Buffer.from('<svg width="360" height="260"><rect x="85" y="45" width="190" height="150" rx="8" fill="#75583e"/><path d="M105 195v35m150-35v35M90 100h180M90 150h180" stroke="#302b28" stroke-width="8"/><text x="180" y="30" text-anchor="middle" font-size="18">Fixture cabinet</text></svg>') }]).jpeg().toBuffer();
  const photo = { name: 'cabinet.jpg', mimeType: 'image/jpeg', buffer: image };
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  let mode = '', savePosts = 0, uploadPosts = 0;
  const handleApi = async (route: Route) => {
    const request = route.request(), url = new URL(request.url()), method = request.method();
    const body = request.postDataBuffer();
    const input = new Request(request.url(), { method, headers: request.headers(), ...(body ? { body: new Uint8Array(body) } : {}) });
    let response: Response;
    if (url.pathname === '/api/desktop/finance' && method === 'GET') {
      const store = readResaleStore(true);
      response = Response.json({ date: '2026-10-05', available: false, generatedAt: null, daily: { revenue: 0, costs: 0, profit: 0, recyclingIncome: 0 }, month: { label: 'October', missingDates: [] }, territories: [], costs: [], trends: [], reconciliation: { status: 'not_collected', generatedAt: null, merchantCenterAvailable: false, merchantCenterFresh: false, summary: {}, paymentsByJob: [], exceptions: [] }, resale: store.items.map(item => ({ ...item, version: commercialVersion(item) })), resaleUpdatedAt: store.updatedAt, recycling: [], recyclingVersion: '', recyclingIncomeRows: [] });
    } else if (url.pathname === '/api/desktop/finance' && method === 'POST') {
      savePosts++; response = await routes.finance.POST(input);
      if (mode === 'lost-save') { mode = ''; await route.abort('failed'); return; }
    } else if (url.pathname === '/api/resale-items/photos' && method === 'POST') {
      uploadPosts++;
      if (mode === 'interrupt') { mode = ''; await route.abort('failed'); return; }
      response = await routes.upload.POST(input);
      if (mode === 'lost-photo') { mode = ''; await route.abort('failed'); return; }
    } else if (url.pathname.startsWith('/api/resale-items/photos/')) {
      response = await routes.view.GET(input, { params: Promise.resolve({ photoId: url.pathname.split('/').at(-1)! }) });
    } else if (url.pathname === '/api/desktop/ask-opsbot' && method === 'GET') {
      response = Response.json({ available: false, remaining: 0, limit: 0, reason: 'Synthetic fixture; paid services disabled.' });
    } else throw new Error(`Unexpected fixture request ${url.pathname}`);
    await route.fulfill({ status: response.status, headers: Object.fromEntries(response.headers), body: Buffer.from(await response.arrayBuffer()) });
  };
  await page.route('**/api/**', handleApi);
  async function create(name: string) {
    await page.getByRole('button', { name: 'Add item', exact: true }).click();
    await page.getByLabel('Item name', { exact: true }).fill(name);
    await page.getByLabel('Source job / custody reference').fill('Synthetic fixture');
    await page.getByLabel('Recorded cost', { exact: true }).fill('0');
    await page.getByLabel('Asking price', { exact: true }).fill('80');
    await page.getByLabel('Sale amount', { exact: false }).fill('0');
  }
  const closed = () => page.getByRole('dialog').waitFor({ state: 'hidden' });
  const row = (name: string) => readResaleStore().items.find(item => item.itemName === name)!;
  async function screenshot(name: string, target: Page = page) { await target.evaluate(async () => { await Promise.all(document.getAnimations().map(animation => animation.finished.catch(() => {}))); }); await target.screenshot({ path: path.join(evidence, name) }); }
  try {
    await page.goto(base);
    // The shared header uses display:contents, so its search/alert descendants
    // must be covered by the drawer or its backdrop at every responsive width.
    for (const width of [390, 320, 430, 600, 760, 1024, 1440]) {
      await page.setViewportSize({ width, height: 844 });
      await page.getByRole('button', { name: 'Add item', exact: true }).click();
      await page.evaluate(async () => { await Promise.all(document.getAnimations().map(animation => animation.finished.catch(() => {}))); });
      if (width === 390) await screenshot('mobile-drawer-layer.png');
      if (width === 1440) await screenshot('desktop-drawer-layer.png');
      for (const selector of ['.live-search-below-day .global-search', '.notification-trigger']) {
        const coverage = await page.locator(selector).evaluate(element => {
          const box = element.getBoundingClientRect();
          const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
          return { covered: Boolean(hit?.closest('.record-drawer, .record-drawer-backdrop')), hit: hit?.outerHTML.slice(0, 160) };
        });
        assert(coverage.covered, `${width}px: ${selector} must be covered by resale drawer/backdrop; hit ${coverage.hit}`);
      }
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${width}px must fit without horizontal overflow`);
      await page.getByRole('button', { name: 'Take photo', exact: true }).click({ trial: true });
      await page.getByRole('button', { name: 'Choose photos', exact: true }).click({ trial: true });
      await page.getByRole('button', { name: 'Close', exact: true }).click();
      await closed();
      await page.locator('.notification-trigger').click();
      await page.getByRole('dialog', { name: 'Alerts', exact: true }).waitFor();
      await page.keyboard.press('Escape');
      await page.getByRole('dialog', { name: 'Alerts', exact: true }).waitFor({ state: 'hidden' });
      await page.keyboard.press('/');
      await page.getByRole('dialog', { name: 'OpsCenter launcher', exact: true }).waitFor();
      await page.keyboard.press('Escape');
      await page.getByRole('dialog', { name: 'OpsCenter launcher', exact: true }).waitFor({ state: 'hidden' });
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
    await create('No photo chair'); await page.getByRole('button', { name: 'Save Inventory Record', exact: true }).click(); await closed(); assert.equal(row('No photo chair').photos?.length, 0);
    await create('Desktop cabinet');
    await page.getByLabel('Choose resale photos').setInputFiles({ name: 'bad.heic', mimeType: 'image/heic', buffer: Buffer.from('bad') });
    await page.getByRole('alert').filter({ hasText: 'Export HEIC' }).waitFor();
    await page.getByLabel('Choose resale photos').setInputFiles([photo, { ...photo, name: 'remove.jpg' }]);
    await page.getByRole('button', { name: 'Remove remove.jpg' }).click();
    assert.equal(await page.getByAltText('Selected: cabinet.jpg').count(), 1);
    await screenshot('desktop-selected.png');
    mode = 'lost-save'; await page.getByRole('button', { name: 'Save item & upload photos', exact: true }).click();
    await page.getByRole('alert').waitFor(); assert.equal(uploadPosts, 0); assert(row('Desktop cabinet'));
    await page.getByRole('button', { name: 'Check saved item & retry', exact: true }).click(); await closed();
    assert.equal(readResaleStore().items.length, 2); assert.equal(row('Desktop cabinet').photos?.length, 1); assert.equal(savePosts, 3);
    await page.reload(); await page.getByRole('button', { name: 'View 1 photos of Desktop cabinet' }).click();
    await page.getByRole('link', { name: 'Open photo 1 of Desktop cabinet' }).waitFor();
    await page.getByAltText('Desktop cabinet, photo 1').evaluate((img: HTMLImageElement) => img.decode());
    assert.equal(await page.getByAltText('Desktop cabinet, photo 1').evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0), true);
    await page.getByLabel('Item name', { exact: true }).fill('Desktop cabinet edited');
    await page.getByRole('button', { name: 'Save Inventory Record', exact: true }).click(); await closed(); assert.equal(row('Desktop cabinet edited').photos?.length, 1);
    await page.close();
    page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/api/**', handleApi); await page.goto(base);
    await create('Mobile cabinet');
    assert.equal(await page.getByLabel('Take resale photo').getAttribute('capture'), 'environment');
    await page.getByLabel('Take resale photo').setInputFiles(photo);
    await page.getByLabel('Choose resale photos').setInputFiles({ ...photo, name: 'second.jpg', buffer: await sharp(image).tint('#806244').jpeg().toBuffer() });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'Mobile must fit without horizontal overflow');
    await screenshot('mobile-selected.png');
    mode = 'lost-photo'; await page.getByRole('button', { name: 'Save item & upload photos', exact: true }).click();
    await page.getByRole('alert').waitFor(); assert.equal(row('Mobile cabinet').photos?.length, 1);
    await screenshot('mobile-interrupted.png');
    const beforeSave = savePosts;
    await page.getByRole('button', { name: 'Retry remaining photos', exact: true }).click(); await closed();
    assert.equal(savePosts, beforeSave); assert.equal(row('Mobile cabinet').photos?.length, 2);
    await page.reload(); await page.getByRole('button', { name: 'View 2 photos of Mobile cabinet' }).click();
    await page.getByRole('link', { name: 'Open photo 2 of Mobile cabinet' }).waitFor(); await screenshot('mobile-saved.png');
    await page.getByRole('button', { name: 'Close', exact: true }).click();
    await create('Interrupted cabinet'); await page.getByLabel('Choose resale photos').setInputFiles(photo);
    mode = 'interrupt'; await page.getByRole('button', { name: 'Save item & upload photos', exact: true }).click();
    await page.getByRole('alert').waitFor(); assert.equal(row('Interrupted cabinet').photos?.length, 0);
    await page.getByRole('button', { name: 'Retry remaining photos', exact: true }).evaluate((button: HTMLButtonElement) => { button.click(); button.click(); });
    await closed(); assert.equal(row('Interrupted cabinet').photos?.length, 1);
    assert.equal(readResaleStore().items.length, 4); assert.deepEqual(errors, []);
    console.log('PASS: desktop/mobile creation, camera/library inputs, previews/removal, unsupported files, no-photo save, verified storage reload/gallery, existing edits, interrupted/lost save and photo responses, safe retry and double-submit guard.');
    console.log(`Screenshots: ${evidence}`);
  } finally { await browser.close(); process.chdir(original); fs.rmSync(directory, { recursive: true, force: true }); }
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
