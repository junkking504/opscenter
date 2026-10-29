import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {chromium} from 'playwright';

const directory = process.env.ALERT_PREVIEW_OUTPUT || '/tmp/opscenter-crew-progress-preview';
await mkdir(directory,{recursive:true});
const browser = await chromium.launch({headless:true});
const errors = [];
try {
  const page = await browser.newPage({viewport:{width:1440,height:1000},deviceScaleFactor:1});
  page.on('pageerror',error => errors.push(error.message));
  await page.goto(process.env.CREW_PROGRESS_PREVIEW_URL || 'http://127.0.0.1:3128/tests/crew-progress.html');
  await page.getByRole('heading',{name:'Operational Updates',exact:true}).waitFor();
  const timeline = page.getByRole('region',{name:'All operational updates, newest first'});
  const summaries = timeline.locator('.crew-compact-update > summary');
  const labels = () => summaries.locator(':scope > strong').allTextContents();
  const expected = ['Arrival','New Appointment','Krewe Summary','Job Completed'];
  assert.deepEqual(await labels(),expected,'One compact newest-first timeline');
  assert.equal(await timeline.locator('details[open]').count(),0,'Rows start compact');
  await summaries.filter({hasText:'New Appointment'}).click();
  assert.match(await page.getByRole('status').last().textContent(),/job-jk1000002/,'Compact row opens its record');
  assert.equal(await timeline.locator('details[open]').count(),0,'Record action does not expand legacy inline content');

  // Retained inline action names are still part of the component contract,
  // although current compact summaries route directly to the record drawer.
  const closed = timeline.locator('details').filter({has: page.locator('summary strong', {hasText:'Job Completed'})});
  for (const name of ['Mark Reviewed','Follow Up in Control','Open Record']) {
    assert.equal(await closed.getByRole('button',{name,exact:true,includeHidden:true}).count(),1);
  }
  await page.getByRole('combobox',{name:'Filter by truck'}).selectOption({label:'Truck# 3'});
  assert.deepEqual(await labels(),['Arrival']);
  await page.getByRole('button',{name:'Clear Filters',exact:true}).click();
  await page.getByRole('searchbox',{name:'Search operational updates'}).fill('JK1000002');
  assert.deepEqual(await labels(),['New Appointment']);
  await page.getByRole('button',{name:'Clear Filters',exact:true}).click();
  await page.getByRole('button',{name:'Follow-up Only',exact:true}).click();
  assert.deepEqual(await labels(),['Job Completed']);
  await page.getByRole('button',{name:'Clear Filters',exact:true}).click();
  assert.deepEqual(await labels(),expected);
  await page.getByRole('button',{name:'Simulate partial history'}).click();
  assert.match(await page.locator('.crew-source-notice').textContent(),/history is incomplete/);
  assert.equal(await closed.getByRole('button',{name:'Mark Reviewed',exact:true,includeHidden:true}).isEnabled(),true);
  await page.getByRole('button',{name:'Simulate disconnected sources'}).click();
  assert.equal(await closed.getByRole('button',{name:'Mark Reviewed',exact:true,includeHidden:true}).isDisabled(),true);
  await page.getByRole('button',{name:'Reset preview'}).click();
  await page.getByRole('button',{name:'Simulate unindexed updates'}).click();
  assert.deepEqual(await labels(),['Arrival','New Appointment','Truck Unloaded','Krewe Summary','Job Completed','Inspection']);
  await page.getByRole('button',{name:'Reset preview'}).click();
  await page.getByRole('button',{name:'Simulate warehouse entry'}).click();
  assert.deepEqual(await labels(),['Arrival','New Appointment','Geofence','Krewe Summary','Job Completed']);
  await summaries.filter({hasText:'Truck 2 at NOHQ'}).click();
  assert.match(await page.getByRole('status').last().textContent(),/workspace=Fleet/);
  await page.getByRole('button',{name:'Reset preview'}).click();
  await page.getByRole('button',{name:'Simulate clock-out pay',exact:true}).click();
  assert.deepEqual(await labels(),['Clock Out',...expected]);
  await summaries.filter({hasText:'Clock Out'}).click();
  assert.match(await page.getByRole('status').last().textContent(),/crew\?date=2026-09-07/);
  await page.screenshot({path:`${directory}/desktop.png`,fullPage:true});
  await page.setViewportSize({width:390,height:844});
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),true,'Mobile must not overflow horizontally');
  await page.screenshot({path:`${directory}/mobile.png`,fullPage:true});
  assert.deepEqual(errors,[]);
  console.log('Crew progress browser PASS: compact chronology, record actions, exact action names, truck/search/follow-up filters, source gating, unindexed updates and phone overflow. Synthetic records only.');
} finally { await browser.close(); }
