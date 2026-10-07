import assert from 'node:assert/strict';
import path from 'node:path';
import {mkdir} from 'node:fs/promises';
import {build} from 'esbuild';
import {chromium,expect,type Page} from '@playwright/test';
import {fixture} from './fixtures/crew-closeout';

// Entire application requests are intercepted. No live origin or provider is used.
async function main(){
const artifacts=process.env.WAYPOINT_TEST_ARTIFACTS;if(artifacts)await mkdir(artifacts,{recursive:true});
const repo=process.cwd(),origin='http://127.0.0.1:39991';
const bundle=await build({stdin:{contents:`import './app/ops-styles.css';import React from 'react';import {createRoot} from 'react-dom/client';import App from './components/WaypointApp';import * as storage from './app/crew-jobs/photo-storage';import * as drafts from './desktop-ui/lib/closeout-drafts';window.fixtureStorage={...storage,...drafts};createRoot(document.getElementById('root')).render(<App/>);`,resolveDir:repo,loader:'tsx'},absWorkingDir:repo,bundle:true,write:false,outdir:'fixture',jsx:'automatic',define:{'process.env.NODE_ENV':'"production"'},alias:{'@':repo,react:path.join(repo,'node_modules/react'),'react-dom':path.join(repo,'node_modules/react-dom')}});
const js=bundle.outputFiles.find(file=>file.path.endsWith('.js'))!.text,css=bundle.outputFiles.find(file=>file.path.endsWith('.css'))!.text;
const browser=await chromium.launch({headless:true});
const phone={deviceId:'fixture-phone',truck:'Truck 6',label:'Fixture phone'},date='2026-10-06';
const oldId='fixture-schedule-B',newId='fixture-current-B',draftScope=`appointment:${date}:900002:original`;
const draftKey=`ops-crew-closeout:${phone.deviceId}:${draftScope}`,photoKey=`${phone.deviceId}:${draftScope}`,aliasKey=`ops-crew-closeout:${phone.deviceId}:${oldId}`;
const a={assignmentId:'fixture-A',appointmentId:'900001',date,jkNumber:'FIXTURE-A',customerName:'Fixture A',address:'',appointmentTime:'9–10 AM',junkItems:[],appointmentNotes:[],driver:'Sample Driver',navigator:'Sample Navigator',status:'Confirmed'};
const image='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aU1cAAAAASUVORK5CYII=';
async function setup({pendingA=false,width=390}:{pendingA?:boolean;width?:number}={}){
 const context=await browser.newContext({viewport:{width,height:900},serviceWorkers:'block'}),page=await context.newPage();page.setDefaultTimeout(10000);
 const state={completeA:false,reads:0,posts:[] as any[],photoPosts:0,receipt:null as any,mode:'pending',sourceChanged:false,crewVersion:1,denyReceipt:false,offlineLoads:false,photoReceipt:null as any,photoChecks:[] as string[],allowPhotoUploads:false,photoReceipts:new Map<string,any>(),uploadGates:[] as Array<()=>void>,holdPhotoHistory:false,holdUpdates:false,updateRequested:false,releaseUpdates:()=>{},updateToken:'one',errors:[] as string[]};
 page.on('pageerror',error=>state.errors.push(error.message));
 const source=()=>({...fixture,loadPrice:state.sourceChanged?'500':'400',photoEvidence:{appointmentId:'900002',urls:['https://junkware.junk-king.com/system/aspnet/local/media/sample-900002-before.jpg']}});
 const receiptA=()=>({requestId:'fixture-request-A',action:'closeout',status:state.completeA?'verified':'pending',message:'Fixture receipt'});
 if(pendingA)await context.addInitScript(h=>localStorage.setItem(`ops-crew-closeout:${h.deviceId}:${h.assignmentId}:handoff`,JSON.stringify(h)),{deviceId:phone.deviceId,assignmentId:a.assignmentId,requestId:'fixture-request-A',createdAt:Date.now(),phase:'accepted',payload:{requestId:'fixture-request-A'},photoIds:[],acceptedPhotos:{},message:'Fixture pending',receipt:receiptA()});
 await context.route('**/*',async route=>{
  const req=route.request(),url=new URL(req.url()),send=(body:unknown,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)});
  if(url.origin!==origin)return route.abort();
  if(url.pathname.startsWith('/fonts/'))return route.abort();
  if(url.pathname==='/crew-jobs/waypoint-crown-road-v1-192.png')return route.fulfill({contentType:'image/png',path:path.join(repo,'public/crew-jobs/waypoint-crown-road-v1-192.png')});
  if(url.pathname==='/bundle.js')return route.fulfill({contentType:'text/javascript',body:js});
  if(url.pathname==='/')return route.fulfill({contentType:'text/html',body:`<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0}${css}</style></head><body><div id="root"></div><script src="/bundle.js"></script></body></html>`});
  if(url.pathname==='/api/crew-jobs/session')return send({phone});
  if(url.pathname==='/api/crew-jobs/day')return send({phone,date,day:{date,version:state.crewVersion,truck:phone.truck,driver:'Sample Driver',navigators:['Sample Navigator']},inspection:{status:'ready'},trucks:['Truck 6'],roster:['Sample Driver','Sample Navigator']});
  if(url.pathname==='/api/crew-jobs/current'){state.reads++;return send({state:'assigned',truck:phone.truck,job:a,jobs:[a,{...a,appointmentId:'900002',assignmentId:state.completeA?newId:oldId,draftScope,draftAssignmentIds:[oldId,newId],jkNumber:'FIXTURE-B',customerName:'Fixture B'}],updateToken:state.updateToken});}
  if(url.pathname==='/api/crew-jobs/updates'){
   if(state.holdUpdates){state.updateRequested=true;await new Promise<void>(resolve=>{state.releaseUpdates=resolve;});}
   return send({updateToken:state.updateToken});
  }
  if(url.pathname==='/api/crew-jobs/photos'){
   if(req.method()!=='GET'){
    state.photoPosts++;
    if(!state.allowPhotoUploads)return send({error:'Unexpected photo write'},500);
    const body=req.postDataJSON();await new Promise<void>(resolve=>state.uploadGates.push(resolve));
    const receipt={requestId:body.requestId,category:body.category,status:'pending'};state.photoReceipts.set(body.requestId,receipt);return send({receipt},202);
   }
   if(state.holdPhotoHistory && !url.searchParams.has('requestId'))return;
   if(url.searchParams.has('requestId')){state.photoChecks.push(url.searchParams.get('assignmentId')!);const receipt=state.photoReceipts.get(url.searchParams.get('requestId')!) || state.photoReceipt;return receipt?send({receipt}):send({error:'not found'},404);}
   return send({photos:[]});
  }
  if(url.pathname==='/api/crew-jobs/closeout'){
   if(req.method()==='POST'){
    const body=req.postDataJSON();state.posts.push(body);
    state.receipt={requestId:body.requestId,action:'closeout',status:['lost','unknown'].includes(state.mode)?'pending':state.mode,message:state.mode==='failed'?'Fixture validation failure':'Fixture server receipt',...(state.mode==='verified'?{sourceResult:{closeout:{...source(),status:{value:'8',label:'Completed'}}}}:{})};
    if(state.mode==='unknown'){state.denyReceipt=true;return route.abort();}
    if(state.mode==='lost')return route.abort();
    return send({receipt:state.receipt},state.mode==='failed'?422:202);
   }
   if(url.searchParams.has('requestId')){
    if(url.searchParams.get('requestId')==='fixture-request-A')return send({receipt:receiptA()});
    if(state.denyReceipt)return route.abort();
    return state.receipt?send({receipt:state.receipt}):send({error:'Receipt not found'},404);
   }
   if(state.offlineLoads)return route.abort();
   return send({closeout:source(),crewVersion:state.crewVersion,crewDefaults:{version:state.crewVersion,driver:fixture.driver,navigators:fixture.navigators},sourceVersion:state.sourceChanged?'changed-source':'fixture-source',jobVersion:'fixture-job',canWrite:true});
  }
  throw new Error(`Unexpected fixture request ${req.method()} ${url.pathname}`);
 });
 await page.goto(origin);
 await expect(page.getByRole('heading',{name:'Assignments',exact:true})).toBeVisible();
 const open=async()=>{await page.getByRole('button',{name:'View assignment',exact:true}).nth(1).click();await page.getByRole('button',{name:/^(Start closeout · Before photos|Check saved checkout)$/}).click();await expect(page.getByLabel('Load price',{exact:true})).toBeAttached();await expect(page.locator('.appointment-closeout-panel')).toHaveAttribute('aria-busy','false');};
 const charges=async()=>{const next=page.getByRole('button',{name:'Continue to charges',exact:true});if(await next.isVisible())await next.click();await expect(page.getByLabel('Load price',{exact:true})).toBeVisible();};
 const payment=async()=>{await charges();await page.getByLabel('Load price',{exact:true}).fill('321');await page.getByRole('button',{name:'Continue to after photos',exact:true}).click();await page.getByRole('button',{name:'Continue to payment',exact:true}).click();await page.getByLabel('Record a collected payment',{exact:true}).check();await page.getByRole('radio',{name:'Cash',exact:true}).check();};
 const review=async()=>{await payment();await page.getByRole('button',{name:'Review Closeout',exact:true}).click();await expect(page.getByRole('button',{name:'Submit checkout',exact:true})).toBeVisible();};
 const done=async()=>{assert.deepEqual(state.errors,[]);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'No horizontal overflow');await context.close();};
 return {context,page,state,open,charges,payment,review,done};
}
async function storedDraft(page:Page){return page.evaluate(key=>JSON.parse(localStorage.getItem(`${key}:draft`)||'null'),draftKey);}
try{
 for(const step of [0,1,2,3,'review'] as const){
  const t=await setup({pendingA:true});await t.open();await t.charges();await t.page.getByLabel('Load price',{exact:true}).fill('321');
  if(step===0)await t.page.getByRole('button',{name:'Previous step',exact:true}).click();
  if(step===2||step===3||step==='review')await t.page.getByRole('button',{name:'Continue to after photos',exact:true}).click();
  if(step===3||step==='review')await t.page.getByRole('button',{name:'Continue to payment',exact:true}).click();
  if(step==='review')await t.page.getByRole('button',{name:'Review Closeout',exact:true}).click();
  const reads=t.state.reads;t.state.completeA=true;
  await expect(t.page.getByText('Checkout finished and was verified in JunkWare.',{exact:true})).toBeVisible();
  await expect(t.page.locator('.appointment-closeout-panel')).toHaveAttribute('data-mobile-step',String(step));
  assert.equal(t.state.reads,reads,'Background completion cannot refresh an active editor');
  if(artifacts && step==='review')await t.page.screenshot({path:path.join(artifacts,'mobile-active-review.png'),fullPage:true});
  assert.equal((await storedDraft(t.page)).value.fields.loadPrice,'321');assert.equal(t.state.posts.length,0);
  await t.page.getByRole('button',{name:'Back to appointment',exact:true}).click();await t.page.getByRole('button',{name:'Back to Assignments',exact:true}).click();
  await expect.poll(()=>t.state.reads).toBeGreaterThan(reads);await t.open();
  assert.equal((await storedDraft(t.page)).value.fields.loadPrice,'321','Promotion keeps stable draft');
  await t.done();console.log(`PASS completion while B step ${step}; safe deferred refresh and promotion`);
 }
 // Poll response started on the list must not replace a subsequently opened editor.
 {
  const t=await setup();t.state.holdUpdates=true;
  await expect.poll(()=>t.state.updateRequested).toBe(true);
  await t.open();await t.charges();await t.page.getByLabel('Load price',{exact:true}).fill('321');const reads=t.state.reads;
  t.state.updateToken='late-update';t.state.releaseUpdates();
  await t.page.getByRole('button',{name:'Refresh assignments',exact:true}).click();
  await expect(t.page.getByLabel('Load price',{exact:true})).toHaveValue('321');assert.equal(t.state.reads,reads);
  await t.done();console.log('PASS late poll and manual refresh preserve dirty editor');
 }
 for(const mode of ['pending','verified','failed','uncertain','lost','unknown']){
  const t=await setup({width:mode==='failed'?1280:390});t.state.mode=mode;await t.open();await t.review();
  await t.page.getByRole('button',{name:'Submit checkout',exact:true}).evaluate(button=>{(button as HTMLButtonElement).click();(button as HTMLButtonElement).click();});
  if(['pending','verified','lost'].includes(mode)){
   await expect(t.page.getByRole('heading',{name:'Assignments',exact:true})).toBeVisible();
   await expect(t.page.locator('.appointment-closeout-panel')).toHaveCount(0);
   if(mode!=='verified')await expect(t.page.getByText('Checkout accepted by the server. JunkWare verification is still pending.',{exact:true})).toBeVisible();
  }else{
   await expect(t.page.locator('.appointment-closeout-panel')).toHaveAttribute('aria-busy','false');
   await expect(t.page.getByRole('heading',{name:'Assignment details',exact:true})).toBeVisible();
   assert.equal((await storedDraft(t.page)).value.fields.loadPrice,'321');
   if(mode==='failed')await expect(t.page.getByLabel('Payment amount',{exact:true})).toBeEnabled();
   else{
    await expect(t.page.getByRole('button',{name:'Check Saved Result',exact:true}).first()).toBeVisible();
    await expect(t.page.getByLabel('Payment amount',{exact:true})).toBeDisabled();
    await t.page.reload();await t.open();
    await expect(t.page.getByLabel('Payment amount',{exact:true})).toHaveValue('371.00');
    await expect(t.page.getByLabel('Payment amount',{exact:true})).toBeDisabled();
    t.state.denyReceipt=false;t.state.receipt={...t.state.receipt,status:'failed',message:'Fixture rejected'};
    await t.page.getByRole('button',{name:'Check Saved Result',exact:true}).first().click();
    await expect(t.page.getByLabel('Payment amount',{exact:true})).toHaveValue('371.00');
    await expect(t.page.getByLabel('Payment amount',{exact:true})).toBeEnabled();
   }
  }
  assert.equal(t.state.posts.length,1,'Repeat click/recovery must not create another submission');
  assert.equal(t.state.photoPosts,0);
  if(mode==='unknown')await expect(t.page.getByRole('button',{name:'Resume transfer',exact:true})).toHaveCount(0);
  if(artifacts && ['pending','failed','unknown'].includes(mode))await t.page.screenshot({path:path.join(artifacts,`${mode}-result.png`),fullPage:true});
  await t.done();console.log(`PASS ${mode} submission, retained values and duplicate prevention`);
 }
 // The sticky Submit area shows durable photo progress during delayed transfers.
 for(const width of [320,390,430]){
  const t=await setup({width});t.state.allowPhotoUploads=true;
  await t.page.evaluate(async({photoKey,image})=>(window as any).fixtureStorage.storedPhotos(photoKey,Array.from({length:4},(_,i)=>({requestId:`transfer-${i}`,category:'before',status:'selected',image}))),{photoKey,image});
  await t.open();await t.review();await t.page.getByRole('button',{name:'Submit checkout',exact:true}).click();
  await expect.poll(()=>t.state.uploadGates.length).toBe(2);
  const progress=t.page.locator('.closeout-footer-slot .closeout-transfer-progress');
  await expect(progress).toContainText('0 of 4');await expect(progress).toBeInViewport();
  assert.equal(t.state.posts.length,0,'No checkout before photo acknowledgments');
  t.state.uploadGates.splice(0).forEach(resolve=>resolve());
  await expect(progress).toContainText('2 of 4');await expect.poll(()=>t.state.uploadGates.length).toBe(2);
  await expect(t.page.getByRole('button',{name:'Sending checkout…',exact:true})).toBeDisabled();
  if(artifacts)await t.page.screenshot({path:path.join(artifacts,`transfer-progress-${width}.png`)});
  t.state.uploadGates.splice(0).forEach(resolve=>resolve());
  await expect(t.page.getByRole('heading',{name:'Assignments',exact:true})).toBeVisible();
  assert.equal(t.state.posts.length,1);assert.equal(t.state.photoPosts,4);
  await t.done();console.log(`PASS visible transfer count, two uploads, durable acceptance at ${width}px`);
 }
 {
  const t=await setup();t.state.holdPhotoHistory=true;await t.page.clock.install();await t.open();
  await expect(t.page.getByText('Checking saved photos…',{exact:true})).toBeVisible();
  await t.page.clock.runFor(15_100);
  await expect(t.page.getByRole('button',{name:'Check saved photos again',exact:true})).toBeVisible();
  t.state.holdPhotoHistory=false;await t.page.getByRole('button',{name:'Check saved photos again',exact:true}).click();
  await expect(t.page.getByLabel('Add before photos',{exact:true})).toBeEnabled();
  assert.equal(t.state.photoPosts,0);await t.done();console.log('PASS stalled photo history offers a bounded read-only retry');
 }
 // Source/crew mismatch preserves exact old bytes without applying them to a new source.
 for(const conflict of ['source','crew','expired','malformed']){
  const t=await setup();await t.open();await t.charges();await t.page.getByLabel('Load price',{exact:true}).fill('321');
  await expect.poll(async()=>(await storedDraft(t.page))?.value.fields.loadPrice).toBe('321');
  let old=await t.page.evaluate(key=>localStorage.getItem(`${key}:draft`)!,draftKey);
  if(conflict==='source')t.state.sourceChanged=true;
  if(conflict==='crew')t.state.crewVersion=2;
  if(conflict==='expired'){const value=JSON.parse(old);value.at=Date.now()-25*3600000;old=JSON.stringify(value);}
  if(conflict==='malformed')old='{incomplete';
  await t.page.evaluate(({key,raw})=>localStorage.setItem(`${key}:draft`,raw),{key:draftKey,raw:old});
  await t.page.reload();await t.open();await t.charges();
  await expect(t.page.getByLabel('Load price',{exact:true})).toHaveValue(conflict==='source'?'500':'400');
  assert.ok(await t.page.evaluate(({key,raw})=>Object.keys(localStorage).some(k=>k.startsWith(`${key}:preserved:`)&&localStorage.getItem(k)===raw),{key:draftKey,raw:old}));
  await expect(t.page.getByRole('button',{name:'Download preserved drafts',exact:true})).toBeVisible();assert.equal(t.state.posts.length,0);
  await t.done();console.log(`PASS ${conflict} conflict preserves original draft bytes`);
 }
 // Legacy drafts/photos copy without mutation; a deliberately emptied new photo list wins.
 {
  const t=await setup();await t.open();await t.charges();await t.page.getByLabel('Load price',{exact:true}).fill('321');const raw=JSON.stringify(await storedDraft(t.page));
  await t.page.evaluate(async({key,alias,raw,photoKey,oldId,deviceId,image})=>{
   const api=(window as any).fixtureStorage;
   localStorage.setItem(`${alias}:draft`,raw);localStorage.removeItem(`${key}:draft`);
   await api.clearCrewPhotoDraft(photoKey);await api.storedPhotos(`${deviceId}:${oldId}`,[{requestId:'legacy-before',category:'before',status:'selected',image},{requestId:'legacy-after',category:'after',status:'selected',image}]);
  },{key:draftKey,alias:aliasKey,raw,photoKey,oldId,deviceId:phone.deviceId,image});
  t.state.completeA=true;await t.page.reload();await t.open();await t.charges();
  await expect(t.page.getByLabel('Load price',{exact:true})).toHaveValue('321');
  const photos=await t.page.evaluate(async({photoKey,oldId,deviceId})=>{const api=(window as any).fixtureStorage;return {next:await api.storedPhotos(photoKey),old:await api.storedPhotos(`${deviceId}:${oldId}`)};},{photoKey,oldId,deviceId:phone.deviceId});
  assert.deepEqual(photos.next,photos.old);assert.equal(photos.next.length,2);
  assert.equal(await t.page.evaluate(key=>localStorage.getItem(`${key}:draft`),aliasKey),raw);
  await t.page.evaluate(async key=>(window as any).fixtureStorage.storedPhotos(key,[]),photoKey);
  await t.page.reload();await t.open();assert.deepEqual(await t.page.evaluate(async key=>(window as any).fixtureStorage.storedPhotos(key),photoKey),[]);
  await t.done();console.log('PASS legacy draft and before/after photo migration; originals retained; removed photos stay removed');
 }
 // Promotion during review must refresh request authority without replacing entered values.
 for(const changed of [false,true]){
  const t=await setup({pendingA:true});await t.open();await t.review();t.state.completeA=true;
  await expect(t.page.getByText('Checkout finished and was verified in JunkWare.',{exact:true})).toBeVisible();t.state.sourceChanged=changed;
  await t.page.getByRole('button',{name:'Submit checkout',exact:true}).click();
  if(changed){await expect(t.page.getByText('The appointment or crew changed. Your draft is preserved. Reload from JunkWare and review before submitting.',{exact:true})).toBeVisible();assert.equal(t.state.posts.length,0);assert.equal((await storedDraft(t.page)).value.fields.loadPrice,'321');}
  else{await expect(t.page.getByRole('heading',{name:'Assignments',exact:true})).toBeVisible();assert.equal(t.state.posts.length,1);assert.equal(t.state.posts[0].assignmentId,newId);assert.equal(t.state.posts[0].values.loadPrice,'321');}
  await t.done();console.log(`PASS submit after promotion, concurrent source change=${changed}`);
 }
 // Offline source reload preserves bytes, then restores after a read-only retry.
 {
  const t=await setup();await t.open();await t.charges();await t.page.getByLabel('Load price',{exact:true}).fill('321');await expect.poll(async()=>(await storedDraft(t.page))?.value.fields.loadPrice).toBe('321');
  t.state.offlineLoads=true;await t.page.reload();await t.page.getByRole('button',{name:'View assignment',exact:true}).nth(1).click();await t.page.getByRole('button',{name:'Start closeout · Before photos',exact:true}).click();
  await expect(t.page.getByRole('button',{name:'Retry loading closeout',exact:true})).toBeVisible();assert.equal((await storedDraft(t.page)).value.fields.loadPrice,'321');
  t.state.offlineLoads=false;await t.page.getByRole('button',{name:'Retry loading closeout',exact:true}).click();await expect(t.page.getByLabel('Load price',{exact:true})).toHaveValue('321');assert.equal(t.state.posts.length,0);
  await t.done();console.log('PASS offline reload retains draft until source can be checked');
 }
 // An upload acknowledged under an old assignment is checked under that authority, never reposted.
 {
  const t=await setup();t.state.completeA=true;
  await t.page.evaluate(async({deviceId,oldId,image})=>(window as any).fixtureStorage.storedPhotos(`${deviceId}:${oldId}`,[{requestId:'old-upload',category:'before',status:'pending',image}]),{deviceId:phone.deviceId,oldId,image});
  await t.page.getByRole('button',{name:'Refresh assignments',exact:true}).click();await t.open();await t.review();
  await t.page.getByRole('button',{name:'Submit checkout',exact:true}).click();await expect(t.page.getByText('A photo from the earlier assignment needs verification. Use Check saved photo before submitting.',{exact:true})).toBeVisible();assert.equal(t.state.posts.length,0);
  await t.page.getByRole('button',{name:'Before photos',exact:true}).click();t.state.photoReceipt={requestId:'old-upload',category:'before',status:'verified'};
  await t.page.getByRole('button',{name:'Check saved photo',exact:true}).click();await expect(t.page.getByText('Saved in JunkWare',{exact:true})).toBeVisible();assert.deepEqual(t.state.photoChecks,[oldId]);assert.equal(t.state.photoPosts,0);
  await t.done();console.log('PASS old photo receipt authority and no duplicate upload');
 }
 // Conflicting copies are left intact and the migration transaction creates no replacement.
 {
  const t=await setup();const result=await t.page.evaluate(async()=>{
   const api=(window as any).fixtureStorage,a={requestId:'conflict',category:'before',status:'selected',image:'one'},b={...a,image:'two'};
   await api.storedPhotos('fixture:alias-a',[a]);await api.storedPhotos('fixture:alias-b',[b]);let failures=0;
   for(let i=0;i<2;i++)try{await api.migratePhotoDraft('fixture:conflict',['fixture:alias-a','fixture:alias-b']);}catch{failures++;}
   return {failures,a:await api.storedPhotos('fixture:alias-a'),b:await api.storedPhotos('fixture:alias-b'),next:await api.storedPhotos('fixture:conflict')};
  });assert.equal(result.failures,2);assert.equal(result.a[0].image,'one');assert.equal(result.b[0].image,'two');assert.deepEqual(result.next,[]);await t.done();console.log('PASS conflicting photo migration preserves both originals atomically');
 }
 // Storage denial retains the on-screen work and cannot cause a network submission.
 {
  const t=await setup();await t.open();await t.review();
  await t.page.evaluate(()=>{Storage.prototype.setItem=()=>{throw new DOMException('Fixture quota','QuotaExceededError');};});
  await t.page.getByRole('button',{name:'Submit checkout',exact:true}).click();
  await expect(t.page.getByRole('button',{name:'Check Saved Result',exact:true}).first()).toBeVisible();
  assert.equal(t.state.posts.length,0);await expect(t.page.getByLabel('Payment amount',{exact:true})).toHaveValue('371.00');
  await t.done();console.log('PASS storage denial keeps editor and prevents submission');
 }
 console.log('PASS Waypoint draft/refresh browser suite. All network requests intercepted; no live writes.');
}finally{await browser.close();}

}
void main().catch(error=>{console.error(error);process.exitCode=1;});
