import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {build} from 'esbuild';
import {chromium,expect} from '@playwright/test';
const field=(value='',label='',options=[{value:'',label:''}])=>({value,label,options});
const fixture={photoEvidence:{appointmentId:'1234',urls:['https://junkware.junk-king.com/system/aspnet/local/media/before-1234-test.jpg']},truck:'Truck 1',truckOptions:[{value:'t',label:'Truck# 1'},{value:'u',label:'Truck# 6'}],status:field('1','Confirmed'),appointmentType:field('2','Job'),driver:{value:'d',label:'Fixture Driver'},drivers:[{value:'d',label:'Fixture Driver'}],navigators:[],navigatorOptions:[],loadQuantity:'1',loadSize:field(),loadPrices:[],loadPrice:'1200',bedloadQuantity:'',bedloadSize:field(),bedloadPrices:[],bedloadPrice:'',otherChargeOptions:[],otherCharges:[],discount:'',tip:'',jobCategory:field(),howHeard:field('ref','Referral',[{value:'ref',label:'Referral'}]),actualStartHour:field('12','12 PM',[{value:'12',label:'12 PM'}]),actualStartMinute:field('00','00',[{value:'00',label:'00'}]),actualEndHour:field('13','1 PM',[{value:'13',label:'1 PM'}]),actualEndMinute:field('00','00',[{value:'00',label:'00'}]),paymentMethods:[{value:'1',label:'Billed'},{value:'2',label:'Cash'},{value:'3',label:'Credit Card'},{value:'4',label:'Check'}],payments:[],balance:'1200.00',total:'$1,200.00'};

