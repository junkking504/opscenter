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

expect(
  runner.includes('JUNKWARE_DNS_HOST="junkware.junk-king.com"'),
  "The live refresh loop must name the JunkWare host it verifies.",
);
expect(
  runner.includes('/usr/bin/dscacheutil -q host -a name "$JUNKWARE_DNS_HOST"'),
  "The live refresh loop must verify a concrete JunkWare DNS answer rather than generic route reachability.",
);
expect(
  runner.includes("MAX_FAILED_REFRESH_RETRY_SECONDS=60"),
  "Failed JunkWare refreshes must retry at least once per minute.",
);
expect(
  runner.includes("JunkWare DNS recovered; starting an immediate current-data refresh."),
  "The loop must immediately retry when JunkWare DNS returns.",
);

console.log("JunkWare live refresh loop checks passed.");
