import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {historyQuery,historyDate,historyDateBounds,historyResult,mergeHistoryResults} from '../lib/junkware-history-contract';
import {createHistoryLookup,HISTORY_UNAVAILABLE} from '../lib/junkware-history-search';
import {searchSubmission} from '../desktop-ui/lib/search-intent';
import {desktopSourceHref} from '../desktop-ui/lib/desktop-links';
import {authorizeOpsRequest} from '../lib/ops-roles';

const old=historyResult({appointmentId:'10001',jk:'JK1000001',name:'Example Customer',date:'2025-11-11',time:'2:00 PM – 3:00 PM',type:'Job',status:'Completed',address:'100 Example Road',phone:'5045550100'});
const recent=historyResult({appointmentId:'10002',jk:'JK1000002',name:'Example Customer',date:'2026-10-27',time:'9:00 AM – 10:00 AM',type:'Job',status:'Confirmed',address:'100 Example Road',phone:'5045550100'});
const result={results:[recent,old],hasMore:false,checkedAt:'2026-10-27T12:30:00Z'};
async function main(){
 for(const q of ['100 Example','JK1000001','(504) 555-0100','test@example.invalid','surname: Example']){assert.ok(historyQuery(q));assert.equal(searchSubmission(q,true,[],[]),'lookup','Enter must not spend a question for an identifier');}
 for(const q of ['Who did the most work?','total revenue','What happened yesterday?','truck 9','12','a'.repeat(121)])assert.equal(historyQuery(q),null);
 for(const q of ['5 biggest jobs last week?','3 trucks idle today','10 largest jobs this month','2 crews','2026 revenue','1 M','1 Ma','100 Ex']){
  assert.equal(historyQuery(q),null,'Questions and incomplete street tokens must not start source browsers');
  assert.equal(searchSubmission(q,true,[],[]),'assistant','Keep Enter available for numeric-leading questions');
 }
 assert.equal(historyQuery('1 Oak')?.field,'AddressTB');
 assert.equal(historyQuery('100 Main St Apt 2')?.field,'AddressTB');
 assert.equal(historyQuery('address: 10 Jobs Lane')?.field,'AddressTB','Explicit addresses resolve ambiguous words');
 assert.equal(historyQuery('JK 1000001')?.value,'JK1000001');
 assert.equal(historyQuery('+1 (504) 555-0100')?.value,'5045550100');
 assert.equal(historyDate('11/11/2025'),'2025-11-11');assert.throws(()=>historyDate('02/30/2026'));
 assert.deepEqual(historyDateBounds('all','2026-10-27'),{start:'',end:''});
 assert.deepEqual(historyDateBounds('past','2026-01-01'),{start:'',end:'12/31/2025'});
 assert.deepEqual(historyDateBounds('upcoming','2026-10-27'),{start:'10/27/2026',end:''});
 assert.deepEqual(mergeHistoryResults([],result.results),result.results,'An uncollected historical date must not prevent discovery');
 assert.deepEqual(mergeHistoryResults([recent],result.results),result.results,'A newer saved match must not hide completed history');
 const stale={...old,id:'job:2025-11-10:10001',href:old.href.replace('2025-11-11','2025-11-10')};
 assert.equal(mergeHistoryResults([stale],[old]).length,1,'Deduplicate by appointment identity across date changes');
 const destination=new URL(desktopSourceHref(old.href,'https://example.invalid'),'https://example.invalid');
 assert.equal(destination.pathname,'/desktop');assert.equal(destination.searchParams.get('date'),'2025-11-11');assert.equal(destination.searchParams.get('appointment'),'10001');assert.equal(destination.searchParams.get('sourceLookup'),'1');
 assert.ok(old.subtitle.includes('Completed'));assert.ok(!old.subtitle.includes('Unassigned'));
 let runs=0,clock=0;const lookup=createHistoryLookup(async()=>{runs++;return result;},()=>clock);
 await Promise.all([lookup('100 Example','all'),lookup('100 example','all')]);assert.equal(runs,1);
 await lookup('100 Example','all');assert.equal(runs,1);
 clock=60001;await lookup('100 Example','all');assert.equal(runs,2);
 await lookup('100 Example','past');assert.equal(runs,3,'Scope gets a separate source search');
 const finishes:Array<(value:typeof result)=>void>=[];
 const busy=createHistoryLookup(()=>new Promise(resolve=>{finishes.push(resolve);}));
 const first=busy('100 Example','all');const second=busy('101 Example','all');
 await assert.rejects(busy('102 Example','all'),new RegExp(HISTORY_UNAVAILABLE));
 for(const finish of finishes)finish(result);await Promise.all([first,second]);
 let attempts=0;const retry=createHistoryLookup(async()=>{attempts++;if(attempts===1)throw Error('source failed');return result;});
 await assert.rejects(retry('100 Example','all'));assert.equal((await retry('100 Example','all')).results.length,2);
 // Exercise the real route with isolated authentication and source dependencies.
 let actor: {role:string}|null={role:'admin'},allowed=true,sourceCalls=0,savedCalls=0,customerCalls=0,customerAllowed=true,customerFail=false,fail=false;
 const mocks:Record<string,unknown>={
  'next/server':{NextResponse:Response},'next/headers':{cookies:async()=>({get:()=>({value:'test-session'})})},
  '@/lib/auth':{AUTH_SESSION_COOKIE:'session',verifyAuthSessionCookie:async()=>actor},
  '@/lib/ops-roles':{authorizeOpsRequest:()=>({allowed}),opsRoleCan:()=>customerAllowed},
  '@/lib/platform/request-actor':{validOperatingDate:()=> '2026-10-27'},
  '@/lib/customer-accounts':{readCustomers:async()=>{customerCalls++;if(customerFail)throw Error('private customer data');return {customers:[{id:'500'}],total:1};}},
  '@/lib/global-search':{customerSearchResult:()=>({id:'customer:500',type:'customer',title:'Sample Customer',href:'/desktop?workspace=Schedule&scheduleView=customers&customer=500'}),buildGlobalSearchResponse:()=>{savedCalls++;return {results:[],coverage:{dateCount:0}};}},
  '@/lib/junkware-history-contract':{historyQuery},
  '@/lib/junkware-history-search':{HISTORY_UNAVAILABLE,lookupJunkwareHistory:async(_q:string,scope:string)=>{sourceCalls++;if(fail)throw Error('private upstream data');return {...result,results:scope==='past'?[old]:result.results};}},
 };
 const exports:Record<string,unknown>={};
 vm.runInNewContext(ts.transpileModule(fs.readFileSync('app/api/global-search/route.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,require:(id:string)=>{assert.ok(id in mocks,id);return mocks[id];},URL,Response,Date});
 const get=exports.GET as(request:Request)=>Promise<Response>;
 const request=(params='source=junkware&q=100%20Example')=>get(new Request('https://example.invalid/api/global-search?'+params));
 assert.equal((await (await request()).json()).results[1].title,old.title);assert.equal(savedCalls,0,'Live lookup does not depend on saved date coverage');
 assert.equal((await (await request('source=junkware&q=100%20Example&scope=past')).json()).results.length,1);
 const called=sourceCalls;actor=null;assert.equal((await request()).status,401);actor={role:'admin'};allowed=false;assert.equal((await request()).status,403);allowed=true;assert.equal(sourceCalls,called);
 assert.equal((await request('source=junkware&q=who%20worked')).status,400);assert.equal(sourceCalls,called);
 fail=true;const failure=await request();assert.equal(failure.status,503);assert.equal((await failure.json()).error,HISTORY_UNAVAILABLE);
 const saved=await (await request('q=Example')).json();assert.equal(savedCalls,1,'Saved search remains independently available');assert.equal(saved.results[0].type,'customer');assert.equal(customerCalls,1);customerAllowed=false;assert.equal((await (await request('q=Example')).json()).results.length,0);assert.equal(customerCalls,1,'No customer lookup without existing operations.read permission');customerAllowed=true;customerFail=true;const customerFailure=await (await request('q=Example')).json();assert.match(customerFailure.customerError,/could not be searched/);assert.equal(customerFailure.results.length,0);assert.ok(!customerFailure.customerError.includes('private'));
 assert.equal(authorizeOpsRequest('operator','/api/global-search','GET').allowed,true);
 console.log('PASS: historical discovery without saved days, partial saved matches, deduplication, scope, links, identifier Enter, cache/coalescing/concurrency, failures and API authorization. No live data or provider calls.');
}
void main().catch(error=>{console.error(error);process.exitCode=1;});
