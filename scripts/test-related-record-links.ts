import assert from "node:assert/strict";
import {
  crewMemberAnchor,
  crewMemberHref,
  fleetTruckHref,
  jobScheduleHref,
} from "../lib/related-record-links";

assert.equal(crewMemberAnchor("Lance Gerard"), "crew-member-lance-gerard");
assert.equal(
  crewMemberHref("2026-08-28", "Lance Gerard"),
  "/crew?date=2026-08-28&section=crew&member=Lance+Gerard#crew-member-lance-gerard",
);
assert.equal(
  fleetTruckHref("2026-08-28", "Truck# 9"),
  "/fleet?date=2026-08-28&view=daily&section=map&truck=9",
);
assert.equal(
  jobScheduleHref("2026-08-28", "JK4069484"),
  "/jobs?date=2026-08-28&q=JK4069484#job-jk4069484",
);

console.log("Related-record deep-link contracts passed.");
