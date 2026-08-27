import assert from "node:assert/strict";
import fs from "node:fs";

const loop = fs.readFileSync("scripts/run-junkware-live-refresh-loop.sh", "utf8");
const publisher = fs.readFileSync("scripts/publish-slack-alerts.ts", "utf8");
const alerts = fs.readFileSync("lib/slack-alerts.ts", "utf8");

assert.match(
  publisher,
  /--only supports truck_arrival, job_closed, or estimate_closed\./,
  "The command-line publisher must expose isolated job and estimate closeout modes.",
);
assert.match(
  alerts,
  /async function runTruckCloseoutSlackAlerts[\s\S]*?buildAllTruckCloseoutSlackNotifications\(date\)/,
  "The focused publisher must use the verified job and estimate closeout rows.",
);
assert.match(
  alerts,
  /runTruckCloseoutSlackAlerts\(\{ date, dryRun, enabled, kinds: closeoutKinds \}\)/,
  "The closeout modes must not fall through to the broad alert pass.",
);

const successBlock = loop.slice(
  loop.indexOf('else\n    # Closeouts are complete in the verified JunkWare snapshot'),
  loop.indexOf('for PAYMENT_DATE in "$TODAY" "$YESTERDAY"'),
);
assert.match(
  loop,
  /publish_verified_closeout_alerts\(\)[\s\S]*?--only job_closed,estimate_closed/,
  "A verified full JunkWare refresh must invoke the focused job and estimate closeout publisher.",
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
