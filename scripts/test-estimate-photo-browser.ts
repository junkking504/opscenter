import assert from 'node:assert/strict';
import path from 'node:path';
import {build} from 'esbuild';
import {chromium,expect} from '@playwright/test';
import {fixture} from './fixtures/crew-closeout';
async function main(){
 const repo=process.cwd(),origin='http://127.0.0.1:39992';
 const result=await build({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import App from './components/WaypointApp';import './app/ops-styles.css';createRoot(document.getElementById('root')).render(<App/>);`,resolveDir:repo,loader:'tsx'},absWorkingDir:repo,bundle:true,write:false,outdir:'fixture',jsx:'automatic',define:{'process.env.NODE_ENV':'"production"'},alias:{'@':repo,react:path.join(repo,'node_modules/react'),'react-dom':path.join(repo,'node_modules/react-dom')}});
 const js=result.outputFiles.find(f=>f.path.endsWith('.js'))!.text,css=result.outputFiles.find(f=>f.path.endsWith('.css'))!.text;
 const browser=await chromium.launch({headless:true});
 try{for(const width of [320,390,430])for(const outcome of ['Estimate','Job','Missing outcome']){
  const context=await browser.newContext({viewport:{width,height:900},serviceWorkers:'block'}),page=await context.newPage();let posted:any=null;const errors:string[]=[];
  page.on('pageerror',e=>errors.push(e.message));
  const phone={deviceId:'synthetic-phone',truck:'Truck 6',label:'Synthetic ordinary crew phone'},date='2026-10-16';
  const job={assignmentId:'synthetic-assignment',appointmentId:'900001',date,jkNumber:'SYNTHETIC-01',customerName:'Synthetic estimate customer',address:'100 Example Street',appointmentTime:'9 AM',junkItems:[],appointmentNotes:[],driver:'Sample Driver',navigator:'Sample Navigator',status:'Confirmed',appointmentType:'Job'};
  await page.route('**/*',async route=>{
   const req=route.request(),u=new URL(req.url()),send=(body:unknown,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)});
   if(u.origin!==origin)return route.abort();
   if(u.pathname==='/bundle.js')return route.fulfill({contentType:'text/javascript',body:js});
   if(u.pathname==='/')return route.fulfill({contentType:'text/html',body:`<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0}${css}</style></head><body><div id="root"></div><script src="/bundle.js"></script></body></html>`});
   if(!u.pathname.startsWith('/api/'))return route.abort();
   if(u.pathname.endsWith('/session'))return send({phone,manager:false});
   if(u.pathname.endsWith('/day'))return send({phone,date,day:{date,version:1,truck:phone.truck,responsible:'Sample Driver',driver:'Sample Driver',navigators:['Sample Navigator']},inspection:{status:'ready'},trucks:[phone.truck],roster:['Sample Driver','Sample Navigator']});
   if(u.pathname.endsWith('/current'))return send({state:'assigned',truck:phone.truck,job,jobs:[job],updateToken:'fixture'});
   if(u.pathname.endsWith('/updates'))return send({updateToken:'fixture'});
   if(u.pathname.endsWith('/photos')){assert.equal(req.method(),'GET','No real or synthetic after-photo upload should be required');return send({photos:[{requestId:'saved-before',category:'before',status:'verified'}]});}
   if(u.pathname.endsWith('/closeout')){
    if(req.method()==='POST'){posted=req.postDataJSON();assert.equal(outcome,'Estimate');return send({receipt:{requestId:posted.requestId,status:'pending',action:'closeout',message:'Synthetic accepted'}},202);}
    if(u.searchParams.has('requestId'))return send({error:'No saved receipt'},404);
    return send({closeout:{...fixture,photoEvidence:{appointmentId:'900001',urls:['https://junkware.junk-king.com/system/aspnet/local/media/before-900001-fixture.jpg']}},sourceVersion:'fixture-source',sourceFieldsVersion:'a'.repeat(64),jobVersion:'fixture-job',crewVersion:1,crewDefaults:{version:1,driver:fixture.driver,navigators:fixture.navigators},canWrite:true});
   }
   throw Error('Unexpected API '+u.pathname);
  });
  await page.goto(origin);await page.getByRole('button',{name:'View assignment',exact:true}).click();await page.getByRole('button',{name:'START',exact:true}).click();
  await page.getByRole('button',{name:'Submit before photos & continue',exact:true}).click();
  if(outcome!=='Job')await page.getByLabel(/Final appointment category/).selectOption('Estimate');
  if(outcome==='Estimate'){
   await page.getByLabel(/Why did this remain an estimate/).selectOption('Other');await page.getByLabel('Outcome notes',{exact:true}).fill('Customer requested an estimate only');
   await page.getByLabel(/Why was no discount offered/).fill('No removal work was performed');
  }
  await page.getByRole('button',{name:'Continue to after photos',exact:true}).click();
  if(outcome==='Estimate'){
   await expect(page.getByText('Optional for this estimate. Continue to Payment.',{exact:true})).toBeVisible();
   await page.getByRole('button',{name:'Continue to payment',exact:true}).click();await page.getByRole('button',{name:'Review Closeout',exact:true}).click();
   await expect(page.getByRole('button',{name:'Submit checkout',exact:true})).toBeVisible();
   if(width===390)await page.screenshot({path:'/tmp/waypoint-estimate-before-only.png',fullPage:true});
   await page.getByRole('button',{name:'Submit checkout',exact:true}).click();await expect(page.getByRole('heading',{name:'Assignments',exact:true})).toBeVisible();
   assert.equal(posted.values.appointmentType,'Estimate');assert.equal(posted.values.estimateOutcome.explanation,'Customer requested an estimate only');assert.equal(posted.values.skipAfterPhotos,undefined);assert.deepEqual(posted.photoRequestIds,[]);
  }else{
   await page.getByRole('button',{name:'Submit after photos & continue',exact:true}).click();await expect(page.getByText('Add at least one after photo before continuing.',{exact:true})).toBeVisible();assert.equal(posted,null);
  }
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);assert.deepEqual(errors,[]);await context.close();
 }
 console.log('PASS: ordinary crew estimate closeout with before-only photos, explicit outcome/no-discount validation, unchanged Job after-photo gate, no bypass flag and 320/390/430px layout. Synthetic APIs only.');
 }finally{await browser.close();}
}
void main().catch(e=>{console.error(e);process.exitCode=1;});
