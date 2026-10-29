import fs from 'node:fs';
import {attributeWexAlert} from './wex-alert-attribution';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {wexFuelDirectory,type WexFuelTransaction} from './wex-fuel';
import type {WexPriceMessage} from './wex-realtime-prices';
import {validRosterDate} from './schedule-crew-roster';
import {isWexSource} from '../desktop-ui/lib/wex-source';

import type {WexExpenseAlert,WexAlertExpenseRow,WexAlertDailyExpenses} from '../desktop-ui/lib/wex-alert-expenses-contract';
export type {WexExpenseAlert,WexAlertExpenseRow,WexAlertDailyExpenses} from '../desktop-ui/lib/wex-alert-expenses-contract';
const normalized=(s:string)=>s.toLowerCase().replace(/[^a-z0-9]/g,'');
const cents=(n:number)=>Math.round(n*100);
const sourceUrlValid=isWexSource;
export function parseWexExpenseAlert(message:WexPriceMessage):WexExpenseAlert|null{
 if(!message||['id','sender','receivedAt','sourceUrl','body'].some(key=>typeof message[key as keyof WexPriceMessage]!=='string')||!message.id||message.sender.toLowerCase()!=='onlineservices@wexinc.com')return null;
 if(!sourceUrlValid(message.sourceUrl))return null;
 if(!/(?:Z|[+-]\d{2}:\d{2})$/.test(message.receivedAt)||!Number.isFinite(Date.parse(message.receivedAt)))return null;
 const body=message.body.replace(/<[^>]*>/g,' ').replace(/&nbsp;/g,' ').replace(/&amp;/g,'&');
 const field=(name:string)=>body.match(new RegExp(name+':\\s*\\|?\\s*([^\\n|]+)','i'))?.[1]?.trim()||'';
 const trackingNumber=field('Tracking Number'),reason=field('Reason'),local=field('Authorization Date & Time');
 const match=local.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4}) ([0-2]\d:[0-5]\d:[0-5]\d)$/);
 if(!/^\d+$/.test(trackingNumber)||!match||Number(match[4].slice(0,2))>23||!/fuel/i.test(reason))return null;
 const date=`${match[3]}-${match[1].padStart(2,'0')}-${match[2].padStart(2,'0')}`;
 if(!validRosterDate(date))return null;
 const amountMatch=reason.match(/\$([\d,]+(?:\.\d+)?)/),amount=amountMatch?Number(amountMatch[1].replaceAll(',','')):null;
 const units=Number(field('Units')),gallons=field('Units of Measure')==='GA'&&Number.isFinite(units)&&units>0?units:null;
 const state=/revers|void/i.test(reason)?'reversed':/declin/i.test(reason)?'declined':/Fuel purchase/i.test(reason)?'authorized':'unknown';
 return {messageId:message.id,trackingNumber,receivedAt:message.receivedAt,sourceUrl:message.sourceUrl,authorizationLocal:local,date,time:match[4],timeZone:null,state,amount:amount!==null&&Number.isFinite(amount)&&amount>0?amount:null,gallons,merchant:field('Merchant Name'),address:field('Merchant Address'),city:field('Merchant City'),stateCode:field('Merchant State / Province'),postalCode:field('Merchant Postal Code'),driver:[field('Driver First Name'),field('Driver Last Name')].filter(Boolean).join(' ')};
}
export const wexAlertExpenseFile=()=>path.join(wexFuelDirectory(),'alert-expenses.json');
type Store={version:1;importedAt:string;alerts:WexExpenseAlert[]};
function validStoredAlert(a:WexExpenseAlert){
 return a&&['messageId','trackingNumber','receivedAt','sourceUrl','authorizationLocal','date','time','merchant','address','city','stateCode','postalCode','driver'].every(key=>typeof a[key as keyof WexExpenseAlert]==='string')&&!!a.messageId&&/^\d+$/.test(a.trackingNumber)&&validRosterDate(a.date)&&/^([01]\d|2[0-3]):[0-5]\d:[0-5]\d$/.test(a.time)&&Number.isFinite(Date.parse(a.receivedAt))&&/(?:Z|[+-]\d{2}:\d{2})$/.test(a.receivedAt)&&sourceUrlValid(a.sourceUrl)&&a.timeZone===null&&['authorized','reversed','declined','unknown'].includes(a.state)&&[a.amount,a.gallons].every(n=>n===null||typeof n==='number'&&Number.isFinite(n)&&n>0);
}
function readStore():{store:Store;hash:string}{
 try{const bytes=fs.readFileSync(wexAlertExpenseFile()),store=JSON.parse(bytes.toString()) as Store;
  if(store.version!==1||!Number.isFinite(Date.parse(store.importedAt))||!Array.isArray(store.alerts)||store.alerts.some(a=>!validStoredAlert(a))||new Set(store.alerts.map(a=>a.messageId)).size!==store.alerts.length)throw Error('Invalid WEX alert expense store.');
  return {store,hash:createHash('sha256').update(bytes).digest('hex')};
 }catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;return {store:{version:1,importedAt:'',alerts:[]},hash:'missing'};}
}
export function prepareWexAlertExpenses(messages:WexPriceMessage[]){
 if(!Array.isArray(messages))throw Error('Expected an Outlook message array.');
 const {store,hash}=readStore(),byId=new Map(store.alerts.map(a=>[a.messageId,a]));let accepted=0;
 for(const message of messages){const alert=parseWexExpenseAlert(message);if(!alert)continue;accepted++;const old=byId.get(alert.messageId);if(old&&JSON.stringify(old)!==JSON.stringify(alert))throw Error('Conflicting content for an existing Outlook source ID.');byId.set(alert.messageId,alert);}
 return {alerts:[...byId.values()],sourceSha256:hash,summary:{supplied:messages.length,accepted,rejected:messages.length-accepted,added:byId.size-store.alerts.length,total:byId.size}};
}
export function importWexAlertExpenses(messages:WexPriceMessage[],expectedHash:string){
 const file=wexAlertExpenseFile();fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});const lock=file+'.lock',fd=fs.openSync(lock,'wx',0o600),temp=file+'.'+randomUUID()+'.tmp';
 try{const plan=prepareWexAlertExpenses(messages);if(plan.sourceSha256!==expectedHash)throw Error('WEX alert expenses changed after preflight.');
  if(plan.summary.added){fs.writeFileSync(temp,JSON.stringify({version:1,importedAt:new Date().toISOString(),alerts:plan.alerts}),{mode:0o600,flag:'wx'});fs.renameSync(temp,file);}return plan.summary;
 }finally{try{fs.rmSync(temp,{force:true});}finally{try{fs.closeSync(fd);}finally{fs.unlinkSync(lock);}}}
}
const clockSeconds=(s:string)=>s.split(':').reduce((sum,n)=>sum*60+Number(n),0);
const possibleRepeat=(a:WexExpenseAlert,b:WexExpenseAlert)=>a.date===b.date&&a.address.length>3&&a.driver.length>2&&normalized(a.address)===normalized(b.address)&&normalized(a.driver)===normalized(b.driver)&&Math.abs(clockSeconds(a.time)-clockSeconds(b.time))<=1800;
function matches(a:WexExpenseAlert,p:WexFuelTransaction,allowUnknownGallons=false){
 // Tracking Number is not assumed to be a posted Trans ID or receipt number.
 const time=p.transactionTime.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?$/i);if(!time)return false;
 const hour=time[4]?Number(time[1])%12+(time[4].toUpperCase()==='PM'?12:0):Number(time[1]);
 const clock=`${String(hour).padStart(2,'0')}:${time[2]}:${time[3]||'00'}`;
 return p.status==='posted'&&p.transactionDate===a.date&&clock===a.time&&a.address.length>3&&normalized(p.merchantAddress)===normalized(a.address)&&!!a.city&&normalized(p.city)===normalized(a.city)&&!!a.stateCode&&normalized(p.state)===normalized(a.stateCode)&&a.driver.length>2&&normalized(p.driver)===normalized(a.driver)&&(allowUnknownGallons||a.gallons!==null&&p.gallons===a.gallons);
}
export function reconcileWexAlertExpenses(date:string,alerts:WexExpenseAlert[],posted:WexFuelTransaction[],importedAt:string|null=null):WexAlertDailyExpenses{
 const groups=new Map<string,WexExpenseAlert[]>();for(const a of alerts)groups.set(a.trackingNumber,[...(groups.get(a.trackingNumber)||[]),a]);
 const all=[...groups.values()].map(versions=>{versions.sort((a,b)=>Date.parse(a.receivedAt)-Date.parse(b.receivedAt));return {versions,latest:versions.at(-1)!};});
 const candidates=all.map(({latest})=>posted.filter(p=>matches(latest,p)));
 const rows:WexAlertExpenseRow[]=all.filter(({versions})=>versions.some(a=>a.date===date)).map(({versions,latest:a})=>{
  const index=all.findIndex(g=>g.latest.trackingNumber===a.trackingNumber),options=candidates[index];
  const changedIdentity=versions.some(v=>v.date!==a.date||v.time!==a.time||normalized(v.address)!==normalized(a.address)||normalized(v.driver)!==normalized(a.driver));
  const simultaneous=versions.some(v=>v!==a&&Date.parse(v.receivedAt)===Date.parse(a.receivedAt)&&(v.amount!==a.amount||v.state!==a.state));
  const repeatedIdentity=all.some(g=>g.latest.trackingNumber!==a.trackingNumber&&possibleRepeat(g.latest,a));
  const unique=options.length===1&&candidates.filter(c=>c.some(p=>p.transactionId===options[0].transactionId)).length===1;
  const possibleSettlement=options.length===0&&posted.some(p=>matches(a,p,true));
  const conflict=possibleSettlement||changedIdentity||simultaneous||repeatedIdentity||options.length>0&&(!unique||a.state!=='authorized')||a.state==='unknown'||a.state==='authorized'&&versions.some(v=>v.state==='reversed');
  const p=!conflict&&unique?options[0]:null;
  const postedAmount=p?(p.totalFuelCost??(p.totalNonFuelCost===0?p.netCost:null)):null;
  const status:WexAlertExpenseRow['status']=conflict||p&&postedAmount===null?'review':p?'posted':a.state==='reversed'?'reversed':a.state==='declined'?'declined':a.amount===null?'review':'provisional';
  return {id:`wex-alert:${a.trackingNumber}`,trackingNumber:a.trackingNumber,date:a.date,truck:null,merchant:a.merchant,address:a.address,gallons:a.gallons,authorizationLocal:a.authorizationLocal,timeZone:null,receivedAt:a.receivedAt,sourceUrl:a.sourceUrl,sourceIds:versions.map(v=>v.messageId),revisionCount:versions.length,status,authorizedAmount:a.amount,postedAmount,postedId:p?.transactionId||null,difference:p&&postedAmount!==null&&a.amount!==null?(cents(postedAmount)-cents(a.amount))/100:null,
   reason:possibleSettlement?'Possible posted purchase with incomplete or changed quantities; email excluded to prevent a duplicate expense.':conflict?'Conflicting identity, sequence or multiple matching purchases; review required.':p&&postedAmount===null?'Posted purchase matched, but its fuel amount is unknown; review required.':p?'One posted purchase matches local date/time, merchant address, driver and gallons; posted amount replaces the authorization.':status==='reversed'?'Authorization reversed; excluded from pending amount.':status==='declined'?'Authorization declined; excluded from pending amount.':'Purchase alert counted on this day; settlement is pending.'};
 });
 const pending=rows.filter(r=>r.status==='provisional');
 return {date,status:'available',importedAt,rows,provisionalTotal:rows.some(r=>r.status==='review')||!pending.length?null:pending.reduce((sum,r)=>sum+cents(r.authorizedAmount!),0)/100,reviewCount:rows.filter(r=>r.status==='review').length,postedCount:rows.filter(r=>r.status==='posted').length};
}
export function readWexAlertExpenses(date:string,posted:WexFuelTransaction[]):WexAlertDailyExpenses{
 try{const {store,hash}=readStore();if(hash==='missing')return {date,status:'missing',importedAt:null,rows:[],provisionalTotal:null,reviewCount:0,postedCount:0};
  const result=reconcileWexAlertExpenses(date,store.alerts,posted,store.importedAt);
  for(const row of result.rows){
   if(!['provisional','posted'].includes(row.status))continue;
   const original=store.alerts.filter(a=>row.sourceIds.includes(a.messageId)&&a.state==='authorized').sort((a,b)=>Date.parse(a.receivedAt)-Date.parse(b.receivedAt))[0];
   if(original){row.attribution=attributeWexAlert(original);row.truck=row.attribution.truck;}
  }
  const purchases=result.rows.filter(row=>['provisional','posted'].includes(row.status));
  result.operatingTotal=purchases.length?purchases.reduce((sum,row)=>sum+cents(row.postedAmount??row.authorizedAmount??0),0)/100:null;
  result.unassignedTotal=purchases.filter(row=>!row.truck).reduce((sum,row)=>sum+cents(row.postedAmount??row.authorizedAmount??0),0)/100;
  return result;
 }catch{return {date,status:'invalid',importedAt:null,rows:[],provisionalTotal:null,reviewCount:0,postedCount:0};}
}

export function readWexAlertDates():string[]{
 try{return [...new Set(readStore().store.alerts.map(row=>row.date))].sort();}catch{return [];}
}