async function main(){
 const output=await build({stdin:{contents:`import React,{useState} from 'react';import{createRoot}from'react-dom/client';import Closeout from './desktop-ui/appointment-closeout';
 function App(){const [id,setId]=useState('1234'),[version,setVersion]=useState('1'),[shown,setShown]=useState(true),[busy,setBusy]=useState(false);const query=new URLSearchParams(location.search);return <div className="job-record-drawer"><button onClick={()=>setShown(x=>!x)}>Toggle drawer</button><button onClick={()=>setId('5678')}>Other appointment</button><button onClick={()=>setVersion('2')}>New schedule version</button><output data-testid="busy">{String(busy)}</output>{shown&&<Closeout key={id} prepareOnMount={!query.has('baseline')} job={{appointmentId:id,appointmentUrl:'https://example.invalid/?id='+id,status:query.has('cancelled')?'Cancelled':'Confirmed',appointmentType:'Job',truck:'Truck 1',recordId:id,version,customerName:'Fixture Customer',jkNumber:'Fixture'}} date="2026-10-16" saved={()=>{}} onBusyChange={setBusy}/>}<div className="closeout-footer-slot"/></div>};createRoot(document.getElementById('root')).render(<React.StrictMode><App/></React.StrictMode>);`,resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,outdir:'fixture',jsx:'automatic',alias:{react:process.cwd()+'/desktop-ui/node_modules/react','react-dom':process.cwd()+'/desktop-ui/node_modules/react-dom'}});
 const js=output.outputFiles.find(f=>f.path.endsWith('.js'))!.text,css=output.outputFiles.find(f=>f.path.endsWith('.css'))!.text;
 const server=createServer((req,res)=>{if(req.url==='/app.js'){res.setHeader('Content-Type','text/javascript');res.end(js);return;}res.setHeader('Content-Type','text/html');res.end(`<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body><div id="root"></div><script src="/app.js"></script></body></html>`);});
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
 const url=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
 const browser=await chromium.launch({headless:true});
 let writes=0;
 try{
 const timings=[];
 async function scenario(query='',delay=1000,width=390,failFirst=false){
  const page=await browser.newPage({viewport:{width,height:844}});let reads=0,completed=0;
  await page.route('**/*',async route=>{
   const request=route.request();
   if(!request.url().startsWith(url)){await route.abort();return;}
   if(request.method()!=='GET'){writes++;await route.abort();return;}
   if(!request.url().includes('/api/')){await route.continue();return;}
   assert.ok(request.url().includes('/api/desktop/schedule/closeout?appointmentId='));
   const number=++reads;
   await new Promise(resolve=>setTimeout(resolve,delay));
   const id=new URL(request.url()).searchParams.get('appointmentId');
   try{await route.fulfill(failFirst&&number===1?{status:502,json:{error:'Fixture unavailable'}}:{json:{closeout:{...fixture,loadPrice:id==='5678'?'5678':String(1200+number)},sourceVersion:String(number).repeat(64),canWrite:true}});}catch{/* drawer may have been closed */}
   completed++;
  });
  await page.goto(url+query);
  return {page,reads:()=>reads,completed:()=>completed};
 }
 for(const width of [390,1280]){
  const before=await scenario('?baseline',1000,width);
  assert.equal(before.reads(),0);
  let start=Date.now();await before.page.getByText('Appointment Closeout',{exact:true}).click();
  await expect(before.page.getByText('Loading current JunkWare closeout…',{exact:true})).toBeVisible();
  await expect(before.page.getByRole('textbox',{name:'Load price',exact:true})).toHaveValue('1201');
  const beforeMs=Date.now()-start;await before.page.close();
  const after=await scenario('',1000,width);
  await expect.poll(after.completed).toBe(1);
  await expect(after.page.getByTestId('busy')).toHaveText('false');
  assert.equal(await after.page.locator('details').evaluate(el=>(el as HTMLDetailsElement).open),false);
  start=Date.now();await after.page.getByText('Appointment Closeout',{exact:true}).click();
  await expect(after.page.getByRole('textbox',{name:'Load price',exact:true})).toHaveValue('1201');
  const afterMs=Date.now()-start;
  assert.equal(after.reads(),1,'Ready preparation opens without another source request');
  assert.ok(afterMs<beforeMs-500,'Prepared opening removes the simulated network delay');
  await after.page.getByRole('textbox',{name:'Load price',exact:true}).fill('42');
  await after.page.locator('summary').click();await after.page.locator('summary').click();
  await expect(after.page.getByRole('textbox',{name:'Load price',exact:true})).toHaveValue('42');
  assert.equal(after.reads(),1,'Collapsing preserves edits and does not refetch');
  await after.page.getByRole('button',{name:'Reload from JunkWare',exact:true}).click();
  await expect(after.page.getByRole('textbox',{name:'Load price',exact:true})).toHaveValue('1202');
  assert.equal(after.reads(),2,'Explicit reload bypasses preparation');
  timings.push({width,sourceDelayMs:1000,beforeMs,preparedMs:afterMs});await after.page.close();
 }
 const early=await scenario();
 await expect.poll(early.reads).toBe(1);
 await early.page.locator('summary').click();
 await expect(early.page.getByText('Loading current JunkWare closeout…',{exact:true})).toBeVisible();
 await expect(early.page.getByRole('textbox',{name:'Load price',exact:true})).toHaveValue('1201');
 assert.equal(early.reads(),1,'A tap during preparation joins the pending request');await early.page.close();
 const immediate=await scenario();
 await immediate.page.locator('summary').evaluate(el=>(el as HTMLElement).click());
 await expect(immediate.page.getByRole('textbox',{name:'Load price',exact:true})).toHaveValue('1201');
 assert.equal(immediate.reads(),1,'A tap before the dwell timer suppresses speculative duplication');await immediate.page.close();
 const failed=await scenario('',50,390,true);
 await expect.poll(failed.completed).toBe(1);
 await failed.page.locator('summary').click();
 await expect(failed.page.getByRole('textbox',{name:'Load price',exact:true})).toHaveValue('1202');
 assert.equal(failed.reads(),2);await failed.page.close();
 const switching=await scenario('',500);
 await expect.poll(switching.reads).toBe(1);
 await switching.page.getByRole('button',{name:'Other appointment',exact:true}).click();
 await expect.poll(switching.completed).toBe(2);
 await switching.page.locator('summary').click();
 await expect(switching.page.getByRole('textbox',{name:'Load price',exact:true})).toHaveValue('5678');
 assert.equal(switching.reads(),2,'Switching appointments discards the prior pending payload');await switching.page.close();
 const version=await scenario('',50);
 await expect.poll(version.completed).toBe(1);
 await version.page.getByRole('button',{name:'New schedule version',exact:true}).click();
 await expect.poll(version.completed).toBe(2);
 await version.page.locator('summary').click();
 await expect(version.page.getByRole('textbox',{name:'Load price',exact:true})).toHaveValue('1202');await version.page.close();
 const dismissed=await scenario('',50);
 await dismissed.page.getByRole('button',{name:'Toggle drawer',exact:true}).evaluate(el=>(el as HTMLButtonElement).click());
 await dismissed.page.waitForTimeout(250);assert.equal(dismissed.reads(),0,'Quick drawer dismissal avoids the speculative read');await dismissed.page.close();
 const pendingFailure=await scenario('',500,390,true);
 await expect.poll(pendingFailure.reads).toBe(1);
 await pendingFailure.page.locator('summary').click();
 await expect(pendingFailure.page.getByText('Fixture unavailable',{exact:true})).toBeVisible();
 await expect(pendingFailure.page.getByTestId('busy')).toHaveText('false');
 await pendingFailure.page.getByRole('button',{name:'Retry loading closeout',exact:true}).click();
 await expect(pendingFailure.page.getByRole('textbox',{name:'Load price',exact:true})).toHaveValue('1202');await pendingFailure.page.close();
 const cancelled=await scenario('?cancelled',50);
 await cancelled.page.waitForTimeout(250);assert.equal(cancelled.reads(),0,'Cancelled appointments never prepare');await cancelled.page.close();
 assert.equal(writes,0,'Preparation and every opening test made no operational writes');
 console.log(JSON.stringify({timings,writes,passed:['ready and pending opening','early click','background does not lock drawer','reload','draft preservation','failed read retry','appointment isolation','schedule version invalidation','quick dismissal','visible failure and explicit retry','cancelled exclusion','React StrictMode']},null,2));
 }finally{await browser.close();await new Promise<void>(resolve=>server.close(()=>resolve()));}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
