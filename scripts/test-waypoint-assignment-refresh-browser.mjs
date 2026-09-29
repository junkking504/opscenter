import assert from 'node:assert/strict';
import { chromium, expect } from '@playwright/test';

const origin=process.argv[2] || 'http://127.0.0.1:3194';
const browser=await chromium.launch({headless:true});
try {
  const context=await browser.newContext({viewport:{width:390,height:844}}),page=await context.newPage();
  const phone={deviceId:'00000000-0000-4000-8000-000000000001',truck:'Truck 3',label:'Synthetic phone',enrolledAt:'2026-09-29T12:00:00.000Z',expiresAt:'2026-12-29T12:00:00.000Z'};
  const day={date:'2026-09-29',version:1,deviceId:phone.deviceId,truck:phone.truck,responsible:'Sample Driver',driver:'Sample Driver',navigators:['Sample Navigator']};
  let assigned=false,currentReads=0,updateChecks=0;
  const job={assignmentId:'00000000-0000-4000-8000-000000000002',appointmentId:'900001',date:day.date,jkNumber:'SAMPLE-REFRESH',customerName:'Sample customer',address:'100 Sample Street',appointmentTime:'10 AM–12 PM',junkItems:['Garage cleanout'],appointmentNotes:['Side door'],driver:'Sample Driver',navigator:'Sample Navigator',status:'Confirmed'};
  await page.route('**/api/crew-jobs/**',route=>{
    const url=new URL(route.request().url()),send=body=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(body)});
    if(url.pathname==='/api/crew-jobs/session')return send({phone});
    if(url.pathname==='/api/crew-jobs/day')return send({date:day.date,day,phone,roster:['Sample Driver','Sample Navigator'],trucks:['Truck 3'],inspection:{status:'ready'},switch:null});
    if(url.pathname==='/api/crew-jobs/current'){
      currentReads++;
      return send(assigned?{state:'assigned',truck:phone.truck,observedAt:'2026-09-29T12:00:00.000Z',job,jobs:[job],updateToken:'assigned'}:{state:'waiting',truck:phone.truck,observedAt:'2026-09-29T12:00:00.000Z',job:null,jobs:[],updateToken:'waiting'});
    }
    if(url.pathname==='/api/crew-jobs/updates'){
      updateChecks++;assigned=true;return send({updateToken:'assigned'});
    }
    throw new Error(`Unexpected API request: ${url.pathname}`);
  });
  await page.goto(`${origin}/crew-jobs`,{waitUntil:'domcontentloaded'});
  await expect(page.getByText('No appointments are assigned to this truck today.',{exact:true})).toBeVisible();
  await expect(page.getByText('SAMPLE-REFRESH',{exact:false})).toBeVisible({timeout:8_000});
  assert.ok(updateChecks>=1,'The visible assignment list checks the local update token.');
  assert.ok(currentReads>=2,'A changed token reloads the full assignment once.');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  console.log(JSON.stringify({status:'passed',updateChecks,currentReads,viewport:'390x844',providerCalls:0}));
  await context.close();
} finally {await browser.close();}
