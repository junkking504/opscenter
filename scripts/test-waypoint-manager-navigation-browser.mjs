import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {build} from 'esbuild';
import {chromium,expect} from '@playwright/test';
const repo=process.cwd();
let fixture=`
const phone={deviceId:'fixture-phone',truck:'Truck 4',label:'Sample phone',test:new URLSearchParams(location.search).has('test')},date='2026-10-23';
const job={assignmentId:'fixture-a',appointmentId:'1',truck:'Truck 4',date,jkNumber:'SAMPLE-A',customerName:'Sample appointment',address:'',appointmentTime:'10 AM – 12 PM',junkItems:['Furniture'],appointmentNotes:[],status:'Confirmed'};
const mapped=new URLSearchParams(location.search).has('mapped');
if(mapped){job.address='123 Sample St, New Orleans';job.mapLocation={latitude:29.955,longitude:-90.075,approximate:false};}
const jobs=[job,{...job,assignmentId:'fixture-b',appointmentId:'2',customerName:'Completed sample',status:'Completed'},{...job,assignmentId:'fixture-c',appointmentId:'3',truck:'Truck 2',customerName:'Other truck sample',status:'Completed'}];
if(mapped)jobs.push({...job,assignmentId:'fixture-d',appointmentId:'4',customerName:'Next appointment',appointmentTime:'12 PM – 2 PM',address:'456 Sample Ave, New Orleans',mapLocation:{latitude:29.964,longitude:-90.067,approximate:false}});
const summary={date,truck:phone.truck,revenue:950,tips:40,message:'Today’s reported totals.',completed:[],crew:[{name:'Sample Driver',revenue:950,tips:40,bonus:0,progress:{bonus:0,next:{revenue:1000,bonus:20,remaining:50}}}]};
window.fixture={notificationReads:0,empty:false,summary:true};
window.Notification={permission:'granted'};window.PushManager=function(){};
Object.defineProperty(navigator,'serviceWorker',{value:{getRegistration:async()=>({pushManager:{getSubscription:async()=>({endpoint:'synthetic'})}})}});
const match=window.matchMedia;window.matchMedia=q=>q==='(display-mode: standalone)'?{matches:true}:match(q);
window.fetch=async(url,options={})=>{
 const route=new URL(url,location.href).pathname;let body;
 if(options.method && options.method!=='GET')throw Error('Unexpected fixture write');
 if(route==='/api/crew-jobs/session')body={phone};
 else if(route==='/api/crew-jobs/manager-session')body={manager:false};
 else if(route==='/api/crew-jobs/day')body={phone,date,day:{date,version:1,truck:phone.truck,driver:'Sample Driver',navigators:['Sample Navigator']},inspection:{status:'ready'},trucks:['Truck 4','Truck 2'],roster:[]};
 else if(route==='/api/crew-jobs/current')body={state:window.fixture.empty?'waiting':'assigned',truck:phone.truck,job:window.fixture.empty?null:job,jobs:phone.test?undefined:window.fixture.empty?[]:jobs,visibility:mapped?'truck':'all-trucks',message:phone.test&&window.fixture.empty?'All three test assignments are complete.':undefined,updateToken:'one',summary:window.fixture.summary?summary:null};
 else if(route==='/api/crew-jobs/updates')body={updateToken:'one'};
 else if(route==='/api/crew-jobs/notifications'){window.fixture.notificationReads++;body={enabled:true,available:true,messages:[{id:'1',body:'Sample office message: check supplies before leaving the shop.',created_at:'2026-10-23T14:00:00Z'}]};}
 else throw Error('Unexpected fixture API '+route);
 return {ok:true,status:200,json:async()=>body};
};`;

