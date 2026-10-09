import assert from 'node:assert/strict';
import fs from 'node:fs';
import { chromium } from 'playwright';
const browser=await chromium.launch({headless:true});
try {
 const page=await browser.newPage();
 let saves=0;
 let saveDelay=0;
 const actions=[];
 await page.route('**/api/desktop/schedule/order',async route=>{
  const body=route.request().postDataJSON();
  actions.push(body.action);
  const ids=body.action==='nearest'?[body.ids[0],...body.ids.slice(1).reverse()]:body.ids;
  const jobs=ids.map((recordId,index)=>({recordId,appointmentId:recordId.split(':').at(-1),version:'1',jkNumber:'JK'+recordId.split(':').at(-1),customerName:'Example',address:'100 Example St New Orleans LA 70125',truck:'Truck 8',status:'Confirmed',appointmentStartMinutes:480,appointmentEndMinutes:540,appointmentTime:'8:00 AM–9:00 AM',stopOrder:index,location:{latitude:30,longitude:-90}}));
  if(body.action==='save'){saves++;await new Promise(resolve=>setTimeout(resolve,saveDelay));}
  await route.fulfill({json:body.action==='save'?{saved:true,snapshot:{date:body.date,observedAt:null,fleet:{isToday:false,trucks:[]},appointments:jobs}}:{ids,legs:ids.slice(1).map((id,index)=>({fromAppointmentId:ids[index],toAppointmentId:id,travelMinutes:10+index,miles:5+index}))}});
 });
 for(const width of [1280,390]) {
  await page.setViewportSize({width,height:800});
  await page.goto(process.env.STOP_ORDER_TEST_URL || 'http://127.0.0.1:3157/tests/stop-order.html');
  await page.addStyleTag({content:fs.readFileSync('desktop-ui/app/globals.css','utf8')});
  await page.getByRole('button',{name:'Job Order',exact:true}).click();
  const modal=page.getByRole('dialog');
  await modal.getByText('10 min · 5 mi from previous stop',{exact:true}).waitFor();
  await modal.getByRole('button',{name:'Move JK3 up',exact:true}).click();
  assert.deepEqual(await modal.locator('.stop-order-row strong').allTextContents(),['JK1 · Example 1','JK3 · Example 3','JK2 · Example 2']);
  await modal.getByRole('button',{name:'Save Order',exact:true}).click();
  await page.getByText('JK1,JK3,JK2',{exact:true}).waitFor();
  await page.getByRole('button',{name:'Job Order',exact:true}).click();
  await modal.getByText('10 min · 5 mi from previous stop',{exact:true}).waitFor();
  assert.deepEqual(await modal.locator('.stop-order-row strong').allTextContents(),['JK1 · Example','JK3 · Example','JK2 · Example']);
  await modal.getByRole('button',{name:'Suggest nearest after first stop',exact:true}).click();
  await page.waitForFunction(()=>!document.querySelector('dialog').textContent.includes('Finding nearest stops'));
  assert.deepEqual(await modal.locator('.stop-order-row strong').allTextContents(),['JK1 · Example','JK2 · Example','JK3 · Example']);
  const bounds=await modal.boundingBox();assert(bounds.x>=0 && bounds.x+bounds.width<=width+1);
  await page.keyboard.press('Escape');
  assert.equal(await modal.count(),0);
  assert.equal(await page.locator('output').textContent(),'JK1,JK3,JK2','Cancel cannot save a suggestion');
 }
 assert.equal(saves,2);
 saveDelay=900;
 await page.goto(process.env.STOP_ORDER_TEST_URL || 'http://127.0.0.1:3157/tests/stop-order.html');
 await page.getByRole('button',{name:'Job Order',exact:true}).click();
 await page.getByRole('dialog').getByText('10 min · 5 mi from previous stop',{exact:true}).waitFor();
 const beforeSave=actions.length;
 await page.getByRole('button',{name:'Move JK3 up',exact:true}).click();
 await page.getByRole('button',{name:'Save Order',exact:true}).click();
 await page.getByText('JK1,JK3,JK2',{exact:true}).waitFor({timeout:4000});
 assert.equal(await page.getByRole('dialog').count(),0,'A pending travel preview must never cancel Save Order');
 assert.deepEqual(actions.slice(beforeSave),['save'],'Saving must cancel the queued preview');
 assert.equal(saves,3,'Exactly one save per explicit Save Order click');
 for(const width of [1280,390]) {
  await page.setViewportSize({width,height:720});
  await page.route('https://tile.openstreetmap.org/**',route=>route.fulfill({status:200,contentType:'image/png',body:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWQAAAABJRU5ErkJggg==','base64')}));
  await page.goto((process.env.STOP_ORDER_TEST_URL || 'http://127.0.0.1:3157/tests/stop-order.html')+'?multi&fleet&collisions');
  await page.addStyleTag({content:fs.readFileSync('desktop-ui/app/globals.css','utf8')});
  await page.getByRole('button',{name:'Job Order',exact:true}).click();
  await page.getByRole('button',{name:'All trucks',exact:true}).click();
  await page.waitForFunction(()=>document.querySelectorAll('.stop-order-truck').length===6);
  const inspect=async()=>page.locator('.stop-order-truck').evaluateAll(elements=>elements.map(element=>{
   const badge=element.querySelector('.stop-order-truck-badge'),r=badge.getBoundingClientRect();
   return {label:badge.textContent,title:element.title,selected:element.classList.contains('selected'),stale:element.classList.contains('stale'),z:Number(element.style.zIndex),left:r.left,right:r.right,top:r.top,bottom:r.bottom};
  }));
  const assertBadges=async()=>{
   const badges=await inspect();assert.equal(badges.length,6);
   const controls=await page.locator('.stop-order-map .leaflet-control').evaluateAll(elements=>elements.map(element=>{const r=element.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom};}));
   for(const badge of badges)for(const control of controls)assert(badge.right<=control.left||control.right<=badge.left||badge.bottom<=control.top||control.bottom<=badge.top,'Truck labels must not be hidden by map controls');
   for(const [index,badge] of badges.entries()) {
    if(badge.stale)assert.match(badge.label,/Last known/);
    assert.match(badge.title,/GPS/);
    for(const other of badges.slice(index+1))assert(badge.right<=other.left||other.right<=badge.left||badge.bottom<=other.top||other.bottom<=badge.top,`Badges overlap at ${width}px: ${JSON.stringify(badges)}`);
   }
   const selected=badges.find(badge=>badge.selected);assert(selected);assert(badges.every(badge=>badge.selected||badge.z<selected.z),'Selected truck must stay above every other badge');
  };
  await assertBadges();
  await page.locator('.stop-order-truck').first().click();
  await page.locator('.leaflet-popup-content').waitFor();
  await page.waitForTimeout(350);
  assert.equal(await page.locator('.leaflet-popup-content').count(),1,'A popup must survive its automatic viewport pan');
  await page.locator('.leaflet-popup-close-button').click();
  await page.getByRole('button',{name:'Zoom in',exact:true}).click();
  await page.waitForTimeout(300);
  await assertBadges();
  if(process.env.STOP_ORDER_SCREENSHOT_DIR){fs.mkdirSync(process.env.STOP_ORDER_SCREENSHOT_DIR,{recursive:true});await page.screenshot({path:`${process.env.STOP_ORDER_SCREENSHOT_DIR}/truck-badges-${width}.png`});}
  await page.keyboard.press('Escape');
 }
 console.log('Stop order browser passed at 390px and 1280px: arrows, save/read-back, nearest suggestion, cancel, dialog bounds and delayed save without preview interruption. Synthetic API only.');
} finally {await browser.close();}
