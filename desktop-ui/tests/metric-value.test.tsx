import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MetricValue } from '../metric-value';

for (const value of [null, undefined, NaN, Infinity, '—', 'Unavailable', 'N/A']) {
  const html = renderToStaticMarkup(<MetricValue value={value} reason="Source pending" />);
  assert.match(html, /Not Yet Available/);
  assert.match(html, /missing-value/);
  assert.match(html, /Source pending/);
}
for (const value of [0, '0', '$0', 12]) {
  const html = renderToStaticMarkup(<MetricValue value={value} />);
  assert.doesNotMatch(html, /Not Yet Available|missing-value/);
  assert.ok(html.includes(String(value)));
}
console.log('MetricValue missing observations and real zeroes pass');
