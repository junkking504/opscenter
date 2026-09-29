import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const base=process.env.DISPATCH_FIXTURE_URL || 'http://127.0.0.1:3156';
const intersects=(a,b)=>a.x < b.x+b.width && a.x+a.width > b.x && a.y < b.y+b.height && a.y+a.height > b.y;
const browser=await chromium.launch({headless:true});
try {
  const page=await browser.newPage({viewport:{width:390,height:844},deviceScaleFactor:1});
  await page.goto(`${base}/tests/schedule-destinations.html?scenario=mobile-nearby`);
  const blocks=page.locator('[data-schedule-truck="Truck 8"] [data-schedule-appointment]');
  await blocks.first().waitFor();
  assert.equal(await blocks.count(),4);
  const boxes=await Promise.all(Array.from({length:4},(_,index)=>blocks.nth(index).boundingBox()));
  assert.ok(boxes.every(Boolean));
  for(let first=0;first<boxes.length;first++) for(let second=first+1;second<boxes.length;second++) {
    assert.equal(intersects(boxes[first],boxes[second]),false,`Mobile appointment cards ${first+1} and ${second+1} must not overlap`);
  }
  const row=await page.locator('[data-schedule-truck="Truck 8"]').boundingBox();
  assert.ok(row && row.height>42,'The mobile truck row grows when minimum-width cards need additional lanes');
  assert.equal(await page.locator('#fixture-writes').innerText(),'Writes: 0');
  console.log('Mobile Schedule overlap browser PASS: narrow appointment cards use separate lanes with zero writes.');
} finally {
  await browser.close();
}
