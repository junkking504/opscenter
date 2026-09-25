import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../desktop-ui/finance-trends.tsx', import.meta.url), 'utf8');
const bars = [...source.matchAll(/<Bar\s[^>]+/g)].map(match => match[0]);
assert.deepEqual(bars.map(bar => bar.match(/dataKey="([^"]+)"/)?.[1]), ['prior', 'current', 'remaining']);
assert.ok(!bars[0].includes('stackId="current"'), 'prior year must stay separate');
assert.ok(bars[0].includes('stackId="prior"'), 'explicit prior-year group prevents Recharts placing unstacked bars after stacked bars');
assert.ok(bars[1].includes('stackId="current"') && bars[2].includes('stackId="current"'), 'forecast stacks only above current actuals');
const legend = source.slice(source.indexOf('className="finance-performance-legend"'), source.indexOf('className="finance-performance-chart"'));
assert.ok(legend.indexOf('{year - 1}') < legend.indexOf('{year} actual'), 'legend follows bar order');
assert.ok(source.includes('${year - 1} on the left and ${year} on the right'), 'accessible chart description follows bar order');
console.log('PASS: prior year left, current year right, forecast stack and legend order preserved');
