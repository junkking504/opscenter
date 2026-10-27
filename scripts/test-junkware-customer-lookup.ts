import assert from 'node:assert/strict';
import { CustomerSelectionError, customerSearchFields, normalizeCustomerSelection } from '../lib/junkware-customer-contract';
import { customerLookupFailureMessage } from '../lib/junkware-customer-lookup';
import { customerRow } from './junkware-customer-lookup';
assert.deepEqual(customerSearchFields(' Sample   Customer '), { firstName: 'Sample', lastName: 'Customer' });
assert.deepEqual(customerSearchFields('Customer'), { lastName: 'Customer' });
assert.deepEqual(customerSearchFields('+1 (504) 555-0100'), { phone: '5045550100' });
assert.deepEqual(customerSearchFields('sample@example.com'), { email: 'sample@example.com' });
assert.throws(() => customerSearchFields('555'), /seven/);
assert.throws(() => customerSearchFields('a'), /2–160/);
const cells = ['Job', 'Sample Customer', '', '(504) 555-0100', '', 'sample@example.com', '100 Sample St', '100 Sample St'];
const job = customerRow(cells), estimate = customerRow(['Estimate', ...cells.slice(1)]);
assert.notEqual(job.key, estimate.key, 'Job and Estimate fingerprints remain distinct');
assert.notEqual(job.key, customerRow([...cells.slice(0,7), '200 Other St']).key, 'Changed source fields invalidate the previous key');
assert.throws(() => customerRow(['unexpected columns']), /columns changed/);
assert.deepEqual(normalizeCustomerSelection({ query: 'Sample Customer', key: job.key }), { query: 'Sample Customer', key: job.key });
assert.throws(() => normalizeCustomerSelection({ query: 'Sample Customer', key: 'bad' }));
console.log('Customer lookup: name/phone/email, source selection, changed and ambiguous records passed.');

for (const code of ['customer_changed', 'customer_ambiguous'] as const) {
  const error = new CustomerSelectionError(code);
  assert.equal(customerLookupFailureMessage(JSON.stringify({ ok: false, lookupCode: error.code, error: 'synthetic private diagnostic' })), error.message);
}
for (const raw of ['not json', JSON.stringify({ ok: false, lookupCode: 'unknown', error: 'synthetic private diagnostic' }), JSON.stringify({ ok: true, lookupCode: 'customer_changed' }), JSON.stringify({ ok: false, lookupCode: '__proto__' })]) {
  assert.equal(customerLookupFailureMessage(raw), 'JunkWare customer search is unavailable. Please try again.');
}
console.log('Customer lookup errors: allowlisted stale/ambiguous codes pass; raw diagnostics remain private.');
