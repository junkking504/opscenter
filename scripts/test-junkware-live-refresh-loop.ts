import fs from "node:fs";
import path from "node:path";

function expect(condition: unknown, message: string) {
  if (!condition) throw new Error(message);
}

const runner = fs.readFileSync(path.join(process.cwd(), "scripts/run-junkware-live-refresh-loop.sh"), "utf8");
const prefetchStart = runner.indexOf('echo "Prefetching tomorrow\'s JunkWare schedule: $TOMORROW"');
const collect = runner.indexOf('python3 scripts/collect_junkware_daily.py --date "$TOMORROW"', prefetchStart);
const geocode = runner.indexOf('python3 scripts/geocode_junkware_appointments.py --date "$TOMORROW"', collect);
const assignments = runner.indexOf('auto_virtualize_external_bookings "$TOMORROW"', geocode);

expect(prefetchStart >= 0, "The live refresh loop must prefetch tomorrow's schedule.");
expect(collect > prefetchStart, "Tomorrow's JunkWare schedule must be collected in the prefetch block.");
expect(geocode > collect, "Tomorrow's schedule must geocode new appointment addresses after collecting appointments.");
expect(assignments > geocode, "Tomorrow's route assignments must follow the geocode refresh.");

console.log("Tomorrow Schedule map refresh checks passed.");
