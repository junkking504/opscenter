import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { DumpExpenses } from '../desktop-ui/dump-expenses';
// The root test runner uses classic JSX, while the desktop build uses automatic JSX.
(globalThis as typeof globalThis & { React: typeof React }).React = React;
const base = { date: '2026-09-25', policyAvailable: true, geofencesAvailable: true, observedAt: null, records: [], actualTotal: 100, assumedTotal: 50, total: 150, missingMinimumCount: 0 };
const render = (data: typeof base | (Omit<typeof base, 'total'> & { total: null })) => renderToStaticMarkup(React.createElement(DumpExpenses, { data }));
assert.match(render(base), /Combined<sup>\*<\/sup>/);
assert.match(render(base), /Combined includes assumed costs alongside recorded actual costs/);
assert.doesNotMatch(render({ ...base, assumedTotal: 0, total: 100 }), /<sup>|disposal-assumed-note/);
assert.match(render({ ...base, total: null }), /Combined<sup>\*<\/sup>/);
assert.doesNotMatch(render({ ...base, total: null }), /\$150/);
console.log('PASS: combined-cost marker is conditional, explained, and preserves unavailable totals');
