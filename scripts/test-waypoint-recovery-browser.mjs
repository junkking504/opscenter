import assert from 'node:assert/strict';import path from 'node:path';import fs from 'node:fs';
import {build} from 'esbuild';import {chromium,expect} from '@playwright/test';
const root=process.cwd();
const fixture=`
const scenario=new URLSearchParams(location.search).get('fixture')||'recover';
window.fixture={mode:scenario==='unknown'?'unknown':scenario==='updates'?'ready':'anonymous',gets:0,posts:0,unexpected:[],failRead:false,interrupted:false};
const phone={deviceId:'fictional-phone',truck:'Truck 4',label:'Fictional phone'};
window.fetch=async(url,options={})=>{
 const u=new URL(url,location.href),f=window.fixture;let status=200,body;
 if(u.pathname==='/api/crew-jobs/session'&&options.method==='POST'){
  f.posts++;const input=JSON.parse(options.body);if(input.action!=='enroll')throw Error('No code sending allowed');
  f.mode='ready';if(f.interrupted)throw Error('Synthetic lost enrollment response');
  status=409;body={code:'already_connected',error:'This phone is already connected. Check connection to continue.'};
 }else if(u.pathname==='/api/crew-jobs/session'&&u.search)body={choices:[{id:'fictional',label:'Fictional Driver'}]};
 else if(u.pathname==='/api/crew-jobs/session'){
  f.gets++;if(f.mode==='unknown'||f.failRead){status=503;body={error:'Synthetic lookup unavailable'};}
  else if(f.mode==='anonymous'){status=401;body={error:'Setup required'};}else body={phone,manager:false};
 }else if(u.pathname==='/api/crew-jobs/manager-session')body={manager:scenario==='updates'};
 else if(u.pathname==='/api/crew-jobs/day')body={phone,date:'2026-10-24',day:scenario==='updates'?{date:'2026-10-24',version:1,truck:'Truck 4',driver:'Fictional Driver',navigators:[]}:null,roster:['Fictional Driver'],trucks:['Truck 4'],inspection:{status:'ready'}};
 else if(u.pathname==='/api/crew-jobs/current')body={state:'assigned',job:null,jobs:[{appointmentId:'101',jkNumber:'JK101',customerName:'Fictional Crew Customer',phone:'',address:'Fictional address',date:'2026-10-24',appointmentTime:'10 AM',status:'Confirmed',appointmentNotes:[],junkItems:[],driver:'Fictional Driver',navigator:'',truck:'Truck 4',readOnly:true}],truck:'Truck 4',observedAt:null,message:'No fictional assignments',updateToken:'one'};
 else if(u.pathname==='/api/crew-jobs/updates')body={updateToken:'one'};
 else if(u.pathname==='/api/crew-jobs/notifications'&&!options.method)body={available:false,enabled:false,updates:[{id:'12345678-1234-4234-8234-123456789012',counts:{timing:1,removed:1,messages:1},changes:[{appointmentId:'101',kind:'time',before:'8 AM',after:'10 AM'},{appointmentId:'102',kind:'removed'}],created_at:'2026-10-24T14:00:00Z'}],messages:[{id:'fictional-message',body:'Fictional office instruction',created_at:'2026-10-24T14:00:00Z'}]};
 else {f.unexpected.push(u.pathname);throw Error('Unexpected fixture API '+u.pathname);}
 return {ok:status===200,status,json:async()=>body};
};`;
const bundle=await build({stdin:{contents:`import React from 'react';import{createRoot}from'react-dom/client';import './app/globals.css';import App from './components/WaypointApp';${fixture}\ncreateRoot(document.getElementById('root')).render(<App/>);`,resolveDir:root,loader:'tsx'},bundle:true,write:false,outdir:'out',jsx:'automatic',loader:{'.png':'dataurl'},nodePaths:[path.join(root,'desktop-ui/node_modules')],define:{'process.env.NODE_ENV':'"production"'}});
const html=`<!doctype html><title>Fictional Waypoint recovery test</title><meta name="viewport" content="width=device-width,initial-scale=1"><style>${bundle.outputFiles.find(f=>f.path.endsWith('.css')).text}</style><div id="root"></div><script>${bundle.outputFiles.find(f=>f.path.endsWith('.js')).text}</script>`;
const browser=await chromium.launch({headless:true});let cases=0;
try{
 for(const width of [320,390,1280]){
  const context=await browser.newContext({viewport:{width,height:844}});
  await context.route('**/*',route=>{if(route.request().isNavigationRequest())return route.fulfill({status:200,contentType:'text/html',body:html});const url=new URL(route.request().url()),file=path.resolve(root,'public','.'+url.pathname);if(file.startsWith(path.join(root,'public')+path.sep)&&fs.existsSync(file)&&fs.statSync(file).isFile())return route.fulfill({path:file});return route.abort();});
  for(const scenario of ['unknown','recover','readback','interrupted','updates']){
   const page=await context.newPage();await page.goto('https://waypoint.example.invalid/crew-jobs?fixture='+scenario+(scenario==='updates'?'&view=updates&update=12345678-1234-4234-8234-123456789012':''));
   if(scenario==='unknown'){
    await expect(page.getByRole('button',{name:'Retry access check'})).toBeVisible();await expect(page.getByRole('heading',{name:'Connect Your Phone'})).toHaveCount(0);
    await page.evaluate(()=>window.fixture.mode='ready');await page.getByRole('button',{name:'Retry access check'}).click();await expect(page.getByRole('button',{name:'Refresh setup'})).toBeVisible();
   }else if(scenario==='updates'){
    await expect(page.getByRole('heading',{name:'Recent Truck Updates'})).toBeVisible();await expect(page.getByText('Appointment time or route order changed',{exact:true})).toBeVisible();
    await expect(page.getByText('Opened from notification',{exact:true})).toBeVisible();
    await expect(page.getByText('Time changed: 8 AM → 10 AM',{exact:true})).toBeVisible();
    await page.getByRole('button',{name:'Open JK101',exact:true}).click();await expect(page.getByRole('heading',{name:'Fictional Crew Customer',exact:true})).toBeVisible();
    await page.reload();await expect(page.getByText('Opened from notification',{exact:true})).toBeVisible();
    if(process.env.WAYPOINT_PUSH_SCREENSHOTS){await fs.promises.mkdir(process.env.WAYPOINT_PUSH_SCREENSHOTS,{recursive:true});await page.screenshot({path:path.join(process.env.WAYPOINT_PUSH_SCREENSHOTS,'update-context-'+width+'.png'),fullPage:true});}
    await expect(page.getByRole('button',{name:'Crew workflow',exact:true})).toHaveAttribute('aria-pressed','true');
    await page.getByRole('button',{name:'Read office messages'}).click();await expect(page.getByText('Fictional office instruction',{exact:true})).toBeVisible();
    await page.reload();await expect(page.getByRole('heading',{name:'Recent Truck Updates'})).toBeVisible();
   }else{
    await expect(page.getByRole('heading',{name:'Connect Your Phone'})).toBeVisible();
    await page.getByRole('button',{name:'Already have a code?'}).click();await page.getByLabel('Verification code',{exact:true}).fill('000000');
    if(scenario==='readback')await page.evaluate(()=>window.fixture.failRead=true);
    if(scenario==='interrupted')await page.evaluate(()=>window.fixture.interrupted=true);
    // A repeated event while the request is in flight must not enroll twice.
    await page.getByRole('button',{name:'Connect phone',exact:true}).evaluate(button=>{const form=button.closest('form');form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));});
    if(scenario==='readback'){
     await expect(page.getByRole('button',{name:'Check connection',exact:true})).toBeVisible();await expect(page.getByRole('heading',{name:'Connect Your Phone'})).toHaveCount(0);
     assert.ok(await page.evaluate(()=>localStorage.getItem('ops-crew-phone-enrollment-v1')),'Recovery key retained on readback failure');
     await page.evaluate(()=>window.fixture.failRead=false);await page.getByRole('button',{name:'Check connection',exact:true}).click();
    }else if(scenario==='interrupted'){
     await expect(page.getByRole('alert')).toContainText('Synthetic lost enrollment response');await page.getByText('Need help connecting?',{exact:true}).click();await page.getByRole('button',{name:'Check connection',exact:true}).click();
    }
    await expect(page.getByRole('button',{name:'Refresh setup'})).toBeVisible();assert.equal(await page.evaluate(()=>window.fixture.posts),1);assert.equal(await page.evaluate(()=>localStorage.getItem('ops-crew-phone-enrollment-v1')),null);
   }
   assert.deepEqual(await page.evaluate(()=>window.fixture.unexpected),[]);
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'No horizontal overflow at '+width);
   cases++;await page.close();
  }
  await context.close();
 }
 console.log('PASS '+cases+' API-mocked browser cases: unknown access/retry, 409 read recovery, interrupted enrollment, repeated submit, preserved recovery key, manager notification entry/context/refresh, 320/390/1280px. No sign-in, OTP, real push or external request.');
}finally{await browser.close();}
