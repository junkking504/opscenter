import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {pickupSourceNoteCandidates,recordPickupSourceNote,pickupSourceNoteNotices} from '../lib/truck-pickup-source-notes';

const root=fs.mkdtempSync(path.join(os.tmpdir(),'pickup-source-notes-'));
process.env.OPSCENTER_DATA_DIR=root;
const date='2026-09-06';
const job:Parameters<typeof pickupSourceNoteCandidates>[1][number]={appointmentId:'1001',jkNumber:'JK1001',truck:'Truck 9',status:'Completed',appointmentType:'Job',appointmentNotes:[],chargeDetailsPending:false,closeoutObservedAt:`${date}T22:20:00Z`,closeout:{loadQuantity:1,loadSize:'1/4',loadPrice:100,bedloadQuantity:0,bedloadSize:'',bedloadPrice:0,otherCharges:[],discount:0,tip:0,total:100,payments:[],balance:0}};
const visit={appointment_id:'1001',truck_number:'Truck 4',match_confidence:'confirmed',first_arrival:`${date}T21:38:16Z`,final_departure:`${date}T22:10:16Z`};
async function main() {
  try {
    const [candidate]=pickupSourceNoteCandidates(date,[job],[visit]);
    assert.ok(candidate.note.length<=500);
    assert.match(candidate.note,/Truck 4 arrived 4:38:16 PM and departed 5:10:16 PM CT/);
    assert.match(candidate.note,/1\/4 truck.*Recorded assignment: Truck# 9/);
    for(const patch of [{truck:'Truck 4'},{appointmentType:'Estimate'},{status:'Canceled'},{chargeDetailsPending:true},{closeout:null}])
      assert.equal(pickupSourceNoteCandidates(date,[{...job,...patch}],[visit]).length,0);
    assert.equal(pickupSourceNoteCandidates(date,[job],[visit,{...visit,truck_number:'Truck 9'}]).length,0);
    assert.equal(pickupSourceNoteCandidates(date,[job,{...job,truck:'Truck 6'}],[visit]).length,0);
    assert.equal(pickupSourceNoteCandidates(date,[{...job,appointmentNotes:[candidate.note]}],[visit]).length,0);
    let calls=0;
    const write:Parameters<typeof recordPickupSourceNote>[2]=async input=>{calls++;assert.equal(input.ifAbsent,true);assert.equal(input.expectedDate,date);return {...input,verifiedAt:new Date().toISOString()};};
    await Promise.all([recordPickupSourceNote(candidate,'test',write),recordPickupSourceNote(candidate,'test',write)]);
    await recordPickupSourceNote(candidate,'test',write);
    assert.equal(calls,1,'Concurrent refreshes and retries reserve only one source write');
    const failed={...candidate,key:'a'.repeat(64)};
    await recordPickupSourceNote(failed,'test',async()=>{calls++;throw new Error('Response lost');});
    await recordPickupSourceNote(failed,'test',write);
    assert.equal(calls,2,'An uncertain submission is never automatically replayed');
    assert.equal(pickupSourceNoteNotices(date,[job]).length,1,'Unverified writes remain visible');
    assert.equal(pickupSourceNoteNotices(date,[{...job,appointmentNotes:[candidate.note]}]).length,0,'Collected saved notes resolve uncertain receipts without a second write');
    console.log('Pickup source notes passed: physical evidence, completed-only scope, source assignment preservation, length, deduplication, concurrent reservations, uncertain writes and read-back recovery.');
  } finally {fs.rmSync(root,{recursive:true,force:true});}
}
void main();
