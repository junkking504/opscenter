import assert from 'node:assert/strict';
import {chromium} from 'playwright';

const browser=await chromium.launch({headless:true});
const base=process.env.DISPATCH_FIXTURE_URL || 'http://127.0.0.1:3156';
try {
  const page=await browser.newPage({viewport:{width:1280,height:900}});
  await page.goto(`${base}/tests/schedule-destinations.html?scenario=parked-location`);
  const progress=page.getByRole('button',{name:/Truck# 9 · At job: Parked report customer/});
  await progress.waitFor();
  assert.match(await progress.innerText(),/At job: Parked report customer[\s\S]*Parked · (?:29|30)m ago/);
  assert.match(await progress.getAttribute('title'),/parked GPS report at this job[\s\S]*Exact arrival and on-site duration are unconfirmed/);
  const row=page.getByRole('row').filter({hasText:'JK1001001'}).last();
  assert.match(await row.innerText(),/Completed[\s\S]*Truck# 9 at job[\s\S]*Parked report[\s\S]*arrival and duration unconfirmed/);
  assert.doesNotMatch(await row.innerText(),/On Site|\d+ min on site/);
  const block=page.locator('[data-schedule-truck="Truck 9"] [data-schedule-appointment]').first();
  await block.click();
  const summary=page.getByRole('region',{name:'Selected job JK1001001',exact:true});
  await summary.waitFor();
  assert.match(await summary.innerText(),/At job[\s\S]*Truck# 9[\s\S]*Parked report[\s\S]*Arrival time and duration unconfirmed/);
  assert.equal(await page.locator('#fixture-writes').innerText(),'Writes: 0');
  console.log('Parked job location browser PASS: timestamped At job state is distinct from dwell, duration and writes.');
} finally {await browser.close();}
