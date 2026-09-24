import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
const base = process.env.DISPATCH_FIXTURE_URL || 'http://127.0.0.1:3156';
try {
  const page = await browser.newPage();
  for (const [width, height] of [[1440, 900], [390, 844]]) {
    await page.setViewportSize({ width, height });
    await page.goto(`${base}/tests/schedule-destinations.html?scenario=same-time&details=long`);
    await page.locator('.day-switcher button').first().click();
    await page.locator('[data-schedule-appointment]').first().click();
    const summary = page.getByRole('region', { name: 'Selected job JK1001001', exact: true });
    await summary.waitFor();
    await page.waitForFunction(() => document.querySelector('.selected-job-closest')?.textContent?.includes('10 min'));
    const closest = summary.locator('.selected-job-closest');
    assert.equal(await closest.innerText(), 'Closest truck\nTruck# 1 · 10 min · 5 mi');
    assert.doesNotMatch(await closest.innerText(), /Recent GPS|road estimate|Check availability/);
    assert.equal(await closest.locator('strong').evaluate(element => getComputedStyle(element).fontSize), '13px');
    assert.doesNotMatch(await page.locator('body').innerText(), /JunkWare snapshot:|No consecutive assigned appointments to route|Appointment windows are not confirmed service durations/);

    await summary.getByRole('button', { name: 'Full details for JK1001001', exact: true }).click();
    const appointment = page.getByRole('dialog', { name: 'JK1001001', exact: true });
    await appointment.waitFor();
    await appointment.getByRole('button', { name: 'Enlarge before photo: synthetic-before.svg', exact: true }).click();
    const gallery = page.getByRole('dialog', { name: 'Photo gallery', exact: true });
    await gallery.waitFor();
    assert.match(await gallery.innerText(), /Before photo[\s\S]*1 of 2/);
    await page.keyboard.press('ArrowRight');
    assert.match(await gallery.innerText(), /After photo[\s\S]*2 of 2/);
    await page.keyboard.press('Escape');
    assert.equal(await gallery.count(), 0, 'first Escape returns to appointment details');
    assert.equal(await appointment.count(), 1, 'appointment remains open after gallery closes');
    await page.keyboard.press('Escape');
    assert.equal(await appointment.count(), 0, 'second Escape returns to Control');
  }
  console.log('Schedule cleanup browser passed at 390px and 1440px: compact closest-truck facts, no snapshot explainer, in-app photo gallery, arrow cycling, and two-stage Escape.');
} finally {
  await browser.close();
}
