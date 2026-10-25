import fs from 'node:fs';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {wexFuelDirectory} from './wex-fuel';
import {parseWexExpenseAlert,prepareWexAlertExpenses,importWexAlertExpenses,reconcileWexAlertExpenses} from './wex-alert-expenses';
import {parseWexPriceMessage,prepareWexRealtimePrices,importWexRealtimePrices,type WexPriceMessage} from './wex-realtime-prices';
import type {FuelPriceEvidence} from './appointment-cost-model';
import type {WexMailFeedStatus} from '../desktop-ui/lib/wex-alert-expenses-contract';

export type NativeWexPacket={messages:WexPriceMessage[];sources:Array<{id:string;accountId:string;internetMessageId:string;receivedAt:string}>};
const file=(name:string)=>path.join(wexFuelDirectory(),name);
function read<T>(name:string,fallback:T):T{try{return JSON.parse(fs.readFileSync(file(name),'utf8'));}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return fallback;throw e;}}
function atomic(name:string,value:unknown){const target=file(name),temp=target+'.'+randomUUID()+'.tmp';try{fs.writeFileSync(temp,JSON.stringify(value),{mode:0o600,flag:'wx'});fs.renameSync(temp,target);}finally{fs.rmSync(temp,{force:true});}}
const equivalent=(a:ReturnType<typeof parseWexExpenseAlert>,b:ReturnType<typeof parseWexExpenseAlert>)=>a&&b&&JSON.stringify({...a,messageId:'',sourceUrl:''})===JSON.stringify({...b,messageId:'',sourceUrl:''});

type PriceDependencies={attribute?:Parameters<typeof prepareWexRealtimePrices>[1];assignments?:Parameters<typeof prepareWexRealtimePrices>[2]};
export function prepareNativeWex(packet:NativeWexPacket,dependencies:PriceDependencies={}){
 if(!packet||!Array.isArray(packet.messages)||!Array.isArray(packet.sources)||packet.sources.length!==packet.messages.length)throw Error('Invalid native WEX packet.');
 const previous=read<Array<NativeWexPacket['sources'][number]>>('native-mail-evidence.json',[]);
 const sources=new Map(previous.map(s=>[s.id,s]));
 const seen=new Map<string,string>();
 const prior=prepareWexAlertExpenses([]);
 let aliases=0;
 const canonical=packet.messages.map((message,index)=>{
  const source=packet.sources[index];
  if(!source||typeof source.accountId!=='string'||!/^[-a-z0-9]{1,100}$/i.test(source.accountId)||typeof source.internetMessageId!=='string'||!/^<[^\s<>]+@[^\s<>]+>$/.test(source.internetMessageId))throw Error('Native WEX source identity missing.');
  const id='outlook-local:'+createHash('sha256').update(source.accountId+'\0'+source.internetMessageId).digest('hex');
  if(source.id!==id||message.id!==id||message.sourceUrl!==id||source.receivedAt!==message.receivedAt)throw Error('Native WEX source identity mismatch.');
  const parsed=parseWexExpenseAlert(message);if(!parsed)throw Error('Native WEX alert rejected.');
  const bodyDigest=createHash('sha256').update(JSON.stringify({...parsed,messageId:'',sourceUrl:''})).digest('hex');
  if(seen.has(id)&&seen.get(id)!==bodyDigest)throw Error('Conflicting content for a native WEX source ID.');seen.set(id,bodyDigest);
  const evidence={...source,bodyDigest},old=sources.get(id);if(old&&JSON.stringify(old)!==JSON.stringify(evidence))throw Error('Native WEX source identity changed.');sources.set(id,evidence);
  const matches=prior.alerts.filter(a=>equivalent(a,parsed));
  if(matches.length>1)throw Error('Ambiguous cross-source WEX identity.');
  if(matches.length===1&&matches[0].messageId!==id){aliases++;return {...message,id:matches[0].messageId,sourceUrl:matches[0].sourceUrl};}
  return message;
 });
 const daily=prepareWexAlertExpenses(canonical);
 const rows=[...new Set(daily.alerts.map(a=>a.date))].flatMap(date=>reconcileWexAlertExpenses(date,daily.alerts,[]).rows);
 const prices=read<{rows:FuelPriceEvidence[]}>('realtime-prices.json',{rows:[]});
 const blocked=new Set(rows.filter(r=>r.status!=='provisional').map(r=>r.trackingNumber));
 const newPrices=canonical.filter(message=>{
  const parsed=parseWexPriceMessage(message);if(!parsed)return false;
  const row=rows.find(r=>r.trackingNumber===parsed.trackingNumber);
  if(!row||row.status!=='provisional'||row.receivedAt!==message.receivedAt||row.sourceUrl!==message.sourceUrl)return false;
  const old=prices.rows.find(p=>p.trackingNumber===parsed.trackingNumber);
  if(old){if(old.amount!==parsed.amount||old.gallons!==parsed.gallons)blocked.add(parsed.trackingNumber);return false;}
  return true;
 });
 const pricePlan=prepareWexRealtimePrices(newPrices,dependencies.attribute,dependencies.assignments);
 return {canonical,sources:[...sources.values()],daily,pricePlan,newPrices,blocked:[...blocked],summary:{received:packet.messages.length,crossSourceAliases:aliases,newDaily:daily.summary.added,newPrices:pricePlan.summary.added,blockedPrices:blocked.size}};
}

export function importNativeWex(packet:NativeWexPacket,dependencies:PriceDependencies={}){
 fs.mkdirSync(wexFuelDirectory(),{recursive:true,mode:0o700});
 const lock=file('mail-feed.lock'),fd=fs.openSync(lock,'wx',0o600);
 try{
  const plan=prepareNativeWex(packet,dependencies),startedAt=new Date().toISOString();
  atomic('mail-feed-status.json',{status:'applying',checkedAt:startedAt});
  atomic('native-mail-evidence.json',plan.sources);
  importWexAlertExpenses(plan.canonical,plan.daily.sourceSha256);
  importWexRealtimePrices(plan.newPrices,dependencies.attribute,dependencies.assignments,plan.pricePlan.sourceSha256,plan.blocked);
  const result={status:'available',checkedAt:new Date().toISOString(),latestReceivedAt:packet.sources.map(s=>s.receivedAt).sort().at(-1)||null,...plan.summary};
  atomic('mail-feed-status.json',result);return result;
 }catch(e){atomic('mail-feed-status.json',{status:'apply_failed',checkedAt:new Date().toISOString(),error:'WEX import did not complete; inspect private evidence before retry.'});throw e;}
 finally{try{fs.closeSync(fd);}finally{fs.unlinkSync(lock);}}
}

function watcherAvailability():WexMailFeedStatus['watcher']{
 if(process.platform!=='darwin'||!process.getuid)return 'unknown';
 try{const state=execFileSync('/bin/launchctl',['print',`gui/${process.getuid()}/com.hermes.event-intake`],{encoding:'utf8',timeout:500,stdio:['ignore','pipe','ignore']});return /^\s*state = running\s*$/m.test(state)?'running':'not_running';}catch{return 'unknown';}
}
export function readWexMailFeedStatus(watcher=watcherAvailability):WexMailFeedStatus{
 try{const application=read<WexMailFeedStatus['application']>('mail-feed-status.json',null),source=read<WexMailFeedStatus['source']>('mail-source-status.json',null);return {watcher:application||source?watcher():'unknown',application,source};}
 catch{return {watcher:'unknown',application:{status:'invalid'},source:null};}
}
