import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createServer} from '../desktop-ui/node_modules/vite/dist/node/index.js';
import {chromium, expect} from '@playwright/test';
import {openScheduleControls,closeScheduleControls} from './schedule-controls-browser.mjs';
const field=(value='',label='',options=[{value:'',label:''}])=>({value,label,options});
const fixture={photoEvidence:{appointmentId:'1234',urls:['https://junkware.junk-king.com/system/aspnet/local/media/before-1234-test.jpg']},truck:'Truck 1',truckOptions:[{value:'t',label:'Truck# 1'},{value:'u',label:'Truck# 6'}],status:field('1','Confirmed'),appointmentType:field('2','Job'),driver:{value:'d',label:'Fixture Driver'},drivers:[{value:'d',label:'Fixture Driver'}],navigators:[],navigatorOptions:[],loadQuantity:'1',loadSize:field(),loadPrices:[],loadPrice:'1200',bedloadQuantity:'',bedloadSize:field(),bedloadPrices:[],bedloadPrice:'',otherChargeOptions:[],otherCharges:[],discount:'',tip:'',jobCategory:field(),howHeard:field('ref','Referral',[{value:'ref',label:'Referral'}]),actualStartHour:field('12','12 PM',[{value:'12',label:'12 PM'}]),actualStartMinute:field('00','00',[{value:'00',label:'00'}]),actualEndHour:field('13','1 PM',[{value:'13',label:'1 PM'}]),actualEndMinute:field('00','00',[{value:'00',label:'00'}]),paymentMethods:[{value:'1',label:'Billed'},{value:'2',label:'Cash'},{value:'3',label:'Credit Card'},{value:'4',label:'Check'}],payments:[],balance:'1200.00',total:'$1,200.00'};

const root=fileURLToPath(new URL('../',import.meta.url));
const cache=fs.mkdtempSync(path.join(os.tmpdir(),'appointment-notes-browser-'));
const server=await createServer({configFile:path.join(root,'desktop-ui/tests/schedule-destinations.vite.config.ts'),configLoader:'runner',cacheDir:cache,base:'/',server:{host:'127.0.0.1',port:0,strictPort:false}});
let browser, lastPage;
try {
 await server.listen();browser=await chromium.launch({headless:true});
 for(const width of [390,1440]) {
  const page=await browser.newPage({viewport:{width,height:950}}),errors=[];
  lastPage=page;
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/tests/schedule-destinations.html?scenario=same-time&details=long`);
  await page.locator('.schedule-board-tools').waitFor({state:'attached'});
  await page.evaluate(fixture=>{
   const original=window.fetch;window.noteTest={posts:0,reads:0,notes:[]};
   window.fetch=async(input,init)=>{
    const url=new URL(String(input),location.origin),state=window.noteTest;
    if(url.pathname==='/api/desktop/schedule/closeout'){state.reads++;return Response.json({closeout:fixture,sourceVersion:'a'.repeat(64),canWrite:true});}
    if(url.pathname==='/api/desktop/schedule/operations'&&init?.method==='POST'){
     const body=JSON.parse(init.body);if(body.action!=='note')throw new Error('Only synthetic note saves allowed');
     state.posts++;state.notes.push(body.values.note+' (10/30/2026 11:00:00 AM , Verified in JunkWare)');
     return Response.json({receipt:{requestId:body.requestId,action:'note',status:'verified',message:'Note saved and verified in JunkWare.'}});
    }
    const result=await original(input,init);
    if(url.pathname!=='/api/desktop/schedule')return result;
    const body=await result.json();for(const job of body.appointments){job.appointmentNotes=[...job.appointmentNotes,...state.notes];job.version='version-'+state.notes.length;}
    return Response.json(body);
   };
  },fixture);
  await openScheduleControls(page);await page.locator('.day-switcher button').first().click();await closeScheduleControls(page);
  await page.locator('[data-schedule-appointment]').first().click();
  if (!(await page.locator('.job-record-drawer').isVisible())) await page.getByRole('button',{name:/^Full details/}).click();
  const drawer=page.locator('.job-record-drawer');await drawer.waitFor();
  const notes=drawer.getByRole('region',{name:'Appointment notes',exact:true});
  await expect(notes.getByRole('heading',{name:/Appointment notes/})).toBeVisible();
  assert.equal(await drawer.locator('.drawer-detail-sections > :first-child').getAttribute('aria-label'),'Appointment notes','Notes lead the detail content');
  await drawer.getByText('Appointment Closeout',{exact:true}).click();
  const price=drawer.getByRole('textbox',{name:'Load price',exact:true});await price.fill('321.50');
  await drawer.getByRole('combobox',{name:'Final appointment category',exact:true}).selectOption('Estimate');
  const input=drawer.getByRole('textbox',{name:'Add Appointment Note',exact:true});await input.fill('Synthetic note: keep the glass doors.');
  assert.equal(await input.getAttribute('maxlength'),'500');
  await drawer.getByRole('button',{name:'Save Note in JunkWare',exact:true}).click();
  await expect(notes.getByText('Synthetic note: keep the glass doors.',{exact:true})).toBeVisible();
  await expect(price).toHaveValue('321.50');
  await expect(drawer.getByRole('combobox',{name:'Final appointment category',exact:true})).toHaveValue('Estimate');
  await expect(input).toHaveValue('');
  assert.equal(await page.evaluate(()=>window.noteTest.posts),1,'One note request; no closeout replay');
  assert.equal(await page.evaluate(()=>window.noteTest.reads),1,'Saving a note does not reload the active closeout');
  await notes.scrollIntoViewIfNeeded();
  assert.equal(await drawer.evaluate(el=>el.scrollWidth>el.clientWidth),false,'Drawer has no horizontal overflow');
  await page.screenshot({path:`/tmp/appointment-notes-detail-${width}.png`,fullPage:true});
  assert.deepEqual(errors,[]);await page.close();
 }
 console.log('Appointment note browser passed at 390 and 1440px: notes lead detail, one verified save appears, drawer stays open, estimate/price draft survives, source closeout is not reloaded, 500-character limit and no horizontal overflow. Synthetic requests only.');
}catch(error){if(lastPage){console.log((await lastPage.locator('body').innerText()).slice(-4500));await lastPage.screenshot({path:'/tmp/appointment-note-test-failure.png'});}throw error;}finally{await browser?.close();await server.close();fs.rmSync(cache,{recursive:true,force:true});}
