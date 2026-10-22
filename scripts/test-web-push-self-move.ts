import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {isTruckOnlyMove,selfMoveOwner,readSelfMoveOwner,type SelfMove} from '../lib/web-push-self-move';
import {pushSchedule} from '../lib/web-push-schedule';
import {pushMessage} from '../lib/web-push-message';
async function main(){
const at=Date.now(),stamp=(offset:number)=>new Date(at+offset).toISOString();
const before={date:'2026-10-22',time:'12:00 PM - 01:00 PM',label:'JK123 — Synthetic',status:'Confirmed',type:'Job',truck:'Truck #4'};
const after={...before,truck:'Truck #9',changedFields:['truck']};
const input:SelfMove={identity:createHash('sha256').update('"123"\n').digest('hex'),observedAt:stamp(0),previous:before,current:after};
const receipt={action:'move',status:'verified',date:before.date,recordId:before.date+':appointment:123',actor:'owner@example.test',createdAt:stamp(-30000),updatedAt:stamp(-10000),sourceResult:{junkware:{appointmentId:'123',date:before.date,changed:true,previousTruck:'Truck 4',truck:'Truck 9',previousAppointmentStartMinutes:720,appointmentStartMinutes:720,appointmentEndMinutes:780,verifiedAt:stamp(-11000)}}};
assert.equal(selfMoveOwner(input,[receipt],receipt.actor),receipt.actor);
assert.equal(selfMoveOwner(input,[receipt],undefined),null,'default preserves notifications');
assert.equal(selfMoveOwner(input,[receipt],'other@example.test'),null,'other users retain notices');
assert.equal(selfMoveOwner(input,[{...receipt,actor:'other@example.test'}],receipt.actor),null,'other actors retain notices');
for(const change of [{date:'2026-10-23'},{time:'01:00 PM - 02:00 PM'},{status:'Completed'},{type:'Estimate'},{label:'JK456'},
 {changedFields:['truck','driver']},{changedFields:['truck','time']},{changedFields:undefined}]){
 assert.equal(selfMoveOwner({...input,current:{...after,...change}},[receipt],receipt.actor),null);
}
for(const changes of [{status:'pending'},{status:'uncertain'},{action:'reschedule'},{createdAt:stamp(-16*60000)},{updatedAt:stamp(1)},{recordId:'wrong'},{date:'2026-10-21'}])
 assert.equal(selfMoveOwner(input,[{...receipt,...changes}],receipt.actor),null);
for(const changes of [{previousTruck:'Truck 3'},{truck:'Truck 3'},{appointmentId:'999'},{previousAppointmentStartMinutes:660},{appointmentEndMinutes:840},{verifiedAt:'bad'},{changed:false}])
 assert.equal(selfMoveOwner(input,[{...receipt,sourceResult:{junkware:{...receipt.sourceResult.junkware,...changes}}}],receipt.actor),null);
assert.equal(selfMoveOwner(input,[receipt,{...receipt,actor:'other@example.test'}],receipt.actor),null,'ambiguous source writer stays visible');
assert.equal(selfMoveOwner({...input,previous:{...before,truck:'Truck #Virtual Truck'}},[{...receipt,sourceResult:{junkware:{...receipt.sourceResult.junkware,previousTruck:''}}}],receipt.actor),receipt.actor);
assert.equal(isTruckOnlyMove({...input,previous:null}),false,'new appointment stays visible');
assert.equal(isTruckOnlyMove({...input,current:null}),false,'removal stays visible');
assert.deepEqual(pushSchedule(after)?.changedFields,['truck']);
assert.equal(pushSchedule({...after,changedFields:['unrecognized']})?.changedFields,undefined);
assert.deepEqual(pushMessage({title:'Schedule updated',body:'Synthetic',schedule:after}),{title:'Schedule updated',body:'Synthetic'},'private attribution metadata never enters wire payload');
const dir=await fs.mkdtemp(path.join(os.tmpdir(),'self-move-test-'));
try{
 const file=path.join(dir,'00000000-0000-4000-8000-000000000001.json');await fs.writeFile(file,JSON.stringify(receipt));
 assert.equal(await readSelfMoveOwner(input,receipt.actor,dir),receipt.actor);
 await fs.writeFile(file,'not json');assert.equal(await readSelfMoveOwner(input,receipt.actor,dir),null);
 await fs.unlink(file);await fs.symlink(path.join(dir,'missing'),file);assert.equal(await readSelfMoveOwner(input,receipt.actor,dir),null);
 assert.equal(await readSelfMoveOwner(input,receipt.actor,path.join(dir,'absent')),null);
}finally{await fs.rm(dir,{recursive:true,force:true});}
console.log('PASS self-move: exact owner/actor/identity/truck/time, all other recipients and reschedules preserved; stale/uncertain/ambiguous/missing receipts leave delivery on; private metadata excluded. Synthetic local files only.');

}
main().catch(error=>{console.error(error);process.exitCode=1;});
