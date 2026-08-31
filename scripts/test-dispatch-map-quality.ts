import assert from "node:assert/strict";
import {
  dispatchMapCoverage,
  dispatchMapVerificationReason,
  hasVerifiedDispatchLocation,
} from "../lib/dispatch-map-quality";

const mapped = { latitude: 30.45, longitude: -91.15, address: "100 Test St, Baton Rouge, LA" };
const missing = { latitude: null, longitude: null, address: "—" };
const unverified = { latitude: null, longitude: null, address: "200 Test St, New Orleans, LA" };
const outside = { latitude: 35, longitude: -91.15, address: "300 Test St" };

assert.equal(hasVerifiedDispatchLocation(mapped), true);
assert.equal(hasVerifiedDispatchLocation(outside), false);
assert.equal(dispatchMapVerificationReason(missing), "Service address is missing");
assert.equal(dispatchMapVerificationReason(unverified), "Address is not confirmed in the map cache");
assert.deepEqual(dispatchMapCoverage([mapped, missing, unverified, outside]), {
  mapped: 1,
  total: 4,
  needsVerification: 3,
  percent: 25,
});
assert.deepEqual(dispatchMapCoverage([]), {
  mapped: 0,
  total: 0,
  needsVerification: 0,
  percent: 100,
});

console.log("Dispatch map quality checks passed.");
