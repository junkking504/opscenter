import assert from 'node:assert/strict';
import {chromium} from 'playwright';
const browser=await chromium.launch({headless:true});
const errors=[];
try {
 for(const mode of ['normal','lost','sync-pending']) {
  const page=await browser.newPage({viewport:{width:1280,height:900}});page.on('pageerror',error=>errors.push(error.message));
  await page.goto(`http://127.0.0.1:3128/tests/krewe-edits.html?mode=${mode}`);
  await page.getByText('Week 1',{exact:true}).click();
  await page.getByRole('region',{name:'2026-08-26 daily totals',exact:true}).getByRole('button',{name:'Edit hours'}).click();
  const dialog=page.getByRole('dialog');await dialog.getByLabel('Clock-in',{exact:true}).fill('08:00');await dialog.getByLabel('Clock-out',{exact:true}).fill('12:00');await dialog.getByLabel('Hourly rate',{exact:true}).fill('22');await dialog.getByLabel('Correction reason').fill('Synthetic source synchronization');
  await dialog.getByRole('button',{name:'Save hours',exact:true}).click();
  if(mode==='normal')await dialog.getByRole('status').filter({hasText:'verified in JunkWare'}).waitFor();
  else {
    await dialog.getByRole('button',{name:'Check saved result',exact:true}).click();
    if(mode==='lost')await dialog.getByRole('status').filter({hasText:'verified in JunkWare'}).waitFor();
    else {await dialog.getByRole('status').filter({hasText:'JunkWare result unconfirmed'}).waitFor();assert.equal(await dialog.getByLabel('Clock-in',{exact:true}).isDisabled(),true);assert.doesNotMatch(await dialog.innerText(),/Times and shift rate verified in JunkWare for/);}
  }
  assert.match(await page.getByRole('status').filter({hasText:'Writes:'}).innerText(),/Writes: 1/,'Checking a lost or uncertain response must not submit twice');
  await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.close();
 }
 assert.deepEqual(errors,[]);console.log('Payroll browser checks passed: explicit JunkWare success, lost-response recovery without resubmission, uncertain-source edit lock, and mobile width. Synthetic data only.');
}finally{await browser.close();}
