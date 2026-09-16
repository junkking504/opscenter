import assert from 'node:assert/strict';
import { automaticSizePrice } from '../lib/closeout-load-price';
import { closeoutChargesSummary } from '../lib/closeout-draft-summary';

// Synthetic source tariff: prices align with every option after the blank one.
const options = ['', 'Bag(s)', '3 (1/2)', 'Full'].map(value => ({ value, label: value }));
const prices = [40, 500, 728];
const load = (quantity: string, size = '') => automaticSizePrice(size, quantity, options, prices, 'load');
assert.equal(load('1'), '728.00');
assert.equal(load('6'), '4368.00', 'Full trucks must calculate with the default no-partial-load selection');
assert.equal(load('2'), '1456.00', 'Reducing the count replaces the prior total');
assert.equal(load('0'), '');
assert.equal(load(''), '');
assert.equal(load('0', '3 (1/2)'), '500.00');
assert.equal(load('2', '3 (1/2)'), '1956.00');
assert.equal(load('3', 'Bag(s)'), '120.00');
assert.equal(load('1', 'unknown'), '');
assert.equal(automaticSizePrice('', '6', options, [], 'load'), '', 'Missing source rates must not invent a price');
assert.equal(automaticSizePrice('', '2', options, [30, 100, 200], 'bedload'), '400.00');
assert.equal(automaticSizePrice('3 (1/2)', '2', options, [30, 100, 200], 'bedload'), '500.00');
assert.deepEqual(closeoutChargesSummary({loadPrice:load('6'),bedloadPrice:'',discount:'20',tip:'10',otherCharges:[],otherChargeOptions:[]}, []), {subtotal:4368,total:4358,estimated:false});
console.log('Closeout load pricing passed: full trucks, count changes, partial loads, bags, bedloads, missing rates, subtotal, discount and tip.');
