import assert from "node:assert/strict";
import crypto from "node:crypto";
import { planningLocation } from "../lib/planning-geocodes";

function cacheKey(address: string): string {
  const normalized = address.replace(/\s+/g, " ").replace(/\s*,\s*/g, ", ").trim().toUpperCase();
  return crypto.createHash("sha256").update(normalized).digest("hex");
}

const confirmed = {
  [cacheKey("4026 Juno Drive, Chalmette, 70043")]: {
    latitude: 29.9601984,
    longitude: -89.966716,
    match_confidence: "confirmed",
    normalized_address: "4026 Juno Drive, Chalmette, 70043",
  },
};

assert.deepEqual(
  planningLocation("4026 Juno Drive, Chalmette, LA 70043", confirmed),
  { latitude: 29.9601984, longitude: -89.966716 },
  "A separate Louisiana state column must resolve to the confirmed JunkWare geocode.",
);
assert.deepEqual(
  planningLocation("4026 Juno Drive Chalmette, LA 70043", confirmed),
  { latitude: 29.9601984, longitude: -89.966716 },
  "JunkWare's fast-schedule punctuation must resolve to the same confirmed service address.",
);
assert.deepEqual(
  planningLocation("4026 Juno Drive Chalmette, LA 70043 Followup", confirmed),
  { latitude: 29.9601984, longitude: -89.966716 },
  "JunkWare's trailing Followup label must not change a confirmed service address.",
);
assert.equal(planningLocation("4026 Juno Drive, Chalmette, LA 70043", {}), null);
assert.equal(planningLocation("4026 Juno Drive, Chalmette, LA 70043", {
  [cacheKey("4026 Juno Drive, Chalmette, 70043")]: { latitude: null, longitude: -89.966716 },
}), null);
assert.equal(planningLocation("4026 Juno Drive Chalmette, LA 70043", {
  [cacheKey("4026 Juno Drive, Chalmette, 70043")]: {
    latitude: 29.9601984,
    longitude: -89.966716,
    match_confidence: "ambiguous",
    normalized_address: "4026 Juno Drive, Chalmette, 70043",
  },
}), null);
assert.equal(planningLocation("—", confirmed), null);
console.log("Planning geocode checks passed.");
