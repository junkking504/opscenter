import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { sendManagerNotification, readPushoverApproval, reservePushover, type PushoverIO } from '../lib/pushover-transport';
import { trialFingerprint } from '../lib/web-push-trial';
import type { PushEnvelope } from '../lib/web-push-message';

async function main(){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'ops-pushover-test-'));
 try{
  const now=Date.now(),file=path.join(root,'config.json');
  const envelope:PushEnvelope={subscription:{endpoint:'https://web.push.apple.com/Q'+'a'.repeat(32),keys:{p256dh:'a'.repeat(87),auth:'a'.repeat(22)}},recordedAt:new Date(now).toISOString(),message:{title:'Synthetic schedule change',body:'Test only\nNo real records',path:'/jobs?date=2026-10-22#job-jk123'}};
  const config={schema:1,enabled:true,provider:'pushover',purpose:'opscenter-notifications',approvedAt:new Date(now-1000).toISOString(),expiresAt:new Date(now+600000).toISOString(),approvalReference:'synthetic-only',maxAdditionalSpendMicros:0,maxAttempts:3,content:'existing-alert-details',subscriptionFingerprint:trialFingerprint(envelope.subscription),token:'x'.repeat(30),user:'y'.repeat(30),device:'testphone'};
  const write=(value:unknown)=>fs.writeFileSync(file,JSON.stringify(value),{mode:0o600});
  const reset=()=>{write(config);fs.chmodSync(file,0o600);fs.writeFileSync(file+'.ledger.json',JSON.stringify({schema:1,approvalReference:'synthetic-only',attempts:0}),{mode:0o600});};
  reset();let apple=0,calls:string[]=[],payload:URLSearchParams|undefined;
  const io:PushoverIO={configPath:()=>file,enabled:()=>true,now:()=>now,
    apple:async()=>{apple++;return 201;},post:async(route,fields,authorize)=>{assert.equal(await authorize(),true);calls.push(route);if(route.endsWith('validate.json'))return {status:200,body:{status:1,devices:['testphone']}};payload=fields;return {status:200,body:{status:1}};}};
  const send=(overrides:Partial<PushoverIO>={},item=envelope,authorize=async()=>true)=>sendManagerNotification(item.subscription.endpoint,authorize,now+60000,item,{...io,...overrides});
  assert.equal(await send({configPath:()=>undefined}),201);assert.equal(apple,1);assert.equal(calls.length,0);
  assert.equal(await send(),201);assert.equal(apple,1);assert.equal(calls.length,2);
  assert.equal(payload!.get('device'),'testphone');assert.equal(payload!.get('priority'),'0');assert.equal(payload!.has('sound'),false);assert.equal(payload!.get('url'),'https://ops.junk-king.app/jobs?date=2026-10-22#job-jk123');
  assert.equal(JSON.parse(fs.readFileSync(file+'.ledger.json','utf8')).attempts,1);
  // Unicode truncation and plain text; malformed paths cannot inject a URL.
  await send({}, {...envelope,message:{title:'test',body:'🙂'.repeat(800),path:'https://example.invalid'}});
  assert.ok(payload!.get('message')!.length<=1024);assert.ok(!/[\uD800-\uDBFF]…$/.test(payload!.get('message')!));assert.equal(payload!.get('url'),'https://ops.junk-king.app/desktop');
  await assert.rejects(send({},envelope,async()=>false));assert.equal(JSON.parse(fs.readFileSync(file+'.ledger.json','utf8')).attempts,2);
  const callCount=calls.length;
  assert.equal(await send({}, {...envelope,recordedAt:new Date(now-10000).toISOString()}),400);assert.equal(calls.length,callCount);
  const other={...envelope,subscription:{...envelope.subscription,endpoint:envelope.subscription.endpoint+'b'}};
  await send({},other);assert.equal(apple,2);assert.equal(calls.length,callCount);
  await assert.rejects(send({enabled:()=>false}));
  // Failure is never retried or routed back to Apple; uncertain consumes slot.
  reset();calls=[];
  await assert.rejects(send({post:async()=>{calls.push('uncertain');throw Error('network');}}));assert.equal(calls.length,1);assert.equal(apple,2);assert.equal(JSON.parse(fs.readFileSync(file+'.ledger.json','utf8')).attempts,1);
  for(const body of [{status:0},{status:1,devices:[]},{status:1,devices:['testphone','second']},{status:1,devices:['renamed']},{status:1,group:1,devices:['testphone']}]){
    reset();let attempts=0;assert.equal(await send({post:async()=>{attempts++;return {status:200,body};}}),400);assert.equal(attempts,1);
  }
  reset();let attempts=0;
  assert.equal(await send({post:async(route)=>{attempts++;return route.endsWith('validate.json')?{status:200,body:{status:1,devices:['testphone']}}:{status:410,body:{status:0}};}}),400);assert.equal(attempts,2);assert.equal(apple,2);
  // Approval changes between validation and send prevent the message.
  reset();attempts=0;
  await assert.rejects(send({post:async()=>{attempts++;write({...config,enabled:false});return {status:200,body:{status:1,devices:['testphone']}};}}));assert.equal(attempts,1);
  for(const patch of [{enabled:false},{expiresAt:new Date(now).toISOString()},{approvedAt:new Date(now+1).toISOString()},{maxAdditionalSpendMicros:1},{maxAttempts:10001},{content:'anything'},{device:'bad,device'},{provider:'other'}]){
    reset();write({...config,...patch});await assert.rejects(send());
  }
  reset();fs.chmodSync(file,0o644);await assert.rejects(send());
  reset();fs.unlinkSync(file+'.ledger.json');await assert.rejects(send());
  reset();fs.writeFileSync(file+'.ledger.json','not json');await assert.rejects(send());
  reset();fs.mkdirSync(file+'.ledger.json.lock');await assert.rejects(send());fs.rmdirSync(file+'.ledger.json.lock');
  reset();const approved=readPushoverApproval(file,now).approval;
  reservePushover(file,approved);reservePushover(file,approved);reservePushover(file,approved);
  assert.throws(()=>reservePushover(file,approved));assert.equal(JSON.parse(fs.readFileSync(file+'.ledger.json','utf8')).attempts,3);
  reset();fs.renameSync(file,file+'.real');fs.symlinkSync(file+'.real',file);await assert.rejects(send());
  console.log('Pushover mocked checks passed: routing, recipient validation, payload, authorization, quota durability and no-retry/no-fallback. No live requests.');
 }finally{fs.rmSync(root,{recursive:true,force:true});}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
