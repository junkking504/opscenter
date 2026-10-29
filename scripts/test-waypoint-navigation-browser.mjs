import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {build} from 'esbuild';
import {chromium,expect} from '@playwright/test';
const repo=process.cwd();
const fixture=`
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
 if(route==='/api/crew-jobs/session')body={phone,manager:false};
 else if(route==='/api/crew-jobs/manager-session')body={manager:false};
 else if(route==='/api/crew-jobs/day')body={phone,date,day:{date,version:1,truck:phone.truck,driver:'Sample Driver',navigators:['Sample Navigator']},inspection:{status:'ready'},trucks:['Truck 4','Truck 2'],roster:[]};
 else if(route==='/api/crew-jobs/current')body={state:window.fixture.empty?'waiting':'assigned',truck:phone.truck,job:window.fixture.empty?null:job,jobs:phone.test?undefined:window.fixture.empty?[]:jobs,visibility:mapped?'truck':'all-trucks',message:phone.test&&window.fixture.empty?'All three test assignments are complete.':undefined,updateToken:'one',summary:window.fixture.summary?summary:null};
 else if(route==='/api/crew-jobs/updates')body={updateToken:'one'};
 else if(route==='/api/crew-jobs/notifications'){window.fixture.notificationReads++;body={enabled:true,available:true,messages:[{id:'1',body:'Sample office message: check supplies before leaving the shop.',created_at:'2026-10-23T14:00:00Z'}]};}
 else throw Error('Unexpected fixture API '+route);
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
await new Promise(resolve=>server.listen(process.argv.includes('--serve')?3197:0,'127.0.0.1',resolve));
const origin=`http://127.0.0.1:${server.address().port}`;
if(process.argv.includes('--serve')){console.log(origin);await new Promise(()=>{});}
const browser=await chromium.launch({headless:true});
try{
 for(const width of [320,390,430,1440]){
  const context=await browser.newContext({viewport:{width,height:900}}),page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(origin);await expect(page.getByRole('heading',{name:'Today’s Route',exact:true})).toBeVisible();
  await expect(page.getByRole('region',{name:'All appointments map'}).getByText('0 mapped · 3 without a map location')).toBeVisible();
  const nav=page.getByRole('navigation',{name:'Your day'});
  for(const label of ['Route','Completed','Performance','Notifications','Messages']){const box=await nav.getByRole('button',{name:label,exact:true}).boundingBox();if(label==='Route')await expect(nav.getByRole('button',{name:label,exact:true})).toHaveAttribute('aria-current','page');assert.ok(box.height>=44 && box.y+box.height<=900 && box.y>700);}
  await expect.poll(()=>nav.locator('img').evaluateAll(images=>images.every(image=>image.complete && image.naturalWidth>0))).toBe(true);
  await nav.getByRole('button',{name:'Completed',exact:true}).click();await expect(page.getByRole('heading',{name:'Completed Appointments',exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'Completed sample'})).toBeVisible();
  await page.getByLabel('View truck').selectOption('Truck# 2');await expect(page.getByRole('button',{name:'Other truck sample'})).toBeVisible();
  await nav.getByRole('button',{name:'Performance',exact:true}).click();await expect(page.getByRole('heading',{name:'Today’s Performance',exact:true})).toBeVisible();await expect(page.getByText('$950.00',{exact:true})).toBeVisible();
  await nav.getByRole('button',{name:'Messages',exact:true}).click();await expect(page.getByText('Sample office message:',{exact:false})).toBeVisible();await expect(page.getByText('Notifications are on and follow your current truck.')).toBeHidden();
  await nav.getByRole('button',{name:'Notifications',exact:true}).click();await expect(page.getByText('Notifications are on and follow your current truck.')).toBeVisible();await expect(page.getByRole('button',{name:'Disable notifications'})).toHaveCount(0);
  assert.equal(await page.evaluate(()=>window.fixture.notificationReads),1,'Navigation preserves notification connection/component');
  await nav.getByRole('button',{name:'Completed',exact:true}).click();await expect(page.getByLabel('View truck')).toHaveValue('Truck# 2');
  await page.getByRole('button',{name:'Other truck sample'}).click();await expect(page.getByRole('heading',{name:'Appointment Details'})).toBeVisible();await expect(nav).toBeHidden();await page.getByRole('button',{name:'All Assignments',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Completed Appointments',exact:true})).toBeVisible();
  await expect(page.getByLabel('View truck')).toHaveValue('Truck# 2');
  await page.evaluate(()=>{window.fixture.empty=true;window.fixture.summary=false;});await page.getByRole('button',{name:'Refresh Assignments',exact:true}).click();await expect(page.getByText('No completed appointments for this truck today.')).toBeVisible();
  await nav.getByRole('button',{name:'Performance',exact:true}).click();await expect(page.getByText('Today’s totals are unavailable. Refresh to check again.')).toBeVisible();
  await nav.getByRole('button',{name:'Route',exact:true}).click();await expect(page.getByText('No remaining appointments for this truck.')).toBeVisible();
  await page.getByText('Truck & Phone',{exact:true}).click();await page.evaluate(()=>window.scrollTo({top:document.documentElement.scrollHeight}));const last=await page.getByRole('button',{name:'Check connection',exact:true}).boundingBox(),bar=await nav.boundingBox();assert.ok(last.y+last.height<=bar.y,'Bottom navigation does not cover final controls');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);assert.deepEqual(errors,[]);
  await context.close();
 }
 const sandbox=await browser.newPage();await sandbox.goto(origin+'/?test=1');const testNav=sandbox.getByRole('navigation',{name:'Your day'});await expect(testNav.getByRole('button')).toHaveCount(3);await testNav.getByRole('button',{name:'Completed',exact:true}).click();await expect(sandbox.getByText('Completed test appointment details are unavailable. See Performance for test totals.')).toBeVisible();await sandbox.evaluate(()=>{window.fixture.empty=true;});await sandbox.getByRole('button',{name:'Refresh Assignments',exact:true}).click();await testNav.getByRole('button',{name:'Route',exact:true}).click();await expect(sandbox.getByText('All three test assignments are complete.',{exact:true})).toBeVisible();await expect(sandbox.getByText('You can reset test assignments in Truck & Phone.')).toBeVisible();await sandbox.close();
 console.log('PASS Waypoint navigation: five accessible entries, populated/empty views, truck filter retained across navigation, detail guard, persistent notification instance, 320/390/430/1440px; synthetic APIs only.');
}finally{await browser.close();server.close();}
