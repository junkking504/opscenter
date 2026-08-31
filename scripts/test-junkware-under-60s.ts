import fs from "node:fs";
import path from "node:path";

function expect(condition: unknown, message: string) {
  if (!condition) throw new Error(message);
}

const root = process.cwd();
const detector = fs.readFileSync(path.join(root, "scripts/run-junkware-schedule-detector.sh"), "utf8");
const stream = fs.readFileSync(path.join(root, "scripts/collect-junkware-schedule-stream.py"), "utf8");
const plist = fs.readFileSync(path.join(root, "deploy/macmini/production-launchd/com.openclaw.opsbot.junkware-schedule-detector.plist"), "utf8");
const deploy = fs.readFileSync(path.join(root, "deploy/macmini/deploy-release.sh"), "utf8");
const installer = fs.readFileSync(path.join(root, "deploy/macmini/install-junkware-schedule-detector.sh"), "utf8");
const health = fs.readFileSync(path.join(root, "app/api/health/route.ts"), "utf8");
const sync = fs.readFileSync(path.join(root, "components/CurrentDataSync.tsx"), "utf8");
const jobs = fs.readFileSync(path.join(root, "app/(protected)/jobs/page.tsx"), "utf8");
const alerts = fs.readFileSync(path.join(root, "lib/slack-alerts.ts"), "utf8");
const schedulePublisher = fs.readFileSync(path.join(root, "scripts/publish-junkware-schedule-changes.ts"), "utf8");

expect(detector.includes('WATCH_INTERVAL_SECONDS="${JUNKWARE_SCHEDULE_DETECTOR_INTERVAL_SECONDS:-5}"'), "Detector must target five seconds between sweeps");
expect(stream.includes("while True:"), "Detector must keep one authenticated browser session persistent");
expect(stream.includes('"duration_seconds"'), "Detector heartbeat must expose measured runtime");
expect(detector.includes("collect-junkware-schedule-stream.py"), "Detector must use the per-market streaming collector");
expect(stream.includes("for market_id, market_name in MARKETS"), "Streaming collector must verify every market in one session");
expect(stream.includes('f"market-{market_id}"'), "Each verified market must publish immediately with isolated state");
expect(plist.includes("<key>KeepAlive</key>"), "LaunchAgent must keep the detector alive");
expect(!plist.includes("<key>StartInterval</key>"), "Persistent detector must not use a one-minute launch interval");
expect(deploy.includes('restart_release_bound_services "$release"'), "Production deploy must restart release-bound services after activation");
expect(deploy.includes('"$release/deploy/macmini/install-junkware-schedule-detector.sh" || return 1'), "Production deploy must reinstall and restart the detector from the active release");
expect(installer.includes("for attempt in {1..5}"), "Detector install must retry launchd's transient bootstrap race");
expect(installer.includes("INSTALL_STARTED_EPOCH"), "Detector install must wait for a heartbeat from the new process");
expect(installer.includes("child_command") && installer.includes("collect-junkware-schedule-stream.py"), "Detector install must validate orphan child commands");
expect(installer.includes('kill -TERM "$LOCK_PID"'), "Detector install must terminate only the validated detector PID");
expect(health.includes("stale-junkware-schedule"), "Health must expose a stale schedule detector");
expect(health.includes("junkwareSchedule?.updatedAtMs"), "Combined freshness must include the verified schedule snapshot");
expect(sync.includes("5_000"), "Current pages must check source freshness every five seconds");
expect(jobs.includes("currentJunkwareScheduleSnapshot"), "Schedule must consume the verified fast snapshot");
expect(schedulePublisher.includes("publishVerifiedTruckCloseout") && schedulePublisher.includes("published.posted || published.duplicate"), "The fast detector must route full closeouts through the shared idempotent publisher");
expect(alerts.includes("isTruckCloseoutDelivered(date, fingerprint)"), "The shared closeout publisher must reject an already delivered closeout");

console.log("JunkWare under-60-second path checks passed.");
