import assert from 'node:assert/strict';
import { commercialDate, commercialMoney } from '../desktop-ui/lib/commercial-contract';

// Pin user-visible reporting semantics, including Chicago midnight and DST.
for (const [input, expected] of [
  ['', 'Time unavailable'], ['invalid', 'Time unavailable'],
  ['2026-09-09', 'Sep 9'],
  ['2026-09-09T04:59:00Z', 'Sep 8, 11:59 PM'],
  ['2026-09-09T05:00:00Z', 'Sep 9, 12:00 AM'],
  ['2026-03-08T07:59:00Z', 'Mar 8, 1:59 AM'],
  ['2026-03-08T08:00:00Z', 'Mar 8, 3:00 AM'],
  ['2026-11-01T06:30:00Z', 'Nov 1, 1:30 AM'],
  ['2026-11-01T07:30:00Z', 'Nov 1, 1:30 AM'],
]) assert.equal(commercialDate(input), expected, input);
for (const [input, expected] of [
  [null, 'Unavailable'], [undefined, 'Unavailable'], [NaN, 'Unavailable'],
  [Infinity, 'Unavailable'], [0, '$0.00'], [1234.56, '$1,234.56'],
  [-12.5, '-$12.50'],
] as const) assert.equal(commercialMoney(input), expected, String(input));
console.log('Commercial date, timezone, DST, currency, and unavailable formatting passed.');
