import assert from 'node:assert/strict';
import {chromium} from 'playwright';

const base=process.env.DISPATCH_FIXTURE_URL || 'http://127.0.0.1:3156';
const browser=await chromium.launch({headless:true});
try {
  const page=await browser.newPage({viewport:{width:1280,height:900}});
  await page.goto(`${base}/tests/schedule-destinations.html?scenario=co-located`);
  const connector=page.locator('[data-co-located-connector]').first();
  await connector.waitFor();
  const blocks=page.locator('[data-schedule-appointment$="appointment:1001"][data-time-basis="actual"]');
  assert.equal(await blocks.count(),2,'The shared appointment renders once in each physical truck lane');
  const labels=await blocks.evaluateAll(elements=>elements.map(element=>element.getAttribute('aria-label')));
  assert.ok(labels.some(label=>label?.includes('Truck# 3') && label.includes('46 min on site')));
  assert.ok(labels.some(label=>label?.includes('Truck# 6') && label.includes('31 min on site')));
  assert.deepEqual((await blocks.locator('.schedule-visit-duration').allTextContents()).sort(),['31m','46m']);
  const geometry=await connector.evaluate(element=>{
    const line=element.querySelector('.schedule-colocated-connector-line');
    const y1=Number(line?.getAttribute('y1')),y2=Number(line?.getAttribute('y2'));
    return {from:element.getAttribute('data-from-truck'),to:element.getAttribute('data-to-truck'),height:Math.abs(y2-y1)};
  });
  assert.deepEqual(new Set([geometry.from,geometry.to]),new Set(['Truck 3','Truck 6']));
  assert.ok(geometry.height>20,'The connector crosses from one truck row to the other');
  assert.equal(await page.locator('#fixture-writes').innerText(),'Writes: 0');
  console.log('Co-located truck visits passed: per-truck blocks, visible durations, cross-row connector and zero writes.');
} finally { await browser.close(); }
