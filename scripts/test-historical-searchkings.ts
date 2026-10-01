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

  const { availableSearchKingsMonths, readSearchKingsSnapshot, buildSearchKingsInquiryHistory, canonicalSearchKingsCallId } = await import("../lib/searchkings");
  assert.ok(availableSearchKingsMonths().includes("2026-03"));
  assert.equal(readSearchKingsSnapshot("2026-03")?.range.endDate, "2026-03-31");
  // The production data root can contain other months. Use a deliberately
  // unsupported historical key so this isolation check never reads it.
  assert.equal(readSearchKingsSnapshot("1999-01"), null);

  const fixture = readSearchKingsSnapshot("2026-03")!;
  const call = { id: "history-regression-call", name: "Older inquiry", calledAtDate: "2026-03-12", calledAtTime: "12:00 PM", callerNumberComplete: "5045550100", duration: "1:00", tagList: [] };
  fixture.calls.calls = [call] as typeof fixture.calls.calls;
  fs.writeFileSync(path.join(historyDirectory, "searchkings_2026-03.json"), JSON.stringify(fixture));
  fs.mkdirSync(path.join(temporaryRoot, "searchkings"), { recursive: true });
  fs.writeFileSync(path.join(temporaryRoot, "searchkings", "current.json"), JSON.stringify({ ...fixture, range: { ...fixture.range, startDate: "2026-10-01", endDate: "2026-10-01" }, calls: { ...fixture.calls, calls: [{ ...call, name: "Latest copy" }, { ...call, id: "current-regression-call", callerNumberComplete: "5045550101" }] } }));
  const history = buildSearchKingsInquiryHistory();
  assert.equal(history.filter(lead => lead.callId === canonicalSearchKingsCallId(call)).length, 1);
  assert.equal(history.find(lead => lead.callId === canonicalSearchKingsCallId(call))?.callerName, "Latest copy");
  assert.ok(history.some(lead => lead.phone === "5045550101"));

  const marketingPage = fs.readFileSync(path.join(process.cwd(), "app", "(protected)", "marketing", "page.tsx"), "utf8");
  assert.match(marketingPage, /availableSearchKingsMonths/);
  assert.match(marketingPage, /OpsMonthSelector/);
  assert.match(marketingPage, /buildSearchKingsView\(selectedMonthKey/);

  const navigation = fs.readFileSync(path.join(process.cwd(), "components", "OpsNav.tsx"), "utf8");
  const marketingBlock = navigation.slice(navigation.indexOf('if (pathname.startsWith("/marketing"))'), navigation.indexOf('if (pathname.startsWith("/crew"))'));
  assert.doesNotMatch(marketingBlock, /includeDate: false/);

  const monthSelector = fs.readFileSync(path.join(process.cwd(), "components", "OpsMonthSelector.tsx"), "utf8");
  assert.match(monthSelector, /params\.set\("mode", "historical"\)/);
  assert.match(monthSelector, /params\.delete\("mode"\)/);
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
