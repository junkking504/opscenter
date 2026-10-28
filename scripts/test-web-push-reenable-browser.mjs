import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { chromium, webkit } from 'playwright';
const output=process.env.PUSH_PREVIEW_OUTPUT||'/tmp/opscenter-push-toggle';await mkdir(output,{recursive:true});
const url=process.env.PUSH_PREVIEW_URL||'http://127.0.0.1:3137/desktop-assets/tests/web-push.html';
const hash=s=>createHash('sha256').update(JSON.stringify([s.endpoint,s.keys.p256dh,s.keys.auth])).digest('hex');
for(const [engine,type] of Object.entries({chromium,webkit})) {
 const browser=await type.launch({headless:true});
 try {
  const page=await browser.newPage({viewport:{width:390,height:844},hasTouch:true});page.setDefaultTimeout(15000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>{
   window.pushTest={permission:'granted',permissionCalls:0,subscribeCalls:0,unsubscribeCalls:0,sub:null,sequence:0};
   Object.defineProperty(window,'Notification',{value:{requestPermission:async()=>{window.pushTest.permissionCalls++;if(window.pushTest.permission==='interrupted')throw Error('Permission prompt interrupted.');return window.pushTest.permission;}}});
   Object.defineProperty(window,'PushManager',{value:class{}});
   const wrap=()=>window.pushTest.sub?{toJSON:()=>window.pushTest.sub,unsubscribe:async()=>{window.pushTest.unsubscribeCalls++;window.pushTest.sub=null;return true;}}:null;
   Object.defineProperty(navigator,'serviceWorker',{value:{register:async()=>({active:{},update:async()=>{},pushManager:{getSubscription:async()=>wrap(),subscribe:async()=>{window.pushTest.subscribeCalls++;window.pushTest.sequence++;window.pushTest.sub={endpoint:'https://web.push.apple.com/Qfixture'+window.pushTest.sequence,keys:{p256dh:'fixture-key',auth:'fixture-auth'}};return wrap();}}})}});
  });
  let device=null,globalEnabled=true,senderReady=true,posts=0,dropResponse=false,denyOff=false,invalidNext=false;
  await page.route('**/api/push/devices',async route=>{
   if(route.request().method()==='POST'){
    const b=route.request().postDataJSON();posts++;
    if(b.action==='enable'){
     assert.equal(b.confirm,true);
     if(invalidNext){invalidNext=false;await route.fulfill({status:409,json:{error:'subscription_invalid'}});return;}
     device={id:'00000000-0000-4000-8000-000000000002',fingerprint:hash(b.subscription),categories:b.categories,expires_at:null,consented_at:new Date().toISOString(),approved:true};
     if(dropResponse){dropResponse=false;await route.abort();return;}
     await route.fulfill({json:{deviceId:device.id,enabled:true}});return;
    }
    assert.equal(b.action,'unsubscribe');
    if(denyOff){denyOff=false;await route.fulfill({status:503,json:{error:'fixture'}});return;}
    device=null;await route.fulfill({json:{ok:true}});return;
   }
   await route.fulfill({json:{enabled:true,mode:'device-toggle',publicKey:'B'+'A'.repeat(86),sender:{enabled:globalEnabled,ready:senderReady},devices:device?[device]:[]}});
  });
  await page.goto(url,{waitUntil:'domcontentloaded'});
  const toggle=page.getByRole('switch',{name:'Notifications on this phone'}),refresh=page.getByRole('button',{name:'Refresh status'});
  await toggle.waitFor();await page.waitForFunction(()=>!document.querySelector('[role=switch]').disabled);
  assert.equal(await toggle.getAttribute('aria-checked'),'false');assert.equal(posts,0);assert.equal(await page.evaluate(()=>window.pushTest.permissionCalls),0);
  await page.evaluate(()=>window.pushTest.permission='default');await toggle.click();await page.getByText('Permission was not granted.',{exact:false}).waitFor();assert.equal(posts,0);
  await page.evaluate(()=>window.pushTest.permission='interrupted');await toggle.click();await page.getByText('Permission prompt interrupted.',{exact:false}).waitFor();assert.equal(posts,0);
  await page.evaluate(()=>window.pushTest.permission='granted');dropResponse=true;await toggle.click();await page.getByRole('status').filter({hasText:/fetch|network|Could not|Load failed/i}).waitFor();
  await refresh.click();await page.waitForFunction(()=>document.querySelector('[role=switch]').getAttribute('aria-checked')==='true');assert.equal(posts,1);assert.equal(await page.evaluate(()=>window.pushTest.unsubscribeCalls),0);
  assert.doesNotMatch(await page.locator('.push-settings').innerText(),/request ID|Awaiting owner|authorization limit|expires Nov/i);
  await page.getByRole('checkbox',{name:'Schedule changes'}).uncheck();
  await page.getByRole('button',{name:'Save categories'}).evaluate(el=>{el.click();el.click();});await page.getByText('Notifications are on',{exact:false}).waitFor();assert.equal(posts,2);assert.deepEqual(device.categories,['krewe','fleet']);
  senderReady=false;await refresh.click();await page.getByText('Alert service: paused.',{exact:false}).waitFor();assert.equal(await toggle.getAttribute('aria-checked'),'true');
  globalEnabled=false;await refresh.click();await page.getByText('Alert service: off.',{exact:false}).waitFor();assert.equal(await toggle.getAttribute('aria-checked'),'true');
  denyOff=true;await toggle.click();await page.getByText('Could not disable device.',{exact:false}).waitFor();assert.equal(await toggle.getAttribute('aria-checked'),'true','failed OFF cannot claim success');
  await toggle.click();await page.getByText('Notifications are off',{exact:false}).waitFor();assert.equal(await toggle.getAttribute('aria-checked'),'false');assert.equal(await page.evaluate(()=>window.pushTest.unsubscribeCalls),1);
  globalEnabled=true;senderReady=true;await toggle.click();await page.getByText('Notifications are on',{exact:false}).waitFor();
  // Browser subscription rotation must not masquerade as the old ON device.
  await page.evaluate(()=>{window.pushTest.sub={...window.pushTest.sub,endpoint:'https://web.push.apple.com/Qstale'};});await refresh.click();await page.waitForFunction(()=>document.querySelector('[role=switch]').getAttribute('aria-checked')==='false');
  await toggle.click();await page.getByText('Notifications are on',{exact:false}).waitFor();
  // Simulate provider invalidation: status must no longer report ON.
  device=null;await refresh.click();await page.waitForFunction(()=>document.querySelector('[role=switch]').getAttribute('aria-checked')==='false');
  invalidNext=true;await toggle.click();await page.getByText('This browser subscription is no longer valid.',{exact:false}).waitFor();
  assert.equal(await page.evaluate(()=>window.pushTest.sub),null);
  await toggle.click();await page.getByText('Notifications are on',{exact:false}).waitFor();
  await page.screenshot({path:`${output}/${engine}-phone-on.png`,fullPage:true});
  await toggle.click();await page.getByText('Notifications are off',{exact:false}).waitFor();
  await page.reload();await toggle.waitFor();await page.waitForFunction(()=>!document.querySelector('[role=switch]').disabled);
  assert.equal(await page.getByRole('checkbox',{name:'Schedule changes'}).isChecked(),false,'OFF/reload retains category preference');
  for(const [width,height] of [[390,844],[844,390],[1440,1000]])for(const theme of ['light','dark']){
   await page.setViewportSize({width,height});await page.evaluate(t=>document.documentElement.setAttribute('data-ops-theme',t),theme);
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`${engine} ${width} ${theme} overflow`);
   await page.screenshot({path:`${output}/${engine}-${width}-${theme}.png`,fullPage:true});
  }
  assert.deepEqual(errors,[]);console.log(`PASS ${engine}: explicit ON/OFF; permission denial/interruption; lost response; repeated click; categories; global/device separation; failed OFF; invalid/stale subscription; responsive light/dark. Mocked APIs only.`);
 }finally{await browser.close();}
}
