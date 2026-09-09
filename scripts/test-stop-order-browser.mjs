import assert from 'node:assert/strict';
import fs from 'node:fs';
import { chromium } from 'playwright';
const browser=await chromium.launch({headless:true});
try {
 const page=await browser.newPage();
 let saves=0;
 await page.route('**/api/desktop/schedule/order',async route=>{
  const body=route.request().postDataJSON();
  const ids=body.action==='nearest'?[body.ids[0],...body.ids.slice(1).reverse()]:body.ids;
  const jobs=ids.map((recordId,index)=>({recordId,appointmentId:recordId.split(':').at(-1),version:'1',jkNumber:'JK'+recordId.split(':').at(-1),customerName:'Example',address:'100 Example St New Orleans LA 70125',truck:'Truck 8',status:'Confirmed',appointmentStartMinutes:480,appointmentEndMinutes:540,appointmentTime:'8:00 AM–9:00 AM',stopOrder:index,location:{latitude:30,longitude:-90}}));
  if(body.action==='save')saves++;
  await route.fulfill({json:body.action==='save'?{saved:true,snapshot:{date:body.date,observedAt:null,fleet:{isToday:false,trucks:[]},appointments:jobs}}:{ids,legs:ids.slice(1).map((id,index)=>({fromAppointmentId:ids[index],toAppointmentId:id,travelMinutes:10+index,miles:5+index}))}});
 });
 for(const width of [1280,390]) {
  await page.setViewportSize({width,height:800});
  await page.goto(process.env.STOP_ORDER_TEST_URL || 'http://127.0.0.1:3157/tests/stop-order.html');
  await page.addStyleTag({content:fs.readFileSync('desktop-ui/app/globals.css','utf8')});
  await page.getByRole('button',{name:'Stop Order',exact:true}).click();
  const modal=page.getByRole('dialog');
  await modal.getByText('10 min · 5 mi from previous stop',{exact:true}).waitFor();
  await modal.getByRole('button',{name:'Move JK3 up',exact:true}).click();
  assert.deepEqual(await modal.locator('.stop-order-row strong').allTextContents(),['JK1 · Example 1','JK3 · Example 3','JK2 · Example 2']);
  await modal.getByRole('button',{name:'Save Order',exact:true}).click();
  await page.getByText('JK1,JK3,JK2',{exact:true}).waitFor();
  await page.getByRole('button',{name:'Stop Order',exact:true}).click();
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
 console.log('Stop order browser passed at 390px and 1280px: arrows, save/read-back, nearest suggestion, cancel and dialog bounds. Synthetic API only.');
} finally {await browser.close();}
