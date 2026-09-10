import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  for (const [width,height] of [[1440,900],[1024,768],[390,1000]]) {
    await page.setViewportSize({width,height});
    await page.goto('http://127.0.0.1:3156/tests/schedule-destinations.html?scenario=route-stack');
    const row = page.locator('[data-schedule-truck="Truck 9"]');
    const incoming = row.locator('.schedule-route-connector').filter({has: page.getByRole('button',{name:/31m/})});
    await incoming.waitFor();
    const sourceId = await incoming.getAttribute('data-route-from');
    const targetId = await incoming.getAttribute('data-route-to');
    const source = row.locator(`[data-schedule-appointment="${sourceId}"]`);
    const target = row.locator(`[data-schedule-appointment="${targetId}"]`);
    const next = row.locator('.schedule-route-connector.vertical');
    assert.equal(await next.getAttribute('data-route-from'), targetId, 'The next leg starts at the incoming destination');
    const lower = row.locator(`[data-schedule-appointment="${await next.getAttribute('data-route-to')}"]`);
    const [a,b,c,arrow] = await Promise.all([source.boundingBox(),target.boundingBox(),lower.boundingBox(),incoming.locator('.route-connector-arrow').boundingBox()]);
    assert.ok(b.y<c.y, 'Saved first stop is above the second stop');
    assert.ok(Math.abs(arrow.y+arrow.height/2-(b.y+b.height/2))<1.5, '31-minute arrow aligns with the first appointment center');
    assert.ok(Math.abs(arrow.x+arrow.width-b.x)<3, 'Arrow tip reaches the first appointment left edge');
    const path = incoming.locator('svg');
    const pathBox = await path.boundingBox();
    assert.ok(Math.abs(pathBox.y-(a.y+a.height/2))<1.5, 'Travel line leaves the completed source appointment');
    await incoming.getByRole('button').click();
    const details = page.getByRole('dialog',{name:'Travel · Truck 9',exact:true});
    await details.waitFor();
    assert.match(await details.innerText(), /JK1001001[\s\S]*JK1001002[\s\S]*31m/);
    await details.getByRole('button',{name:'Close travel details'}).click();
    await target.click();
    await page.locator('.schedule-appointment-summary').waitFor();
    const selectedArrow = await incoming.locator('.route-connector-arrow').boundingBox();
    const selectedTarget = await target.boundingBox();
    assert.ok(Math.abs(selectedArrow.y+selectedArrow.height/2-selectedTarget.y-selectedTarget.height/2)<1.5, 'Opening details preserves the arrow target');
    assert.equal(await page.locator('#fixture-writes').innerText(),'Writes: 0');
    if(width===1440) await row.screenshot({path:'/tmp/route-stack-fixed.png'});
  }
  console.log('Stack route arrows PASS: source -> first stacked stop -> second stop, responsive geometry, exact travel popover, selection, zero writes.');
} finally {
  await browser.close();
}
