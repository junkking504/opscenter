import assert from 'node:assert/strict';
import { chromium, webkit } from 'playwright';
const base=process.env.DISPATCH_FIXTURE_URL || 'http://127.0.0.1:3167';
const shot=process.env.STOP_ORDER_SCREENSHOT_DIR;
for (const engine of [chromium,webkit]) {
 const browser=await engine.launch({headless:true});
 try {
  for(const width of [320,390,430,768,1280]) {
   const mobile=width<768;
   const page=await browser.newPage({viewport:{width,height:844},hasTouch:mobile,isMobile:mobile});
   const errors=[];page.on('pageerror',e=>errors.push(e.message));
   await page.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
   const press=locator=>mobile?locator.tap():locator.click();
   await page.goto(`${base}/tests/schedule-destinations.html?scenario=same-time`);
   const trigger=page.getByRole('button',{name:'Job Order',exact:true});
   assert.equal(await trigger.isEnabled(),false);
   if(mobile) {
    await press(page.locator('[data-overview-truck="Truck 8"] .mobile-schedule-truck'));
    await page.getByRole('dialog',{name:'Truck schedule details'}).waitFor();
    await press(page.getByRole('button',{name:'Close truck schedule details'}));
   } else await page.getByRole('combobox',{name:'Truck trips',exact:true}).selectOption('Truck 8');
   assert.equal(await trigger.isEnabled(),true,'Selecting a mobile truck must enable Job Order');
   await press(trigger);
   const dialog=page.getByRole('dialog',{name:'Truck Job Order',exact:true});
   await dialog.waitFor();
   const labels=()=>dialog.locator('.stop-order-row strong').allTextContents();
   const original=await labels();assert.equal(original.length,4);
   for(let i=0;i<3;i++)await press(dialog.getByRole('button',{name:'Move JK1001004 up',exact:true}));
   assert.equal((await labels())[0],original[3],'Repeated taps move the same stop to first');
   const bounds=await dialog.boundingBox();assert(bounds.x>=0&&bounds.x+bounds.width<=width+1);
   if(mobile) for(const box of await dialog.locator('.stop-order-arrows button').evaluateAll(es=>es.map(e=>({width:e.getBoundingClientRect().width,height:e.getBoundingClientRect().height}))))assert(box.width>=44&&box.height>=44);
   if(shot && width===390)await page.screenshot({path:`${shot}/stop-order-${engine.name()}-390.png`});
   await press(dialog.getByRole('button',{name:'Cancel',exact:true}));
   await press(trigger);assert.deepEqual(await labels(),original,'Cancel discards draft');
   await press(dialog.getByRole('button',{name:'Close job order',exact:true}));
   assert.equal(await page.locator('#fixture-writes').innerText(),'Writes: 0');
   await press(page.getByRole('button',{name:'Leave fixture schedule',exact:true}));
   await press(page.getByRole('button',{name:'Return to fixture schedule',exact:true}));
   if(mobile) {
    await press(page.locator('[data-overview-truck="Truck 8"] [data-schedule-appointment]').first());
    const drawer=page.getByRole('dialog',{name:'JK1001001',exact:true});await drawer.waitFor();
    await press(drawer.getByRole('button',{name:'Close',exact:true}).first());
    assert.equal(await trigger.isEnabled(),true,'Selecting a mobile appointment must enable Job Order');
    await press(trigger);await dialog.waitFor();
    await press(dialog.getByRole('button',{name:'Cancel',exact:true}));
   }
   assert.deepEqual(errors,[]);await page.close();
   console.log(`${engine.name()} ${width}px: mobile selection, repeated reorder, cancel/reopen, navigation, bounds and zero dispatch writes passed`);
  }
 }finally{await browser.close();}
}
