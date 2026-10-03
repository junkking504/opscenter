import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
  await page.goto(`${process.env.DISPATCH_FIXTURE_URL || 'http://127.0.0.1:3168'}/tests/schedule-destinations.html?scenario=same-time&details=long`);
  await page.getByRole('button', { name: /^2026-09-07/ }).click();
  await page.locator('[data-schedule-appointment^="2026-09-07:"]').first().waitFor();
  await page.evaluate(() => {
    const original = window.fetch;
    window.closestReads = [];
    window.scheduleRefreshes = 0;
    window.fetch = async (input, init) => {
      const url = new URL(String(input), location.origin);
      if (url.pathname === '/api/desktop/schedule/routes') {
        if (url.searchParams.get('scope') !== 'closest') return new Promise(() => {});
        return new Promise(resolve => window.closestReads.push({ resolve, signal: init.signal, url }));
      }
      const response = await original(input, init);
      if (url.pathname !== '/api/desktop/schedule') return response;
      const body = await response.json();
      body.appointments[1].version = String(Date.now());
      window.scheduleRefreshes += 1;
      return Response.json(body);
    };
    window.finishClosest = (index, truck = 'Truck 8', status = 200) => {
      const read = window.closestReads[index];
      read.resolve(Response.json({ date: read.url.searchParams.get('date'), appointmentId: read.url.searchParams.get('appointment'), calculatedAt: new Date().toISOString(), legs: [], closest: [{ truck, minutes: 12, miles: 7.5, status: 'available', gpsUpdatedAt: new Date().toISOString() }] }, { status }));
    };
  });
  await page.locator('[data-schedule-appointment$=":appointment:1001"]').click();
  const summary = page.getByRole('region', { name: 'Selected job JK1001001', exact: true });
  await page.waitForFunction(() => window.closestReads.length === 1);
  await page.getByRole('button', { name: 'Refresh day', exact: true }).click();
  await page.waitForFunction(() => window.scheduleRefreshes >= 2);
  assert.equal(await page.evaluate(() => window.closestReads.length), 1);
  assert.equal(await page.evaluate(() => window.closestReads[0].signal.aborted), false, 'Other appointment changes do not cancel proximity');
  await page.evaluate(() => window.finishClosest(0));
  await summary.getByText(/12 min · 7.5 mi/).waitFor();
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await page.waitForFunction(() => window.closestReads.length === 2);
  assert.match(await summary.innerText(), /12 min · 7.5 mi/);
  assert.match(await summary.innerText(), /Last estimate/);
  await page.evaluate(() => window.finishClosest(1, 'Truck 8', 503));
  await summary.getByText('Refresh failed. Showing the last estimate.').waitFor();
  assert.match((await page.locator('.register-status').allTextContents()).join(' '), /Refresh failed/);
  await summary.getByRole('button', { name: 'Retry closest truck' }).click();
  await page.waitForFunction(() => window.closestReads.length === 3);
  await page.evaluate(() => window.finishClosest(2, 'Truck 4'));
  await summary.getByText(/Truck# 4 · 12 min/).waitFor();
  await page.locator('[data-schedule-appointment$=":appointment:1002"]').click();
  await page.waitForFunction(() => window.closestReads.length === 4);
  const second = page.getByRole('region', { name: 'Selected job JK1001002', exact: true });
  assert.doesNotMatch(await second.innerText(), /7.5 mi/);
  await page.evaluate(() => window.finishClosest(3, 'Truck 4', 503));
  await second.getByText('Lookup failed', { exact: true }).waitFor();
  assert.doesNotMatch(await second.innerText(), /Checking distance/);
  assert.match(await page.locator('#fixture-writes').innerText(), /Writes: 0/);
  console.log('Closest-truck browser passed: independent lookup, retained result, failure, retry, selection isolation, zero writes.');
} finally { await browser.close(); }
