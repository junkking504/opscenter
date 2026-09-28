import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const base = process.env.PHOTO_REVIEW_PREVIEW_URL || 'http://127.0.0.1:4178/desktop-assets/tests/photo-assignment.html';
const output = new URL('../tmp/photo-review-evidence/', import.meta.url); fs.mkdirSync(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
const errors = []; page.on('pageerror', error => errors.push(error.message));
await page.route('**/api/desktop/photos?preview=*', route => route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="360" height="460"><rect width="360" height="460" fill="#ebece7"/><rect x="75" y="80" width="210" height="300" rx="18" fill="#e0d5bd" stroke="#b7aa8f" stroke-width="3"/><path d="M85 120H275M85 165H275M85 210H275M85 255H275M85 300H275M85 345H275" stroke="#c8b99a"/><text x="180" y="420" text-anchor="middle" fill="#4d5a51" font-size="16">Synthetic photo placeholder</text></svg>' }));
async function open(suffix = '') { await page.goto(`${base}?photoReview=1${suffix}`); await page.getByRole('button', { name: /^Inspect photo/ }).click(); }
async function choose() {
  await page.getByLabel('Truck', { exact: true }).selectOption('Truck# 4');
  await page.getByLabel('Appointment', { exact: true }).selectOption('100002');
  await page.getByLabel('Photo category').selectOption('before');
  await page.getByRole('checkbox').check();
}
try {
  await open();
  assert.equal(await page.getByRole('button', { name: 'Assign and upload photo' }).isDisabled(), true);
  await choose();
  await page.waitForFunction(() => [...document.querySelectorAll('button')].some(button => button.textContent === 'Assign and upload photo' && !button.disabled));
  assert.equal(await page.getByText('200 Example Avenue, New Orleans', { exact: false }).count(), 1);
  await page.screenshot({ path: new URL('assignment-desktop.png', output).pathname, fullPage: true });
  await page.getByRole('button', { name: 'Assign and upload photo' }).click();
  await page.getByText('Assignment saved. Waiting for the photo worker; upload is not yet verified.').waitFor();
  assert.equal(await page.locator('#post-count').textContent(), '1');
  await page.getByRole('button', { name: 'Check upload status' }).click();
  assert.equal(await page.locator('#post-count').textContent(), '1');
  await page.getByRole('button', { name: 'Simulate verified upload' }).click();
  await page.getByRole('button', { name: 'Check upload status' }).click();
  await page.getByRole('heading', { name: 'Upload verified', exact: true }).waitFor();
  await page.screenshot({ path: new URL('assignment-verified.png', output).pathname, fullPage: true });
  await open('&uncertain=1');
  assert.equal(await page.getByRole('button', { name: 'Assign and upload photo' }).count(), 0);
  await page.getByRole('heading', { name: 'Assignment unavailable' }).waitFor();
  await open('&lost=1'); await choose(); await page.getByRole('button', { name: 'Assign and upload photo' }).click();
  await page.getByRole('alert').filter({ hasText: 'lost response' }).waitFor();
  await page.getByRole('button', { name: 'Check upload status' }).click();
  await page.getByText('Assignment saved. Waiting for the photo worker; upload is not yet verified.').waitFor();
  assert.equal(await page.locator('#post-count').textContent(), '1', 'Lost response is checked without another submission');
  await page.setViewportSize({ width: 390, height: 844 }); await open(); await choose();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'Mobile page must not overflow');
  await page.screenshot({ path: new URL('assignment-mobile.png', output).pathname, fullPage: true });
  await page.getByLabel('Appointment date').fill('2026-09-25');
  await page.getByText('0 appointments match.', { exact: false }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Assign and upload photo' }).isDisabled(), true);
  assert.deepEqual(errors, []);
  console.log('PASS: rendered assignment, truck filtering, explicit confirmation, pending/verified states, lost response read-back, unsafe hold, empty dates and mobile width.');
} finally { await browser.close(); }
