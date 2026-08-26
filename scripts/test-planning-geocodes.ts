import assert from "node:assert/strict";
import crypto from "node:crypto";
import { planningLocation } from "../lib/planning-geocodes";

function cacheKey(address: string): string {
  const normalized = address.replace(/\s+/g, " ").replace(/\s*,\s*/g, ", ").trim().toUpperCase();
  return crypto.createHash("sha256").update(normalized).digest("hex");
}

const chalmetteAddress = "4026 Juno Drive, Chalmette, 70043";
const confirmed = {
  [cacheKey(chalmetteAddress)]: {
    latitude: 29.9601984,
    longitude: -89.966716,
    match_confidence: "confirmed",
    normalized_address: chalmetteAddress,
  },
};

assert.deepEqual(
  planningLocation("4026 Juno Drive, Chalmette, LA 70043", confirmed),
  { latitude: 29.9601984, longitude: -89.966716 },
  "A separate Louisiana state field must resolve to the confirmed cache record.",
);
assert.deepEqual(
  planningLocation("4026 Juno Drive Chalmette, LA 70043", confirmed),
  { latitude: 29.9601984, longitude: -89.966716 },
  "A punctuation-only schedule difference must resolve to the confirmed cache record.",
);
assert.equal(planningLocation("4026 Juno Drive, Chalmette, LA 70043", {}), null);
assert.equal(planningLocation("4026 Juno Drive, Chalmette, LA 70043", {
  [cacheKey(chalmetteAddress)]: { latitude: 29.9601984, longitude: -89.966716, match_confidence: "ambiguous" },
}), null, "Ambiguous geocodes must remain off the map.");
assert.equal(planningLocation("4026 Juno Drive, Chalmette, LA 70043", {
  [cacheKey(chalmetteAddress)]: { latitude: 0, longitude: 0, match_confidence: "confirmed" },
}), null, "Out-of-service-area coordinates must remain off the map.");
assert.equal(planningLocation("4026 Juno Drive Chalmette, LA 70043", {
  [cacheKey(chalmetteAddress)]: { latitude: 29.9601984, longitude: -89.966716, match_confidence: "confirmed", normalized_address: chalmetteAddress },
  [cacheKey("4026 Juno Drive, Chalmette, 70043 #B")]: { latitude: 30.01, longitude: -90.01, match_confidence: "confirmed", normalized_address: chalmetteAddress },
}), null, "A non-unique canonical match must remain off the map.");
assert.equal(planningLocation("—", confirmed), null);
console.log("Planning geocode checks passed.");
