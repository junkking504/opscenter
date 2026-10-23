import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
const browser=await chromium.launch({headless:true});
const output=process.env.PUSH_PREVIEW_OUTPUT || '/tmp/opscenter-web-push-preview';await mkdir(output,{recursive:true});
try {
 const page=await browser.newPage({viewport:{width:393,height:852}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{
   window.pushCalls={permission:0,subscribe:0,gesture:false};
   const sub={toJSON:()=>({endpoint:'https://web.push.apple.com/Q'+'x'.repeat(64),keys:{p256dh:'fixture',auth:'fixture'}}),unsubscribe:async()=>true};
   Object.defineProperty(window,'Notification',{value:{requestPermission:async()=>{window.pushCalls.permission++;window.pushCalls.gesture=navigator.userActivation.isActive;return 'granted';}}});
   Object.defineProperty(window,'PushManager',{value:class {}});
   Object.defineProperty(navigator,'serviceWorker',{value:{register:async()=>({active:{},update:async()=>{},pushManager:{getSubscription:async()=>null,subscribe:async()=>{window.pushCalls.subscribe++;return sub;}}})}});
 });
 let device=false,approved=false,mode='enabled';const writes=[];
 await page.route('**/api/push/devices',async route=>{
   const req=route.request();if(mode==='operator'){await route.fulfill({status:403,json:{error:'Manager access required.'}});return;}
   if(mode==='withheld'){await route.fulfill({json:{enabled:true,publicKey:'B'+'A'.repeat(86),devices:[],health:[{scope:'schedule:fixture',code:'coverage_gap',reason:'ordering_uncertain'}]}});return;}
   if(mode==='recovered'){await route.fulfill({json:{enabled:true,publicKey:'B'+'A'.repeat(86),devices:[],health:[{scope:'schedule:fixture',code:'recovered_gap'}]}});return;}
   if(mode==='journal'){
    await route.fulfill({json:{enabled:false,devices:[],journal:{configured:true,status:'observed',sampledAt:'2026-10-18T19:00:00Z',retention:{status:'observed',unscopableRetained:7,scannedAt:'2026-10-17T12:00:00Z'},capacity:[{key:'ready',status:'observed',files:10000,bytes:134217728,remainingFiles:0,remainingBytes:0,limitFiles:10000,limitBytes:134217728},{key:'pending',status:'unknown',files:null,bytes:null,remainingFiles:null,remainingBytes:null,limitFiles:10000,limitBytes:134217728},{key:'uncertain',status:'observed',files:2,bytes:1024,remainingFiles:9998,remainingBytes:134216704,limitFiles:10000,limitBytes:134217728}]}}});return;
   }
   if(mode==='journal-error'){await route.fulfill({status:503,json:{error:'Unavailable'}});return;}
   if(mode==='journal-unknown'){await route.fulfill({json:{enabled:false,devices:[],journal:{configured:true,status:'unknown',sampledAt:'2026-10-18T19:00:00Z',retention:{status:'unknown',unscopableRetained:null,scannedAt:null},capacity:[{key:'ready',status:'unknown',limitFiles:10000,limitBytes:134217728}]}}});return;}
   if(mode==='ongoing-paused'){await route.fulfill({json:{enabled:false,devices:[],journal:{configured:true,status:'unknown',retention:{status:'unknown',unscopableRetained:null,scannedAt:null},capacity:[]},trial:{status:'ongoing',deadline:'2026-11-20T15:23:33Z',attemptsUsed:1,maxAttempts:null}}});return;}
   if(mode==='disabled'){await route.fulfill({json:{enabled:false,devices:[],storage:'unavailable'}});return;}
   if(req.method()==='POST'){const body=req.postDataJSON();writes.push(body);device=body.action==='subscribe';await route.fulfill({json:{deviceId:'fixture-device',ok:true}});return;}
   await route.fulfill({json:{enabled:true,publicKey:'B'+'A'.repeat(86),trial:{status:mode==='ongoing'?'ongoing':approved?'awaiting_start':'awaiting_device',deadline:mode==='ongoing'?'2026-11-20T15:23:33Z':null,attemptsUsed:1,maxAttempts:mode==='ongoing'?null:3},devices:device?[{id:'fixture-device',categories:['fleet','krewe'],expires_at:'2026-11-01T12:00:00Z',approved,fingerprint:'a'.repeat(64)}]:[]}});
 });
 await page.goto(process.env.PUSH_PREVIEW_URL || 'http://127.0.0.1:3137/desktop-assets/tests/web-push.html');
 const enable=page.getByRole('button',{name:'Enable Notifications / Save Categories'});await enable.waitFor();await page.waitForFunction(()=>!document.querySelector('.push-settings button').disabled);
 assert.equal((await page.evaluate(()=>window.pushCalls)).permission,0,'no permission request on mount');
 const summaries=page.locator('.crew-compact-update > summary');assert.equal(await summaries.count(),3);
 const text=await summaries.allTextContents();assert.match(text[0],/departed NOHQ.*59m/);assert.match(text[1],/2 clocked in.*Example Driver.*08:46 AM.*Example Navigator.*08:37 AM.*Original.*Updated/s);assert.match(text[2],/3 appointments in schedule snapshot/);
 assert.match(await page.locator('.crew-source-notice').innerText(),/LinxUp.*missing.*unknown/);
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),'mobile has no horizontal overflow');
 await page.screenshot({path:output+'/mobile.png',fullPage:true});
 await page.getByRole('checkbox',{name:'Schedule changes'}).uncheck();await enable.click();await page.getByRole('button',{name:'Disable device 1'}).waitFor();
 assert.deepEqual((await page.evaluate(()=>window.pushCalls)),{permission:1,subscribe:1,gesture:true});assert.deepEqual(writes[0].categories,['krewe','fleet']);
 assert.match(await page.locator('.push-settings').innerText(),/Awaiting device approval/);assert.match(await page.locator('.push-settings').innerText(),/clock has not started/);
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),'fingerprint fits phone');
 approved=true;await page.getByRole('button',{name:'Refresh status'}).click();await page.getByText('Device approved',{exact:false}).waitFor();assert.equal((await page.evaluate(()=>window.pushCalls)).permission,1,'approval refresh does not request permission or subscribe');
 await page.getByRole('button',{name:'Disable device 1'}).click();await page.getByText('Device disabled.',{exact:false}).waitFor();assert.equal(writes[1].action,'unsubscribe');
 await page.setViewportSize({width:1440,height:1000});await page.screenshot({path:output+'/desktop.png',fullPage:true});
 mode='ongoing';await page.reload();await page.getByText('Ongoing notifications: enabled',{exact:false}).waitFor();assert.doesNotMatch(await page.locator('.push-settings').innerText(),/3 send attempts|Trial:/);
 mode='ongoing-paused';await page.reload();await page.getByText('Ongoing notifications: paused',{exact:false}).waitFor().catch(async error=>{console.error(await page.locator('body').innerText());throw error;});
 mode='recovered';await page.reload();await page.getByText('Capture recovered after a recorded gap.',{exact:false}).waitFor();assert.doesNotMatch(await page.locator('.push-settings').innerText(),/sources are blocked/);
 mode='withheld';await page.reload();await page.getByText('Some notification facts are withheld',{exact:false}).waitFor();assert.doesNotMatch(await page.locator('.push-settings').innerText(),/sources are blocked/);
 mode='journal';await page.reload();await page.getByRole('heading',{name:'Notification queue status'}).waitFor();
 assert.match(await page.locator('.push-settings').innerText(),/last retention scan: 7 files.*Current count may differ/s);
 assert.match(await page.locator('.push-settings').innerText(),/Admission limit reached/);assert.match(await page.locator('.push-settings').innerText(),/Pending and pending quarantine: headroom unknown/);
 assert.match(await page.locator('.push-settings').innerText(),/Runtime capacity remains unmeasured/);assert.ok(await enable.isDisabled(),'disabled staging has health visibility without enrollment');
 await page.setViewportSize({width:393,height:852});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth));await page.screenshot({path:output+'/journal-mobile.png',fullPage:true});
 await page.setViewportSize({width:1440,height:1000});await page.screenshot({path:output+'/journal-desktop.png',fullPage:true});
 mode='journal-unknown';await page.getByRole('button',{name:'Refresh status'}).click();await page.getByText('Unscopable evidence count is unknown',{exact:false}).waitFor();assert.doesNotMatch(await page.locator('.push-settings').innerText(),/last retention scan: 7/);
 mode='journal-error';await page.getByRole('button',{name:'Refresh status'}).click();await page.getByText('Notification queue measurements are unknown.',{exact:true}).waitFor();
 assert.equal((await page.evaluate(()=>window.pushCalls)).permission,0,'status reads never request permission');
 mode='operator';await page.reload();await page.getByRole('heading',{name:'Local synthetic preview'}).waitFor();await page.waitForTimeout(100);assert.equal(await page.locator('.push-settings').count(),0);
 mode='disabled';await page.reload();await page.getByRole('heading',{name:'Local synthetic preview'}).waitFor();await page.waitForTimeout(100);assert.equal(await page.locator('.push-settings').count(),0);
 assert.deepEqual(errors,[]);console.log('Browser fixture passed: collapsed mobile/desktop previews, no overflow, tap-only mocked permission, category save/revoke, disabled-staging queue counts, unknown/error states and no permission calls on status refresh. No real subscription or notification.');
} finally {await browser.close();}
