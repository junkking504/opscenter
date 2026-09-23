import assert from 'node:assert/strict';
import {chromium} from 'playwright';

const browser=await chromium.launch({headless:true});
const base=process.env.DISPATCH_FIXTURE_URL || 'http://127.0.0.1:3156';
try {
  const page=await browser.newPage({viewport:{width:1280,height:900}});
  await page.goto(`${base}/tests/schedule-destinations.html?scenario=gps-mismatch`);
  const block=page.locator('[data-schedule-truck="Truck 3"] [data-schedule-appointment]').first();
  await block.waitFor();
  assert.match(await block.getAttribute('aria-label'),/Truck# 3[\s\S]*33 min on site[\s\S]*Assigned Truck# 6/,'Completed work appears once on the GPS truck with the source mismatch exposed');
  assert.equal(await page.locator('[data-schedule-truck="Truck 6"] [data-schedule-appointment]').count(),0,'The stale JunkWare lane does not duplicate the completed appointment');
  const row=page.getByRole('row').filter({hasText:'JK1001001'}).last();
  assert.match(await row.innerText(),/Truck# 3[\s\S]*GPS confirmed · JunkWare says Truck# 6[\s\S]*33 min on site[\s\S]*Started 9:06 AM · Finished 9:38 AM/);
  await block.click();
  const summary=page.getByRole('region',{name:'Selected job JK1001001',exact:true});
  await summary.waitFor();
  assert.match(await summary.innerText(),/Truck# 3[\s\S]*GPS confirmed · JunkWare says Truck# 6[\s\S]*Started 9:06 AM · Finished 9:38 AM/);
  await summary.getByRole('button',{name:'Full details for JK1001001',exact:true}).click();
  const drawer=page.getByRole('dialog',{name:'JK1001001',exact:true});
  await drawer.getByText('Assignment & call-ahead',{exact:true}).click();
  assert.equal(await drawer.getByRole('combobox',{name:'Truck Assignment',exact:true}).inputValue(),'Truck 3','GPS truck is the prefilled correction');
  assert.match(await drawer.innerText(),/GPS confirms Truck# 3[\s\S]*JunkWare still says Truck# 6/);
  await drawer.getByRole('button',{name:'Move Appointment',exact:true}).click();
  assert.equal(await page.getByRole('dialog',{name:'Confirm schedule move',exact:true}).count(),0,'A move does not open a confirmation dialog');
  await page.waitForFunction(()=>document.querySelector('#fixture-writes')?.textContent?.includes('Writes: 1'));
  assert.match(await page.locator('#fixture-writes').innerText(),/→ Truck 3$/,'The verified write corrects JunkWare to the GPS truck');
  console.log('Completed GPS mismatch browser PASS: one GPS lane, exact times, mismatch label, one-click correction, no confirmation dialog, and verified Truck 3 write.');
} finally {await browser.close();}
