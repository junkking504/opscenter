import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium, type Page, type Route } from 'playwright';
import sharp from 'sharp';
import { resaleTestRoutes } from './resale-photo-test-support';
import { readResaleStore, upsertResaleItem } from '../lib/resale-items';
import { commercialVersion } from '../lib/desktop-marketing';

async function main() {
  const original = process.cwd(), directory = fs.mkdtempSync(path.join(os.tmpdir(), 'resale-browser-test-'));
  const evidence = path.join(original, 'tmp/resale-delete-evidence'); fs.mkdirSync(evidence, { recursive: true });
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
      savePosts++;
      if (mode === 'reject-delete') { mode = ''; await route.fulfill({ status: 503, body: JSON.stringify({ error: 'Fixture storage unavailable.' }) }); return; }
      response = await routes.finance.POST(input);
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
  const closed = () => page.getByRole('dialog').waitFor({ state: 'hidden' });
  const row = (name: string) => readResaleStore().items.find(item => item.itemName === name)!;
  async function screenshot(name: string, target: Page = page) { await target.evaluate(async () => { await Promise.all(document.getAnimations().map(animation => animation.finished.catch(() => {}))); }); await target.screenshot({ path: path.join(evidence, name) }); }
  try {
    upsertResaleItem({ itemId: 'synthetic-cabinet', itemName: 'Synthetic cabinet', acquiredDate: '2026-10-06', source: 'Fixture source reference', status: 'sold', cost: 20, askingPrice: 80, soldPrice: 65, marketplace: 'Fixture marketplace', notes: 'Synthetic sale receipt retained' });
    await page.goto(base);
    await page.getByRole('button', { name: 'Review item', exact: true }).click();
    await page.getByLabel('Choose resale photos').setInputFiles(photo);
    await page.getByRole('button', { name: 'Save item & upload photos', exact: true }).click(); await closed();
    for (const width of [1440, 390, 320]) {
      await page.setViewportSize({ width, height: 900 });
      await page.getByRole('button', { name: 'Review item', exact: true }).click();
      await page.getByRole('button', { name: 'Delete item', exact: true }).click();
      await page.getByRole('heading', { name: 'Delete “Synthetic cabinet”?' }).waitFor();
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      await screenshot(`confirm-${width}.png`);
      const posts = savePosts;
      await page.getByRole('button', { name: 'Cancel', exact: true }).click();
      assert.equal(savePosts, posts); assert(row('Synthetic cabinet'));
      await page.getByRole('button', { name: 'Close', exact: true }).click(); await closed();
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole('button', { name: 'Review item', exact: true }).click();
    await page.getByRole('button', { name: 'Delete item', exact: true }).click();
    mode = 'reject-delete'; await page.getByRole('button', { name: 'Delete item', exact: true }).click();
    await page.getByRole('alert').waitFor(); assert(row('Synthetic cabinet'));
    await screenshot('mobile-failure.png');
    mode = 'lost-save';
    const posts = savePosts;
    await page.getByRole('button', { name: 'Retry safely', exact: true }).evaluate((button: HTMLButtonElement) => { button.click(); button.click(); });
    await page.getByRole('alert').filter({ hasText: 'Failed to fetch' }).waitFor();
    assert.equal(savePosts, posts + 1); assert.equal(readResaleStore().items.length, 0);
    await page.getByRole('button', { name: 'Retry safely', exact: true }).click(); await closed();
    await page.reload();
    await page.getByRole('button', { name: 'Deleted', exact: true }).click();
    await page.getByRole('button', { name: 'Review deleted item', exact: true }).waitFor();
    assert.equal(readResaleStore(true).items[0].soldPrice, 65);
    assert.equal(readResaleStore(true).items[0].photos?.length, 1);
    await screenshot('mobile-deleted.png');
    await page.getByRole('button', { name: 'Review deleted item', exact: true }).click();
    await page.getByRole('button', { name: 'Restore item', exact: true }).click();
    await page.getByRole('button', { name: 'Restore item', exact: true }).click(); await closed();
    await page.reload();
    await page.getByRole('button', { name: 'View 1 photos of Synthetic cabinet' }).click();
    await page.getByAltText('Synthetic cabinet, photo 1').evaluate((img: HTMLImageElement) => img.decode());
    await screenshot('mobile-restored-photo.png');
    await page.getByRole('button', { name: 'Close', exact: true }).click(); await closed();
    await page.setViewportSize({ width: 1440, height: 1000 }); await screenshot('desktop-restored.png');
    assert.equal(Object.keys(readResaleStore(true).lifecycleReceipts!).length, 2);
    assert.equal(uploadPosts, 1); assert.deepEqual(errors, []);
    console.log('PASS: real Capital UI desktop/mobile deletion confirmation, cancel, overflow, failure, lost response, double click, safe retry, reload, Deleted view, restore and preserved photo/financial evidence.');
    console.log(`Screenshots: ${evidence}`);
  } finally { await browser.close(); process.chdir(original); fs.rmSync(directory, { recursive: true, force: true }); }
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
