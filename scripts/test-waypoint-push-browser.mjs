import assert from 'node:assert/strict';
import fs from 'node:fs';import path from 'node:path';
import {build} from 'esbuild';
import {chromium,expect} from '@playwright/test';
import {createECDH} from 'node:crypto';
const key=createECDH('prime256v1');key.generateKeys();const publicKey=key.getPublicKey().toString('base64url');
const result=await build({stdin:{contents:`import React from 'react';import{createRoot}from'react-dom/client';import './app/globals.css';import styles from './app/crew-jobs/phone-access.module.css';import shell from './components/waypoint-app.module.css';import Notifications from './app/crew-jobs/notifications';import Composer from './components/CrewMessageComposer';createRoot(document.getElementById('root')).render(location.pathname==='/composer'?<Composer truck="Truck 1"/>:<div className={shell.app}><div><main className={styles.page+" "+styles.connectedPage}><div className={styles.content}><button className={styles.secondary}>Refresh Assignments</button><Notifications/><details className={styles.card}><summary>Truck &amp; Phone</summary><h2>Today’s crew</h2><p>Synthetic crew</p><button className={styles.secondary}>Edit Crew</button></details></div></main></div></div>);`,resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,outdir:'out',format:'iife',define:{'process.env.NODE_ENV':'"test"'}});
const html=`<!doctype html><style>${result.outputFiles.find(file=>file.path.endsWith('.css'))?.text || ''}</style><meta name="viewport" content="width=device-width, initial-scale=1"><div id="root"></div><script>${result.outputFiles.find(file=>file.path.endsWith('.js')).text}</script>`;
const browser=await chromium.launch({headless:true});
try{
 for(const width of [320,390,430,1440]){
  const context=await browser.newContext({viewport:{width,height:844}}),page=await context.newPage();let subscriptions=0,restores=0,enabled=false,connected=false,failRestore=false,inboxMessages=[];
  await page.addInitScript(()=>{
   window.PushManager=function(){};window.Notification={get permission(){return localStorage.getItem('fixture-permission') || 'default';},requestPermission:async()=>{localStorage.setItem('fixture-permission-calls',String(Number(localStorage.getItem('fixture-permission-calls'))+1));localStorage.setItem('fixture-permission','granted');return 'granted';}};
   const match=window.matchMedia;window.matchMedia=q=>q==='(display-mode: standalone)'?{matches:true}:match(q);
   Object.defineProperty(navigator,'serviceWorker',{value:{register:async()=>({active:true,pushManager:{getSubscription:async()=>({toJSON:()=>({endpoint:'synthetic',keys:{}})})}}),getRegistration:async()=>({pushManager:{getSubscription:async()=>localStorage.getItem('fixture-permission')==='granted'?{endpoint:'synthetic',unsubscribe:async()=>true}:null}})}});
  });
  await page.route('**/*',async route=>{
   const request=route.request(),url=new URL(request.url());
   if(url.pathname==='/crew-jobs')return route.fulfill({status:200,contentType:'text/html',body:html});
   assert.equal(url.pathname,'/api/crew-jobs/notifications');
   if(request.method()==='GET')return route.fulfill({json:{available:true,publicKey,enabled:enabled && connected,messages:inboxMessages}});
   const body=request.postDataJSON();if(body.action==='subscribe'){subscriptions++;enabled=true;connected=true;return route.fulfill({json:{deviceId:'synthetic-device',enabled:true}});}if(body.action==='restore'){restores++;assert.equal(body.endpoint,'synthetic');if(failRestore)return route.fulfill({status:503,json:{error:'Service restarting'}});assert.ok(body.notificationKey);assert.equal(body.deviceId,'synthetic-device');connected=enabled;return route.fulfill({json:{deviceId:'synthetic-device',enabled}});}throw Error('Unexpected notification action: '+body.action);
  });
  await page.goto('https://waypoint.fixture/crew-jobs');
  await expect(page.getByText('No office messages for this truck today.')).toBeVisible();
  const setup=await page.getByRole('region',{name:'Notification status',exact:true}).boundingBox(),inbox=await page.getByRole('region',{name:'Office Messages',exact:true}).boundingBox();
  assert.ok(inbox.y>=setup.y+setup.height+12,'Inbox is separated from notification setup');
  for(const name of ['Enable notifications','Refresh Messages'])assert.ok((await page.getByRole('button',{name,exact:true}).boundingBox()).height>=44,'Touch target remains at least 44px');
  if(process.env.WAYPOINT_PUSH_SCREENSHOTS){fs.mkdirSync(process.env.WAYPOINT_PUSH_SCREENSHOTS,{recursive:true});await page.screenshot({path:path.join(process.env.WAYPOINT_PUSH_SCREENSHOTS,`notifications-off-empty-${width}.png`),fullPage:true});}
  inboxMessages=[{id:'synthetic',body:'Synthetic office instruction for this truck.',created_at:new Date().toISOString()}];await page.getByRole('button',{name:'Refresh Messages',exact:true}).click();
  await expect(page.getByText('Synthetic office instruction for this truck.')).toBeVisible();assert.equal(await page.evaluate(()=>Number(localStorage.getItem('fixture-permission-calls'))),0,'No automatic permission prompt');
  await page.getByRole('button',{name:'Enable notifications',exact:true}).click();await expect(page.getByRole('status')).toContainText('Notifications enabled');assert.equal(subscriptions,1);assert.equal(await page.evaluate(()=>Number(localStorage.getItem('fixture-permission-calls'))),1);
  // A new daily phone session keeps browser permission and subscription but needs a new server binding.
  connected=false;await page.reload();await expect(page.getByText('Notifications are on and follow your current truck.')).toBeVisible();assert.equal(restores,1);assert.equal(subscriptions,1,'No new subscription or gesture on daily setup');assert.equal(await page.evaluate(()=>Number(localStorage.getItem('fixture-permission-calls'))),1,'Permission prompted only once');
  await page.reload();await expect(page.getByText('Notifications are on and follow your current truck.')).toBeVisible();assert.equal(restores,2,'Connected refresh validates the current browser endpoint');
  // Returning to the app recovers a missed binding without prompting.
  connected=false;await page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));await expect.poll(()=>restores).toBe(3);await expect(page.getByText('Notifications are on and follow your current truck.')).toBeVisible();
  enabled=false;connected=false;await page.reload();await expect(page.getByRole('button',{name:'Enable notifications',exact:true})).toBeEnabled();assert.equal(restores,4,'Server-disabled subscription is checked but never enabled');assert.equal(subscriptions,1);
  await page.getByRole('button',{name:'Enable notifications',exact:true}).click();await expect(page.getByRole('status')).toContainText('Notifications enabled');
  await expect(page.getByRole('button',{name:'Disable notifications',exact:true})).toHaveCount(0);
  failRestore=true;await page.reload();await expect(page.getByRole('alert')).toContainText('Office messages are up to date. Notifications could not reconnect');await expect(page.getByText('Synthetic office instruction for this truck.')).toBeVisible();
  if(process.env.WAYPOINT_PUSH_SCREENSHOTS)await page.screenshot({path:path.join(process.env.WAYPOINT_PUSH_SCREENSHOTS,`notifications-error-${width}.png`),fullPage:true});
  failRestore=false;await page.getByRole('button',{name:'Refresh Messages',exact:true}).click();await expect(page.getByText('Notifications are on and follow your current truck.')).toBeVisible();await expect(page.getByRole('alert')).toHaveCount(0);

  if(process.env.WAYPOINT_PUSH_SCREENSHOTS){fs.mkdirSync(process.env.WAYPOINT_PUSH_SCREENSHOTS,{recursive:true});await page.screenshot({path:path.join(process.env.WAYPOINT_PUSH_SCREENSHOTS,`notifications-${width}.png`),fullPage:true});}
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,`Fits ${width}px`);await context.close();
 }
 const context=await browser.newContext(),page=await context.newPage();const sent=[];let lose=true;
 await page.route('**/*',async route=>{const request=route.request(),url=new URL(request.url());if(url.pathname==='/composer')return route.fulfill({status:200,contentType:'text/html',body:html});assert.equal(url.pathname,'/api/crew-messages');sent.push(request.postDataJSON());if(lose){lose=false;return route.abort();}return route.fulfill({json:{saved:true}});});
 await page.goto('https://waypoint.fixture/composer');await page.getByRole('textbox',{name:'Office message'}).fill('Synthetic office message');await page.getByRole('button',{name:'Send to truck'}).click();await expect(page.getByRole('button',{name:'Check same message'})).toBeVisible();await page.reload();await expect(page.getByRole('button',{name:'Check same message'})).toBeVisible();await page.getByRole('button',{name:'Check same message'}).click();await expect(page.getByRole('status')).toContainText('Message saved');assert.deepEqual(sent[0],sent[1],'Lost response/reload retains original request ID/body');await context.close();
 console.log('PASS Waypoint push UI: explicit permission gesture, one-time enable with no disable control, office inbox, daily automatic restore, server revocation respected, 320/390/430/1440px, and lost office-message response recovery across reload. All browser APIs and sends mocked.');
}finally{await browser.close();}
