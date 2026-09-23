import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {randomBytes} from 'node:crypto';
import {chromium,expect} from '@playwright/test';
import {createCrewPhoneEnrollment,enrollCrewPhone,revokeCrewPhone} from '../lib/crew-phone-store';
import {CREW_PHONE_COOKIE} from '../lib/crew-phone';
import {readWaypointTestPricing} from '../lib/waypoint-test-pricing';

async function main(){
 if(!process.env.OPS_CREW_PHONE_DIR)throw new Error('Explicit test phone directory required.');
 const origin=process.argv[2] || 'http://127.0.0.1:3196';
 const pricing=readWaypointTestPricing(),halfPrice=pricing.loadPrices[pricing.loadOptions.filter(row=>row.value!=='Dry Run').findIndex(row=>row.value==='3 (1/2)')-1];
 const key=randomBytes(32).toString('hex'),phone=enrollCrewPhone(createCrewPhoneEnrollment('Truck 6','Waypoint sandbox QA','sandbox-qa',new Date(),true).code,key);
 const browser=await chromium.launch({headless:true});
 try{
  const context=await browser.newContext({ignoreHTTPSErrors:true,viewport:{width:390,height:844},extraHTTPHeaders:{Cookie:`${CREW_PHONE_COOKIE}=${key}`}}),page=await context.newPage();
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  const timings:Array<{action:string;ms:number}>=[],apiTimings:Array<{path:string;method:string;ms:number;status:number}>=[];
  const time=async(action:string,run:()=>Promise<unknown>)=>{const start=performance.now();await run();timings.push({action,ms:Math.round(performance.now()-start)});};
  page.on('requestfinished',async request=>{if(new URL(request.url()).pathname.startsWith('/api/')){const response=await request.response();apiTimings.push({path:new URL(request.url()).pathname,method:request.method(),ms:Math.round(request.timing().responseEnd),status:response?.status()||0});}});
  const capture=async(name:string)=>{
   for(const width of [320,390,430]){
    await page.setViewportSize({width,height:844});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,`${name}: no horizontal overflow at ${width}`);
   }
   await page.setViewportSize({width:390,height:844});
   await page.screenshot({path:`/tmp/waypoint-audit-${name}.png`,fullPage:true});
  };

  await time('Open Waypoint and load truck setup',async()=>{await page.goto(`${origin}/crew-jobs`);await expect(page.getByRole('heading',{name:'Set up your truck phone',exact:true})).toBeVisible();});
  await expect(page.getByText('Test mode',{exact:true})).toBeVisible();
  await expect(page.getByRole('heading',{name:'Set up your truck phone',exact:true})).toBeVisible();
  await capture('01-setup');
  await page.getByRole('combobox',{name:/^Assigned truck/}).selectOption('Truck 6');
  await page.getByRole('combobox',{name:/^Person responsible for this phone/}).selectOption('Test Driver');
  await page.getByRole('combobox',{name:/^Driver/}).selectOption('Test Driver');
  await page.getByRole('combobox',{name:/^Navigator/}).selectOption('Test Navigator');
  await time('Save truck setup and open inspection',async()=>{await page.getByRole('button',{name:'Continue',exact:true}).click();await expect(page.getByLabel('Odometer · miles')).toBeVisible();});
  await capture('02-inspection-start');
  await page.getByLabel('Odometer · miles').fill('12345');
  await time('Start inspection',async()=>{await page.getByRole('button',{name:'Start inspection →',exact:true}).click();await expect(page.getByRole('button',{name:/✓ Good/})).toBeVisible();});
  for(let i=0;i<5;i++){
   if(i===2)await page.getByRole('button',{name:'Fuel tank Full',exact:true}).click();
   if(i===3)await page.getByRole('button',{name:'Truck fullness Empty',exact:true}).click();
   await time(`Inspection section ${i+1}`,async()=>{await page.getByRole('button',{name:/✓ Good/}).click();await expect(i===4?page.getByRole('radio',{name:'No problems',exact:true}):page.getByRole('button',{name:/✓ Good/})).toBeVisible();});
   // The real form debounces rapid duplicate taps.
   await page.waitForTimeout(500);
  }
  await page.getByRole('radio',{name:'No problems',exact:true}).check();
  await page.getByRole('button',{name:'Review report →',exact:true}).click();
  await page.getByLabel('Your initials').fill('TD');
  assert.equal(await page.getByRole('button',{name:'Send to OpsCenter',exact:true}).evaluate(button=>getComputedStyle(button.parentElement!).position),'static','Embedded inspection actions must not cover initials');
  await capture('03-inspection-review');
  await time('Submit simulated inspection and verify receipt',async()=>{await page.getByRole('button',{name:'Send to OpsCenter',exact:true}).click();await expect(page.getByRole('button',{name:'Continue to Assignments →',exact:true})).toBeVisible();});
  await time('Open Assignments',async()=>{await page.getByRole('button',{name:'Continue to Assignments →',exact:true}).click();await expect(page.getByRole('heading',{name:'Assignments',exact:true})).toBeVisible();});
  await expect(page.getByRole('heading',{name:'Assignments',exact:true})).toBeVisible();
  await expect(page.getByRole('list',{name:'Start your day'})).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Switch truck',exact:true})).not.toBeVisible();
  await expect(page.getByRole('heading',{name:'Next bonus tier',exact:true})).toBeVisible();
  await expect(page.getByRole('link',{name:/101 Practice Lane/})).toHaveAttribute('href',/https:\/\/www.google.com\/maps\/dir\/\?api=1&destination=/);
  await capture('04-assignments');
  for(let i=1;i<=3;i++){
   await expect(page.getByRole('heading',{name:new RegExp(`Test ${i} ·`)})).toBeVisible();
   await time(`Job ${i}: open assignment`,async()=>{await page.getByRole('button',{name:'View assignment',exact:true}).click();await expect(page.getByRole('button',{name:'Start closeout · Before photos',exact:true})).toBeVisible();});
   await time(`Job ${i}: open closeout and photo history`,async()=>{await page.getByRole('button',{name:'Start closeout · Before photos',exact:true}).click();await expect(page.getByLabel('Add before photos',{exact:true})).toBeEnabled();});
   const data=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=10;c.height=10;const x=c.getContext('2d')!;x.fillStyle='#b51935';x.fillRect(0,0,10,10);return c.toDataURL('image/jpeg').split(',')[1];});
   await expect(page.getByLabel('Add before photos',{exact:true})).toBeEnabled();
   const selectedAt=Date.now();
   await page.getByLabel('Add before photos',{exact:true}).setInputFiles(Array.from({length:i===1?12:1},(_,n)=>({name:`test-${n}.jpg`,mimeType:'image/jpeg',buffer:Buffer.from(data,'base64')})));
   await expect(page.getByRole('img').filter({visible:true}).first()).toBeVisible({timeout:2000});
   console.log(`Photo selection visible within ${Date.now()-selectedAt}ms`);
   await expect(page.getByText('Ready to submit',{exact:true})).toHaveCount(i===1?12:1);
   timings.push({action:`Job ${i}: prepare ${i===1?12:1} before photos`,ms:Date.now()-selectedAt});
   if(i===1){
    const selected=page.getByAltText('before job photo selected for upload',{exact:true});
    const first=await selected.nth(0).boundingBox(),second=await selected.nth(1).boundingBox();
    assert.ok(first && second && Math.abs(first.y-second.y)<2 && second.x>first.x,'Prepared photos stay in a compact two-column grid');
    await capture('05-before-photos');
   }
   await time(`Job ${i}: open Charges`,async()=>{await page.getByRole('button',{name:'Continue to charges',exact:true}).click();await expect(page.getByLabel('Load price',{exact:true})).toBeVisible();});
   await expect(page.getByLabel('Job category',{exact:true})).toHaveCount(0);
   await expect(page.getByLabel('How heard',{exact:true})).toHaveCount(0);
   await expect(page.getByLabel('Load price',{exact:true})).toHaveValue(halfPrice.toFixed(2));
   await expect(page.getByLabel('Actual start hour',{exact:true})).toHaveCount(0);
   await page.getByRole('combobox',{name:/^Other charge/}).selectOption('1|75.00');
   await expect(page.getByLabel('Price / amount',{exact:true})).toHaveValue('75.00');
   await time(`Job ${i}: add charge`,async()=>{await page.getByRole('button',{name:'+ Add charge',exact:true}).click();await expect(page.getByLabel('Other Charges to add').getByText(/Labor/)).toBeVisible();});
   await expect(page.getByLabel('Other Charges to add').getByText(/Labor/)).toBeVisible();
   if(i===1){
    const label=page.getByLabel('Other Charges to add').getByText(/Labor/);
    assert.equal(await label.evaluate(el=>getComputedStyle(el).color),'rgb(37, 49, 44)','Pending charge names use dark readable text');
    await capture('06-charges');
   }
   await page.getByLabel('Other Charges to add').getByRole('button',{name:'Remove',exact:true}).click();
   await page.getByLabel('Tip',{exact:true}).fill('20');
   await time(`Job ${i}: open After photos`,async()=>{await page.getByRole('button',{name:'Continue to after photos',exact:true}).click();await expect(page.getByLabel('Add after photos',{exact:true})).toBeEnabled();});
   await expect(page.getByLabel('Add after photos',{exact:true})).toBeEnabled();
   await page.getByLabel('Add after photos',{exact:true}).setInputFiles(Array.from({length:i===1?13:1},(_,n)=>({name:`test-after-${n}.jpg`,mimeType:'image/jpeg',buffer:Buffer.from(data,'base64')})));
   await expect(page.getByText('Ready to submit',{exact:true})).toHaveCount(i===1?13:1);
   if(i===1){
    await expect(page.getByText('25 of 25 selected · Before and After combined',{exact:true})).toBeVisible();
    await page.getByLabel('Add after photos',{exact:true}).setInputFiles({name:'one-too-many.jpg',mimeType:'image/jpeg',buffer:Buffer.from(data,'base64')});
    await expect(page.getByText('You can add 0 more photos.',{exact:false})).toBeVisible();
    await expect(page.getByText('Ready to submit',{exact:true})).toHaveCount(13);
    await capture('07-after-photos');
   }
   await time(`Job ${i}: open Payment`,async()=>{await page.getByRole('button',{name:'Continue to payment',exact:true}).click();await expect(page.getByLabel('Record a collected payment',{exact:true})).toBeVisible();});
   if(i===1)await capture('08-payment');
   await time(`Job ${i}: review closeout`,async()=>{await page.getByRole('button',{name:'Review Closeout',exact:true}).click();await expect(page.getByRole('button',{name:'Submit checkout',exact:true})).toBeVisible();});
   if(i===1)await capture('09-review');
   await time(`Job ${i}: submit simulated closeout`,async()=>{await page.getByRole('button',{name:'Submit checkout',exact:true}).click();await expect(page.getByRole('heading',{name:'Dry run complete',exact:true})).toBeVisible();});
   await page.getByRole('button',{name:'Check next assignment',exact:true}).click();
  }
  await expect(page.getByText('All three test assignments are complete.',{exact:false})).toBeVisible();
  await expect(page.getByRole('region',{name:'Today’s performance'}).getByText(new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(halfPrice*3),{exact:true})).toBeVisible();
  await expect(page.getByRole('region',{name:'Today’s performance'}).getByText('$60.00',{exact:true})).toBeVisible();
  await page.screenshot({path:'/tmp/waypoint-day-summary.png',fullPage:true});
  await capture('10-day-summary');
  await page.getByText('Truck & phone',{exact:true}).click();
  await page.getByRole('button',{name:'Reset three test assignments',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Test 1 · Sofa pickup',exact:true})).toBeVisible();
  await time('Reload Waypoint with saved setup',async()=>{await page.reload();await expect(page.getByRole('heading',{name:'Assignments',exact:true})).toBeVisible();});
  await page.getByText('Truck & phone',{exact:true}).click();
  await page.getByRole('button',{name:'Edit crew',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Edit today’s crew',exact:true})).toBeVisible();
  await capture('11-edit-crew');
  await page.getByRole('button',{name:'Keep current setup',exact:true}).click();
  await page.getByText('Truck & phone',{exact:true}).click();
  await page.getByRole('button',{name:'Switch truck',exact:true}).click();
  await page.getByRole('combobox',{name:'Replacement truck',exact:true}).selectOption('Truck 5');
  await time('Review simulated truck switch',async()=>{await page.getByRole('button',{name:'Review switch',exact:true}).click();await expect(page.getByRole('button',{name:'Move our unfinished jobs to Truck 5',exact:true})).toBeVisible();});
  await capture('12-switch-review');
  await page.getByRole('button',{name:'Keep Truck# 6',exact:true}).click();
  for(const width of [320,390,430]){await page.setViewportSize({width,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,`No overflow at ${width}px`);}
  assert.deepEqual(errors,[]);
  const result={origin,mode:'isolated test phone: synthetic jobs and payments, actual API/UI',timings,apiTimings};
  fs.writeFileSync('/tmp/waypoint-audit-timings.json',JSON.stringify(result,null,2));
  console.log(JSON.stringify(result));
  const state=fs.readFileSync(path.join(process.env.OPS_CREW_PHONE_DIR,'sandbox',phone.deviceId,new Intl.DateTimeFormat('en-CA',{timeZone:'America/Chicago'}).format(new Date()),'state.json'),'utf8');assert(!state.includes('addPayment'));
  console.log('PASS browser: real setup, five-section inspection, Assignments-only home, before/after photos, 3 dry-run closeouts, next assignment, reset, refresh, mobile widths; no external writes.');
 }catch(e){for(const context of browser.contexts())for(const page of context.pages()){console.error((await page.locator('body').innerText().catch(()=>'' )).slice(-6500));try{console.error('Photo DB',await page.evaluate(()=>new Promise(resolve=>{const r=indexedDB.open('ops-crew-photo-drafts-v1');r.onsuccess=()=>{const db=r.result;const t=db.transaction('drafts');const q=t.objectStore('drafts').getAll();q.onsuccess=()=>resolve(q.result.map((x:{photos:unknown[]})=>({count:x.photos.length})));};})));}catch{console.error('Photo DB unavailable after failure.');}await page.screenshot({path:'/tmp/waypoint-sandbox-browser-failure.png',fullPage:true}).catch(()=>{});}throw e;}
 finally{await browser.close();revokeCrewPhone(phone.deviceId,'sandbox-qa-complete');}
}
void main().catch(e=>{console.error(e);process.exitCode=1;});
