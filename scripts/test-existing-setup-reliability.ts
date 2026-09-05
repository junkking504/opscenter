import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseCalledDate, parseCalledAt, canonicalSearchKingsCallId } from '../lib/searchkings';
import { freshnessLabel } from '../lib/fleet-map';
import { sourceFreshness } from '../lib/source-freshness';
import { publishCrewValue, writeCrewSyncStatus } from '../lib/crew-portal-sync';
import { financePeriodComparison } from '../lib/finance-period-comparison';
import { desktopWorkItemHref } from '../lib/desktop-record-links';

async function main() {
  const call = { id:'fixture', name:'Fixture call', tagList:[], calledAtDate:'Sep 4, 2026', calledAtTime:'7:09 pm CDT', callerNumberComplete:'5555550100', duration:'30' };
  assert.equal(parseCalledDate(call),'2026-09-04');
  assert.equal(parseCalledAt(call),'2026-09-05T00:09:00.000Z');
  assert.equal(canonicalSearchKingsCallId(call),canonicalSearchKingsCallId({...call,calledAtDate:'2026-09-05'}),'Existing call identity must retain notes and overrides');
  const at=(date:string,time:string)=>parseCalledAt({...call,calledAtDate:date,calledAtTime:time});
  assert.equal(at('2026-11-01','1:30 am'),'');
  assert.equal(at('2026-11-01','1:30 am CST'),'2026-11-01T07:30:00.000Z');
  assert.equal(at('2026-11-01','1:30 am CDT'),'2026-11-01T06:30:00.000Z');
  assert.equal(at('2026-03-08','2:30 am'),'');
  assert.equal(at('2026-09-04','unknown'),'');
  assert.equal(at('2026-02-30','7:00 am'),'');
  assert.equal(at('2026-99-99','7:00 am'),'');
  assert.equal(at('2026-09-04','25:10'),'');
  const now=Date.now();
  const today=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Chicago'}).format(now);
  const gps=(timestamp:string|null)=>freshnessLabel({hasPayload:true,latestTimestamp:timestamp,selectedDate:today});
  assert.equal(gps(null),'GPS unavailable');
  assert.equal(gps('invalid'),'GPS unavailable');
  assert.equal(gps(new Date(now+60000).toISOString()),'GPS unavailable');
  assert.equal(gps(new Date(now-120000).toISOString()),'Live GPS');
  assert.equal(gps(new Date(now-181000).toISOString()),'GPS Stale');
  assert.equal(sourceFreshness('2020-01-01T00:00:00Z',1200,now).fresh,false);
  assert.equal(sourceFreshness(new Date(now+120000).toISOString(),1200,now).fresh,false);
  assert.equal(sourceFreshness('',1200,now).fresh,false);
  assert.equal(sourceFreshness(new Date(now-1200000).toISOString(),1200,now).fresh,true);
  const ok={status:0,stdout:'{"value":1}',stderr:''};
  let puts=0,reads=0;
  await publishCrewValue('test','/fixture',{value:1},args=>{
    if(args[2]==='put') { puts++; return puts===1?{status:1,stdout:'',stderr:'fetch failed'}:ok; }
    reads++; return reads===1?{...ok,stdout:'{"value":0}'}:ok;
  },async()=>{});
  assert.equal(puts,2); assert.equal(reads,2);
  let authAttempts=0;
  await assert.rejects(publishCrewValue('test','/fixture',{value:1},()=>{authAttempts++;return {status:1,stdout:'',stderr:'Authentication error [code: 10000]'};},async()=>{}),/authentication/);
  assert.equal(authAttempts,1);
  puts=0; reads=0;
  await assert.rejects(publishCrewValue('test','/fixture',{value:1},args=>{if(args[2]==='put')puts++;else reads++;return {...ok,stdout:'{}'};},async()=>{}),/read-back unconfirmed/);
  assert.equal(puts,1); assert.equal(reads,5);
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ops-reliability-'));
  try {
    const file=path.join(dir,'status.json');
    writeCrewSyncStatus(file,{status:'synchronized',lastSuccessAt:'2026-09-05T10:00:00Z'});
    writeCrewSyncStatus(file,{status:'failed',lastAttemptAt:'2026-09-05T10:05:00Z',error:'network'});
    assert.equal(JSON.parse(fs.readFileSync(file,'utf8')).lastSuccessAt,'2026-09-05T10:00:00Z');
  } finally {fs.rmSync(dir,{recursive:true,force:true});}
  const matched=financePeriodComparison('2026-09-05',()=>({total_revenue:10,net_profit:0}));
  assert.equal(matched.priorEnd,'2026-08-05'); assert.equal(matched.currentRevenue,50); assert.equal(matched.currentProfit,0);
  assert.equal(financePeriodComparison('2026-03-31',()=>null).currentEnd,'2026-03-28');
  assert.equal(financePeriodComparison('2026-01-03',()=>null).priorEnd,'2025-12-03');
  assert.equal(financePeriodComparison('2026-09-05',date=>date==='2026-08-03'?null:{total_revenue:10}).priorRevenue,null);
  const link=new URL(desktopWorkItemHref({operatingDate:'2026-09-04',category:'Dispatch',entity:{type:'job',id:'2026-09-04:appointment:123',label:'Job'}}),'http://fixture');
  assert.equal(link.searchParams.get('date'),'2026-09-04'); assert.equal(link.searchParams.get('appointment'),'2026-09-04:appointment:123');
  console.log('Existing setup reliability regression checks passed.');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
