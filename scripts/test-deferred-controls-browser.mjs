import assert from 'node:assert/strict';
import { chromium, webkit } from 'playwright';
const origin=process.env.DISPATCH_FIXTURE_URL||'http://127.0.0.1:3287';
for(const [name,engine] of [['chromium',chromium],['webkit',webkit]]) {
 const browser=await engine.launch({headless:true});
 try {
  const page=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  let controls=0,release;
  const held=new Promise(resolve=>release=resolve);
  await page.route('**/schedule-controls.tsx',async route=>{controls++;await held;await route.continue();});
  await page.goto(`${origin}/tests/appointment-summary.html`);
  await page.getByRole('button',{name:'View details for JKSYNTHETIC'}).waitFor();
  assert.equal(controls,0,'Closed drawer does not load operational controls');
  await page.getByRole('button',{name:'View details for JKSYNTHETIC'}).click();
  await page.getByRole('status').filter({hasText:'Loading appointment controls'}).waitFor();
  assert.equal(controls,1);
  assert.equal(await page.getByRole('button',{name:'Review Cancellation',exact:true}).count(),0);
  release();
  await page.getByRole('button',{name:'Save Note in JunkWare',exact:true}).waitFor();
  await page.getByRole('button',{name:'Cancel appointment',exact:true}).click();
  assert.equal(await page.getByRole('button',{name:'Review Cancellation',exact:true}).isDisabled(),true);
  await page.getByLabel('Cancellation Reason',{exact:true}).fill('Synthetic review only');
  await page.getByRole('button',{name:'Review Cancellation',exact:true}).click();
  assert.equal(await page.getByRole('group',{name:'Review cancellation'}).evaluate(el=>document.activeElement===el),true);
  await page.getByRole('button',{name:'Keep Appointment',exact:true}).click();
  assert.equal(await page.evaluate(()=>window.summaryFixtureCalls.filter(call=>call.method!=='GET').length),0);
  let guides=0;await page.route('**/convoy-guide-content.tsx',route=>{guides++;return route.continue();});
  await page.goto(`${origin}/tests/deferred-fleet-guide.html`);
  const summary=page.locator('summary');await summary.waitFor();assert.equal(guides,0,'Collapsed guide does not load content');
  await summary.tap();await page.getByRole('button',{name:/3. Plan maintenance/}).waitFor();assert.equal(guides,1);
  await page.getByRole('button',{name:/3. Plan maintenance/}).tap();
  assert.equal(await page.getByLabel('Selected view').innerText(),'service');
  assert.match(await page.locator('.convoy-guide').innerText(),/Plan upcoming work/);
  await summary.tap();await summary.tap();assert.equal(guides,1,'Guide stays loaded after reopen');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  assert.deepEqual(errors,[]);
  console.log(`PASS ${name}: cold drawer loading, disabled/review/focus behavior, no writes, deferred guide navigation/reopen`);
 }finally{await browser.close();}
}
