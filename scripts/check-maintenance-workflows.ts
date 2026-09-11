// Read-only builders used by the real Schedule/Fleet views. No authentication
// fabrication, data mutations, routing refresh, external requests or raw output.
import { chicagoDateKey } from '../lib/report-dates';
import { readDesktopSchedule } from '../lib/desktop-schedule';
import { readDesktopFleet } from '../lib/desktop-fleet';
import { validReadSnapshot } from '../desktop-ui/lib/maintenance-evidence';
const results: Record<string, boolean | null> = {};
const date = chicagoDateKey();
for (const operation of ['schedule', 'fleet'] as const) {
  try {
    const value = operation === 'schedule' ? readDesktopSchedule(date) : readDesktopFleet(date, 'overview', 'operator');
    const source = operation === 'schedule' ? Boolean('observedAt' in value && value.observedAt) : Boolean('sourceAvailable' in value && value.sourceAvailable);
    results[operation] = source && validReadSnapshot(operation, value);
  } catch { results[operation] = false; }
}
process.stdout.write(JSON.stringify(results));
