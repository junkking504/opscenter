import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");

const releaseBoundPlists = new Map([
  ["deploy/macmini/launchd/com.openclaw.opscenter.macmini-preview.plist", "/bin/zsh"],
  ["deploy/macmini/production-launchd/com.openclaw.opsbot.junkware-collector.plist", "/bin/bash"],
  ["deploy/macmini/production-launchd/com.openclaw.opsbot.junkware-history-reconciliation.plist", "/bin/bash"],
  ["deploy/macmini/production-launchd/com.openclaw.opsbot.junkware-schedule-detector.plist", "/bin/bash"],
  ["deploy/macmini/production-launchd/com.openclaw.opsbot.linxup-collector.plist", "/bin/bash"],
  ["deploy/macmini/production-launchd/com.openclaw.opsbot.podium-reviews-collector.plist", "/bin/bash"],
  ["deploy/macmini/production-launchd/com.openclaw.opsbot.searchkings-collector.plist", "/bin/bash"],
  ["deploy/macmini/production-launchd/com.openclaw.opscenter.plist", "/bin/zsh"],
  ["deploy/macmini/production-launchd/com.openclaw.opscenter.whatsapp-photos.plist", "/bin/zsh"],
]);

for (const [relativePath, interpreter] of releaseBoundPlists) {
  const plistPath = path.join(root, relativePath);
  const plist = JSON.parse(
    execFileSync("/usr/bin/plutil", ["-convert", "json", "-o", "-", plistPath], {
      encoding: "utf8",
    }),
  ) as { Label: string; ProgramArguments: string[] };

  assert.equal(
    plist.ProgramArguments[0],
    interpreter,
    `${plist.Label} must expose a stable executable to macOS Background Task Management`,
  );
  assert.match(
    plist.ProgramArguments[1],
    /^\/Users\/missioncontrol\/opscenter-v2\/opscenter(?:-preview)?\//,
    `${plist.Label} must pass the active immutable-release script to its stable interpreter`,
  );
}

for (const relativePath of [
  "deploy/macmini/install-junkware-schedule-detector.sh",
  "deploy/macmini/install-linxup-collector.sh",
  "deploy/macmini/install-searchkings-collector.sh",
  "deploy/macmini/install-whatsapp-photo-worker.sh",
]) {
  const installer = fs.readFileSync(path.join(root, relativePath), "utf8");
  assert.match(
    installer,
    /! cmp -s "\$SOURCE_PLIST" "\$INSTALLED_PLIST"/,
    `${relativePath} must not rewrite an identical registered LaunchAgent`,
  );
}

console.log("LaunchAgent background-registration checks passed.");
