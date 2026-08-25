import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  currentJunkwareScheduleSnapshot,
  readVerifiedJunkwareScheduleSnapshot,
} from "@/lib/junkware-fast-schedule";

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "opscenter-fast-schedule-"));
const date = "2026-08-25";
const directory = path.join(temporary, "history", "junkware");
const canonical = path.join(directory, `junkware_${date}_raw.json`);
const fast = path.join(directory, `junkware_schedule_fast_${date}.json`);
fs.mkdirSync(directory, { recursive: true });
fs.writeFileSync(canonical, "{}\n");

const payload = {
  date,
  scraped_at: "2026-08-25T16:45:00-05:00",
  markets_scraped: [
    "Junk King New Orleans",
    "Junk King Northshore",
    "Junk King Baton Rouge",
    "Junk King Jefferson Parish",
  ],
  appointments: [{ appt_id: "4052090", job_id: "JK4065268", job_status: "Completed", revenue: "$1,808.68" }],
  cancelled: [{ appt_id: "4059999", job_id: "JK4069999", job_status: "Cancelled" }],
};
fs.writeFileSync(fast, `${JSON.stringify(payload)}\n`);

const base = new Date("2026-08-25T21:45:00.000Z");
fs.utimesSync(canonical, base, base);
fs.utimesSync(fast, new Date(base.getTime() - 5_000), new Date(base.getTime() - 5_000));
assert.equal(currentJunkwareScheduleSnapshot(temporary, date), null, "Older fast data must not replace canonical data");

fs.utimesSync(fast, new Date(base.getTime() + 5_000), new Date(base.getTime() + 5_000));
const current = currentJunkwareScheduleSnapshot(temporary, date);
assert.equal(current?.appointments[0]?.job_status, "Completed");
assert.equal(current?.cancelled[0]?.job_status, "Cancelled");

fs.writeFileSync(fast, `${JSON.stringify({ ...payload, markets_scraped: payload.markets_scraped.slice(0, 3) })}\n`);
assert.equal(readVerifiedJunkwareScheduleSnapshot(temporary, date), null, "Partial-market data must be rejected");

const scopedMarkets = [
  ["352", "Junk King New Orleans"],
  ["477", "Junk King Northshore"],
  ["399", "Junk King Baton Rouge"],
  ["484", "Junk King Jefferson Parish"],
] as const;
for (const [index, [marketId, market]] of scopedMarkets.entries()) {
  const scopedFile = path.join(directory, "schedule-watchers", marketId, `junkware_schedule_fast_${date}.json`);
  fs.mkdirSync(path.dirname(scopedFile), { recursive: true });
  fs.writeFileSync(scopedFile, `${JSON.stringify({
    ...payload,
    markets_scraped: [market],
    appointments: [{ appt_id: `scope-${marketId}`, market }],
    cancelled: [],
  })}\n`);
  const stamp = new Date(base.getTime() + 10_000 + index * 1_000);
  fs.utimesSync(scopedFile, stamp, stamp);
}
const combined = readVerifiedJunkwareScheduleSnapshot(temporary, date);
assert.equal(combined?.appointments.length, 4, "Four verified market snapshots must form the live roster");
assert.equal(combined?.freshnessAtMs, base.getTime() + 10_000, "Health must use the oldest market heartbeat");

fs.rmSync(temporary, { recursive: true, force: true });
console.log("JunkWare fast schedule checks passed.");
