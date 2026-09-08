import assert from 'node:assert/strict';
import {chromium} from 'playwright';
const browser=await chromium.launch({headless:true});
try {
  const page=await browser.newPage({viewport:{width:1280,height:900}});
  await page.goto('http://127.0.0.1:3148/tests/duplicates.html');
  await page.getByRole('button',{name:'Keep Both',exact:true}).click();
  await page.getByRole('button',{name:'Confirm Keep Both',exact:true}).click();
  await page.getByRole('button',{name:'Show 1 Kept Pair'}).click();
  await page.getByText('Kept by Synthetic Operator',{exact:false}).waitFor();
  await page.getByRole('button',{name:'Reopen Review'}).click();
  await page.getByText('Review Before Dispatch',{exact:true}).waitFor();
  await page.getByRole('button',{name:'Open Appointment',exact:true}).first().click();
  await page.getByRole('status').filter({hasText:'Opened 2026-09-08:appointment:1'}).waitFor();
  assert.equal(await page.getByRole('link',{name:'Review in JunkWare'}).count(),2);
  assert.equal(await page.locator('.duplicate-pair-grid').evaluate(el=>getComputedStyle(el).gridTemplateColumns.split(' ').length),2);
  await page.setViewportSize({width:760,height:900});
  assert.equal(await page.locator('.duplicate-pair-grid').evaluate(el=>getComputedStyle(el).gridTemplateColumns.split(' ').length),1);
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.goto('http://127.0.0.1:3148/tests/duplicates.html?fail=1');
  await page.getByRole('alert').waitFor();
  assert.equal(await page.getByRole('button',{name:'Keep Both',exact:true}).isDisabled(),true);
  console.log('Browser checks passed: side-by-side comparison, confirm/save/read-back, kept disclosure, reopen, record navigation, source links, narrow layout, and visible storage failure. Synthetic only.');
} finally {await browser.close();}
