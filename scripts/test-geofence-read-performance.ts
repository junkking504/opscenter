import assert from 'node:assert/strict';
import { chicagoDateKey } from '../lib/chicago-date';
import { visitDay } from '../lib/visit-tracking-agent';
import { geofenceEntries } from '../lib/linxup-geofence-alerts';

// Replay-sized reads must not allocate an ICU formatter for every observation.
// Count allocations instead of using a machine-dependent wall-clock threshold.
const NativeFormatter = Intl.DateTimeFormat;
let constructions = 0;
Intl.DateTimeFormat = class extends NativeFormatter {
  constructor(...args: ConstructorParameters<typeof NativeFormatter>) {
    super(...args);
    constructions++;
  }
} as typeof NativeFormatter;
try {
  const boundaries = [
    ['2026-03-08T05:59:59Z', '2026-03-07'],
    ['2026-03-08T06:00:00Z', '2026-03-08'],
    ['2026-03-08T08:00:00Z', '2026-03-08'],
    ['2026-11-01T04:59:59Z', '2026-10-31'],
    ['2026-11-01T05:00:00Z', '2026-11-01'],
    ['2026-11-01T07:00:00Z', '2026-11-01'],
  ];
  for (let repeat = 0; repeat < 1000; repeat++) {
    for (const [stamp, expected] of boundaries) {
      assert.equal(chicagoDateKey(new Date(stamp)), expected);
      assert.equal(visitDay(stamp), expected);
    }
  }
  const rows = Array.from({length: 2000}, (_, i) => ({
    alert_type: 'geofence_entered', geofence_name: 'Gentilly', truck_number: 'Truck 4',
    occurred_at: new Date(Date.parse('2026-09-16T05:00:00Z') + i * 1000).toISOString(),
  }));
  const entries = geofenceEntries('2026-09-16', rows, Date.parse('2026-09-17T00:00:00Z'));
  assert.equal(entries.length, rows.length);
  assert.equal(entries[0].timestamp, rows.at(-1)!.occurred_at);
  assert.ok(entries.every(entry => entry.resetLocation === 'dump'));
  assert.ok(constructions <= 4, `GPS replay allocated ${constructions} date formatters`);
} finally {
  Intl.DateTimeFormat = NativeFormatter;
}
console.log('PASS GPS read performance: bounded formatter allocations, Chicago midnight and DST, complete ordered evidence');
