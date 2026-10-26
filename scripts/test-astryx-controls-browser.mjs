import {chromium} from 'playwright';
import assert from 'node:assert/strict';
const browser=await chromium.launch({headless:true});
try {
 for(const width of [320,390,1440]) for(const mode of ['light','dark']) {
  const page=await browser.newPage({viewport:{width,height:900}});
  await page.addInitScript(mode=>{document.addEventListener('DOMContentLoaded',()=>document.documentElement.dataset.opsTheme=mode);},mode);
  await page.goto(`${process.env.ASTRYX_TEST_ORIGIN || 'http://127.0.0.1:3287'}/tests/appointment-summary.html`);
  await page.getByRole('button',{name:'View details for JKSYNTHETIC'}).click();
  await page.getByRole('button',{name:'Cancel appointment',exact:true}).click();
  const review=page.getByRole('button',{name:'Review Cancellation',exact:true});
  assert.equal(await review.isDisabled(),true);
  await page.getByLabel('Cancellation Reason',{exact:true}).fill('Sample reason for preview');
  await review.click();
  const confirm=page.getByRole('button',{name:'Confirm Cancellation',exact:true});
  const values=await confirm.evaluate(el=>{const s=getComputedStyle(el),r=el.getBoundingClientRect();return {font:parseFloat(s.fontSize),padding:parseFloat(s.paddingLeft),height:r.height,right:r.right,mode:document.documentElement.dataset.theme};});
  assert(values.font>=14 && values.padding>0);
  assert(values.height>=(width<=640?44:36));
  assert(values.right<=width);
  assert.equal(values.mode,mode);
  assert.equal(await page.getByRole('group',{name:'Review cancellation'}).evaluate(el=>document.activeElement===el),true);
  await page.getByRole('button',{name:'Keep Appointment',exact:true}).click();
  assert.equal(await confirm.count(),0);
  assert.equal(await page.evaluate(()=>window.summaryFixtureCalls.filter(x=>x.method!=='GET').length),0);
  console.log(`PASS OpsCenter ${width}px ${mode}: disabled gate, review focus, keep action, readable buttons, touch size, mode, no writes`);
  await page.close();
 }
} finally {await browser.close();}
