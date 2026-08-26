import assert from "node:assert/strict";
import fs from "node:fs";

const loop = fs.readFileSync("scripts/run-junkware-live-refresh-loop.sh", "utf8");
const publisher = fs.readFileSync("scripts/publish-slack-alerts.ts", "utf8");
const alerts = fs.readFileSync("lib/slack-alerts.ts", "utf8");

assert.match(
  publisher,
  /--only supports truck_arrival or job_closed\./,
  "The command-line publisher must expose an isolated job-closed mode.",
);
assert.match(
  alerts,
  /async function runTruckCloseoutSlackAlerts[\s\S]*?readCompletedJunkwareRows\(date\)/,
  "The focused publisher must use the verified completed JunkWare rows.",
);
assert.match(
  alerts,
  /runTruckCloseoutSlackAlerts\(\{ date, dryRun, enabled \}\)/,
  "The job-closed mode must not fall through to the broad alert pass.",
);

const successBlock = loop.slice(
  loop.indexOf('else\n    # Closeouts are complete in the verified JunkWare snapshot'),
  loop.indexOf('for PAYMENT_DATE in "$TODAY" "$YESTERDAY"'),
);
assert.match(
  loop,
  /publish_verified_closeout_alerts\(\)[\s\S]*?--only job_closed/,
  "A verified full JunkWare refresh must invoke the focused closeout publisher.",
);
assert.match(
  successBlock,
  /publish_verified_closeout_alerts/,
  "A verified full JunkWare refresh must invoke the focused closeout publisher.",
);
assert.ok(
  successBlock.indexOf("publish_verified_closeout_alerts") < successBlock.indexOf("auto_virtualize_external_bookings"),
  "Closeout delivery must happen before optional downstream integrations.",
);
assert.match(
  loop,
  /OPSCENTER_DATA_DIR="\$OPSBOT_DIR\/data"[\s\\\n]+SLACK_OPSCENTER_STATE_FILE="\$OPSBOT_DIR\/data\/slack\/ops_alert_state\.json"/,
  "The focused publisher must use the live shared deduplication state.",
);

console.log("Verified JunkWare closeout alert latency checks passed.");
