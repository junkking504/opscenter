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
    await page.goto(campaign);
    const save = page.getByRole('button', { name: 'Review & save outcome', exact: true });
    await save.waitFor();
    // Inspect enabled appearance, since disabled opacity can obscure duplicate emphasis.
    await page.getByRole('textbox', { name: 'Note or next step' }).fill('Synthetic follow-up');
    const background = locator => locator.evaluate(el => getComputedStyle(el).backgroundColor);
    const call = page.getByRole('link', { name: 'Call customer', exact: true });
    const red = await background(call);
    assert.equal(red, 'rgb(181, 25, 53)');
    assert.notEqual(await background(save), red, 'Outcome action is neutral beside Call customer');
    await save.click();
    await page.getByRole('dialog').waitFor();
    await page.getByRole('dialog').getByRole('button', { name: 'Back to edit', exact: true }).click();
    await page.getByRole('tab', { name: 'Reviews', exact: true }).click();
    const match = page.getByRole('button', { name: 'Review job match', exact: true });
    await match.waitFor();
    assert.equal(await background(match), red, 'Review detail keeps its single primary action');
    console.log(`PASS ${width} Marketing: neutral outcome action; review matching stays primary`);
  }
} finally { await browser.close(); }
console.log('Synthetic fixtures only; no live data or provider calls.');
