import assert from 'node:assert/strict';
import {isTruckOnlyMove,truckMoveOwner,type TruckMove} from '../lib/web-push-truck-move';
import {pushSchedule} from '../lib/web-push-schedule';
import {pushMessage} from '../lib/web-push-message';
const before={date:'2026-10-22',time:'12:00 PM - 01:00 PM',label:'JK123 — Synthetic',status:'Confirmed',type:'Job',truck:'Truck #4'};
const after={...before,truck:'Truck #9',changedFields:['truck']};
const input:TruckMove={identity:'synthetic',observedAt:new Date().toISOString(),previous:before,current:after};
assert.equal(truckMoveOwner(input,'owner@example.test'),'owner@example.test');
assert.equal(truckMoveOwner(input,undefined),null,'default preserves notifications');
for(const change of [{date:'2026-10-23'},{time:'01:00 PM - 02:00 PM'},{status:'Completed'},{status:'Cancelled'},
 {type:'Estimate'},{label:'JK456'},{changedFields:['truck','driver']},{changedFields:['truck','time']},{changedFields:undefined}])
 assert.equal(truckMoveOwner({...input,current:{...after,...change}},'owner@example.test'),null);
assert.equal(isTruckOnlyMove({...input,previous:null}),false,'new appointment stays visible');
assert.equal(isTruckOnlyMove({...input,current:null}),false,'removal stays visible');
assert.equal(isTruckOnlyMove({...input,current:{...after,truck:'Truck #4'}}),false,'no truck change');
assert.equal(isTruckOnlyMove({...input,previous:{...before,truck:'Truck #Virtual Truck'}}),true,'existing appointment assigned from virtual truck');
assert.equal(isTruckOnlyMove({...input,previous:{...before,status:'Completed'},current:{...after,status:'Completed'}}),true,'truck-only correction after completion is still a truck move');
assert.deepEqual(pushSchedule(after)?.changedFields,['truck']);
assert.equal(pushSchedule({...after,changedFields:['unrecognized']})?.changedFields,undefined);
assert.deepEqual(pushMessage({title:'Schedule updated',body:'Synthetic',schedule:after}),{title:'Schedule updated',body:'Synthetic'},'private metadata never enters wire payload');
console.log('PASS truck-move preference: actor-independent, exact owner only; date/time/status/type/crew changes, new/removal and unknown metadata remain visible; private metadata excluded.');
