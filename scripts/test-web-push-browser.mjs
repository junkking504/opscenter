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
   Object.defineProperty(navigator,'serviceWorker',{value:{register:async()=>({active:{},pushManager:{getSubscription:async()=>null,subscribe:async()=>{window.pushCalls.subscribe++;return sub;}}})}});
 });
 let device=false;const writes=[];
 await page.route('**/api/push/devices',async route=>{
   const req=route.request();if(req.method()==='POST'){const body=req.postDataJSON();writes.push(body);device=body.action==='subscribe';await route.fulfill({json:{deviceId:'fixture-device',ok:true}});return;}
   await route.fulfill({json:{enabled:true,publicKey:'B'+'A'.repeat(86),devices:device?[{id:'fixture-device',categories:['fleet','krewe'],expires_at:'2026-11-01T12:00:00Z'}]:[]}});
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
 await page.getByRole('button',{name:'Disable device 1'}).click();await page.getByText('Device disabled.',{exact:false}).waitFor();assert.equal(writes[1].action,'unsubscribe');
 await page.setViewportSize({width:1440,height:1000});await page.screenshot({path:output+'/desktop.png',fullPage:true});
 assert.deepEqual(errors,[]);console.log('Browser fixture passed: collapsed mobile/desktop previews, no overflow, tap-only mocked permission, category save and revoke. No real subscription or notification.');
} finally {await browser.close();}
