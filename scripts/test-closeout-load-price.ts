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
// Provider dropdown shape: Dry Run has its own hidden fee, not a tariff row.
const sourceSizes = ['', 'Dry Run', 'Bag(s)', 'Minimum', '.5 (1/12)', '1 (1/6)', '1.5 (1/4)', '2 (1/3)', '2.5 (3/8)', '3 (1/2)', '3.5 (5/8)', '4 (2/3)', '4.5 (3/4)', '5 (5/6)', '5.5 (7/8)'];
const sourceOptions = sourceSizes.map(value => ({value,label:value}));
const sourceRates = [40,100,150,200,250,300,350,400,450,500,550,600,650,700];
const expectedPartials = [100,150,200,250,300,350,400,450,500,550,600,650];
for (const [offset, size] of sourceSizes.slice(3).entries()) {
  assert.equal(automaticSizePrice(size,'0',sourceOptions,sourceRates,'load'), expectedPartials[offset].toFixed(2), size);
  assert.equal(automaticSizePrice(size,'2',sourceOptions,sourceRates,'load'), (1400+expectedPartials[offset]).toFixed(2), `two trucks plus ${size}`);
  assert.equal(automaticSizePrice(size,'0',sourceOptions.filter(option=>option.value!=='Dry Run'),sourceRates,'load'), expectedPartials[offset].toFixed(2));
}
assert.equal(automaticSizePrice('', '2', sourceOptions, sourceRates, 'load'), '1400.00');
assert.equal(automaticSizePrice('Bag(s)', '3', sourceOptions, sourceRates, 'load'), '120.00');
assert.equal(automaticSizePrice('Dry Run', '2', sourceOptions, sourceRates, 'load', '75'), '75.00');
assert.equal(automaticSizePrice('Dry Run', '0', sourceOptions, sourceRates, 'load', '0'), '0.00');
for (const fee of [undefined,'','invalid','-1']) assert.equal(automaticSizePrice('Dry Run','1',sourceOptions,sourceRates,'load',fee), '');
assert.equal(automaticSizePrice('3 (1/2)', '2', sourceOptions, [40,100], 'load'), '', 'Missing partial tariff must not silently price only the full trucks');
assert.equal(automaticSizePrice('', '6', options, [], 'load'), '', 'Missing source rates must not invent a price');
assert.equal(automaticSizePrice('', '2', options, [30, 100, 200], 'bedload'), '400.00');
assert.equal(automaticSizePrice('3 (1/2)', '2', options, [30, 100, 200], 'bedload'), '500.00');
assert.deepEqual(closeoutChargesSummary({loadPrice:load('6'),bedloadPrice:'',discount:'20',tip:'10',otherCharges:[],otherChargeOptions:[]}, []), {subtotal:4368,total:4358,estimated:false});
console.log('Closeout load pricing passed: full trucks, count changes, partial loads, bags, bedloads, missing rates, subtotal, discount and tip.');
