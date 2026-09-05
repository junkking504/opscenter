import assert from 'node:assert/strict';
import { payForDays, payBreakdownDifference } from '../desktop-ui/lib/krewe-pay-breakdown';
import type { DesktopCrewMember } from '../desktop-ui/lib/people-fleet-contract';
const days = [
  { date: '2026-08-24', labor: 100, tips: 20, bonuses: 10, supplemental: 0, totalPay: 130 },
  { date: '2026-08-30', labor: 120, tips: 0, bonuses: 5, supplemental: 15, totalPay: 140 },
  { date: '2026-08-31', labor: 90, tips: 10, bonuses: 0, supplemental: 0, totalPay: 100 },
] as DesktopCrewMember['days'];
const before = JSON.stringify(days);
assert.deepEqual(payForDays(days, '2026-08-24', '2026-08-30'), { labor: 220, tips: 20, bonuses: 15, supplemental: 15, totalPay: 270 });
assert.equal(payForDays(days, '2026-08-31', '2026-09-06').totalPay, 100);
assert.equal(payForDays(days, '2026-08-24', '2026-09-06').totalPay, 370);
assert.equal(payForDays(days, '2026-08-24', '2026-08-24').totalPay, 130);
assert.equal(payForDays([], '2026-08-24', '2026-09-06').totalPay, null);
const missing = [{ ...days[0], tips: null, totalPay: null }, days[1]];
assert.equal(payForDays(missing, '2026-08-24', '2026-08-30').tips, null);
assert.equal(payForDays(missing, '2026-08-24', '2026-08-30').totalPay, null);
assert.equal(payBreakdownDifference(payForDays(days, '2026-08-24', '2026-09-06')), 0);
assert.equal(payBreakdownDifference({ labor: 100, tips: 20, bonuses: 0, supplemental: 0, totalPay: 130 }), 10);
assert.equal(JSON.stringify(days), before);
console.log('Krewe pay breakdown: weekly/daily/period sums, supplemental pay, missing values, reconciliation, and source preservation passed.');
