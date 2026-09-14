import assert from 'node:assert/strict';
import {withSavedCloseoutTruck} from '../lib/command-closeout-truck';
import type {OperationalAlert} from '../lib/operational-alert-presentation';

const event = {id:'completion',label:'Job Completed',title:'Truck 9 · JK4087819',truck:'Truck 9',facts:[{label:'Payment',value:'$328.00 Cash'}],timestamp:'2026-09-14T23:08:00Z'} as OperationalAlert;
const corrected = withSavedCloseoutTruck(event,[{status:'Completed',truck:'Truck# 4'}]);
assert.equal(corrected.truck,'Truck 4');
assert.equal(corrected.title,'Truck 4 · JK4087819');
assert.equal(corrected.id,event.id);
assert.equal(corrected.timestamp,event.timestamp);
assert.deepEqual(corrected.facts,event.facts);
assert.equal(event.truck,'Truck 9','Original historical event remains unchanged');
for(const rows of [[],[{status:'Completed',truck:'Truck 4'},{status:'Completed',truck:'Truck 9'}],[{status:'Confirmed',truck:'Truck 4'}],[{status:'Completed',truck:'—'}],[{status:'Completed',truck:'Virtual Truck'}]]) {
  assert.equal(withSavedCloseoutTruck(event,rows),event,'Missing, ambiguous or nonterminal source cannot rewrite the heading');
}
assert.equal(withSavedCloseoutTruck({...event,label:'Arrival'},[{status:'Completed',truck:'Truck 4'}]).truck,'Truck 9','Historical arrival truck is not rewritten by a later assignment');
assert.equal(withSavedCloseoutTruck({...event,label:'Estimate Completed'},[{status:'Estimate Closed',truck:'Truck 4'}]).truck,'Truck 4');
console.log('Closeout truck correction passed: unique saved completed assignment, historical event preservation, ambiguous/open source and arrival exclusions.');
