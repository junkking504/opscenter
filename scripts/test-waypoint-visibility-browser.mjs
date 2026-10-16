import assert from 'node:assert/strict';
import { chromium, expect } from '@playwright/test';

const origin = process.argv[2] || 'http://127.0.0.1:3199';
const date = '2026-09-30';
const phone = {deviceId:'synthetic-phone',truck:'Truck 6',label:'Synthetic company phone',enrolledAt:'2026-09-30T12:00:00.000Z',expiresAt:'2026-10-01T05:00:00.000Z'};
const day = {deviceId:phone.deviceId,truck:phone.truck,date,version:1,requestId:'synthetic-day',responsible:'Sample Driver',driver:'Sample Driver',navigators:['Sample Navigator'],savedAt:'2026-09-30T12:00:00.000Z'};
const job = {assignmentId:'00000000-0000-4000-8000-000000000001',appointmentId:'900001',date,jkNumber:'SAMPLE-01',customerName:'Sample Customer',phone:'(225) 555-0101',address:'100 Sample Street, Baton Rouge, LA 70801',appointmentTime:'11:00 AM–12:00 PM',junkItems:['Sample pickup'],appointmentNotes:['Synthetic browser fixture.'],driver:'Sample Driver',navigator:'Sample Navigator',status:'Confirmed'};

const other={...job,appointmentId:'900002',assignmentId:undefined,truck:'Truck 2',customerName:'Other truck customer',driver:'',navigator:'',readOnly:true};
const browser = await chromium.launch({headless:true});
try {
 for(const width of [320,390,430]) for(const onlyOther of [false,true]){
  const context=await browser.newContext({viewport:{width,height:844},isMobile:true,hasTouch:true});
  const page=await context.newPage();let writes=0;const errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/*',async route=>{
   const request=route.request(),url=new URL(request.url());
   if(url.origin!==origin)return route.abort();
   if(!url.pathname.startsWith('/api/'))return route.continue();
   if(request.method()!=='GET')writes++;
   const send=body=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(body)});
   if(url.pathname.endsWith('/session'))return send({phone});
   if(url.pathname.endsWith('/day'))return send({date,day,roster:['Sample Driver'],trucks:['Truck 6'],phone,inspection:{status:'ready'},switch:null});
   if(url.pathname.endsWith('/current'))return send({state:'assigned',truck:phone.truck,job:onlyOther?null:job,jobs:onlyOther?[other]:[{...job,truck:'Truck 6'},other],visibility:'all-trucks',observedAt:'2026-09-30T12:00:00.000Z',updateToken:'fixture'});
   if(url.pathname.endsWith('/updates'))return send({updateToken:'fixture'});
   throw Error('Unexpected API '+url.pathname);
  });
  await page.goto(`${origin}/crew-jobs`);
  await expect(page.getByRole('heading',{name:'Assignments',exact:true})).toBeVisible();
  await expect(page.getByText(/All trucks ·/)).toBeVisible();
  const card=page.locator('section').filter({has:page.getByRole('heading',{name:'Other truck customer',exact:true})});
  await expect(card.getByText('Truck# 2 · View only',{exact:true})).toBeVisible();
  await card.getByRole('button',{name:'View assignment',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Assignment details',exact:true})).toBeVisible();
  await expect(page.getByText('View only · Closeout stays with the assigned truck.',{exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:/Start closeout/})).toHaveCount(0);
  await expect(page.getByText('Not listed · Driver',{exact:true})).toBeVisible();
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  if(width===390 && onlyOther)await page.screenshot({path:'/tmp/waypoint-visibility-read-only-390.png',fullPage:true});
  await page.getByRole('button',{name:'Back to Assignments',exact:true}).click();
  if(!onlyOther){
   const own=page.locator('section').filter({has:page.getByRole('heading',{name:'Sample Customer',exact:true})});
   await own.getByRole('button',{name:'View assignment',exact:true}).click();
   await expect(page.getByRole('button',{name:/Start closeout/})).toBeVisible();
  }
  assert.equal(writes,0);assert.deepEqual(errors,[]);await context.close();
 }
 console.log('PASS: all-truck list/details at 320/390/430px, read-only other-truck actions, truthful missing crew, own-truck closeout retained, no own-truck jobs supported, no overflow or writes. Synthetic API only.');
}finally{await browser.close();}
