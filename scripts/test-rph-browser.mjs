import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {chromium} from 'playwright';
const output=process.env.RPH_SCREENSHOT_DIR || fs.mkdtempSync(path.join(os.tmpdir(),'rph-browser-'));
fs.mkdirSync(output,{recursive:true});
const preview=process.env.RPH_PREVIEW_URL || 'http://127.0.0.1:3197/desktop-assets/tests/rph.html';
const browser=await chromium.launch({headless:true});
const errors=[];
try {
 const page=await browser.newPage();page.on('pageerror',e=>errors.push(e.message));
 for(const width of [1440,390,320]) {
  await page.setViewportSize({width,height:1000});
  await page.goto(preview);
  const card=page.getByRole('button',{name:'Open RPH details',exact:true});await card.waitFor();
  assert.match(await card.innerText(),/\$160.00/);
  assert.equal(await page.locator('.command-metrics .kpi-card').count(),6);
  assert.equal(await page.locator('.command-metrics').evaluate(el=>el.scrollWidth<=el.clientWidth+1),true,`Command cards fit ${width}`);
  await page.screenshot({path:`${output}/command-${width}.png`});
  await card.click();await page.locator('.crew-today-row').first().waitFor();
  assert.match(await page.locator('.crew-today-row[aria-label="Example Crew"] .crew-today-rph').innerText(),/\$160.00/);
  assert.match(await page.locator('.crew-today-row[aria-label="Missing Hours"] .crew-today-rph').innerText(),/Unavailable/);
  assert.equal(await page.locator('.crew-today').evaluate(el=>el.scrollWidth<=el.clientWidth+1),true,`Crew cards fit ${width}`);
  assert.equal(await page.locator('.crew-today .krewe-kpi-strip article').evaluateAll(rows=>rows.every(el=>el.scrollHeight<=el.clientHeight+1)),true,'Crew summary text must not clip');
  await page.locator('.crew-today-row').first().scrollIntoViewIfNeeded();
  await page.screenshot({path:`${output}/crew-${width}.png`});
  await page.goto(`${preview}?period=1`);
  await page.locator('.hours-employee-card').waitFor();
  const fact=page.locator('.hours-employee-card > .hours-total-grid .hours-fact').filter({hasText:'RPH'});
  assert.match(await fact.innerText(),/\$206.67/);
  assert.match(await page.locator('.crew-selected-week > .hours-week-content > .hours-total-grid .hours-fact').filter({hasText:'RPH'}).innerText(),/\$300.00/);
  await page.getByRole('button',{name:'Week 1',exact:false}).last().click();
  assert.match(await page.locator('.crew-selected-week > .hours-week-content > .hours-total-grid .hours-fact').filter({hasText:'RPH'}).innerText(),/\$160.00/);
  assert.equal(await page.locator('.hours-employee-card').evaluate(el=>el.scrollWidth<=el.clientWidth+1),true,`Pay-period card fits ${width}`);
  await page.screenshot({path:`${output}/period-${width}.png`});
 }
 assert.deepEqual(errors,[]);console.log('PASS browser: six Command cards, selected-date Crew navigation, individual unavailable states, period/week RPH and 1440/390/320px layouts.');
} finally {await browser.close();}
