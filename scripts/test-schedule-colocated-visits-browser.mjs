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
  assert.ok(labels.some(label=>label?.includes('Truck# 3') && label.includes('4 min on site')));
  assert.ok(labels.some(label=>label?.includes('Truck# 6') && label.includes('2 min on site')));
  assert.deepEqual((await blocks.locator('.schedule-visit-duration').allTextContents()).sort(),['2m','4m']);
  const geometry=await connector.evaluate(element=>{
    const points=element.querySelector('.schedule-colocated-connector-line')?.getAttribute('points')?.split(' ').map(point=>point.split(',').map(Number)) || [];
    return {from:element.getAttribute('data-from-truck'),to:element.getAttribute('data-to-truck'),height:Math.abs(points[0]?.[1]-points.at(-1)?.[1]),x1:points[0]?.[0],x2:points.at(-1)?.[0]};
  });
  assert.deepEqual(new Set([geometry.from,geometry.to]),new Set(['Truck 3','Truck 6']));
  assert.ok(geometry.height>20,'The connector crosses from one truck row to the other');
  assert.ok(geometry.x2>geometry.x1,'The stepped connector preserves the parked heartbeat gap between truck blocks');
  assert.equal(await page.locator('#fixture-writes').innerText(),'Writes: 0');
  await page.goto(`${base}/tests/schedule-destinations.html?scenario=co-located&presence=stale`);
  await page.locator('[data-schedule-appointment$="appointment:1001"][data-time-basis="actual"]').first().waitFor();
  assert.equal(await page.locator('[data-co-located-connector]').count(),0,'A stale parked report cannot bridge the evidence gap');
  console.log('Co-located truck visits passed: per-truck blocks, visible durations, cross-row connector and zero writes.');
} finally { await browser.close(); }
