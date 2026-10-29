import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {previewTimecardDeletion, executeTimecardDeletion, type SourceTimecard, type TimecardDeletion, type TimecardDeletionAdapter} from '../lib/timecard-deletion';
const base:SourceTimecard={entryId:'fixture-entry-1',employeeId:'fixture-employee',marketId:'fixture-market',workDate:'2026-10-28',clockIn:'07:00 AM',clockOut:'12:00 PM',clockOutDate:'2026-10-28',hourlyRate:20,version:'fixture-v1'};
const sibling={...base,entryId:'fixture-entry-2',clockIn:'01:00 PM',clockOut:'05:00 PM'};
const now=()=> '2026-10-29T01:00:00.000Z';
function setup() {
  let source=structuredClone([base,sibling]), submits=0, prepares=0;
  const receipts:TimecardDeletion[]=[];
  const preview=previewTimecardDeletion({id:randomUUID(),actor:'manager@example.invalid',employeeName:'Synthetic Employee',selected:base,entries:source,now:now()});
  const journal={write:(row:TimecardDeletion)=>{receipts.push(structuredClone(row));}};
  const adapter:TimecardDeletionAdapter={read:async()=>structuredClone(source),prepare:async()=>{prepares++;},submit:async()=>{assert.equal(receipts.at(-1)?.state,'submitted');assert.deepEqual(receipts.at(-1)?.before,base);submits++;source=source.filter(x=>x.entryId!==base.entryId);},reload:async()=>{}};
  const run=(row=preview,confirm=true,clock=now)=>executeTimecardDeletion(row,{actor:preview.actor,confirm,now:clock},adapter,journal);
  return {preview,adapter,journal,run,receipts,get source(){return source;},set source(value){source=value;},get submits(){return submits;},get prepares(){return prepares;}};
}
async function main(){
  const happy=setup();const result=await happy.run();assert.equal(result.state,'verified');assert.deepEqual(happy.source,[sibling]);assert.equal(happy.submits,1);assert.deepEqual(result.before,base);assert.deepEqual(result.siblings,[sibling]);await happy.run(result);assert.equal(happy.submits,1);
  const cancel=setup();assert.equal((await cancel.run(cancel.preview,false)).state,'preview');assert.equal(cancel.prepares,0);assert.equal(cancel.submits,0);
  const stale=setup();stale.source[0].clockIn='08:00 AM';assert.equal((await stale.run()).state,'failed');assert.equal(stale.submits,0);
  const adjacent=setup();adjacent.source[1].clockOut='06:00 PM';assert.equal((await adjacent.run()).state,'failed');assert.equal(adjacent.submits,0);
  const editor=setup();editor.adapter.prepare=async()=>{throw new Error('Native entry identity changed');};assert.equal((await editor.run()).state,'failed');assert.equal(editor.submits,0);
  const expired=setup();assert.equal((await expired.run(expired.preview,true,()=> '2026-10-29T01:05:00.000Z')).state,'failed');assert.equal(expired.submits,0);
  const auth=setup();await assert.rejects(()=>executeTimecardDeletion(auth.preview,{actor:'other@example.invalid',confirm:true,now},auth.adapter,auth.journal),/another manager/);assert.equal(auth.submits,0);
  const lost=setup();const submit=lost.adapter.submit;lost.adapter.submit=async()=>{await submit();throw new Error('Response lost');};assert.equal((await lost.run()).state,'verified');assert.equal(lost.submits,1);
  const uncertain=setup();let attempts=0;uncertain.adapter.submit=async()=>{attempts++;throw new Error('Connection lost before outcome');};const unconfirmed=await uncertain.run();assert.equal(unconfirmed.state,'uncertain');await uncertain.run(unconfirmed);assert.equal(attempts,1,'Never retry an uncertain submission');uncertain.source=[sibling];assert.equal((await uncertain.run(unconfirmed,false)).state,'verified');assert.equal(attempts,1);
  const otherChanged=setup();const remove=otherChanged.adapter.submit;otherChanged.adapter.submit=async()=>{await remove();otherChanged.source[0].clockOut='06:00 PM';};assert.equal((await otherChanged.run()).state,'uncertain');
  const audit=setup();let submitted=false;audit.adapter.submit=async()=>{submitted=true;};await assert.rejects(()=>executeTimecardDeletion(audit.preview,{actor:audit.preview.actor,confirm:true,now},audit.adapter,{write:()=>{throw new Error('Disk unavailable');}}),/Disk/);assert.equal(submitted,false,'Never submit without durable before-image');
  assert.throws(()=>previewTimecardDeletion({id:randomUUID(),actor:'manager',employeeName:'Synthetic',selected:{...base,entryId:''},entries:[base],now:now()}),/stable/);
  assert.throws(()=>previewTimecardDeletion({id:randomUUID(),actor:'manager',employeeName:'Synthetic',selected:base,entries:[base,base],now:now()}),/ambiguous/);
  assert.throws(()=>previewTimecardDeletion({id:randomUUID(),actor:'manager',employeeName:'Synthetic',selected:base,entries:[base,{...sibling,employeeId:'other'}],now:now()}),/identity/);
  console.log('Timecard deletion core: preview/cancel, identity, stale entry/siblings, expiry, actor binding, durable audit, lost response, read-only recovery and no repeat submission passed. Synthetic adapters only; no source deletion or production adapter.');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
