import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { CommandRevenueHero, metricNumber } from '../command-revenue-hero';
import { percentDelta } from '../delta-chip';
// The repository's tsx runner uses classic JSX for imported desktop files.
(globalThis as typeof globalThis & { React: typeof React }).React = React;
for (const value of ['—', 'Unavailable', 'Stale', 'N/A']) {
  assert.equal(metricNumber(value), null);
  assert.equal(percentDelta(metricNumber(value), 100), null);
  const html = renderToStaticMarkup(<CommandRevenueHero date="2026-10-29" kpi={{label:'Revenue',value,detail:'Source pending',tone:'warning',progress:0,comparison:{prior:100,label:'prior day'}}} />);
  assert.match(html, /Not Yet Available/);
  assert.doesNotMatch(html, /delta-negative|−100/);
}
assert.equal(percentDelta(metricNumber('$0'),100), -100, 'A recorded zero is a real decline');
console.log('Unavailable revenue stays neutral; recorded zero retains its comparison');
