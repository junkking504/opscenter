import assert from 'node:assert/strict';
import { verifyAddedCloseoutCharges } from '../lib/desktop-closeout-contract';

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
const fixed = { otherChargeOptions: [{ value: 'fixed|9|0', label: option.label }], otherCharges: [] };
assert.throws(() => verifyAddedCloseoutCharges({ otherCharges: [charge] }, fixed, [{ typeValue: 'fixed|9|0', quantity: '1', price: '9' }]), /charge type/);
console.log('Percentage-charge labels: saved/picker forms pass; wrong rate, type, quantity, price, duplicates, ambiguity and missing originals stay blocked.');
