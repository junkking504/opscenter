import assert from 'node:assert/strict';
import {chromium, webkit} from 'playwright';
const origin=process.env.DESKTOP_TEST_ORIGIN || 'http://127.0.0.1:3179';
const browser=await (process.env.LAYOUT_BROWSER === 'webkit' ? webkit : chromium).launch({headless:true});
try {
 const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 const order=()=>page.locator('[data-layout-group="example"] > [data-layout-id]').evaluateAll(items=>items.map(item=>item.dataset.layoutId));
 await page.goto(`${origin}/tests/section-layout.html`);
 await page.getByLabel('Unsaved note').fill('Keep this draft');await page.getByRole('button',{name:'Count 0',exact:true}).click();
 await page.getByRole('button',{name:'Arrange sections',exact:true}).click();
 await page.getByRole('button',{name:'Move Alpha',exact:true}).dragTo(page.locator('[data-layout-id="gamma"]'));
 assert.deepEqual(await order(),['beta','gamma','alpha']);
 assert.equal(await page.getByLabel('Unsaved note').inputValue(),'Keep this draft');await page.getByRole('button',{name:'Count 1',exact:true}).waitFor();
 await page.getByRole('button',{name:'Move Alpha',exact:true}).press('Home');assert.deepEqual(await order(),['alpha','beta','gamma']);
 await page.getByRole('button',{name:'Move Alpha down',exact:true}).click();assert.deepEqual(await order(),['beta','alpha','gamma']);
 await page.waitForFunction(()=>document.activeElement?.getAttribute('data-layout-grip')==='alpha');
 await page.reload();await page.getByRole('button',{name:'Arrange sections',exact:true}).waitFor();assert.deepEqual(await order(),['beta','alpha','gamma']);
 await page.getByRole('button',{name:'Switch page'}).click();assert.deepEqual(await order(),['alpha','beta','gamma']);
 await page.getByRole('button',{name:'Switch page'}).click();await page.waitForTimeout(100);assert.deepEqual(await order(),['beta','alpha','gamma']);
 await page.setViewportSize({width:390,height:844});await page.waitForFunction(()=>!document.querySelector('.section-layout-toolbar'));assert.deepEqual(await order(),['alpha','beta','gamma']);assert.equal(await page.getByRole('button',{name:'Arrange sections',exact:true}).count(),0);
 await page.setViewportSize({width:1440,height:1000});await page.getByRole('button',{name:'Arrange sections',exact:true}).click();assert.deepEqual(await order(),['beta','alpha','gamma']);
 await page.getByRole('button',{name:'Toggle busy'}).click();assert.equal(await page.locator('[data-layout-grip]').count(),0);assert.equal(await page.getByRole('button',{name:'Done arranging'}).isDisabled(),true);
 await page.getByRole('button',{name:'Toggle busy'}).click();await page.getByRole('button',{name:'Reset this page'}).click();assert.deepEqual(await order(),['alpha','beta','gamma']);
 await page.getByRole('button',{name:'Toggle extra'}).click();assert.deepEqual(await order(),['alpha','beta','extra','gamma']);await page.getByRole('button',{name:'Toggle extra'}).click();assert.deepEqual(await order(),['alpha','beta','gamma']);
 await page.evaluate(()=>localStorage.setItem('opscenter-section-layout-v1:one','{"example":["unknown","gamma","gamma",5]}'));await page.reload();await page.getByRole('button',{name:'Arrange sections',exact:true}).waitFor();assert.deepEqual(await order(),['alpha','beta','gamma']);
 await page.evaluate(()=>{Storage.prototype.setItem=()=>{throw new Error('blocked');};});await page.getByRole('button',{name:'Arrange sections',exact:true}).click();await page.getByRole('button',{name:'Move Alpha down'}).click();await page.getByText('Layout changed for this visit. This browser could not save it.').waitFor();assert.deepEqual(await order(),['beta','alpha','gamma']);
 assert.deepEqual(errors,[]);
 console.log('Section layout: actual drag, keyboard, state/focus retention, reload, page isolation, phone order, busy guard, reset, conditional sections and malformed/blocked storage passed.');
 // Real desktop components, synthetic source data.
 const routes=[['Command','commandView','now'],['Command','commandView','today'],['Command','commandView','forecast'],['Schedule','scheduleView','board'],['Schedule','scheduleView','calendar'],['Schedule','scheduleView','followup'],['Schedule','scheduleView','history'],['Schedule','scheduleView','customers'],['Schedule','scheduleView','estimates'],['Krewe','kreweView','today'],['Krewe','kreweView','payperiod'],['Krewe','kreweView','monthly'],['Fleet','fleetView','overview'],['Fleet','fleetView','maintenance'],['Fleet','fleetView','service'],['Fleet','fleetView','reports'],['Marketing','marketingView','overview'],['Marketing','marketingView','reviews'],['Marketing','marketingView','performance'],['Finance','financeView','overview'],['Finance','financeView','payments'],['Finance','financeView','reconciliation'],['Finance','financeView','expenses'],['Finance','financeView','accounting'],['Finance','financeView','resale'],['Finance','financeView','recycling'],['Settings','settingsView','overview'],['Command','tv','1']];
 for(const [workspace,key,view] of routes){
  console.log('Checking',workspace,view);
  await page.goto(`${origin}/tests/aspect-ratio.html?workspace=${workspace}&${key}=${view}`);await page.getByRole('button',{name:'Arrange sections',exact:true}).waitFor();await page.waitForTimeout(400);await page.getByRole('button',{name:'Arrange sections',exact:true}).click();
  assert.deepEqual(await page.locator('[data-layout-group]').evaluateAll(groups=>groups.flatMap(group=>{const ids=[...group.children].map(e=>e.getAttribute('data-layout-id')).filter(Boolean);return ids.length===new Set(ids).size?[]:[group.getAttribute('data-layout-group')];})),[], 'No duplicate section IDs');
  const grip=page.locator('[data-layout-grip]:visible').first();if(await grip.count()){await grip.press('End');await page.getByText('Layout saved for this browser.',{exact:true}).waitFor();await page.getByRole('button',{name:'Reset this page'}).click();}
  await page.getByRole('button',{name:'Done arranging',exact:true}).click();
  await page.waitForFunction(()=>document.querySelectorAll('[data-layout-grip]').length===0);assert.deepEqual(errors,[],`${workspace}/${view}`);
 }
 console.log(`Desktop integration: ${routes.length} page routes render without errors; available sections reorder/reset.`);
 await page.goto(`${origin}/tests/aspect-ratio.html?workspace=Finance&financeView=payments`);await page.getByRole('button',{name:'Arrange sections',exact:true}).click();await page.getByLabel('Search payments',{exact:true}).fill('retain filter');await page.getByRole('button',{name:'Move Payments by job',exact:true}).press('Home');assert.equal(await page.getByLabel('Search payments',{exact:true}).inputValue(),'retain filter');
 if(process.env.LAYOUT_SCREENSHOT_DIR){await page.screenshot({path:`${process.env.LAYOUT_SCREENSHOT_DIR}/finance-arrange.png`,fullPage:true});await page.getByRole('button',{name:'Done arranging',exact:true}).click();await page.setViewportSize({width:390,height:844});await page.screenshot({path:`${process.env.LAYOUT_SCREENSHOT_DIR}/finance-phone.png`,fullPage:true});}
 assert.deepEqual(errors,[]);await page.close();
} finally {await browser.close();}
