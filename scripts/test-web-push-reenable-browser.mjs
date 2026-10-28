import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { chromium, webkit } from 'playwright';
const output=process.env.PUSH_PREVIEW_OUTPUT||'/tmp/opscenter-push-reenable';await mkdir(output,{recursive:true});
const url=process.env.PUSH_PREVIEW_URL||'http://127.0.0.1:3137/desktop-assets/tests/web-push.html';
const hash=s=>createHash('sha256').update(JSON.stringify([s.endpoint,s.keys.p256dh,s.keys.auth])).digest('hex');
for(const [engine,type] of Object.entries({chromium,webkit})) {
 const browser=await type.launch({headless:true});
 try {
  const page=await browser.newPage({viewport:{width:390,height:844},hasTouch:true});page.setDefaultTimeout(15000);page.setDefaultNavigationTimeout(20000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>{
   window.pushTest={permission:'granted',permissionCalls:0,subscribeCalls:0,unsubscribeCalls:0,sub:null,sequence:0};
   Object.defineProperty(window,'Notification',{value:{requestPermission:async()=>{window.pushTest.permissionCalls++;if(window.pushTest.permission==='interrupted')throw Error('Permission prompt interrupted.');return window.pushTest.permission;}}});
   Object.defineProperty(window,'PushManager',{value:class{}});
   const wrap=()=>window.pushTest.sub?{toJSON:()=>window.pushTest.sub,unsubscribe:async()=>{window.pushTest.unsubscribeCalls++;window.pushTest.sub=null;return true;}}:null;
   Object.defineProperty(navigator,'serviceWorker',{value:{register:async()=>({active:{},update:async()=>{},pushManager:{getSubscription:async()=>wrap(),subscribe:async()=>{window.pushTest.subscribeCalls++;window.pushTest.sequence++;window.pushTest.sub={endpoint:'https://web.push.apple.com/Qfixture'+window.pushTest.sequence,keys:{p256dh:'fixture-key',auth:'fixture-auth'}};return wrap();}}})}});
  });
  let revoked=true,globalEnabled=true,senderReady=true,pending=null,approvedSub=null,posts=0,dropResponse=false;
  await page.route('**/api/push/devices',async route=>{
   if(route.request().method()==='POST'){
    const b=route.request().postDataJSON();posts++;
    if(b.action==='request-reenable'){
     assert.equal(b.confirm,true);assert.equal(revoked,true);
     pending={id:'00000000-0000-4000-8000-000000000001',fingerprint:hash(b.subscription),categories:b.categories,expires_at:new Date(Date.now()+900000).toISOString()};
     approvedSub=b.subscription;
     if(dropResponse){dropResponse=false;await route.abort();return;}
     await route.fulfill({json:{requestId:pending.id}});return;
    }
    assert.equal(b.action,'unsubscribe');revoked=true;pending=null;await route.fulfill({json:{ok:true}});return;
   }
   await route.fulfill({json:{enabled:globalEnabled&&senderReady&&!revoked,enrollmentEnabled:globalEnabled&&senderReady,publicKey:'B'+'A'.repeat(86),sender:{enabled:globalEnabled,ready:senderReady},journal:{configured:true,status:'unknown',sampledAt:new Date().toISOString(),capacity:[],retention:{status:'unknown',unscopableRetained:null,scannedAt:null}},trial:{status:revoked?'ongoing_revoked':'ongoing',deadline:'2026-11-20T15:23:33Z',maxAttempts:null,attemptsUsed:2},recovery:{eligible:revoked,categories:['schedule','krewe','fleet'],pending},devices:revoked?[]:[{id:'00000000-0000-4000-8000-000000000002',categories:['schedule','krewe','fleet'],expires_at:'2026-11-20T15:23:33Z',fingerprint:hash(approvedSub),approved:true}]}});
  });
  await page.goto(url,{waitUntil:'domcontentloaded'});console.log(engine+' fixture loaded');const button=page.getByRole('button',{name:'Request re-enable for this phone'}),consent=page.getByRole('checkbox',{name:'I want to re-enable notifications on this phone, within the existing authorization expiry.'});
  await button.waitFor();console.log(engine+' recovery controls visible');assert.ok(await button.isDisabled());assert.equal(posts,0);assert.equal(await page.evaluate(()=>window.pushTest.permissionCalls),0);
  assert.match(await page.locator('.push-settings').innerText(),/Alert service: running/);assert.match(await page.locator('.push-settings').innerText(),/Phone authorization: revoked/);
  await consent.check();await page.evaluate(()=>window.pushTest.permission='default');await button.click();await page.getByText('Permission was not granted.',{exact:false}).waitFor();assert.equal(posts,0);
  await page.evaluate(()=>window.pushTest.permission='interrupted');await button.click();await page.getByText('Permission prompt interrupted.',{exact:false}).waitFor();assert.equal(posts,0);
  await page.evaluate(()=>window.pushTest.permission='granted');dropResponse=true;
  await button.click();await page.getByRole('button',{name:'Refresh status'}).click();await page.getByText('Awaiting owner authorization for this phone',{exact:true}).waitFor();assert.equal(posts,1);assert.equal(await page.evaluate(()=>window.pushTest.unsubscribeCalls),0,'lost response must retain subscription');
  await button.evaluate(el=>{el.click();el.click();});await page.getByText('Request saved.',{exact:false}).waitFor();assert.equal(posts,2,'double click produces only one retry');
  assert.equal(await page.evaluate(()=>window.pushTest.subscribeCalls),1);assert.ok(revoked,'requests never authorize');
  await page.screenshot({path:`${output}/${engine}-mobile-pending.png`,fullPage:true});
  // A different/stale browser subscription cannot claim the previous pending request.
  await page.evaluate(()=>{window.pushTest.sub={...window.pushTest.sub,endpoint:'https://web.push.apple.com/Qstale'};});
  await page.getByRole('button',{name:'Refresh status'}).click();await page.waitForFunction(()=>!document.querySelector('.push-settings').textContent.includes('Awaiting owner authorization for this phone'),{},{timeout:15000});
  await consent.check();await button.click();await page.getByText('Request saved.',{exact:false}).waitFor();assert.equal(posts,3);
  revoked=false;pending=null;await page.getByRole('button',{name:'Refresh status'}).click();await page.getByText('Device approved',{exact:false}).waitFor();assert.match(await page.locator('.push-settings').innerText(),/Device approved/);
  await page.getByRole('button',{name:'Disable device 1'}).click();await page.getByText('Device disabled.',{exact:false}).waitFor();assert.equal(posts,4);assert.equal(await page.evaluate(()=>window.pushTest.unsubscribeCalls),1);
  assert.ok(await button.isDisabled(),'new explicit consent required after disable');
  senderReady=false;await page.getByRole('button',{name:'Refresh status'}).click();await page.getByText('Alert service: paused.',{exact:false}).waitFor();await consent.check();assert.ok(await button.isDisabled());
  globalEnabled=false;await page.getByRole('button',{name:'Refresh status'}).click();await page.getByText('Alert service: off.',{exact:false}).waitFor();assert.ok(await button.isDisabled());
  for(const [width,height] of [[390,844],[844,390],[1440,1000]])for(const theme of ['light','dark']){
   await page.setViewportSize({width,height});await page.evaluate(t=>document.documentElement.setAttribute('data-ops-theme',t),theme);
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`${engine} ${width} ${theme} overflow`);
   await page.screenshot({path:`${output}/${engine}-${width}-${theme}.png`,fullPage:true});
  }
  assert.deepEqual(errors,[]);console.log(`PASS ${engine}: explicit consent; permission denial/interruption; lost response reconciliation; repeat clicks; exact subscription matching; revoke/re-request; sender/global states; phone/landscape/desktop layout. All APIs and notifications mocked.`);
 }finally{await browser.close();}
}
