import assert from 'node:assert/strict';
import { chromium } from 'playwright';
const schedule = process.env.DISPATCH_FIXTURE_URL || 'http://127.0.0.1:3139';
const campaign = process.env.CAMPAIGN_PREVIEW_URL || 'http://127.0.0.1:3176/tests/campaign.html';
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.fulfill({ status: 204 }));
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    for (const view of ['board', 'calendar', 'followup', 'history']) {
      await page.goto(`${schedule}/tests/schedule-destinations.html?view=${view}`);
      const action = page.getByRole('button', { name: 'New Appointment', exact: true });
      await action.waitFor();
      assert.equal(await action.count(), 1, `${view}: exactly one creation action`);
      await action.click();
      await page.getByRole('dialog', { name: 'New Appointment', exact: true }).waitFor();
      console.log(`PASS ${width} ${view}: New opens appointment creation`);
    }
    await page.goto(`${schedule}/tests/photo-assignment.html`);
    const toggle = page.getByRole('button', { name: 'Review WhatsApp photos', exact: true });
    const background = locator => locator.evaluate(el => getComputedStyle(el).backgroundColor);
    const photoRed = await background(toggle);
    assert.equal(photoRed, 'rgb(181, 25, 53)');
    await toggle.click();
    const hide = page.getByRole('button', { name: 'Hide photo queue', exact: true });
    assert.notEqual(await background(hide), photoRed, 'Open queue toggle is neutral');
    await page.getByRole('button', { name: /^Inspect photo/ }).click();
    await page.getByLabel('Truck', { exact: true }).selectOption('Truck# 4');
    await page.getByLabel('Appointment', { exact: true }).selectOption('100002');
    await page.getByLabel('Photo category').selectOption('before');
    await page.getByRole('checkbox').check();
    const assign = page.getByRole('button', { name: 'Assign and upload photo', exact: true });
    assert.equal(await assign.isEnabled(), true);
    assert.equal(await background(assign), photoRed, 'Inline assignment is primary');
    assert.notEqual(await background(hide), photoRed, 'Toggle stays neutral beside enabled assignment');
    await hide.click();
    assert.equal(await assign.count(), 0);
    assert.equal(await toggle.getAttribute('data-variant'), 'brand', 'Closed queue restores review emphasis');
    console.log(`PASS ${width} Dashboard: queue toggle and inline assignment share one primary`);
    await page.goto(campaign);
    await page.locator('.campaign-lead-card').first().click();
    const save = page.getByRole('button', { name: 'Review & save outcome', exact: true });
    await save.waitFor();
    // Inspect enabled appearance, since disabled opacity can obscure duplicate emphasis.
    await page.getByRole('textbox', { name: 'Note or next step' }).fill('Synthetic follow-up');
    const call = page.getByRole('link', { name: 'Call customer', exact: true });
    const red = await background(call);
    assert.equal(red, 'rgb(181, 25, 53)');
    assert.notEqual(await background(save), red, 'Outcome action is neutral beside Call customer');
    await save.click();
    await page.getByRole('dialog').waitFor();
    await page.getByRole('dialog').getByRole('button', { name: 'Back to edit', exact: true }).click();
    await page.getByRole('button', { name: 'Discard changes', exact: true }).click();
    await page.getByRole('tab', { name: 'Reviews', exact: true }).click();
    if (width === 390) await page.locator('.campaign-queue-row').first().click();
    const match = page.getByRole('button', { name: 'Review job match', exact: true });
    await match.waitFor();
    assert.equal(await background(match), red, 'Review detail keeps its single primary action');
    console.log(`PASS ${width} Marketing: neutral outcome action; review matching stays primary`);
  }
} finally { await browser.close(); }
console.log('Synthetic fixtures only; no live data or provider calls.');
