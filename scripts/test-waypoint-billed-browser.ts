import assert from 'node:assert/strict';
import path from 'node:path';
import {build} from 'esbuild';
import {chromium,expect} from '@playwright/test';
import {fixture} from './fixtures/crew-closeout';
async function main(){
 const repo=process.cwd(),origin='http://127.0.0.1:39992';
 const bundle=await build({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import App from './components/WaypointApp';import './app/ops-styles.css';createRoot(document.getElementById('root')).render(<App/>);`,resolveDir:repo,loader:'tsx'},absWorkingDir:repo,bundle:true,write:false,outdir:'fixture',jsx:'automatic',define:{'process.env.NODE_ENV':'"production"'},alias:{'@':repo,react:path.join(repo,'node_modules/react'),'react-dom':path.join(repo,'node_modules/react-dom')}});
 const js=bundle.outputFiles.find(f=>f.path.endsWith('.js'))!.text,css=bundle.outputFiles.find(f=>f.path.endsWith('.css'))!.text;
 const browser=await chromium.launch({headless:true});
 try{for(const width of [320,390,430])for(const manager of [false,true])for(const category of ['Job','Estimate']){
  const context=await browser.newContext({viewport:{width,height:900},serviceWorkers:'block'}),page=await context.newPage();let posted:any=null,posts=0;const errors:string[]=[];
  page.on('pageerror',e=>errors.push(e.message));
  const phone={deviceId:'synthetic-phone',truck:'Truck 6',label:'Synthetic phone'},date='2026-10-16';
  const job={assignmentId:'synthetic-assignment',appointmentId:'900001',date,jkNumber:'SYNTHETIC-01',customerName:'Synthetic billed customer',address:'100 Example Street',appointmentTime:'9 AM',junkItems:[],appointmentNotes:[],driver:'Sample Driver',navigator:'Sample Navigator',status:'Confirmed',appointmentType:'Job'};
  await page.route('**/*',async route=>{
   const req=route.request(),u=new URL(req.url()),send=(body:unknown,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)});
   if(u.origin!==origin)return route.abort();
   if(u.pathname==='/bundle.js')return route.fulfill({contentType:'text/javascript',body:js});
   if(u.pathname==='/')return route.fulfill({contentType:'text/html',body:`<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0}${css}</style></head><body><div id="root"></div><script src="/bundle.js"></script></body></html>`});
   if(!u.pathname.startsWith('/api/'))return route.abort();
   if(u.pathname.endsWith('/session'))return send({phone,manager});
   if(u.pathname.endsWith('/manager')){assert.equal(req.method(),'GET');return send({date,phone,appointments:[],trucks:['Truck 6'],roster:[]});}
   if(u.pathname.endsWith('/day'))return send({phone,date,day:{date,version:1,truck:phone.truck,responsible:'Sample Driver',driver:'Sample Driver',navigators:['Sample Navigator']},inspection:{status:'ready'},trucks:[phone.truck],roster:['Sample Driver','Sample Navigator']});
   if(u.pathname.endsWith('/current'))return send({state:'assigned',truck:phone.truck,job,jobs:[job,{...job,assignmentId:'saved-billed',appointmentId:'900002',status:'Completed',closedTotal:450,closeout:{loadQuantity:1,loadSize:'Full truck',loadPrice:450,bedloadQuantity:0,bedloadSize:'',bedloadPrice:0,otherCharges:[],discount:0,tip:0,total:450,payments:[{method:'Billed',detail:'',amount:450}],balance:0}}],updateToken:'fixture'});
   if(u.pathname.endsWith('/updates'))return send({updateToken:'fixture'});
   if(u.pathname.endsWith('/photos')){assert.equal(req.method(),'GET');return send({photos:['before','after'].map(category=>({requestId:'saved-'+category,category,status:'verified'}))});}
   if(u.pathname.endsWith('/closeout')){
    if(req.method()==='POST'){posts++;posted=req.postDataJSON();return send({receipt:{requestId:posted.requestId,status:'pending',action:'closeout',message:'Synthetic accepted'}},202);}
    if(u.searchParams.has('requestId'))return send({error:'No saved receipt'},404);
    return send({closeout:{...fixture,payments:[{description:'Billed',amount:'100.00'},{description:'Cash',amount:'50.00'}],paymentMethods:fixture.paymentMethods.map(m=>m.label==='Billed'?{...m,value:'source-bill-id'}:m),photoEvidence:{appointmentId:'900001',urls:['https://junkware.junk-king.com/system/aspnet/local/media/before-900001-fixture.jpg']}},sourceVersion:'fixture-source',sourceFieldsVersion:'a'.repeat(64),jobVersion:'fixture-job',crewVersion:1,crewDefaults:{version:1,driver:fixture.driver,navigators:fixture.navigators},canWrite:true});
   }
   throw Error('Unexpected API '+req.method()+' '+u.pathname);
  });
  await page.goto(origin);
  if(manager){await expect(page.getByRole('heading',{name:'Waypoint manager',exact:true})).toBeVisible();await page.getByRole('button',{name:'Crew workflow',exact:true}).click();}
  await expect(page.getByText('Billed · job revenue. Billed entries are not collected payments.',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'View assignment',exact:true}).first().click();await page.getByRole('button',{name:'START',exact:true}).click();
  await page.getByRole('button',{name:'Submit before photos & continue',exact:true}).click();
  if(category==='Estimate'){
   await page.getByLabel(/Final appointment category/).selectOption('Estimate');await page.getByLabel(/Why did this remain an estimate/).selectOption('Other');await page.getByLabel('Outcome notes',{exact:true}).fill('Estimate only');await page.getByLabel(/Why was no discount offered/).fill('No work performed');
  }
  await page.getByRole('button',{name:'Continue to after photos',exact:true}).click();
  await page.getByRole('button',{name:category==='Estimate'?'Continue to payment':'Submit after photos & continue',exact:true}).click();
  await page.getByLabel('Record payment or Billed',{exact:true}).check();
  if(category==='Estimate'){await expect(page.getByRole('radio',{name:'Billed',exact:true})).toBeDisabled();await expect(page.getByText('Billed is available for completed jobs. Estimates remain quotes; choose Job only when work was completed.',{exact:true})).toBeVisible();assert.equal(posts,0);await context.close();continue;}
  await page.getByRole('radio',{name:'Billed',exact:true}).check();
  await expect(page.getByLabel('Billed amount',{exact:true})).toHaveValue('300.00');
  await expect(page.getByLabel('Amount to bill')).toContainText('Already billed · unpaid');
  await expect(page.getByLabel('Amount to bill')).toContainText('Already collected');
  await expect(page.getByLabel('Card last four',{exact:true})).toHaveCount(0);await expect(page.getByLabel('Check number',{exact:true})).toHaveCount(0);
  await page.getByRole('radio',{name:'Cash',exact:true}).check();await expect(page.getByLabel('Payment amount',{exact:true})).toHaveValue('400.00');
  await page.getByRole('radio',{name:'Billed',exact:true}).check();await expect(page.getByLabel('Billed amount',{exact:true})).toHaveValue('300.00');
  await page.getByLabel('Tip',{exact:true}).fill('20');await expect(page.getByLabel('Billed amount',{exact:true})).toHaveValue('320.00');
  await page.getByLabel('Billed amount',{exact:true}).fill('310.00');await page.getByLabel('Tip',{exact:true}).fill('30');await expect(page.getByLabel('Billed amount',{exact:true})).toHaveValue('310.00');
  await page.getByRole('button',{name:'Review Closeout',exact:true}).click();
  await expect(page.getByLabel('Closeout review')).toContainText('Billed receivable to record: Billed · $310.00');
  await expect(page.getByLabel('Closeout review')).toContainText('Payment remains owed.');
  await expect(page.getByLabel('Closeout review')).toContainText('Unbilled amount $330.00');
  await expect(page.getByLabel('Closeout review')).toContainText(category==='Estimate'?'This remains an estimate quote, not job revenue.':'Completed job revenue is counted once');
  assert.equal(posts,0,'Review does not save');assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  if(width===390&&!manager&&category==='Job')await page.screenshot({path:'/tmp/waypoint-billed-review.png',fullPage:true});
  await page.getByRole('button',{name:'Submit checkout',exact:true}).click();await expect(page.getByRole('heading',{name:'Assignments',exact:true})).toBeVisible();
  assert.equal(posts,1);assert.equal(posted.values.appointmentType,category);assert.deepEqual(posted.values.addPayment,{methodId:'source-bill-id',amount:'310.00',reference:''});assert.equal(posted.values.targetStatus,'8');assert.equal(posted.values.truck,'Truck 6');assert.deepEqual(errors,[]);
  await context.close();
 }
 console.log('PASS: crew and manager Billed closeout at 320/390/430px; source method ID, unpaid/revenue review, prior billing versus collections, method switching, partial amount, no charge/reference, estimate billing blocked, one durable submission. Mocked APIs only.');
 }finally{await browser.close();}
}
void main().catch(e=>{console.error(e);process.exitCode=1;});
