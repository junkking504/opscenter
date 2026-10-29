import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const fixture={actor:null as null|{email:string;role:string},calls:[] as string[][],receipt:{id:'11111111-1111-4111-8111-111111111111',actor:'manager@example.invalid',status:'preview',employeeName:'Synthetic Crew',workDate:'2026-10-28',before:{clockIn:'07:00 AM',clockOut:'03:00 PM',hourlyRate:20}},fail:false};
async function main(){
 (globalThis as any).__timecardApi=fixture;
 const mocks:Record<string,string>={
 'next/headers':`export async function cookies(){return {get:()=>({value:'fixture'})}}`,
 '@/lib/auth':`export const AUTH_SESSION_COOKIE='fixture';export function verifyAuthSessionCookie(){return globalThis.__timecardApi.actor}export function resolveRequestOrigin(r){return new URL(r.url).origin}`,
 '@/lib/desktop-krewe':`export function readDesktopKreweDay(date,name){if(name!=='Synthetic Crew'||date!=='2026-10-28')throw Error('unknown');return {date,member:{name}}}`,
 '@/lib/timecard-deletions':`export function readTimecardDelete(id){const r=globalThis.__timecardApi.receipt;return id===r.id?r:null}export function publicTimecardDelete(r){const {actor,...rest}=r;return rest}export async function runTimecardDeleteWorker(args){const f=globalThis.__timecardApi;f.calls.push(args);if(f.fail)throw Error('fixture failure');if(!args.includes('--preview'))f.receipt.status='verified';return {id:f.receipt.id}}`,
 };
 const result=await build({entryPoints:['app/api/desktop/timecards/route.ts'],bundle:true,write:false,platform:'node',format:'cjs',plugins:[{name:'synthetic-only',setup(b){b.onResolve({filter:/^(next\/headers|@\/lib\/(auth|desktop-krewe|timecard-deletions))$/},args=>({path:args.path,namespace:'fixture'}));b.onLoad({filter:/.*/,namespace:'fixture'},args=>({contents:mocks[args.path],loader:'js'}));}}]});
 const fixtureModule={exports:{} as any};new Function('require','module','exports',result.outputFiles[0].text)(require,fixtureModule,fixtureModule.exports);const api=fixtureModule.exports;
 const post=(body:unknown,origin='https://fixture.invalid')=>api.POST(new Request('https://fixture.invalid/api/desktop/timecards',{method:'POST',headers:{origin,'Content-Type':'application/json'},body:JSON.stringify(body)}));
 assert.equal((await post({action:'preview'})).status,401);assert.equal(fixture.calls.length,0);
 fixture.actor={email:'manager@example.invalid',role:'operator'};assert.equal((await post({action:'preview'})).status,403);assert.equal(fixture.calls.length,0);
 fixture.actor.role='manager';assert.equal((await post({action:'preview'},'https://other.invalid')).status,403);assert.equal(fixture.calls.length,0);
 assert.equal((await post({action:'delete',id:fixture.receipt.id})).status,400);assert.equal(fixture.calls.length,0);
 fixture.actor.email='other@example.invalid';assert.equal((await post({action:'delete',id:fixture.receipt.id,confirm:true})).status,404);assert.equal(fixture.calls.length,0);
 fixture.actor.email='manager@example.invalid';assert.equal((await post({action:'preview',name:'Synthetic Crew',date:'2026-10-28'})).status,200);assert.ok(fixture.calls[0].includes('--preview'));
 fixture.calls=[];assert.equal((await api.GET(new Request(`https://fixture.invalid/api/desktop/timecards?id=${fixture.receipt.id}`))).status,200);assert.equal(fixture.calls.length,0,'GET never launches a source operation');
 assert.equal((await post({action:'check',id:fixture.receipt.id})).status,200);assert.ok(fixture.calls[0].includes('--check'),'Recovery is explicitly read-only');
 fixture.receipt.status='preview';fixture.calls=[];assert.equal((await post({action:'delete',id:fixture.receipt.id,confirm:true})).status,200);assert.equal(fixture.calls.length,1);assert.equal((await post({action:'delete',id:fixture.receipt.id,confirm:true})).status,200);assert.equal(fixture.calls.length,1,'Verified replay cannot launch another worker');
 fixture.receipt.status='submitted';fixture.fail=true;assert.equal((await post({action:'check',id:fixture.receipt.id})).status,202,'Uncertain worker result is not success');
 console.log('PASS deletion API: unauthenticated/operator/cross-origin denied, actor-bound receipts, explicit confirmation, preview only, read-only checks and verified duplicate suppression. All source workers mocked.');
 delete (globalThis as any).__timecardApi;
}
main().catch(e=>{console.error(e);process.exitCode=1;});