fixture+=`
const baseFetch=window.fetch;
const appointment=(id,status,start,truck='Truck 4')=>({recordId:id,appointmentId:id,version:'one',jkNumber:'SAMPLE-'+id,customerName:'Customer '+id,phone:'5045550100',address:'100 Example Street',territory:'Junk King New Orleans',status,truck,appointmentStartMinutes:start,appointmentEndMinutes:start+60,appointmentTime:(start/60)+':00 booked',appointmentNotes:['Original work scope','A longer note. '.repeat(120)],cancellationReason:'Changed plans.',driver:'Sample Driver',navigator:'Sample Navigator',callAhead:'not_called'});
const appointments=[appointment('cancelled','Cancelled by Sample',600,'—'),...Array.from({length:20},(_,i)=>appointment('done-'+i,'Completed Duration: 60 min(s)',480+i*15,i%2?'Truck 6':'Truck 4')),appointment('active','Confirmed',540)];
window.fixture.writes=0;
window.fetch=async(url,options={})=>{
 const parsed=new URL(url,location.href);let body;
 if(parsed.pathname==='/api/crew-jobs/manager-session')body={manager:true};
 else if(parsed.pathname==='/api/crew-jobs/manager'){
  const resource=parsed.searchParams.get('resource');
  if(options.method==='POST'){
   if(resource!=='operations')throw Error('Unapproved synthetic mutation '+resource);
   window.fixture.writes++;throw Error('Simulated lost response');
  }
  if(resource==='schedule')body={date:parsed.searchParams.get('date'),observedAt:'2026-10-23T22:47:00Z',appointments,phone,day:{driver:'Sample Driver',navigators:[],responsible:'Sample Driver',version:1},roster:['Sample Driver'],trucks:['Truck 4','Truck 6']};
  else if(resource==='operations')body={receipt:{requestId:parsed.searchParams.get('requestId'),status:'verified',message:'Verified synthetic result'}};
  else if(resource==='edit')body={sourceVersion:'one',closeout:{status:'1',appointmentType:{label:'Job'},truck:'Truck 4',driver:{value:'1'},navigators:[],loadQuantity:'1',loadPrice:'100'}};
  else throw Error('Unexpected manager fixture read '+resource);
 } else return baseFetch(url,options);
 return {ok:true,status:200,json:async()=>body};
};`;
const result=await build({stdin:{contents:`import React from 'react';import{createRoot}from'react-dom/client';import './app/globals.css';import App from './components/WaypointApp';${fixture}\ncreateRoot(document.getElementById('root')).render(<App/>);`,resolveDir:repo,loader:'tsx'},bundle:true,write:false,loader:{'.png':'dataurl'},outdir:'out',jsx:'automatic',define:{'process.env.NODE_ENV':'"production"'}});
const html=`<!doctype html><title>Waypoint design preview — sample data</title><meta name="viewport" content="width=device-width,initial-scale=1"><style>${result.outputFiles.find(f=>f.path.endsWith('.css')).text}</style><div id="root"></div><script>${result.outputFiles.find(f=>f.path.endsWith('.js')).text}</script>`;
const server=http.createServer((req,res)=>{
 const pathname=new URL(req.url,'http://localhost').pathname;
 if(pathname==='/'){res.setHeader('Content-Type','text/html; charset=utf-8');res.end(html);return;}
 if(/^\/crew-jobs\/(icons\/[a-z-]+\.svg|waypoint-crown-road-v1-192.png)$/.test(pathname)){res.setHeader('Content-Type',pathname.endsWith('.svg')?'image/svg+xml':'image/png');res.end(fs.readFileSync(path.join(repo,'public',pathname)));return;}
 res.writeHead(404);res.end();
});
await new Promise(resolve=>server.listen(process.argv.includes('--serve')?3198:0,'127.0.0.1',resolve));
const origin=`http://127.0.0.1:${server.address().port}`;
if(process.argv.includes('--serve')){console.log(origin);await new Promise(()=>{});}

