import assert from 'node:assert/strict';
import {chromium,webkit} from 'playwright';
const url=process.env.STOP_ORDER_TEST_URL || 'http://127.0.0.1:3167/tests/stop-order.html';
for(const engine of [chromium,webkit]) {
 const browser=await engine.launch({headless:true});
 try {
  const page=await browser.newPage({viewport:{width:390,height:844},hasTouch:true,isMobile:true});
  let saves=0,failSave=false,delay=0;
  const actions=[];
  await page.route('**/*',async route=>{
   const req=route.request();
   if(new URL(req.url()).hostname!=='127.0.0.1')return route.abort();
   if(!req.url().endsWith('/api/desktop/schedule/order'))return route.continue();
   const body=req.postDataJSON();actions.push(body.action);
   if(body.action==='save')saves++;
   await new Promise(resolve=>setTimeout(resolve,delay));
   if(body.action==='save'&&failSave)return route.fulfill({status:409,json:{error:'Synthetic source conflict. Refresh stops.'}});
   const ids=body.action==='nearest'?[body.ids[0],...body.ids.slice(1).reverse()]:body.ids;
   const appointments=ids.map((recordId,index)=>({recordId,appointmentId:recordId.split(':').at(-1),version:'1',jkNumber:'JK'+recordId.split(':').at(-1),customerName:'Example',address:'100 Example St New Orleans LA 70125',truck:'Truck 8',status:'Confirmed',appointmentStartMinutes:480,appointmentEndMinutes:540,appointmentTime:'8:00 AM–9:00 AM',stopOrder:index,location:{latitude:30,longitude:-90}}));
   await route.fulfill({json:body.action==='save'?{snapshot:{date:body.date,observedAt:null,fleet:{isToday:false,trucks:[]},appointments}}:{ids,legs:[]}});
  });
  await page.goto(url);
  const open=()=>page.getByRole('button',{name:'Stop Order',exact:true}).tap();
  const modal=page.getByRole('dialog');
  await open();
  await modal.getByRole('button',{name:'Move JK3 up',exact:true}).tap();
  await modal.getByRole('button',{name:'Move JK3 up',exact:true}).tap();
  delay=900;
  await modal.getByRole('button',{name:'Save Order',exact:true}).tap();
  assert.equal(await modal.getByRole('button',{name:'Saving…',exact:true}).isEnabled(),false);
  assert.equal(await modal.getByRole('button',{name:'Cancel',exact:true}).isEnabled(),false);
  await page.getByText('JK3,JK1,JK2',{exact:true}).waitFor();assert.equal(saves,1);
  await open();
  assert.match((await modal.locator('.stop-order-row strong').allTextContents())[0],/^JK3/);
  delay=0;failSave=true;
  await modal.getByRole('button',{name:'Move JK2 up',exact:true}).tap();
  await modal.getByRole('button',{name:'Save Order',exact:true}).tap();
  await modal.getByRole('alert').waitFor();
  assert.equal(await modal.getByRole('button',{name:'Save Order',exact:true}).isEnabled(),true,'Failure releases save lock and keeps draft');
  await modal.getByRole('button',{name:'Cancel',exact:true}).tap();
  assert.equal(await page.locator('output').textContent(),'JK3,JK1,JK2','Failed save cannot replace saved snapshot');
  failSave=false;delay=1000;
  await open();
  await modal.getByRole('button',{name:'Suggest nearest after first stop',exact:true}).tap();
  await modal.getByRole('button',{name:'Cancel',exact:true}).tap();
  delay=0;await open();
  await page.waitForTimeout(1200);
  assert.deepEqual((await modal.locator('.stop-order-row strong').allTextContents()).map(s=>s.split(' · ')[0]),['JK3','JK1','JK2'],'Late canceled suggestion cannot overwrite reopened draft');
  await modal.getByRole('button',{name:'Cancel',exact:true}).tap();
  delay=1000;await open();await page.waitForTimeout(400);await page.goto('about:blank');await page.waitForTimeout(1100);
  assert.equal(saves,2,'Preview, suggestion, cancellation and navigation must never save');
  console.log(`${engine.name()} touch: repeated arrows, delayed save, duplicate-save lock, save/reopen, rejected save, canceled late suggestion and navigation passed. Saves were synthetic only.`);
 }finally{await browser.close();}
}
