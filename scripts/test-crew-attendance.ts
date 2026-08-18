import assert from "node:assert/strict";
import { hasClockedInToday } from "@/lib/crew-attendance";

assert.equal(hasClockedInToday({ roster_only: true, hours_worked: 0 }), false);
assert.equal(hasClockedInToday({ hours_basis: "inferred", revenue_generated: 900 }), false);
assert.equal(hasClockedInToday({ clock_in: "07:15 AM", hours_worked: 0 }), true);
assert.equal(hasClockedInToday({ clock_in: null }, { timeIn: "07:15 AM" }), true);

console.log("Crew attendance filter checks passed.");
