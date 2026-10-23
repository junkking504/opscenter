import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {chromium,expect} from '@playwright/test';
import {createECDH} from 'node:crypto';
const key=createECDH('prime256v1');key.generateKeys();const publicKey=key.getPublicKey().toString('base64url');
const result=await build({stdin:{contents:`import React from 'react';import{createRoot}from'react-dom/client';import Notifications from './app/crew-jobs/notifications';import Composer from './components/CrewMessageComposer';createRoot(document.getElementById('root')).render(location.pathname==='/composer'?<Composer truck="Truck 1"/>:<Notifications/>);`,resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,outdir:'out',format:'iife',define:{'process.env.NODE_ENV':'"test"'}});
const html=`<!doctype html><style>${result.outputFiles.find(file=>file.path.endsWith('.css'))?.text || ''}</style><meta name="viewport" content="width=device-width, initial-scale=1"><div id="root"></div><script>${result.outputFiles.find(file=>file.path.endsWith('.js')).text}</script>`;
const browser=await chromium.launch({headless:true});
try{
 for(const width of [320,390,430]){
  const context=await browser.newContext({viewport:{width,height:844}}),page=await context.newPage();let subscriptions=0,unsubscribes=0;
  await page.addInitScript(()=>{
   window.permissionCalls=0;window.PushManager=function(){};window.Notification={requestPermission:async()=>{window.permissionCalls++;return 'granted';}};
   const match=window.matchMedia;window.matchMedia=q=>q==='(display-mode: standalone)'?{matches:true}:match(q);
   Object.defineProperty(navigator,'serviceWorker',{value:{register:async()=>({active:true,pushManager:{getSubscription:async()=>({toJSON:()=>({endpoint:'synthetic',keys:{}})})}}),getRegistration:async()=>({pushManager:{getSubscription:async()=>({unsubscribe:async()=>true})}})}});
  });
  await page.route('**/*',async route=>{
   const request=route.request(),url=new URL(request.url());
   if(url.pathname==='/crew-jobs')return route.fulfill({status:200,contentType:'text/html',body:html});
   assert.equal(url.pathname,'/api/crew-jobs/notifications');
   if(request.method()==='GET')return route.fulfill({json:{available:true,publicKey,messages:[{id:'synthetic',body:'Synthetic office instruction for this truck.',created_at:new Date().toISOString()}]}});
   const body=request.postDataJSON();if(body.action==='subscribe'){subscriptions++;return route.fulfill({json:{deviceId:'synthetic-device',enabled:true}});}unsubscribes++;return route.fulfill({json:{enabled:false}});
  });
  await page.goto('https://waypoint.fixture/crew-jobs');
  await expect(page.getByText('Synthetic office instruction for this truck.')).toBeVisible();assert.equal(await page.evaluate(()=>window.permissionCalls),0,'No automatic permission prompt');
  await page.getByRole('button',{name:'Enable notifications for today'}).click();await expect(page.getByRole('status')).toContainText('Notifications enabled');assert.equal(subscriptions,1);assert.equal(await page.evaluate(()=>window.permissionCalls),1);
  await page.getByRole('button',{name:'Disable notifications',exact:true}).click();await expect(page.getByRole('status')).toContainText('Notifications disabled');assert.equal(unsubscribes,1);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,`Fits ${width}px`);await context.close();
 }
 const context=await browser.newContext(),page=await context.newPage();const sent=[];let lose=true;
 await page.route('**/*',async route=>{const request=route.request(),url=new URL(request.url());if(url.pathname==='/composer')return route.fulfill({status:200,contentType:'text/html',body:html});assert.equal(url.pathname,'/api/crew-messages');sent.push(request.postDataJSON());if(lose){lose=false;return route.abort();}return route.fulfill({json:{saved:true}});});
 await page.goto('https://waypoint.fixture/composer');await page.getByRole('textbox',{name:'Office message'}).fill('Synthetic office message');await page.getByRole('button',{name:'Send to truck'}).click();await expect(page.getByRole('button',{name:'Check same message'})).toBeVisible();await page.reload();await expect(page.getByRole('button',{name:'Check same message'})).toBeVisible();await page.getByRole('button',{name:'Check same message'}).click();await expect(page.getByRole('status')).toContainText('Message saved');assert.deepEqual(sent[0],sent[1],'Lost response/reload retains original request ID/body');await context.close();
 console.log('PASS Waypoint push UI: explicit permission gesture, enable/disable, office inbox, 320/390/430px, and lost office-message response recovery across reload. All browser APIs and sends mocked.');
}finally{await browser.close();}
