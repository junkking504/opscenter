import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {randomBytes} from 'node:crypto';
import {chromium,expect} from '@playwright/test';
import {createCrewPhoneEnrollment,enrollCrewPhone,revokeCrewPhone} from '../lib/crew-phone-store';
import {CREW_PHONE_COOKIE} from '../lib/crew-phone';

async function main(){
 if(!process.env.OPS_CREW_PHONE_DIR)throw new Error('Explicit test phone directory required.');
 const origin=process.argv[2] || 'http://127.0.0.1:3196';
 const key=randomBytes(32).toString('hex'),phone=enrollCrewPhone(createCrewPhoneEnrollment('Truck 6','Waypoint sandbox QA','sandbox-qa',new Date(),true).code,key);
 const browser=await chromium.launch({headless:true});
 try{
  const context=await browser.newContext({ignoreHTTPSErrors:true,viewport:{width:390,height:844},extraHTTPHeaders:{Cookie:`${CREW_PHONE_COOKIE}=${key}`}}),page=await context.newPage();
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));

  await page.goto(`${origin}/crew-jobs`);
  await expect(page.getByText('Test mode',{exact:true})).toBeVisible();
  await page.getByRole('combobox',{name:/^Assigned truck/}).selectOption('Truck 6');
  await page.getByRole('combobox',{name:/^Person responsible for this phone/}).selectOption('Test Driver');
  await page.getByRole('combobox',{name:/^Driver/}).selectOption('Test Driver');
  await page.getByRole('combobox',{name:/^Navigator/}).selectOption('Test Navigator');
  await page.getByRole('button',{name:'Continue',exact:true}).click();
  await page.getByLabel('Odometer · miles').fill('12345');
  await page.getByRole('button',{name:'Start inspection →',exact:true}).click();
  for(let i=0;i<5;i++){
   if(i===2)await page.getByRole('button',{name:'Fuel tank Full',exact:true}).click();
   if(i===3)await page.getByRole('button',{name:'Truck fullness Empty',exact:true}).click();
   await page.getByRole('button',{name:/✓ Good/}).click();
   // The real form debounces rapid duplicate taps.
   await page.waitForTimeout(500);
  }
  await page.getByRole('radio',{name:'No problems',exact:true}).check();
  await page.getByRole('button',{name:'Review report →',exact:true}).click();
  await page.getByLabel('Your initials').fill('TD');
  await page.getByRole('button',{name:'Send to OpsCenter',exact:true}).click();
  await page.getByRole('button',{name:'Continue to Assignments →',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Assignments',exact:true})).toBeVisible();
  await expect(page.getByRole('list',{name:'Start your day'})).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Switch truck',exact:true})).not.toBeVisible();
  await expect(page.getByRole('heading',{name:'Next bonus tier',exact:true})).toBeVisible();
  await expect(page.getByRole('link',{name:/101 Practice Lane/})).toHaveAttribute('href',/https:\/\/www.google.com\/maps\/dir\/\?api=1&destination=/);
  await page.screenshot({path:'/tmp/waypoint-sandbox-assignments.png',fullPage:true});
  for(let i=1;i<=3;i++){
   await expect(page.getByRole('heading',{name:new RegExp(`Test ${i} ·`)})).toBeVisible();
   await page.getByRole('button',{name:'View assignment',exact:true}).click();
   await page.getByRole('button',{name:'Start closeout · Before photos',exact:true}).click();
   const data=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=10;c.height=10;const x=c.getContext('2d')!;x.fillStyle='#b51935';x.fillRect(0,0,10,10);return c.toDataURL('image/jpeg').split(',')[1];});
   await expect(page.getByLabel('Add before photos',{exact:true})).toBeEnabled();
   await page.getByLabel('Add before photos',{exact:true}).setInputFiles({name:'test.jpg',mimeType:'image/jpeg',buffer:Buffer.from(data,'base64')});
   await expect(page.getByText('Ready to submit',{exact:true})).toBeVisible();
   await page.getByRole('button',{name:'Continue to charges',exact:true}).click();
   await expect(page.getByLabel('Job category',{exact:true})).toHaveCount(0);
   await expect(page.getByLabel('How heard',{exact:true})).toHaveCount(0);
   await expect(page.getByLabel('Load price',{exact:true})).toHaveValue('508.00');
   await page.getByRole('combobox',{name:/^Other charge/}).selectOption('1|75.00');
   await expect(page.getByLabel('Price / amount',{exact:true})).toHaveValue('75.00');
   await page.getByRole('button',{name:'+ Add charge',exact:true}).click();
   await expect(page.getByLabel('Other Charges to add').getByText(/Labor/)).toBeVisible();
   await page.getByLabel('Other Charges to add').getByRole('button',{name:'Remove',exact:true}).click();
   await page.getByLabel('Tip',{exact:true}).fill('20');
   await page.getByRole('button',{name:'Continue to after photos',exact:true}).click();
   await expect(page.getByLabel('Add after photos',{exact:true})).toBeEnabled();
   await page.getByLabel('Add after photos',{exact:true}).setInputFiles({name:'test-after.jpg',mimeType:'image/jpeg',buffer:Buffer.from(data,'base64')});
   await expect(page.getByText('Ready to submit',{exact:true})).toBeVisible();
   await page.getByRole('button',{name:'Continue to payment',exact:true}).click();
   await page.getByRole('button',{name:'Review Closeout',exact:true}).click();
   await page.getByRole('button',{name:'Submit checkout',exact:true}).click();
   await expect(page.getByRole('heading',{name:'Dry run complete',exact:true})).toBeVisible();
   await page.getByRole('button',{name:'Check next assignment',exact:true}).click();
  }
  await expect(page.getByText('All three test assignments are complete.',{exact:false})).toBeVisible();
  await expect(page.getByRole('region',{name:'Today’s performance'}).getByText('$1,524.00',{exact:true})).toBeVisible();
  await expect(page.getByRole('region',{name:'Today’s performance'}).getByText('$60.00',{exact:true})).toBeVisible();
  await expect(page.getByText('$238.00 to your next tier',{exact:true})).toHaveCount(2);
  await page.screenshot({path:'/tmp/waypoint-day-summary.png',fullPage:true});
  await page.getByText('Truck & phone',{exact:true}).click();
  await page.getByRole('button',{name:'Reset three test assignments',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Test 1 · Sofa pickup',exact:true})).toBeVisible();
  await page.reload();await expect(page.getByRole('heading',{name:'Assignments',exact:true})).toBeVisible();
  for(const width of [320,390,430]){await page.setViewportSize({width,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,`No overflow at ${width}px`);}
  assert.deepEqual(errors,[]);
  const state=fs.readFileSync(path.join(process.env.OPS_CREW_PHONE_DIR,'sandbox',phone.deviceId,new Intl.DateTimeFormat('en-CA',{timeZone:'America/Chicago'}).format(new Date()),'state.json'),'utf8');assert(!state.includes('addPayment'));
  console.log('PASS browser: real setup, five-section inspection, Assignments-only home, before/after photos, 3 dry-run closeouts, next assignment, reset, refresh, mobile widths; no external writes.');
 }catch(e){for(const context of browser.contexts())for(const page of context.pages()){console.error((await page.locator('body').innerText().catch(()=>'' )).slice(-6500));try{console.error('Photo DB',await page.evaluate(()=>new Promise(resolve=>{const r=indexedDB.open('ops-crew-photo-drafts-v1');r.onsuccess=()=>{const db=r.result;const t=db.transaction('drafts');const q=t.objectStore('drafts').getAll();q.onsuccess=()=>resolve(q.result.map((x:{photos:unknown[]})=>({count:x.photos.length})));};})));}catch{console.error('Photo DB unavailable after failure.');}await page.screenshot({path:'/tmp/waypoint-sandbox-browser-failure.png',fullPage:true}).catch(()=>{});}throw e;}
 finally{await browser.close();revokeCrewPhone(phone.deviceId,'sandbox-qa-complete');}
}
void main().catch(e=>{console.error(e);process.exitCode=1;});
