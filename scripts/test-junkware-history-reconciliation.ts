import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const historyScript = readFileSync(new URL("./run-junkware-history-reconciliation.sh", import.meta.url), "utf8");
assert.match(historyScript, /abs\(float\(payload\.get\("unreconciled_gross_revenue"\)/, "History reconciliation must retry both positive and negative revenue drift.");
assert.match(historyScript, /while IFS= read -r LOOKBACK_MONTH/, "History reconciliation must use Bash-compatible month iteration.");
assert.match(historyScript, /reconcile-junkware-lookback\.py --month "\$LOOKBACK_MONTH" --days 7/, "History reconciliation must repair each recently reconciled month.");

const lookbackScript = readFileSync(new URL("./reconcile-junkware-lookback.py", import.meta.url), "utf8");
const linxupRefreshScript = readFileSync(new URL("./run-linxup-live-refresh.sh", import.meta.url), "utf8");
assert.match(lookbackScript, /LINXUP_PUBLISH_SLACK_ALERTS": "false"/, "Historical lookbacks must suppress live Slack alerts.");
assert.match(linxupRefreshScript, /LINXUP_PUBLISH_SLACK_ALERTS/, "LinxUp refreshes must honor the alert-publishing mode.");

const result = spawnSync("python3", ["-c", [
  "import importlib.util",
  "spec = importlib.util.spec_from_file_location('lookback', 'scripts/reconcile-junkware-lookback.py')",
  "module = importlib.util.module_from_spec(spec)",
  "spec.loader.exec_module(module)",
  "assert module.needs_reconciliation(0, 195.0)",
  "assert module.needs_reconciliation(0, -195.0)",
  "assert module.needs_reconciliation(1, 0)",
  "assert not module.needs_reconciliation(0, 0.01)",
  "from datetime import date",
  "assert module.candidate_dates('2026-08', 3, date(2026, 8, 22)) == ['2026-08-20', '2026-08-21', '2026-08-22']",
  "assert module.candidate_dates('2026-07', 3, date(2026, 8, 22)) == ['2026-07-29', '2026-07-30', '2026-07-31']",
].join("; ")], { encoding: "utf8" });

assert.equal(result.status, 0, result.stderr || result.stdout);
console.log("JunkWare history reconciliation checks passed.");
