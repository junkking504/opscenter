import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MetricValue } from '../metric-value';
import { percentDelta } from '../delta-chip';

for (const value of [null, undefined, NaN, Infinity, '', '—', 'Unavailable', 'Missing clock-out', 'Stale', 'N/A']) {
  const html = renderToStaticMarkup(<MetricValue value={value} reason="Source observation missing" />);
  assert.match(html, /—<span class="missing-value-label">Not Yet Available<\/span>/);
  assert.match(html, /title="Source observation missing"/);
}
for (const value of [0, '$0.00', '0%', -100]) {
  const html = renderToStaticMarkup(<MetricValue value={value} />);
  assert.equal(html, String(value));
  assert.doesNotMatch(html, /missing-value/);
}
assert.equal(percentDelta(null, 100), null);
assert.equal(percentDelta(0, 100), -100, 'A recorded zero remains a real decline');
console.log('Missing observations have a caption and reason; real zeroes retain their values.');
