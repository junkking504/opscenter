import {chromium} from 'playwright';
import assert from 'node:assert/strict';
const browser=await chromium.launch({headless:true});
try {
 for(const width of [1440,390,320]) for(const reducedMotion of ['reduce','no-preference']) {
  const page=await browser.newPage({viewport:{width,height:800},reducedMotion});
  let requests=0;page.on('request',r=>{if(r.url().includes('/api/'))requests++;});
  await page.goto(`${process.env.DRAWER_TEST_ORIGIN||'http://127.0.0.1:3189'}/tests/appointment-drawer-usability.html`);
  await page.getByRole('button',{name:'Book Job',exact:true}).click();
  const booking=page.getByRole('region',{name:'Book job from estimate'});
  await booking.scrollIntoViewIfNeeded();
  await page.getByLabel('Job start time').selectOption('14:00');
  assert.equal(await page.getByLabel('Job start time').inputValue(),'14:00');
  assert.equal(await page.getByLabel('Job start time').locator('option:checked').textContent(),'2:00 PM');
  assert.equal(await booking.evaluate(el=>el.scrollWidth<=el.clientWidth+1),true,'Booking must fit drawer');
  const controls=await booking.locator('input, select, textarea').evaluateAll(els=>els.map(el=>{const r=el.getBoundingClientRect();return {x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height};}));
  assert(controls.every(r=>r.width>80 && r.height>=39),'Controls must be usable');
  assert(controls[0].bottom<=controls[1].y && controls[1].right<=controls[2].x && controls[2].bottom<=controls[3].y,'Fields have separate rows and do not overlap');
  if(process.env.DRAWER_SCREENSHOT && width===1440 && reducedMotion==='reduce') await booking.screenshot({path:process.env.DRAWER_SCREENSHOT});
  await page.locator('#appointment-reschedule-date').fill('2099-10-23');
  const review=page.getByRole('button',{name:'Review Reschedule',exact:true});
  await review.scrollIntoViewIfNeeded();
  await review.click();
  const confirm=page.getByRole('button',{name:'Confirm Reschedule',exact:true});
  await confirm.waitFor();
  await page.waitForFunction(()=>{const button=[...document.querySelectorAll('button')].find(b=>b.textContent==='Confirm Reschedule');if(!button)return false;const r=button.getBoundingClientRect(),body=document.querySelector('.record-drawer-body').getBoundingClientRect();return r.top>=body.top && r.bottom<=body.bottom;});
  assert.equal(await page.locator('.drawer-reschedule-review').evaluate(el=>el===document.activeElement),true,'Review summary receives focus without activating confirmation');
  assert.equal(requests,0,'Opening review must not submit any operation');
  await page.getByRole('button',{name:'Keep Appointment',exact:true}).click();
  await page.getByRole('button',{name:'Review Reschedule',exact:true}).click();
  await page.waitForFunction(()=>{const r=[...document.querySelectorAll('button')].find(b=>b.textContent==='Confirm Reschedule').getBoundingClientRect();return r.bottom<=document.querySelector('.record-drawer-body').getBoundingClientRect().bottom;});
  console.log(`PASS drawer ${width}px / ${reducedMotion}: booking layout, readable time, confirmation visible, focus, repeated review, no writes`);
  await page.close();
 }
}finally{await browser.close();}
