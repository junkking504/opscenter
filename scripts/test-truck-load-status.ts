import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  formatTruckLoadFraction,
  junkwareJobLoadFraction,
  parseJunkwareLoadFraction,
  readTruckLoadStatuses,
  recordTruckLoadFromCloseout,
  recordTruckLoadSnapshot,
  resetTruckLoad,
  setTruckStartingLoad,
} from "@/lib/truck-load-status";

const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), "opscenter-truck-load-status-"));
process.env.OPSCENTER_DATA_DIR = testRoot;

function assertClose(actual: number | null | undefined, expected: number, message?: string) {
  assert.ok(actual != null && Math.abs(actual - expected) < 1e-9, message || `Expected ${actual} to be close to ${expected}.`);
}

assertClose(parseJunkwareLoadFraction(".5 (1/12)"), 1 / 12);
assertClose(parseJunkwareLoadFraction("1 (1/6)"), 1 / 6);
assert.equal(parseJunkwareLoadFraction("2.5 (3/8)"), 3 / 8);
assert.equal(parseJunkwareLoadFraction("Full truck"), 1);
assertClose(parseJunkwareLoadFraction("Minimum"), 1 / 12);
assertClose(parseJunkwareLoadFraction("4"), 2 / 3);
assert.equal(parseJunkwareLoadFraction("Bag(s)"), null);
assertClose(junkwareJobLoadFraction("2 (1/3)", ""), 1 / 3, "A selected load with blank quantity means one truck load.");
assertClose(junkwareJobLoadFraction("2 (1/3)", "2"), 2 / 3);
assert.equal(formatTruckLoadFraction(0), "Empty");
assert.equal(formatTruckLoadFraction(3 / 4), "3/4 full");
assert.equal(formatTruckLoadFraction(4 / 3), "Full + 1/3");

const date = "2026-08-31";
let status = setTruckStartingLoad({ date, truck: "Truck 9", loadFraction: 1 / 4, recordedBy: "dispatcher@example.com" });
assert.equal(status.truck, "Truck# 9");
assertClose(status.startingLoadFraction, 1 / 4);
assertClose(status.currentLoadFraction, 1 / 4);

let closeout = recordTruckLoadFromCloseout({
  date,
  truck: "Truck# 9",
  appointmentId: "4050001",
  jobNumber: "JK40600001",
  loadSize: "2 (1/3)",
  loadQuantity: "",
  verifiedAt: "2026-08-31T15:00:00.000Z",
});
assert.equal(closeout.updated, true);
assertClose(closeout.status?.currentLoadFraction, 7 / 12);

closeout = recordTruckLoadFromCloseout({
  date,
  truck: "Truck# 9",
  appointmentId: "4050001",
  jobNumber: "JK40600001",
  loadSize: "3 (1/2)",
  loadQuantity: "",
  verifiedAt: "2026-08-31T15:05:00.000Z",
});
assertClose(closeout.status?.currentLoadFraction, 3 / 4, "Editing one closeout must replace, not duplicate, its load contribution.");
assert.equal(closeout.status?.events.filter((event) => event.appointmentId === "4050001").length, 1);

status = resetTruckLoad({ date, truck: "9", location: "dump", recordedBy: "dispatcher@example.com", occurredAt: "2026-08-31T16:00:00.000Z" });
assert.equal(status.currentLoadFraction, 0);
assert.equal(status.lastEvent?.resetLocation, "dump");

closeout = recordTruckLoadFromCloseout({
  date,
  truck: "Truck 9",
  appointmentId: "4050002",
  jobNumber: "JK40600002",
  loadSize: "1 (1/6)",
  loadQuantity: "1",
  verifiedAt: "2026-08-31T17:00:00.000Z",
});
assertClose(closeout.status?.currentLoadFraction, 1 / 6);

status = resetTruckLoad({ date, truck: "Truck 9", location: "metal_yard", recordedBy: "dispatcher@example.com", occurredAt: "2026-08-31T18:00:00.000Z" });
assert.equal(status.currentLoadFraction, 0);
assert.equal(status.lastEvent?.resetLocation, "metal_yard");

const snapshot = recordTruckLoadSnapshot({
  date,
  truck: "Truck 9",
  loadFraction: 1 / 2,
  contents: "some metal, mostly junk",
  messageId: "wamid.snapshot-1",
  occurredAt: "2026-08-31T19:00:00.000Z",
});
assert.equal(snapshot.created, true);
assertClose(snapshot.status.currentLoadFraction, 1 / 2);
assert.equal(snapshot.status.currentContents, "some metal, mostly junk");
assert.equal(recordTruckLoadSnapshot({
  date,
  truck: "Truck 9",
  loadFraction: 3 / 4,
  contents: "duplicate should not replace",
  messageId: "wamid.snapshot-1",
}).created, false);

const ignoredVirtual = recordTruckLoadFromCloseout({
  date,
  truck: "Virtual Truck",
  appointmentId: "4050003",
  loadSize: "Full truck",
  loadQuantity: "1",
});
assert.equal(ignoredVirtual.updated, false);
assert.match(ignoredVirtual.reason, /physical truck/i);

const statuses = readTruckLoadStatuses(date, ["Truck# 2", "Truck# 9", "Virtual Truck"]);
assert.deepEqual(statuses.map((entry) => entry.truck), ["Truck# 2", "Truck# 9"]);
assert.equal(statuses.find((entry) => entry.truck === "Truck# 2")?.currentLoadFraction, 0);
assert.equal(statuses.find((entry) => entry.truck === "Truck# 9")?.events.length, 6);

recordTruckLoadSnapshot({
  date: "2026-09-01",
  truck: "Truck 2",
  loadFraction: 1 / 2,
  contents: "junk",
  messageId: "future-snapshot",
  occurredAt: "2099-09-01T23:59:59.000Z",
});
const monotonicReset = resetTruckLoad({
  date: "2026-09-01",
  truck: "Truck 2",
  location: "dump",
  recordedBy: "dispatcher@example.com",
});
assert.equal(monotonicReset.currentLoadFraction, 0, "A dispatcher reset must remain latest even after a clock-skewed event.");
assert.ok((monotonicReset.lastEvent?.occurredAt || "") > "2099-09-01T23:59:59.000Z");

fs.rmSync(testRoot, { recursive: true, force: true });
console.log("Truck load status verification passed.");
