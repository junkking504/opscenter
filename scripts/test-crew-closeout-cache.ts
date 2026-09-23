import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {savedCrewCloseout,readSavedCrewCloseout,forgetSavedCrewCloseout} from '../lib/crew-closeout-cache';
import {MAX_CHECKOUT_PHOTOS} from '../lib/crew-photo-limits';
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'waypoint-cache-test-'));
process.env.OPSCENTER_DATA_DIR=dir;
const scope={assignmentId:'test',appointmentId:'123',date:'2026-09-22',truck:'Truck 1'};
let reads=0;
const read=async()=>{reads++;await new Promise(resolve=>setTimeout(resolve,10));return {closeout:{status:{value:'1',label:'Confirmed'},total:'400'},arrival:null,jobVersion:'version'};};
async function main(){try{
  const [a,b]=await Promise.all([savedCrewCloseout(scope,false,read),savedCrewCloseout(scope,false,read)]);
  assert.deepEqual(a,b);assert.equal(reads,1,'Simultaneous warm and open use one source read');
  assert.deepEqual(await savedCrewCloseout(scope,false,read),a);assert.equal(reads,1);
  assert.equal(readSavedCrewCloseout(scope)?.jobVersion,'version','Snapshot persists outside process memory');
  for(const altered of [{...scope,truck:'Truck 2'},{...scope,appointmentId:'456'},{...scope,assignmentId:'different'},{...scope,date:'2026-09-23'}])assert.equal(readSavedCrewCloseout(altered),null);
  assert.equal(readSavedCrewCloseout(scope,Date.parse(a.savedAt)+24*60*60_000),null);
  await savedCrewCloseout(scope,true,read);assert.equal(reads,2,'Explicit reload reads source');
  forgetSavedCrewCloseout(scope);assert.equal(readSavedCrewCloseout(scope),null);
  assert.equal(MAX_CHECKOUT_PHOTOS,25);
  console.log('PASS: durable appointment-scoped cache, one source read, refresh bypass, expiry, truck/day/assignment isolation, invalidation, 25 photos.');
}finally{fs.rmSync(dir,{recursive:true,force:true});}}
void main().catch(error=>{console.error(error);process.exitCode=1;});
