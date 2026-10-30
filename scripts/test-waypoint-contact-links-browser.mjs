import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {build} from 'esbuild';
import {chromium,webkit,expect} from '@playwright/test';
const repo=process.cwd();
const result=await build({stdin:{contents:`
import React from 'react';import{createRoot}from'react-dom/client';
import './app/globals.css';import ManagerApp from './app/crew-jobs/manager-app';import RouteOverview from './app/crew-jobs/route-overview';
const date='2026-10-28';
const row={recordId:'sample-record',appointmentId:'sample-id',assignmentId:'sample-assignment',version:'sample-version',sourceDate:date,date,jkNumber:'SAMPLE-01',customerName:'Sample Customer',phone:'(504) 555-0100',address:'100 Example Street, New Orleans, LA 70118',territory:'Junk King New Orleans',appointmentType:'Job',status:'Confirmed',truck:'Truck 8',appointmentTime:'2:00 PM–3:00 PM',hasScheduledTime:true,appointmentStartMinutes:840,appointmentEndMinutes:900,appointmentNotes:['Synthetic fixture only'],driver:'',navigator:''};
const missing={...row,recordId:'missing-record',appointmentId:'missing-id',assignmentId:'missing-assignment',customerName:'Missing Contact',address:'',phone:'',appointmentStartMinutes:960,appointmentEndMinutes:1020};
window.fixture={writes:0,selected:[],links:[]};
window.fetch=async(url,options={})=>{
 if(options.method&&options.method!=='GET'){window.fixture.writes++;throw Error('Unexpected operational write');}
 const parsed=new URL(url,location.href);
 if(parsed.pathname!=='/api/crew-jobs/manager'||parsed.searchParams.get('resource')!=='schedule')throw Error('Unexpected fixture request '+url);
 return{ok:true,status:200,json:async()=>({date,observedAt:'2026-10-28T20:20:00Z',appointments:[row,missing],phone:null,day:null,roster:[],trucks:['Truck 8']})};
};
// Capture links after React handlers without launching maps, phone, or messages.
document.addEventListener('click',e=>{const link=e.target.closest('a');if(link){window.fixture.links.push(link.href);e.preventDefault();}});
const crew=new URLSearchParams(location.search).get('crew');
createRoot(document.getElementById('root')).render(crew?<RouteOverview jobs={[crew==='completed'?{...row,status:'Completed'}:row,missing]} truck="Truck 8" date={date} allTrucks={false} view={crew==='completed'?'completed':'route'} onSelect={id=>window.fixture.selected.push(id)}/>:<ManagerApp onCrew={()=>{}} context={{date,truck:'',scroll:0}}/>);
`,resolveDir:repo,loader:'tsx'},bundle:true,write:false,loader:{'.png':'dataurl'},outdir:'out',jsx:'automatic',define:{'process.env.NODE_ENV':'"production"'}});
const html=`<!doctype html><meta charset="utf-8"><title>Waypoint contacts — synthetic QA</title><meta name="viewport" content="width=device-width,initial-scale=1"><style>${result.outputFiles.find(f=>f.path.endsWith('.css')).text}</style><div id="root"></div><script>${result.outputFiles.find(f=>f.path.endsWith('.js')).text}</script>`;
const server=http.createServer((req,res)=>{
 const pathname=new URL(req.url,'http://localhost').pathname;
 if(pathname==='/'){res.setHeader('Content-Type','text/html');res.end(html);return;}
 if(/^\/crew-jobs\/icons\/[a-z-]+\.svg$/.test(pathname)){res.setHeader('Content-Type','image/svg+xml');res.end(fs.readFileSync(path.join(repo,'public',pathname)));return;}
 res.writeHead(404);res.end();
});
await new Promise(resolve=>server.listen(process.argv.includes('--serve')?3217:0,'127.0.0.1',resolve));
const origin=`http://127.0.0.1:${server.address().port}`;
if(process.argv.includes('--serve')){console.log(origin);await new Promise(()=>{});}
try{
 for(const engine of [chromium,webkit]){
 const browser=await engine.launch({headless:true});
 try{for(const width of [320,390,844,1440]){
 const context=await browser.newContext({viewport:{width,height:width===844?390:844},hasTouch:true,isMobile:width<1000});
 const page=await context.newPage(),errors=[],external=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',route=>{if(!route.request().url().startsWith(origin+'/')){external.push(route.request().url());return route.abort();}return route.continue();});
 const address=()=>page.getByRole('link',{name:'100 Example Street, New Orleans, LA 70118 Open Apple Maps ↗',exact:true});
 const phone=()=>page.getByRole('link',{name:/^Call \(504\) 555-0100/});
 async function contacts(){
  await expect(address()).toHaveAttribute('href','https://maps.apple.com/directions?mode=driving&destination=100%20Example%20Street%2C%20New%20Orleans%2C%20LA%2070118');
  await expect(phone()).toHaveAttribute('href','tel:+15045550100');
  assert.equal(await page.locator('button a,a button').count(),0,'No nested interactive controls');
  for(const link of [address(),phone()]){await link.scrollIntoViewIfNeeded();assert.ok((await link.boundingBox()).height>=44);await link.tap();}
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'No horizontal overflow');
 }
 await page.goto(origin);await expect(page.getByRole('heading',{name:'Active / Scheduled (2)'})).toBeVisible();
 await contacts();await expect(page.getByRole('heading',{name:'Active / Scheduled (2)'})).toBeVisible();
 await expect(page.getByText('Address unavailable',{exact:true})).toBeVisible();await expect(page.getByText('Customer phone unavailable',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:/Booked .*Sample Customer/}).tap();
 await expect(page.getByRole('heading',{name:'Sample Customer',exact:true})).toBeVisible();await contacts();
 await page.getByRole('textbox',{name:'Appointment note',exact:true}).fill('Unsent fixture draft');
 await address().tap();await phone().tap();await expect(page.getByRole('textbox',{name:'Appointment note',exact:true})).toHaveValue('Unsent fixture draft');
 // Pointer long-press stays the existing phone menu; moving/cancelling does not call.
 await phone().dispatchEvent('pointerdown',{pointerType:'touch',clientX:50,clientY:50});await page.waitForTimeout(600);await phone().dispatchEvent('pointerup',{pointerType:'touch'});
 const actions=page.getByRole('group',{name:'Contact (504) 555-0100'});await expect(actions).toBeVisible();await expect(actions.getByRole('link',{name:'Message customer',exact:true})).toHaveAttribute('href','sms:+15045550100');await actions.getByRole('button',{name:'Close',exact:true}).tap();
 const count=await page.evaluate(()=>window.fixture.links.length);
 await phone().dispatchEvent('pointerdown',{pointerType:'touch',clientX:50,clientY:50});await phone().dispatchEvent('pointermove',{pointerType:'touch',clientX:50,clientY:90});await phone().dispatchEvent('pointercancel',{pointerType:'touch'});await page.waitForTimeout(600);await expect(actions).toHaveCount(0);assert.equal(await page.evaluate(()=>window.fixture.links.length),count);
 await address().focus();await expect(address()).toBeFocused();await page.keyboard.press('Enter');
 if(width===390&&process.env.WAYPOINT_TEST_ARTIFACTS){fs.mkdirSync(process.env.WAYPOINT_TEST_ARTIFACTS,{recursive:true});await page.screenshot({path:path.join(process.env.WAYPOINT_TEST_ARTIFACTS,`manager-contact-detail-${engine.name()}.png`),fullPage:true});}
 page.once('dialog',d=>d.dismiss());await page.getByRole('navigation',{name:'Appointment navigation'}).getByRole('button').tap();await expect(page.getByRole('textbox',{name:'Appointment note',exact:true})).toHaveValue('Unsent fixture draft');
 page.once('dialog',d=>d.accept());await page.getByRole('navigation',{name:'Appointment navigation'}).getByRole('button').tap();await expect(page.getByRole('heading',{name:'Active / Scheduled (2)'})).toBeVisible();
 assert.equal(await page.evaluate(()=>window.fixture.writes),0);
 for(const view of ['route','completed']){await page.goto(origin+'/?crew='+view);await contacts();assert.deepEqual(await page.evaluate(()=>window.fixture.selected),[],'Contact taps do not open appointment');await page.getByRole('button',{name:view==='route'?/Stop 1: Sample Customer/:/Sample Customer/}).tap();assert.deepEqual(await page.evaluate(()=>window.fixture.selected),['sample-id']);}
 assert.deepEqual(errors,[]);assert.deepEqual(external,[],'No map/phone/provider requests');await context.close();
 console.log(`PASS ${engine.name()} ${width}px: manager list/detail, crew route/completed links, taps, focus, draft guard, missing data, no writes/external requests`);
 }}finally{await browser.close();}
 }
}finally{server.close();}
