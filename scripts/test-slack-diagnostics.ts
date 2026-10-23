import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fetchSlackDailyDigest } from '../lib/slack-digest';
import { createSlackDiagnostics, persistSlackWindow, type SlackDiagnosticWindow } from '../lib/slack-diagnostics';
import { createSettledPromiseCache } from '../lib/settled-promise-cache';
async function main(){
 let time=Date.parse('2026-10-09T20:00:00Z');
 const windows:SlackDiagnosticWindow[]=[];
 const diagnostics=createSlackDiagnostics({now:()=>time,persist:w=>{windows.push(structuredClone(w));return true;}});
 const message={ts:'1791576000.000001',text:'Synthetic operational update',reply_count:1};
 const response=(payload:object,status=200,headers:Record<string,string>={})=>new Response(JSON.stringify(payload),{status,headers});
 let calls=0;
 const limited=(async(input:RequestInfo|URL)=>{calls++;const url=new URL(String(input));return url.pathname.endsWith('replies')?response({ok:false,error:'ratelimited'},429,{'Retry-After':'120'}):response({ok:true,messages:[message]});}) as typeof fetch;
 const options={token:'xoxb-private-token',channelIds:['PRIVATE_CHANNEL'],appointments:[],completedRows:[],diagnostics,fetchImpl:limited};
 let digest=await fetchSlackDailyDigest('2026-10-09',options);
 assert.equal(digest.status,'ready');assert.equal(digest.complete,false);assert.equal(digest.messages.length,1);
 assert.equal(digest.reasonCounts?.['conversations.replies:rate_limited'],1);assert.match(digest.detail!,/Thread replies: rate limited/);
 assert.equal(calls,2);
 digest=await fetchSlackDailyDigest('2026-10-09',options);
 assert.equal(calls,3,'history stays usable but replies make no call during cooldown');assert.equal(digest.reasonCounts?.['conversations.replies:cooldown'],1);
 time+=119_999;await fetchSlackDailyDigest('2026-10-09',options);assert.equal(calls,4);
 time+=1;await fetchSlackDailyDigest('2026-10-09',options);assert.equal(calls,6,'Retry-After boundary releases the method');
 // Other workspace credential does not inherit this bot's cooldown.
 await fetchSlackDailyDigest('2026-10-09',{...options,token:'xoxb-another-workspace'});assert.equal(calls,8);
 const paths=['history_failure','history_cursor','reply_cursor','reply_http','reply_network','reply_timeout','invalid_response','cursor_cycle'] as const;
 for(const scenario of paths){
  const observer=createSlackDiagnostics({now:()=>time});
  let pages=0;
  const fetchImpl=(async(input:RequestInfo|URL)=>{
   const url=new URL(String(input)), bad=url.searchParams.get('channel')==='BAD', replies=url.pathname.endsWith('replies');
   if(!bad)return response({ok:true,messages:[{...message,reply_count:0,ts:'1791576001.000001'}]});
   if(scenario==='history_failure'&&!replies)return response({ok:false,error:'arbitrary secret reason'});
   if(scenario==='history_cursor'&&!replies)return response({ok:true,messages:[{...message,reply_count:0}],has_more:true});
   if(scenario==='cursor_cycle'&&!replies){pages++;return response({ok:true,messages:[],has_more:true,response_metadata:{next_cursor:'same'}});}
   if(!replies)return response({ok:true,messages:[message]});
   if(scenario==='reply_cursor')return response({ok:true,messages:[],has_more:true});
   if(scenario==='reply_http')return response({},503);
   if(scenario==='reply_network')throw new Error('SECRET endpoint payload');
   if(scenario==='reply_timeout')throw new DOMException('SECRET','TimeoutError');
   return response({ok:true,messages:'not an array'});
  }) as typeof fetch;
  const result=await fetchSlackDailyDigest('2026-10-09',{...options,diagnostics:observer,channelIds:['GOOD','BAD'],fetchImpl});
  assert.equal(result.status,'ready',scenario);assert.equal(result.complete,false,scenario);assert(result.messages.some(m=>m.id.startsWith('GOOD:')),scenario);
  assert(result.detail && !result.detail.includes('SECRET') && !result.detail.includes('arbitrary'),scenario);
  const reason={history_failure:'conversations.history:api_error',history_cursor:'conversations.history:missing_cursor',reply_cursor:'conversations.replies:missing_cursor',reply_http:'conversations.replies:http_error',reply_network:'conversations.replies:network_error',reply_timeout:'conversations.replies:timeout',invalid_response:'conversations.replies:invalid_response',cursor_cycle:'conversations.history:cursor_cycle'}[scenario];
  assert.equal(result.reasonCounts?.[reason as keyof NonNullable<typeof result.reasonCounts>],1,scenario);
  if(scenario==='cursor_cycle')assert.equal(pages,2);
 }
 for(const reason of ['not_in_channel','channel_not_found','missing_scope','invalid_auth','account_inactive','is_archived'] as const){
  const result=await fetchSlackDailyDigest('2026-10-09',{...options,diagnostics:createSlackDiagnostics(),fetchImpl:(async()=>response({ok:false,error:reason}))as typeof fetch});
  assert.equal(result.status,'unavailable');assert.equal(result.reasonCounts?.[`conversations.history:${reason}`],1);assert(result.detail);
 }
 const historyObserver=createSlackDiagnostics({now:()=>time});let historyCalls=0;
 const historyLimited=(async()=>{historyCalls++;return response({ok:false,error:'ratelimited'},200,{'Retry-After':'bad'});})as typeof fetch;
 const historyOptions={...options,diagnostics:historyObserver,channelIds:['A','B','C'],fetchImpl:historyLimited};
 const unavailable=await fetchSlackDailyDigest('2026-10-09',historyOptions);
 assert.equal(historyCalls,1);assert.equal(unavailable.status,'unavailable');assert.equal(unavailable.reasonCounts?.['conversations.history:cooldown'],2);
 time+=59_999;await fetchSlackDailyDigest('2026-10-09',historyOptions);assert.equal(historyCalls,1);
 time+=1;await fetchSlackDailyDigest('2026-10-09',historyOptions);assert.equal(historyCalls,2);
 diagnostics.cool('xoxb-long','conversations.history','172800');time+=86400_000;assert(diagnostics.cooling('xoxb-long','conversations.history'),'long valid server cooldown is not shortened');
 diagnostics.flush();assert.equal(windows.length,1);const serialized=JSON.stringify(windows);
 for(const secret of ['private-token','PRIVATE_CHANNEL','Synthetic operational','1791576000'])assert(!serialized.includes(secret));
 assert(windows[0].counters['refresh:partial']!.count>=4);
 diagnostics.flush();assert.equal(windows.length,1);time+=299_999;diagnostics.flush();assert.equal(windows.length,1);
 // A storage failure stays visible without changing usable channel coverage.
 let broken=true;
 const storageObserver=createSlackDiagnostics({now:()=>time,persist:()=>{if(broken)throw new Error('SECRET private path');return true;}});
 time+=300_000;
 const storageOptions={...options,diagnostics:storageObserver,fetchImpl:(async()=>response({ok:true,messages:[]}))as typeof fetch};
 const realWarn=console.warn;console.warn=()=>{};
 try{const failedStorage=await fetchSlackDailyDigest('2026-10-09',storageOptions);assert.equal(failedStorage.complete,true);assert.match(failedStorage.detail!,/Diagnostic history unavailable/);assert(!failedStorage.detail!.includes('SECRET'));}finally{console.warn=realWarn;}
 broken=false;time+=300_000;
 const recoveredStorage=await fetchSlackDailyDigest('2026-10-09',storageOptions);assert(!recoveredStorage.detail?.includes('Diagnostic history unavailable'));
 // In-flight cache remains shared beyond TTL, then starts a fresh TTL on success.
 let loads=0,resolve!:(value:number)=>void;
 const cache=createSettledPromiseCache<number>(30_000,()=>time);
 const first=cache('today',()=>{loads++;return new Promise(r=>resolve=r);});await Promise.resolve();
 time+=60_000;assert.equal(cache('today',async()=>{loads++;return 9;}),first);assert.equal(loads,1);
 resolve(7);assert.equal(await first,7);time+=29_999;assert.equal(await cache('today',async()=>99),7);
 time+=1;assert.equal(await cache('today',async()=>{loads++;return 8;}),8);assert.equal(loads,2);
 await assert.rejects(cache('failure',async()=>{throw new Error('fixture');}));assert.equal(await cache('failure',async()=>3),3);
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'slack-aggregate-'));
 try {
  const w=(at:number):SlackDiagnosticWindow=>({startedAt:new Date(at-300_000).toISOString(),finishedAt:new Date(at).toISOString(),counters:{'refresh:complete':{count:1,durationMs:20,maxDurationMs:20}}});
  assert(persistSlackWindow(w(time),directory));assert.equal(persistSlackWindow(w(time+299_999),directory),false);
  assert(persistSlackWindow(w(time+300_000),directory));assert(persistSlackWindow(w(time+8*86400_000),directory));
  const data=JSON.parse(fs.readFileSync(path.join(directory,'summary.json'),'utf8'));assert.equal(data.windows.length,1,'seven-day retention is bounded');
  const before=fs.readFileSync(path.join(directory,'summary.json'),'utf8');fs.writeFileSync(path.join(directory,'summary.lock'),String(process.pid));assert.throws(()=>persistSlackWindow(w(time+9*86400_000),directory),/lock unavailable/);assert.equal(fs.readFileSync(path.join(directory,'summary.json'),'utf8'),before);
  fs.unlinkSync(path.join(directory,'summary.lock'));
  fs.writeFileSync(path.join(directory,'summary.json'),JSON.stringify({schema:1,windows:[{...w(time),counters:{'PRIVATE_CHANNEL:secret':{count:1,durationMs:0,maxDurationMs:0}}}]}));
  const corrupt=fs.readFileSync(path.join(directory,'summary.json'),'utf8');
  assert.throws(()=>persistSlackWindow(w(time+9*86400_000),directory),/Invalid diagnostic history/);
  assert.equal(fs.readFileSync(path.join(directory,'summary.json'),'utf8'),corrupt,'corrupt history is preserved');
  // Reproduce the old stale-lock replacement opportunity: no read/unlink of an
  // existing lock is attempted, even when its stored PID belongs to a dead owner.
  fs.writeFileSync(path.join(directory,'summary.lock'),'2147483647');
  const originalRead=fs.readFileSync;
  let inspectedLock=false;
  fs.readFileSync=((...args: Parameters<typeof fs.readFileSync>)=>{
    if(String(args[0]).endsWith('summary.lock')){inspectedLock=true;fs.writeFileSync(path.join(directory,'summary.lock'),String(process.pid));}
    return originalRead(...args);
  }) as typeof fs.readFileSync;
  try{assert.throws(()=>persistSlackWindow(w(time+9*86400_000),directory),/lock unavailable/);}finally{fs.readFileSync=originalRead;}
  assert.equal(inspectedLock,false);assert.equal(fs.readFileSync(path.join(directory,'summary.lock'),'utf8'),'2147483647');
 }finally{fs.rmSync(directory,{recursive:true,force:true});}
 console.log('Slack diagnostics: all incomplete paths, usable successful channels, method/workspace cooldowns, long Retry-After, in-flight TTL, privacy and seven-day aggregate retention passed. Synthetic requests only.');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
