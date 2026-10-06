import assert from 'node:assert/strict';
import { chromium, expect } from '@playwright/test';

const origin=process.argv[2] || 'http://127.0.0.1:3194';
const browser=await chromium.launch({headless:true});
try {
  const context=await browser.newContext({viewport:{width:390,height:844}}),page=await context.newPage();
  const phone={deviceId:'00000000-0000-4000-8000-000000000001',truck:'Truck 3',label:'Synthetic phone',enrolledAt:'2026-09-29T12:00:00.000Z',expiresAt:'2026-12-29T12:00:00.000Z'};
  const day={date:'2026-09-29',version:1,deviceId:phone.deviceId,truck:phone.truck,responsible:'Sample Driver',driver:'Sample Driver',navigators:['Sample Navigator']};
  const priorAssignmentId='00000000-0000-4000-8000-000000000003',resetAt='2026-09-29T19:10:53.351Z';
  let assigned=false,currentReads=0,updateChecks=0,metricsUpdated=false;
  const summary=()=>({date:day.date,truck:phone.truck,test:false,observedAt:'2026-09-29T20:10:00.000Z',stale:false,revenue:metricsUpdated?1400:900,tips:metricsUpdated?24:0,completed:metricsUpdated?[{id:'900002',reference:'SAMPLE-CLOSED',customer:'Completed sample',address:'',time:'',type:'Job',revenue:500,tips:24}]:[],crew:[{name:'Sample Driver',revenue:metricsUpdated?700:450,tips:metricsUpdated?12:0,bonus:0,progress:{bonus:0,next:{revenue:1000,bonus:20,remaining:metricsUpdated?300:550}}}]});
  const job={assignmentId:'00000000-0000-4000-8000-000000000002',appointmentId:'900001',date:day.date,jkNumber:'SAMPLE-REFRESH',customerName:'Sample customer',address:'100 Sample Street',appointmentTime:'10 AM–12 PM',junkItems:['Garage cleanout'],appointmentNotes:['Side door'],driver:'Sample Driver',navigator:'Sample Navigator',status:'Confirmed',resetAt,resetPriorAssignmentId:priorAssignmentId};
  const stale={deviceId:phone.deviceId,assignmentId:priorAssignmentId,requestId:'00000000-0000-4000-8000-000000000004',createdAt:Date.now(),phase:'attention',payload:{requestId:'00000000-0000-4000-8000-000000000004'},photoIds:[],acceptedPhotos:{},message:'Dispatch changed. Refresh your assignment.'};
  const staleKey=`ops-crew-closeout:${phone.deviceId}:${priorAssignmentId}:handoff`;
  await page.addInitScript(({stale,staleKey,resetKey,resetAt})=>{
    localStorage.setItem(staleKey,JSON.stringify(stale));
    // Reproduce a late failed handoff that was rewritten after the first reset
    // cleanup had already recorded its marker.
    localStorage.setItem(resetKey,resetAt);
  },{stale,staleKey,resetKey:`ops-crew-closeout-reset:${phone.deviceId}:${job.appointmentId}`,resetAt});
  await page.route('**/api/crew-jobs/**',route=>{
    const url=new URL(route.request().url()),send=body=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(body)});
    if(url.pathname==='/api/crew-jobs/session')return send({phone});
    if(url.pathname==='/api/crew-jobs/day')return send({date:day.date,day,phone,roster:['Sample Driver','Sample Navigator'],trucks:['Truck 3'],inspection:{status:'ready'},switch:null});
    if(url.pathname==='/api/crew-jobs/current'){
      currentReads++;
      return send(assigned?{state:'assigned',truck:phone.truck,observedAt:'2026-09-29T12:00:00.000Z',job,jobs:[job],updateToken:'assigned',summary:summary()}:{state:'waiting',truck:phone.truck,observedAt:'2026-09-29T12:00:00.000Z',job:null,jobs:[],updateToken:'waiting',summary:summary()});
    }
    if(url.pathname==='/api/crew-jobs/updates'){
      updateChecks++;assigned=true;return send({updateToken:'assigned',summary:summary()});
    }
    throw new Error(`Unexpected API request: ${url.pathname}`);
  });
  await page.goto(`${origin}/crew-jobs`,{waitUntil:'domcontentloaded'});
  await expect(page.getByText('No appointments are assigned to this truck today.',{exact:true})).toBeVisible();
  await expect(page.getByText('SAMPLE-REFRESH',{exact:false})).toBeVisible({timeout:8_000});
  assert.ok(updateChecks>=1,'The visible assignment list checks the local update token.');
  assert.ok(currentReads>=2,'A changed token reloads the full assignment once.');
  await expect(page.getByText('Dispatch changed. Refresh your assignment.',{exact:true})).toHaveCount(0);
  assert.equal(await page.evaluate(key=>localStorage.getItem(key),staleKey),null,'Retired intent is no longer an active submission.');
  assert.ok(await page.evaluate(key=>Object.keys(localStorage).some(name=>name.startsWith(`${key}:retired:`)),staleKey),'Retired intent bytes remain archived for recovery.');
  await page.evaluate(({stale,staleKey})=>{
    localStorage.setItem(staleKey,JSON.stringify(stale));
    window.dispatchEvent(new CustomEvent('waypoint-checkout-handoff',{detail:stale}));
  },{stale,staleKey});
  await expect(page.getByText('Dispatch changed. Refresh your assignment.',{exact:true})).toHaveCount(0);
  assert.equal(await page.evaluate(key=>localStorage.getItem(key),staleKey),null,'A late retired handoff is archived without restoring its warning.');
  const currentHandoff={...stale,assignmentId:job.assignmentId,requestId:'00000000-0000-4000-8000-000000000005',message:'Current checkout needs review.'};
  await page.evaluate(value=>window.dispatchEvent(new CustomEvent('waypoint-checkout-handoff',{detail:value})),currentHandoff);
  await expect(page.getByText('Current checkout needs review.',{exact:true})).toBeVisible();
  const readsBeforeMetrics=currentReads;
  await expect(page.getByText('$900.00',{exact:true})).toBeVisible();
  metricsUpdated=true;
  await expect(page.getByText('$1,400.00',{exact:true})).toBeVisible({timeout:8_000});
  await expect(page.getByText('$24.00',{exact:true})).toBeVisible();
  await expect(page.getByText('$300.00 to your next tier',{exact:true})).toBeVisible();
  await expect(page.getByText('Completed sample',{exact:true})).toBeVisible();
  assert.equal(currentReads,readsBeforeMetrics,'A metrics-only sync updates totals without reloading assignments.');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  console.log(JSON.stringify({status:'passed',updateChecks,currentReads,metricsOnlyRefresh:true,staleResetCleared:true,lateStaleEventIgnored:true,currentAttentionPreserved:true,viewport:'390x844',providerCalls:0}));
  await context.close();
} finally {await browser.close();}
