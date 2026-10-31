import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {build} from 'esbuild';
import {chromium,expect} from '@playwright/test';

const result=await build({stdin:{contents:`
import React,{useState} from 'react';import{createRoot}from'react-dom/client';
import Request from './app/crew-jobs/request-setup-code';import Switch from './app/crew-jobs/switch-truck';
import styles from './app/crew-jobs/phone-access.module.css';
function App(){const[busy,setBusy]=useState(false);return <main className={styles.page+' '+styles.connectionPage}><div className={styles.content}>{location.pathname==='/switch'?<Switch day={{truck:'Truck 9',driver:'Fictional driver',navigators:[]}} trucks={['Truck 9','Truck 1','Truck 2']} pending={null} onDone={()=>window.done=true} onCancel={()=>{}} onBusy={setBusy}/>:<Request busy={busy} onBusy={setBusy} hasPendingCode={false} onChoosePhone={()=>{}} connectionError="" onCheckConnection={()=>{}}><form className={styles.form}><label>Verification code<input inputMode="numeric"/></label><button className={styles.primary}>Connect phone</button></form></Request>}</div></main>}
createRoot(document.getElementById('root')).render(<App/>);`,resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,outdir:'out',format:'iife',define:{'process.env.NODE_ENV':'"test"'}});
const html=`<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1"><style>${result.outputFiles.find(f=>f.path.endsWith('.css')).text}</style><div id="root"></div><script>${result.outputFiles.find(f=>f.path.endsWith('.js')).text}</script>`;
const browser=await chromium.launch({headless:true});let cases=0;
try{
 for(const width of [320,390,1280]){
  const context=await browser.newContext({viewport:{width,height:844}});
  const page=await context.newPage();let sends=[],mode='cancelled',switchCalls=[],confirmLost=true;
  await page.addInitScript(()=>{
   if(!sessionStorage.getItem('initialized')){localStorage.setItem('waypoint-setup-request-v1',JSON.stringify({choiceId:'fixture',requestId:'saved-fixture',createdAt:Date.now()-2*60000}));sessionStorage.setItem('initialized','yes');}
  });
  await page.route('**/*',async route=>{
   const r=route.request(),url=new URL(r.url());
   if(url.pathname==='/code'||url.pathname==='/switch')return route.fulfill({contentType:'text/html',body:html});
   if(url.pathname==='/api/crew-jobs/session'){
    if(r.method()==='GET')return route.fulfill({json:{choices:[{id:'fixture',label:'Fictional phone'}]}});
    const b=r.postDataJSON();assert.equal(b.action,'request-code');sends.push(b);
    if(mode==='cancelled')return route.fulfill({status:409,json:{error:'This setup code was cancelled. Request a new code or contact your manager.',canRequestNewCode:true}});
    return route.fulfill({json:{message:'The send is not yet confirmed. Check WhatsApp first, then use Check send status.',canRequestNewCode:false}});
   }
   if(url.pathname==='/api/crew-jobs/switch-truck'){
    const b=r.method()==='POST'?r.postDataJSON():null;switchCalls.push({query:url.search,body:b});
    if(url.searchParams.get('truck')==='Truck 1')return route.fulfill({status:409,json:{error:'That truck has a current or upcoming dispatch assignment. Ask dispatch to release it first.'}});
    if(url.search)return route.fulfill({json:{preview:{from:'Truck 9',to:'Truck 2',count:0,fingerprint:'fixture',inspection:{status:'ready'}}}});
    if(b?.action==='confirm'&&confirmLost){confirmLost=false;return route.abort('failed');}
    return route.fulfill({json:{switch:{requestId:'fixture-switch',from:'Truck 9',to:'Truck 2',status:b?'complete':'moving',message:'Fixture switch',total:0,moved:0}}});
   }
   throw Error('Unexpected fixture request: '+url.pathname);
  });
  await page.goto('https://waypoint.fixture/code');
  const newCode=page.getByRole('button',{name:'Request a new code',exact:true});
  await expect(newCode).toBeVisible();assert.equal(await newCode.evaluate(b=>Boolean(b.closest('details'))),false);
  const inputBox=await page.getByLabel('Verification code').boundingBox(),buttonBox=await newCode.boundingBox(),steps=await page.getByRole('list',{name:'Start your day'}).boundingBox();
  assert.ok(buttonBox.y>inputBox.y && buttonBox.y<steps.y,'New-code action directly follows code entry, before setup steps');assert.ok(buttonBox.height>=44);
  await page.getByRole('button',{name:'Check send status',exact:true}).click();await expect(page.getByRole('alert')).toContainText('cancelled');
  await newCode.click();await expect(page.getByRole('button',{name:'Send setup code',exact:true})).toBeVisible();assert.equal(sends.length,1,'Immediate replacement preparation never sends automatically');
  mode='uncertain';await page.getByRole('button',{name:'Send setup code',exact:true}).evaluate(button=>{const form=button.closest('form');form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));});assert.notEqual(sends[1].requestId,'saved-fixture');await expect(page.getByRole('status')).toContainText('not yet confirmed');
  await newCode.click();await expect(page.getByRole('alert')).toContainText('Check send status first');assert.equal(sends.length,2);
  await page.reload();await page.getByRole('button',{name:'Check send status',exact:true}).click();assert.equal(sends[2].requestId,sends[1].requestId,'Reload retains uncertain request identity');
  if(process.env.WAYPOINT_CODE_TRUCK_SCREENSHOTS){fs.mkdirSync(process.env.WAYPOINT_CODE_TRUCK_SCREENSHOTS,{recursive:true});await page.screenshot({path:path.join(process.env.WAYPOINT_CODE_TRUCK_SCREENSHOTS,`code-${width}.png`),fullPage:true});}
  await page.evaluate(()=>localStorage.removeItem('waypoint-setup-request-v1'));await page.reload();await page.getByRole('button',{name:'Already have a code?'}).click();await expect(newCode).toBeVisible();await newCode.click();await expect(page.getByRole('combobox',{name:'Phone',exact:true})).toBeVisible();
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));cases++;

  await page.goto('https://waypoint.fixture/switch');
  await page.getByRole('combobox').selectOption('Truck 1');await page.getByRole('button',{name:'Review switch'}).click();await expect(page.getByRole('alert')).toContainText('dispatch assignment');
  await expect(page.getByRole('button',{name:'Check saved switch'})).toHaveCount(0);
  await page.getByRole('combobox').selectOption('Truck 2');await expect(page.getByRole('alert')).toHaveCount(0);
  await page.getByRole('button',{name:'Review switch'}).click();await page.getByRole('button',{name:'Move our unfinished jobs to Truck 2'}).click();await expect(page.getByRole('button',{name:'Check saved switch'})).toBeVisible();
  await page.getByRole('button',{name:'Check saved switch'}).click();await expect.poll(()=>page.evaluate(()=>window.done)).toBe(true);
  assert.equal(switchCalls.filter(c=>c.body?.action==='confirm').length,1,'Lost confirmation never resubmits');
  assert.equal(switchCalls.at(-2).query,'','Recovery reads saved switch without selected-truck preview');assert.equal(switchCalls.at(-1).body.action,'continue');
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));cases++;
  await context.close();
 }
 console.log('PASS '+cases+' API-mocked browser scenarios at 320/390/1280px: prominent recovery, immediate cancelled replacement, reload/uncertain idempotency, manual entry, preview error and lost-confirmation recovery. No live requests.');
}finally{await browser.close();}
