import assert from "node:assert/strict";
import { junkwareBookedAt, junkwareBookedDateLabel } from "../lib/junkware-booking-date";

assert.equal(junkwareBookedDateLabel("8/13/2026 4:31:19 PM"), "Thu, Aug 13");
assert.equal(junkwareBookedDateLabel("Booked: 7/31/2026 4:22:39 PM, Amazon API User"), "Fri, Jul 31");
assert.equal(junkwareBookedDateLabel("2026-08-12T17:33:43-05:00"), "Wed, Aug 12");
assert.equal(junkwareBookedDateLabel("2/30/2026 1:00:00 PM"), "");
assert.equal(junkwareBookedDateLabel("not collected"), "");

assert.equal(
  junkwareBookedAt(
    { booked_at: "" },
    { bookedAt: "8/10/2026 11:55:56 AM" },
  ),
  "8/10/2026 11:55:56 AM",
);
assert.equal(junkwareBookedAt({ booked_at: "not a JunkWare date" }), "");

console.log("JunkWare booking-date checks passed.");
