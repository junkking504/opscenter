import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const historyScript = readFileSync(new URL("./run-junkware-history-reconciliation.sh", import.meta.url), "utf8");
assert.match(historyScript, /abs\(float\(payload\.get\("unreconciled_gross_revenue"\)/, "History reconciliation must retry both positive and negative revenue drift.");

const result = spawnSync("python3", ["-c", [
  "import importlib.util",
  "spec = importlib.util.spec_from_file_location('lookback', 'scripts/reconcile-junkware-lookback.py')",
  "module = importlib.util.module_from_spec(spec)",
  "spec.loader.exec_module(module)",
  "assert module.needs_reconciliation(0, 195.0)",
  "assert module.needs_reconciliation(0, -195.0)",
  "assert module.needs_reconciliation(1, 0)",
  "assert not module.needs_reconciliation(0, 0.01)",
].join("; ")], { encoding: "utf8" });

assert.equal(result.status, 0, result.stderr || result.stdout);
console.log("JunkWare history reconciliation checks passed.");