const browser=await chromium.launch({headless:true});
try{
 for(const width of [320,390,430,1440]){
  const context=await browser.newContext({viewport:{width,height:844}}),page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(origin);
  const nav=page.getByRole('navigation',{name:'Appointment navigation'}),views=page.getByRole('navigation',{name:'Waypoint views'});
  await expect(page.getByRole('heading',{name:'Active / Scheduled (1)',exact:true})).toBeVisible();
  await expect(page.getByRole('heading',{name:'Completed (20)',exact:true})).toBeVisible();
  await expect(page.getByRole('heading',{name:'Cancelled (1)',exact:true})).toBeVisible();
  if(width===390&&process.env.WAYPOINT_TEST_ARTIFACTS){fs.mkdirSync(process.env.WAYPOINT_TEST_ARTIFACTS,{recursive:true});await page.screenshot({path:path.join(process.env.WAYPOINT_TEST_ARTIFACTS,'manager-list-390.png'),fullPage:true});}
  const headings=await page.locator('h2[id^="manager-"]').allTextContents();assert.deepEqual(headings,['Active / Scheduled (1)','Completed (20)','Cancelled (1)']);
  await expect(page.getByText('Completed Duration:',{exact:false})).toHaveCount(0);
  await page.getByLabel('Schedule date').fill('2026-10-22');
  await page.getByLabel('View truck').selectOption('Truck 4');
  await expect(page.getByRole('heading',{name:'Completed (10)'})).toBeVisible();
  const target=page.getByRole('button',{name:/Customer done-10/});await target.scrollIntoViewIfNeeded();
  const listScroll=await page.evaluate(()=>scrollY);assert.ok(listScroll>0);
  await target.click();await expect(page.getByRole('heading',{name:'Customer done-10',exact:true})).toBeVisible();
  await page.evaluate(()=>window.scrollTo(0,600));
  if(width===390&&process.env.WAYPOINT_TEST_ARTIFACTS)await page.screenshot({path:path.join(process.env.WAYPOINT_TEST_ARTIFACTS,'manager-detail-sticky-390.png')});
  const bar=await nav.boundingBox();assert.ok(bar.y>=0&&bar.y<30,'Back stays visible while detail scrolls');
  const back=nav.getByRole('button',{name:'Back to all appointments',exact:true});
  await page.getByRole('textbox',{name:'Appointment note',exact:true}).fill('Unsent synthetic note');
  page.once('dialog',d=>d.dismiss());await back.click();await expect(page.getByRole('textbox',{name:'Appointment note',exact:true})).toHaveValue('Unsent synthetic note');
  page.once('dialog',d=>d.dismiss());await views.getByRole('button',{name:'Crew workflow',exact:true}).click();await expect(page.getByRole('textbox',{name:'Appointment note',exact:true})).toHaveValue('Unsent synthetic note');
  page.once('dialog',d=>d.accept());await back.click();await expect(page.getByLabel('View truck')).toHaveValue('Truck 4');await expect(page.getByLabel('Schedule date')).toHaveValue('2026-10-22');
  await page.waitForFunction(y=>Math.abs(scrollY-y)<2,listScroll);
  await nav.getByRole('button',{name:'Back to crew workflow',exact:true}).click();await expect(page.getByRole('heading',{name:'Today’s route',exact:true})).toBeVisible();
  await page.getByRole('navigation',{name:'Your day'}).getByRole('button',{name:'Completed',exact:true}).click();await page.getByLabel('View truck').selectOption('Truck# 2');
  await views.getByRole('button',{name:'Manager',exact:true}).click();await expect(page.getByLabel('View truck')).toHaveValue('Truck 4');await expect(page.getByLabel('Schedule date')).toHaveValue('2026-10-22');
  await page.waitForFunction(y=>Math.abs(scrollY-y)<2,listScroll);
  await nav.getByRole('button',{name:'Back to crew workflow',exact:true}).click();await expect(page.getByRole('heading',{name:'Completed appointments'})).toBeVisible();await expect(page.getByLabel('View truck')).toHaveValue('Truck# 2');
  await views.getByRole('button',{name:'Manager',exact:true}).click();await expect(page.getByLabel('View truck')).toHaveValue('Truck 4');
  await page.getByRole('button',{name:'New appointment',exact:true}).click();await page.getByLabel('First name').fill('Unsaved');
  page.once('dialog',d=>d.dismiss());await nav.getByRole('button').click();await expect(page.getByLabel('First name')).toHaveValue('Unsaved');
  page.once('dialog',d=>d.accept());await nav.getByRole('button').click();await expect(page.getByLabel('First name')).toHaveCount(0);
  await page.getByRole('button',{name:/Customer active/}).click();await page.getByRole('button',{name:'Edit appointment details',exact:true}).click();
  await page.getByLabel('load Price',{exact:true}).fill('120');page.once('dialog',d=>d.dismiss());await nav.getByRole('button').click();await expect(page.getByLabel('load Price',{exact:true})).toHaveValue('120');
  page.once('dialog',d=>d.accept());await page.getByRole('button',{name:'Review and save details'}).click();await expect(page.getByText('Simulated lost response',{exact:true})).toBeVisible();
  await nav.getByRole('button').click();await expect(page.getByLabel('load Price',{exact:true})).toHaveValue('120');
  await views.getByRole('button',{name:'Crew workflow',exact:true}).click();await expect(page.getByLabel('load Price',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Check saved result'}).click();await expect(page.getByText('verified · Verified synthetic result')).toBeVisible();
  await nav.getByRole('button').click();await expect(page.getByLabel('load Price',{exact:true})).toHaveCount(0);
  await nav.getByRole('button').click();await expect(page.getByRole('heading',{name:'Completed (10)'})).toBeVisible();
  assert.equal(await page.evaluate(()=>window.fixture.writes),1,'Only one explicitly simulated operation; no real API mutation');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'No horizontal overflow');assert.deepEqual(errors,[]);
  await context.close();
 }
 console.log('PASS manager mobile: grouped counts, source-duration labels, persistent Back, selected date/truck/scroll, crew origin, unsaved action/booking/edit guards, uncertain receipt blocks shell and Back, recovered receipt permits return, 320/390/430/1440px; synthetic APIs only.');
}finally{await browser.close();server.close();}
