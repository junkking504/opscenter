import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "opscenter-searchkings-history-"));
const priorDataRoot = process.env.OPSBOT_DATA_DIR;
process.env.OPSBOT_DATA_DIR = temporaryRoot;

async function main() {
try {
  const historyDirectory = path.join(temporaryRoot, "history", "searchkings");
  fs.mkdirSync(historyDirectory, { recursive: true });
  fs.writeFileSync(path.join(historyDirectory, "searchkings_2026-03.json"), JSON.stringify({
    version: 1,
    source: "searchkings_reports_api",
    fetchedAt: "2026-04-01T01:00:00.000Z",
    customerId: "test",
    range: { startDate: "2026-03-01", endDate: "2026-03-31", timezone: "America/Chicago" },
    accounts: [],
    calls: { total: {}, callsQuality: [], calls: [] },
  }));

  const { availableSearchKingsMonths, readSearchKingsSnapshot } = await import("../lib/searchkings");
  assert.ok(availableSearchKingsMonths().includes("2026-03"));
  assert.equal(readSearchKingsSnapshot("2026-03")?.range.endDate, "2026-03-31");
  assert.equal(readSearchKingsSnapshot("2026-02"), null);

  const marketingPage = fs.readFileSync(path.join(process.cwd(), "app", "(protected)", "marketing", "page.tsx"), "utf8");
  assert.match(marketingPage, /availableSearchKingsMonths/);
  assert.match(marketingPage, /OpsMonthSelector/);
  assert.match(marketingPage, /buildSearchKingsView\(selectedMonthKey/);

  const navigation = fs.readFileSync(path.join(process.cwd(), "components", "OpsNav.tsx"), "utf8");
  const marketingBlock = navigation.slice(navigation.indexOf('if (pathname.startsWith("/marketing"))'), navigation.indexOf('if (pathname.startsWith("/crew"))'));
  assert.doesNotMatch(marketingBlock, /includeDate: false/);
} finally {
  if (priorDataRoot === undefined) delete process.env.OPSBOT_DATA_DIR;
  else process.env.OPSBOT_DATA_DIR = priorDataRoot;
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
}

console.log("Historical SearchKings selection checks passed.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
