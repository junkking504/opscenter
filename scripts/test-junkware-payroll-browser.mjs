import assert from 'node:assert/strict';
import {chromium} from 'playwright';
const browser=await chromium.launch({headless:true});
const errors=[];
try {
 for(const mode of ['normal','lost','sync-pending']) {
  const page=await browser.newPage({viewport:{width:1280,height:900}});page.on('pageerror',error=>errors.push(error.message));
  await page.goto(`http://127.0.0.1:3128/desktop-assets/tests/krewe-edits.html?mode=${mode}`);
  await page.getByRole('button',{name:/^Week 1 /}).click();
  await page.getByRole('region',{name:'2026-08-26 daily totals',exact:true}).getByRole('button',{name:/^Edit hours/}).click();
  const dialog=page.getByRole('dialog');await dialog.getByLabel('Clock-in',{exact:true}).fill('08:00');await dialog.getByLabel('Clock-out',{exact:true}).fill('12:00');await dialog.getByLabel('Hourly rate',{exact:true}).fill('22');await dialog.getByLabel('Correction reason').fill('Synthetic source synchronization');
  await dialog.getByRole('button',{name:'Save hours',exact:true}).click();
  if(mode==='normal')await dialog.waitFor({state:'hidden'});
  else {
    await dialog.getByRole('button',{name:'Check saved result',exact:true}).click();
    if(mode==='lost')await dialog.waitFor({state:'hidden'});
    else {await dialog.getByRole('status').filter({hasText:'JunkWare result unconfirmed'}).waitFor();assert.equal(await dialog.getByLabel('Clock-in',{exact:true}).isDisabled(),true);assert.doesNotMatch(await dialog.innerText(),/Times and shift rate verified in JunkWare for/);}
  }
  assert.match(await page.getByRole('status').filter({hasText:'Writes:'}).innerText(),/Writes: 1/,'Checking a lost or uncertain response must not submit twice');
  await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.close();
 }
 for(const width of [1280,390]) for(const mode of ['normal','lost','sync-pending','stale']) {
  const page=await browser.newPage({viewport:{width,height:900}});page.on('pageerror',error=>errors.push(error.message));
  await page.goto(`http://127.0.0.1:3128/desktop-assets/tests/krewe-edits.html?mode=${mode}`);
  await page.getByRole('button',{name:'Today',exact:true}).click();
  const opener=page.getByRole('button',{name:'Edit hours for Sample Crew',exact:true});
  await opener.click();
  const dialog=page.getByRole('dialog');
  await dialog.getByLabel('Correction reason',{exact:true}).fill('Synthetic drawer close check');
  await dialog.getByRole('button',{name:'Save correction',exact:true}).click();
  if(mode==='normal') await dialog.waitFor({state:'hidden'});
  else if(mode==='lost') {
    await dialog.getByRole('status').filter({hasText:'Check Saved Result before trying again'}).waitFor();
    await dialog.getByRole('button',{name:'Check Saved Result',exact:true}).click();
    await dialog.waitFor({state:'hidden'});
  } else {
    await dialog.getByRole('status').filter({hasText:mode==='stale'?'This record changed':'JunkWare result unconfirmed'}).waitFor();
    assert.equal(await dialog.isVisible(),true);
    assert.equal(await dialog.getByLabel('Correction reason',{exact:true}).inputValue(),'Synthetic drawer close check');
  }
  if(['normal','lost'].includes(mode)) {
    assert.equal(await opener.evaluate(el=>el===document.activeElement),true,'Return focus to the main roster');
    await opener.click();
    await dialog.getByLabel('Amount',{exact:true}).fill('5');
    await dialog.getByLabel('Reason',{exact:true}).fill('Synthetic bonus close check');
    await dialog.getByRole('button',{name:'Add bonus',exact:true}).click();
    if(mode==='lost') {
      await dialog.getByRole('status').filter({hasText:'Check Saved Result before trying again'}).waitFor();
      await dialog.getByRole('button',{name:'Check Saved Result',exact:true}).click();
    }
    await dialog.waitFor({state:'hidden'});
    assert.match(await page.getByRole('status').filter({hasText:'Writes:'}).innerText(),/Writes: 2/,'Recovery must not resubmit either save');
  } else assert.match(await page.getByRole('status').filter({hasText:'Writes:'}).innerText(),/Writes: 1/);
  await page.close();
 }
 assert.deepEqual(errors,[]);console.log('Payroll browser checks passed: explicit JunkWare success, lost-response recovery without resubmission, uncertain-source edit lock, and mobile width. Synthetic data only.');
}finally{await browser.close();}
