import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import {build} from 'esbuild';
import {chromium,expect} from '@playwright/test';

async function main(){
 const repo=process.cwd(),origin='http://127.0.0.1:39993';
 const bundle=await build({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import App from './components/WaypointApp';import './app/ops-styles.css';createRoot(document.getElementById('root')).render(<App/>);`,resolveDir:repo,loader:'tsx'},absWorkingDir:repo,bundle:true,loader:{'.png':'dataurl'},write:false,outdir:'fixture',jsx:'automatic',define:{'process.env.NODE_ENV':'"production"'},alias:{'@':repo,react:path.join(repo,'node_modules/react'),'react-dom':path.join(repo,'node_modules/react-dom')}});
 const js=bundle.outputFiles.find(f=>f.path.endsWith('.js'))!.text,css=bundle.outputFiles.find(f=>f.path.endsWith('.css'))!.text;
 const date=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Chicago'}).format(new Date());
 const phone={deviceId:'synthetic-manager',truck:'Truck 1',label:'Fixture phone'};
 const jobs=[1,9].map(n=>({recordId:`${date}:appointment:${n}`,appointmentId:String(n),version:'v1',jkNumber:`SAMPLE-${n}`,customerName:`Synthetic customer ${n}`,address:'100 Example St',appointmentTime:'9:00 AM',status:'Confirmed',truck:`Truck ${n}`,appointmentNotes:[],driver:'Fixture Driver',navigator:'',appointmentStartMinutes:540,appointmentEndMinutes:600,hasScheduledTime:true}));
 const browser=await chromium.launch({headless:true});
 try{for(const width of [320,390,430,1280])for(const identity of ['account','phone','both','employee','anonymous','failure','slow','phone-failure']){
  console.log(`Checking ${width}px ${identity}`);
  const context=await browser.newContext({viewport:{width,height:900},serviceWorkers:'block'}),page=await context.newPage();
  const errors:string[]=[],unexpected:string[]=[],writes:string[]=[];let failed=identity==='failure',managerReads=0,phoneReads=0;
  let releaseSlow:()=>void=()=>{};const slow=new Promise<void>(resolve=>{releaseSlow=resolve;});
  page.on('pageerror',e=>errors.push(e.message));
  const account=['account','both','slow','phone-failure','failure'].includes(identity),managerPhone=['phone','both'].includes(identity);
  await page.route('**/*',async route=>{
   const req=route.request(),u=new URL(req.url());
   const send=(body:unknown,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)});
   if(u.origin!==origin)return route.abort();
   if(u.pathname==='/bundle.js')return route.fulfill({contentType:'text/javascript',body:js});
   if(u.pathname==='/crew-jobs')return route.fulfill({contentType:'text/html',body:`<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0}${css}</style></head><body><div id="root"></div><script src="/bundle.js"></script></body></html>`});
   if(/^\/crew-jobs\/(icons\/[a-z-]+\.svg|waypoint-crown-road-v1-192\.png)$/.test(u.pathname))return route.fulfill({contentType:u.pathname.endsWith('.svg')?'image/svg+xml':'image/png',body:fs.readFileSync(path.join(repo,'public',u.pathname))});
   if(!u.pathname.startsWith('/api/'))return route.abort();
   if(req.method()!=='GET'){writes.push(u.pathname);return send({error:'Mutations prohibited in entry test'},403);}
   if(u.pathname==='/api/crew-jobs/manager-session'){if(identity==='slow')await slow;return send(failed?{error:'Unavailable'}:{manager:account},failed?503:200);}
   if(u.pathname==='/api/crew-jobs/session'){
    if(u.searchParams.has('setup'))return send({choices:[]});
    phoneReads++;
    if(identity==='phone-failure')return send({error:'Unavailable'},503);
    return managerPhone||identity==='employee'?send({phone,manager:managerPhone}):send({error:'Not connected'},401);
   }
   if(u.pathname==='/api/crew-jobs/day')return send({date,phone,day:null,roster:['Fixture Driver'],trucks:['Truck 1','Truck 9'],inspection:null,switch:null});
   if(u.pathname==='/api/crew-jobs/manager'){
    managerReads++;assert.ok(account||managerPhone,'employee never requests manager data');
    const resource=u.searchParams.get('resource');
    if(resource==='schedule')return send({date:u.searchParams.get('date'),observedAt:new Date().toISOString(),appointments:jobs,phone:managerPhone?phone:null,day:null,roster:['Fixture Driver'],trucks:['Truck 1','Truck 9']});
    if(resource==='phones')return send({phones:[]});
   }
   unexpected.push(u.pathname);return send({error:'Unexpected request'},404);
  });
  await page.goto(origin+'/crew-jobs');
  if(identity==='slow'){
   await expect(page.getByText('Checking Waypoint access…')).toBeVisible();
   await expect(page.getByRole('heading',{name:'Connect Your Phone'})).toHaveCount(0);
   assert.equal(phoneReads,1,'crew workflow does not race initial account check');releaseSlow();
  }
  if(identity==='failure'){
   await expect(page.getByRole('button',{name:'Retry access check'})).toBeVisible();
   await expect(page.getByRole('heading',{name:'Connect Your Phone'})).toHaveCount(0);
   assert.equal(managerReads,0);failed=false;await page.getByRole('button',{name:'Retry access check'}).click();
  }
  if(account||managerPhone){
   await expect(page.getByRole('heading',{name:'Appointments',exact:true})).toBeVisible();
   for(const job of jobs)await expect(page.getByRole('button',{name:new RegExp(job.customerName)})).toBeVisible();
   await page.getByRole('button',{name:/Synthetic customer 9/}).click();
   await expect(page.getByRole('button',{name:'Edit appointment details'})).toBeVisible();
   await expect(page.getByText('Dispatch controls',{exact:true})).toBeVisible();
   await expect(page.getByText('Closeout and payment methods',{exact:true})).toHaveCount(managerPhone?1:0);
   await page.getByLabel(/^Action/).selectOption('reschedule');await expect(page.getByLabel('Destination date')).toBeVisible();
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,`${width} no overflow`);
   await page.getByRole('button',{name:'Back to all appointments'}).click();
   await page.getByRole('button',{name:'Phone access',exact:true}).click();await expect(page.getByRole('heading',{name:'Phone access',exact:true})).toBeVisible();
   await expect(page.getByText('Route Order',{exact:true})).toBeVisible();await expect(page.getByText('Enroll a company phone',{exact:true})).toBeVisible();
   await page.getByRole('button',{name:'New appointment',exact:true}).click();await expect(page.getByLabel('First name',{exact:true})).toBeVisible();
   await page.getByRole('button',{name:'Crew workflow',exact:true}).click();await expect(page.getByRole('heading',{name:'Appointments',exact:true})).toHaveCount(0);
   await page.getByRole('button',{name:'Manager',exact:true}).click();await expect(page.getByRole('heading',{name:'Appointments',exact:true})).toBeVisible();
   await page.reload();await expect(page.getByRole('heading',{name:'Appointments',exact:true})).toBeVisible();
   if(width===390&&identity==='account')await page.screenshot({path:'/tmp/waypoint-manager-entry-390.png',fullPage:true});
  }else{
   await expect(page.getByRole('link',{name:'Manager sign-in'})).toBeVisible();
   await expect(page.getByRole('button',{name:'Manager',exact:true})).toHaveCount(0);
   assert.equal(managerReads,0);
   await page.reload();await expect(page.getByRole('button',{name:'Manager',exact:true})).toHaveCount(0);
  }
  assert.deepEqual(writes,[]);assert.deepEqual(errors,[]);assert.deepEqual(unexpected,[]);await context.close();
 }
 console.log('PASS: 32 mocked browser cases: named/phone/dual managers, employees/anonymous, session errors/retry, delayed identity and failed phone lookup, manager capabilities, account-only closeout restriction, crew navigation, reload and 320/390/430/1280px. No real requests, grants or mutations.');
 }finally{await browser.close();}
}
void main().catch(error=>{console.error(error);process.exitCode=1;});
