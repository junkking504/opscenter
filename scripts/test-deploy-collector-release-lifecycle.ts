import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const deployer = fs.readFileSync(path.join(root, "deploy/macmini/deploy-release.sh"), "utf8");

for (const label of [
  "com.openclaw.opsbot.junkware-collector",
  "com.openclaw.opsbot.junkware-schedule-detector",
  "com.openclaw.opsbot.junkware-history-reconciliation",
  "com.openclaw.opsbot.searchkings-collector",
  "com.openclaw.opsbot.browser-keepalive",
]) {
  assert.match(deployer, new RegExp(`="${label}"`), `missing release-bound collector label: ${label}`);
}

assert.match(
  deployer,
  /launchctl list \| awk -v prefix="\$JUNKWARE_MARKET_WATCHER_LABEL_PREFIX"/,
  "market watchers must be enumerated from loaded launchd instances",
);
assert.match(
  deployer,
  /restart_loaded_service "\$watcher_label" \|\| return 1/,
  "each loaded market watcher must participate in restart failure handling",
);
assert.match(
  deployer,
  /restart_release_bound_services "\$release"/,
  "a collector restart failure must fail the deployment rather than be ignored",
);
assert.match(
  deployer,
  /release \$commit failed collector restart health and was rolled back/,
  "a collector restart failure must restore the previous release",
);
assert.match(
  deployer,
  /\/usr\/sbin\/lsof -n -P -F p \+D "\$candidate"/,
  "pruning must inspect candidate cwd and open-file records without emitting paths",
);
assert.match(
  deployer,
  /RELEASE_LSOF_TIMEOUT_SECONDS="\$\{OPSCENTER_RELEASE_LSOF_TIMEOUT_SECONDS:-5\}"/,
  "lsof pruning scan must have a bounded timeout",
);
assert.match(
  deployer,
  /Skipping prune for \$candidate: lsof process-reference scan exceeded/, 
  "a timed-out scan must preserve the release",
);
assert.match(
  deployer,
  /release_has_live_process_reference "\$candidate" && continue/,
  "a referenced release must not reach worktree removal",
);

const activationIndex = deployer.indexOf('activate_release "$release"');
const restartIndex = deployer.indexOf('restart_release_bound_services "$release"', activationIndex);
const pruneIndex = deployer.indexOf('prune_superseded_releases "$release" "$previous_target"', activationIndex);
assert.ok(restartIndex >= 0 && restartIndex < pruneIndex, "collectors must restart before old releases are pruned");

async function verifyLsofDetectsReleaseWorkingDirectory() {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "opscenter-release-lsof-fixture-"));
  const sleeper = spawn("/bin/sleep", ["10"], { cwd: fixture, stdio: "ignore" });
  try {
  await new Promise((resolve) => setTimeout(resolve, 100));
  const records = execFileSync("/usr/sbin/lsof", ["-n", "-P", "-F", "p", "+D", fs.realpathSync(fixture)], { encoding: "utf8" });
  const canonicalFixture = fs.realpathSync(fixture);
  assert.ok(canonicalFixture.length > 0, "fixture must resolve to a canonical path");
  assert.ok(records.split("\n").includes(`p${sleeper.pid}`), "lsof process scan must detect a release working directory");
  } finally {
    sleeper.kill();
    await new Promise((resolve) => sleeper.once("exit", resolve));
    fs.rmdirSync(fixture);
  }
}

verifyLsofDetectsReleaseWorkingDirectory()
  .then(() => console.log("Collector release lifecycle checks passed."))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
