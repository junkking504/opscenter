import assert from 'node:assert/strict';
import { closeoutSourceVersion, stableCloseoutChargeRows, verifyAddedCloseoutCharges } from '../lib/desktop-closeout-contract';

const option = { value: 'card|3|1', label: 'CC Surcharge (Card Present), 3.00%' };
const before = { otherChargeOptions: [option], otherCharges: [] };
const charge = { label: 'CC Surcharge (Card Present)', quantity: '1.00', price: '$9.00', total: '$9.00' };
const requested = { typeValue: option.value, quantity: '1', price: '', sourceCalculatedPrice: '9' };
const verify = (rows = [charge], requests = [requested], baseline = before, staging = false) =>
  verifyAddedCloseoutCharges({ otherCharges: rows }, baseline, requests, staging);

assert.deepEqual(verify(), [charge], 'Saved percentage label may omit the matching picker rate');
assert.deepEqual(verify([charge], [{ ...requested, sourceCalculatedPrice: undefined! }], before, true), [charge]);
assert.deepEqual(verify([{ ...charge, label: option.label }]), [{ ...charge, label: option.label }]);
assert.throws(() => verify([{ ...charge, label: 'CC Surcharge (Card Not Present)' }]), /charge type/);
assert.throws(() => verify([{ ...charge, quantity: '2' }]), /quantity/);
assert.throws(() => verify([{ ...charge, price: '$10.00' }]), /source-calculated/);
assert.throws(() => verify([charge, charge]), /exactly/);
assert.throws(() => verify([]), /exactly/);
assert.throws(() => verify([charge], [{ ...requested, sourceCalculatedPrice: undefined! }]), /price evidence/);
assert.throws(() => verify([charge], [requested], { ...before, otherChargeOptions: [{ ...option, label: 'CC Surcharge (Card Present), 4.00%' }] }), /charge type/);
assert.throws(() => verify([charge], [requested], { ...before, otherChargeOptions: [option, { value: 'other|4|1', label: 'CC Surcharge (Card Present), 4.00%' }] }), /charge type/);
assert.throws(() => verify([charge], [requested], { ...before, otherChargeOptions: [option, { value: 'fixed|9|0', label: charge.label }] }), /charge type/);

const existing = { ...before, otherCharges: [charge] };
verifyAddedCloseoutCharges({ otherCharges: [{ ...charge, price: '$12.00', total: '$12.00' }] }, existing, []);
assert.throws(() => verifyAddedCloseoutCharges({ otherCharges: [] }, existing, []), /existing source/);
assert.throws(() => verifyAddedCloseoutCharges({ otherCharges: [{ ...charge, quantity: '2' }] }, existing, []), /existing source/);
const removalId = '11111111-1111-4111-8111-111111111111';
const keepId = '22222222-2222-4222-8222-222222222222';
const removable = { ...charge, id: removalId }, retained = { label: 'Labor', quantity: '2.00', price: '$75.00', total: '$150.00', id: keepId };
const removalBaseline = { ...before, otherCharges: [removable, retained] };
assert.deepEqual(verifyAddedCloseoutCharges({ otherCharges: [retained] }, removalBaseline, [], false, [removalId]), []);
assert.throws(() => verifyAddedCloseoutCharges({ otherCharges: [removable, retained] }, removalBaseline, [], false, [removalId]), /did not remove/);
assert.throws(() => verifyAddedCloseoutCharges({ otherCharges: [retained] }, removalBaseline, [], false, [keepId, keepId]), /duplicates/);
assert.throws(() => verifyAddedCloseoutCharges({ otherCharges: [retained] }, removalBaseline, [], false, ['33333333-3333-4333-8333-333333333333']), /unavailable/);
const fixed = { otherChargeOptions: [{ value: 'fixed|9|0', label: option.label }], otherCharges: [] };
assert.throws(() => verifyAddedCloseoutCharges({ otherCharges: [charge] }, fixed, [{ typeValue: 'fixed|9|0', quantity: '1', price: '9' }]), /charge type/);

const firstRender=stableCloseoutChargeRows([{...charge,id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'},retained]);
const secondRender=stableCloseoutChargeRows([{...charge,id:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'},retained]);
assert.equal(firstRender[0].id,secondRender[0].id,'Provider render UUIDs must not change the phone row identity');
assert.notEqual(firstRender[0].sourceId,secondRender[0].sourceId,'The current provider UUID remains available for the exact removal click');
assert.equal(closeoutSourceVersion({otherCharges:firstRender}),closeoutSourceVersion({otherCharges:secondRender}),'Provider render UUIDs must not change the reviewed closeout');
const duplicates=stableCloseoutChargeRows([{...charge,id:removalId},{...charge,id:keepId}]);
assert.notEqual(duplicates[0].id,duplicates[1].id,'Identical saved rows retain separate deterministic identities');
verifyAddedCloseoutCharges({otherCharges:stableCloseoutChargeRows([{...charge,id:'33333333-3333-4333-8333-333333333333'}])},{...before,otherCharges:duplicates},[],false,[String(duplicates[1].id)]);
console.log('Closeout charges: saved/picker percentage forms pass; exact row removals verify; wrong rate, type, quantity, price, duplicates, ambiguity and missing originals stay blocked.');
