import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { readEstimateFollowups, saveEstimateFollowup, parseEstimateChange } from '../lib/estimate-follow-up';
import { estimateSummary } from '../desktop-ui/lib/estimate-contract';
const directory = fs.mkdtempSync(path.join(os.tmpdir(),'estimate-followup-test-'));
const previous = process.env.OPSBOT_DATA_DIR;
process.env.OPSBOT_DATA_DIR = directory;
const history = path.join(directory,'history/junkware'); fs.mkdirSync(history,{recursive:true});
const today = '2026-09-10';
const source = (id: string, extra: Record<string,unknown> = {}) => ({ appt_id:id,job_id:`JK${id}`,customer_name:`Synthetic ${id}`,phone:'',appointment_date:'2026-08-12',appointment_type:'Estimate',final_status:'Completed',collection_timestamp:'2026-08-12T12:00:00Z',closeout:{total:'$500.00'},appointment_notes:['Quote given.'],...extra });
const write = (date: string, rows: unknown[]) => fs.writeFileSync(path.join(history,`junkware_${date}_raw.json`),JSON.stringify({appointments:rows,completed:[],cancelled:[],scraped_at:`${date}T18:00:00Z`}));
const actor = {email:'synthetic@example.test',role:'operator' as const};
try {
  const legacyFile=path.join(history,'junkware_2026-07-11_raw.json');
  fs.writeFileSync(legacyFile,JSON.stringify({completed:[source('099',{appointment_date:'2026-07-11'})]}));
  write('2026-08-12',[source('100'),source('101'),source('102'),source('103'),source('104'),source('105',{phone:'5045550100'}),source('106',{final_status:'Confirmed'}),source('107',{final_status:'Cancelled'}),source('108',{closeout:{total:''}})]);
  write('2026-09-10',[
    source('201',{appointment_type:'Job',appointment_date:today,source_estimate_appointment_id:'101',collection_timestamp:'2026-09-10T12:00:00Z'}),
    source('202',{appointment_type:'Job',appointment_date:today,source_estimate_appointment_id:'102',final_status:'Cancelled',collection_timestamp:'2026-09-10T12:00:00Z'}),
    source('103',{appointment_type:'Job',appointment_date:today,collection_timestamp:'2026-09-10T12:00:00Z'}),
    source('204',{appointment_type:'Job',job_id:'JK104',appointment_date:today}),
    source('205',{appointment_type:'Job',phone:'(504)555-0100',appointment_date:today}),
  ]);
  let snapshot=readEstimateFollowups(today);
  const get=(id:string)=>snapshot.rows.find(row=>row.id===id)!;
  assert.equal(get('101').status,'converted','cross-date explicit link counts');
  assert.equal(get('103').status,'converted','same appointment converted in place counts');
  assert.equal(get('102').status,'verify_booking','canceled booking returns for review');
  assert.equal(get('102').canceledBookings.length,1);
  assert.equal(get('104').status,'verify_booking','same JK is not a conversion');
  assert.equal(get('104').possibleBookings.length,1);
  assert.equal(get('105').status,'verify_booking','same phone is not a conversion');
  assert.equal(get('105').possibleBookings.length,1);
  assert.equal(get('108').quote,null,'missing quote is not zero');
  assert.equal(get('106'),undefined,'not-yet-given estimate excluded');
  assert.equal(get('107'),undefined,'canceled estimate excluded');
  assert.equal(get('099').status,'verify_booking','older archives may omit empty buckets');
  const change={requestId:randomUUID(),id:'100',expectedVersion:get('100').version,status:'waiting',owner:'Synthetic Owner',nextFollowup:'2026-09-09',reason:'Waiting on customer approval',note:'Called customer; agreed to check tomorrow.',contacted:true};
  assert.throws(()=>parseEstimateChange({...change,owner:''}),/one owner/);
  assert.throws(()=>parseEstimateChange({...change,nextFollowup:'2026-02-30'}),/valid follow-up date/);
  assert.throws(()=>parseEstimateChange({...change,contacted:true,note:''}),/Describe the contact/);
  assert.throws(()=>parseEstimateChange({...change,status:'converted'}),/valid estimate/);
  const event=saveEstimateFollowup(change,actor,today);
  assert.equal(event.after.owner,'Synthetic Owner');assert.ok(event.after.lastContactAt);
  assert.deepEqual(saveEstimateFollowup(change,actor,today),event,'same request is idempotent');
  assert.throws(()=>saveEstimateFollowup(change,{...actor,email:'other@example.test'},today),/another change/);
  assert.throws(()=>saveEstimateFollowup({...change,requestId:randomUUID()},actor,today),/estimate changed/,'stale drafts cannot overwrite');
  snapshot=readEstimateFollowups(today);assert.equal(get('100').history.length,1);assert.equal(get('100').overdue,true);assert.equal(estimateSummary(snapshot).overdue,1);
  assert.throws(()=>saveEstimateFollowup({...change,requestId:randomUUID(),id:'101',expectedVersion:get('101').version},actor,today),/linked job/);
  const lost=saveEstimateFollowup({...change,requestId:randomUUID(),expectedVersion:get('100').version,status:'lost',reason:'Customer no longer needs service',contacted:false,note:''},actor,today);
  assert.equal(lost.after.nextFollowup,'');assert.equal(lost.after.lastContactAt,event.after.lastContactAt);
  snapshot=readEstimateFollowups(today);assert.equal(get('100').status,'lost');assert.equal(estimateSummary(snapshot).overdue,0);
  const file=path.join(history,'junkware_2026-09-10_raw.json');const day=JSON.parse(fs.readFileSync(file,'utf8'));day.appointments.push(source('300',{appointment_type:'Job',appointment_date:today,source_estimate_appointment_id:'100',collection_timestamp:'2026-09-10T15:00:00Z'}));fs.writeFileSync(file,JSON.stringify(day));
  snapshot=readEstimateFollowups(today);assert.equal(get('100').status,'converted','source conversion overrides local lost disposition');assert.equal(get('100').history.length,2,'source refresh preserves local history');
  const store=path.join(directory,'estimate-follow-up/state.json');assert.equal(fs.statSync(store).mode & 0o777,0o600);
  fs.writeFileSync(store,'broken');assert.throws(()=>readEstimateFollowups(today),/Saved follow-up history is unavailable/);assert.throws(()=>saveEstimateFollowup(change,actor,today),/Saved follow-up history is unavailable/);
  fs.unlinkSync(store);fs.mkdirSync(path.join(directory,'estimate-follow-up/.write-lock'));assert.throws(()=>saveEstimateFollowup(change,actor,today),/requires recovery/);fs.rmdirSync(path.join(directory,'estimate-follow-up/.write-lock'));
  fs.writeFileSync(file,'broken');snapshot=readEstimateFollowups(today);assert.equal(snapshot.coverage.unreadable,1);assert.equal(get('101').status,'verify_booking','unreadable file does not reuse stale cached conversion');
  fs.writeFileSync(legacyFile,'broken');fs.writeFileSync(path.join(history,'junkware_2026-08-12_raw.json'),'broken');assert.throws(()=>readEstimateFollowups(today),/All estimate history files/);
  console.log('Estimate follow-ups PASS: cross-date and in-place conversions, cancellations, ambiguous matching, missing quotes, ownership/dates, durable contact history, actor-bound retries, conflicts, lost/converted precedence, corruption and crash locks. Synthetic only.');
} finally { if (previous === undefined) delete process.env.OPSBOT_DATA_DIR; else process.env.OPSBOT_DATA_DIR=previous; fs.rmSync(directory,{recursive:true,force:true}); }
