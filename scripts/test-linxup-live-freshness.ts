import fs from "node:fs";
import path from "node:path";

function expect(condition: unknown, message: string) {
  if (!condition) throw new Error(message);
}

const root = process.cwd();
const health = fs.readFileSync(path.join(root, "app/api/health/route.ts"), "utf8");
const sync = fs.readFileSync(path.join(root, "components/CurrentDataSync.tsx"), "utf8");
const runner = fs.readFileSync(path.join(root, "scripts/run-linxup-live-refresh.sh"), "utf8");
const installer = fs.readFileSync(path.join(root, "deploy/macmini/install-linxup-collector.sh"), "utf8");
const pushRoute = fs.readFileSync(path.join(root, "app/api/integrations/linxup/push/route.ts"), "utf8");
const pushRunner = fs.readFileSync(path.join(root, "scripts/run-linxup-push.sh"), "utf8");
const pushLibrary = fs.readFileSync(path.join(root, "lib/linxup-push.ts"), "utf8");
const plist = fs.readFileSync(
  path.join(root, "deploy/macmini/production-launchd/com.openclaw.opsbot.linxup-collector.plist"),
  "utf8",
);

expect(health.includes("stale-linxup-data"), "Health endpoint must report stale LinxUp data");
expect(health.includes("dataUpdatedAt"), "Health endpoint must expose combined data freshness");
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
expect(installer.includes("opsbot-linxup-api-token-v2"), "Installer must verify the LinxUp Keychain item");
expect(installer.includes("for attempt in {1..5}"), "Installer must retry transient launchd bootstrap failures");
expect(installer.includes('sleep 2'), "Installer must allow launchd to release the prior process between retries");
expect(pushLibrary.includes("LINXUP_PUSH_BEARER_TOKEN"), "LinxUp push must require its independent bearer token");
expect(pushRunner.includes("collect_linxup_location_history.py") === false, "LinxUp push must not poll the V2 collector");
expect(pushRunner.includes("match_linxup_appointment_visits.py"), "LinxUp push must recompute the affected appointment visit directly");
expect(pushRunner.includes("--only truck_arrival"), "LinxUp push must publish confirmed arrivals immediately");

console.log("LinxUp live freshness checks passed.");
