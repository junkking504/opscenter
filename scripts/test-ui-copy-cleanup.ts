import assert from 'node:assert/strict';
import {compactMetricDetail} from '../desktop-ui/metric-detail';
import {ageFinanceKpi,financeReading} from '../lib/daily-finance-freshness';
const now=Date.parse('2026-10-25T13:34:00Z'), date='2026-10-25';
const current={status:'current' as const,asOf:'2026-10-25T13:31:00Z'};
for(const status of ['current','stale','missing'] as const) {
 const reading=financeReading(0,{...current,status},date,now);
 const compact=compactMetricDetail(reading.detail);
 assert.equal(reading.value,status==='current'?0:null);
 assert.equal(compact,status==='current'?'':status==='stale'?'Stale source':'Input unavailable');
}
assert.equal(compactMetricDetail('Recorded payroll · revenue ratio unavailable · Source Oct 25 at 8:31 AM · 3m old'),'Revenue ratio unavailable');
assert.equal(compactMetricDetail('Includes $109.00 assumed dump cost · Source Oct 25 at 8:31 AM · 3m old'),'Includes $109.00 assumed dump cost');
assert.equal(compactMetricDetail('Source time unavailable'),'Source time unavailable');
assert.equal(compactMetricDetail('Partial data · 2 excluded · Provisional'),'Partial data · 2 excluded · Provisional');
const card=ageFinanceKpi({value:'$0.00',detail:'',progress:0,tone:'warning',financeEvidence:{date,recorded:0,evidence:current,currentDetail:'Recorded payroll · revenue ratio unavailable'}},now);
assert.equal(card.value,'$0.00');
assert.equal(compactMetricDetail(card.detail),'Revenue ratio unavailable');
assert.equal(compactMetricDetail(ageFinanceKpi(card,now+20*60_000).detail),'Stale source');
console.log('UI copy: real zero, aging, missing input, ratio, assumptions and unknown warnings retained.');
