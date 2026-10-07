import assert from 'node:assert/strict';
import {chromium,webkit} from 'playwright';
const base=process.env.DISPATCH_FIXTURE_URL || 'http://127.0.0.1:3156';
for(const engine of [chromium,webkit]) {
 const browser=await engine.launch({headless:true});
 try {
  const page=await browser.newPage();
  for(const [width,height] of [[1813,1000],[1280,900],[1024,768]]) {
   await page.setViewportSize({width,height});
   await page.goto(`${base}/tests/schedule-destinations.html?scenario=travel-order&clock=2026-09-08T17:30:00Z`);
   const row=page.locator('[data-schedule-truck="Truck 9"]');
   await row.locator('.compact-travel').first().waitFor();
   const completed=row.locator('[data-schedule-appointment$=":1002"]');
   const planned=row.locator('[data-schedule-appointment$=":1003"]');
   assert.ok((await completed.boundingBox()).y<(await planned.boundingBox()).y,'Unconfirmed departure remains above planned stops');
   const boxes=await row.locator('.route-connector-label').evaluateAll(es=>es.map(e=>{const r=e.getBoundingClientRect();return{left:r.left,right:r.right,top:r.top,bottom:r.bottom,text:e.textContent};}));
   assert.equal(boxes.length,5);
   boxes.forEach((box,i)=>{
    assert.ok(box.bottom-box.top<=18 && /^\d+m$/.test(box.text),'Compact labels show only the travel time');
    boxes.slice(i+1).forEach(other=>assert.ok(box.right<=other.left||box.left>=other.right||box.bottom<=other.top||box.top>=other.bottom,'No travel labels overlap'));
   });
   await row.locator('.route-connector-label').first().click();
   assert.match(await page.getByRole('dialog',{name:'Travel · Truck# 9'}).innerText(),/JK1001[\s\S]*Earlier visit[\s\S]*JK1002[\s\S]*Just completed/);
   await page.getByRole('button',{name:'Close travel details'}).click();
   await page.getByRole('button',{name:'Select Truck# 9 on map',exact:true}).click();
   await page.getByRole('button',{name:'Stop Order',exact:true}).click();
   await page.getByRole('button',{name:'Move JK1005 up',exact:true}).click();
   await page.getByRole('button',{name:'Move JK1005 up',exact:true}).click();
   await page.getByRole('button',{name:'Save Order',exact:true}).click();
   await page.getByRole('button',{name:'Stop Order',exact:true}).click();
   const modal=page.getByRole('dialog');
   assert.match(await modal.locator('.stop-order-row').first().innerText(),/JK1005[\s\S]*Booked: 2:00 PM/);
   assert.equal(await modal.locator('.stop-order-row').count(),4);
   assert.equal(await page.locator('#fixture-writes').innerText(),'Writes: 0 · Local order saves: 1');
  }
 } finally {await browser.close();}
}
console.log('Travel sequence and day order: compact connected routes, no overlap, recorded priority, cross-window persistence and unchanged bookings.');
