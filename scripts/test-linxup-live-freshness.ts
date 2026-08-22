import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getDataHealthReport } from "../lib/data-health";

function expect(condition: unknown, message: string) {
  if (!condition) throw new Error(message);
}

const root = process.cwd();
const health = fs.readFileSync(path.join(root, "app/api/health/route.ts"), "utf8");
const sync = fs.readFileSync(path.join(root, "components/CurrentDataSync.tsx"), "utf8");
const runner = fs.readFileSync(path.join(root, "scripts/run-linxup-live-refresh.sh"), "utf8");
const lockHelper = fs.readFileSync(path.join(root, "scripts/linxup-lock.sh"), "utf8");
const retryHelper = fs.readFileSync(path.join(root, "scripts/linxup-retry.sh"), "utf8");
const installer = fs.readFileSync(path.join(root, "deploy/macmini/install-linxup-collector.sh"), "utf8");
const deployer = fs.readFileSync(path.join(root, "deploy/macmini/deploy-release.sh"), "utf8");
const pushRoute = fs.readFileSync(path.join(root, "app/api/integrations/linxup/push/route.ts"), "utf8");
const pushRunner = fs.readFileSync(path.join(root, "scripts/run-linxup-push.sh"), "utf8");
const pushLibrary = fs.readFileSync(path.join(root, "lib/linxup-push.ts"), "utf8");
const plist = fs.readFileSync(
  path.join(root, "deploy/macmini/production-launchd/com.openclaw.opsbot.linxup-collector.plist"),
  "utf8",
);

expect(health.includes("stale-linxup-data"), "Health endpoint must report stale LinxUp data");
expect(health.includes("dataUpdatedAt"), "Health endpoint must expose combined data freshness");
const dataHealth = fs.readFileSync(path.join(root, "lib/data-health.ts"), "utf8");
expect(dataHealth.includes("freshnessFiles: linxupLocationFiles"), "Slack data health must use normalized location history freshness");
expect(sync.includes("health?.dataUpdatedAt || health?.updatedAt"), "Current pages must react to LinxUp-only refreshes");
for (const command of [
  "collect_linxup_location_history.py",
  "seed_local_appointment_geocodes.py",
  "match_linxup_appointment_visits.py",
  "validate_linxup_appointment_visits.py",
]) {
  expect(runner.includes(command), `Live refresh must run ${command}`);
}
expect(runner.includes("--only truck_arrival"), "LinxUp collector must publish confirmed arrivals directly");
expect(runner.includes('cd "$OPSCENTER_DIR"'), "LinxUp collector must run the publisher from the active release");
expect(plist.includes("<integer>60</integer>"), "LinxUp collector must run every minute");
expect(plist.includes("run-linxup-live-refresh.sh"), "LaunchAgent must use the dedicated LinxUp refresh");
expect(plist.includes("<key>KeepAlive</key>"), "LinxUp collector must restart after a failed run");
expect(plist.includes("<key>SuccessfulExit</key>\n    <false/>"), "LinxUp collector must only self-restart after failure");
expect(plist.includes("<key>ThrottleInterval</key>\n  <integer>15</integer>"), "LinxUp retries must be throttled");
expect(plist.includes("<key>LINXUP_LOCK_MAX_AGE_SECONDS</key>\n    <string>900</string>"), "LaunchAgent must declare the 15-minute abandoned-lock backstop");
expect(installer.includes("opsbot-linxup-api-token-v2"), "Installer must verify the LinxUp Keychain item");
expect(deployer.includes('LINXUP_COLLECTOR_LABEL="com.openclaw.opsbot.linxup-collector"'), "Deployment must track the dedicated LinxUp collector");
expect(deployer.includes('"$release/deploy/macmini/install-linxup-collector.sh"'), "Deployment must reinstall the enabled LinxUp collector from the active release");
expect(retryHelper.includes("LinxUp refresh attempt"), "LinxUp collector must retry a failed refresh before giving up");
expect(runner.includes('scripts/linxup-retry.sh'), "LinxUp collector must use the tested retry helper");
expect(retryHelper.includes('if "$callback"'), "Every LinxUp retry must invoke the fetch callback again");
expect(runner.includes('scripts/linxup-lock.sh'), "LinxUp collector must use the shared self-healing lock");
expect(pushRunner.includes('scripts/linxup-lock.sh'), "LinxUp push must use the shared self-healing lock");
expect(lockHelper.includes("pid=%s"), "LinxUp lock metadata must record the owner PID");
expect(lockHelper.includes("started_at=%s"), "LinxUp lock metadata must record the start timestamp");
expect(lockHelper.includes("LINXUP_LOCK_MAX_AGE_SECONDS"), "LinxUp lock must enforce a maximum age");
expect(lockHelper.includes("kill -0"), "LinxUp lock must verify whether its owner PID is alive");
expect(lockHelper.includes("Recovered abandoned LinxUp lock"), "LinxUp lock must self-heal abandoned ownership");
expect(pushLibrary.includes("LINXUP_PUSH_BEARER_TOKEN"), "LinxUp push must require its independent bearer token");
expect(pushRunner.includes("collect_linxup_location_history.py") === false, "LinxUp push must not poll the V2 collector");
expect(pushRunner.includes("match_linxup_appointment_visits.py"), "LinxUp push must recompute the affected appointment visit directly");
expect(pushRunner.includes("--only truck_arrival"), "LinxUp push must publish confirmed arrivals immediately");

const healthFixture = fs.mkdtempSync(path.join(os.tmpdir(), "opscenter-linxup-health-"));
const fixtureLinxup = path.join(healthFixture, "data", "history", "linxup");
const fixtureVisits = path.join(fixtureLinxup, "appointment_visits");
const dateParts = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Chicago",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
}).formatToParts(new Date()).map((part) => [part.type, part.value]));
const fixtureDate = `${dateParts.year}-${dateParts.month}-${dateParts.day}`;
fs.mkdirSync(fixtureVisits, { recursive: true });
const fixtureLocation = path.join(fixtureLinxup, `linxup_location_${fixtureDate}.json`);
for (const file of [
  fixtureLocation,
  path.join(fixtureLinxup, `linxup_${fixtureDate}_raw.json`),
  path.join(fixtureLinxup, `linxup_${fixtureDate}_summary.csv`),
  path.join(fixtureVisits, `linxup_appointment_visits_${fixtureDate}.json`),
]) {
  fs.writeFileSync(file, "{}");
}
const staleLocationTime = new Date(Date.now() - 30 * 60_000);
fs.utimesSync(fixtureLocation, staleLocationTime, staleLocationTime);
const originalDirectory = process.cwd();
try {
  process.chdir(healthFixture);
  const source = getDataHealthReport().sources.linxup;
  expect(source.status === "red", "Fresh legacy LinxUp files must not mask stale normalized location history");
  expect((source.ageMinutes || 0) >= 29, "LinxUp health age must come from normalized location history");
  expect(source.notes.includes(`Latest file: linxup_location_${fixtureDate}.json`), "LinxUp health must name normalized location history as its freshness source");
} finally {
  process.chdir(originalDirectory);
  fs.rmSync(healthFixture, { recursive: true, force: true });
}

console.log("LinxUp live freshness checks passed.");
