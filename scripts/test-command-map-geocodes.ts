import assert from "node:assert/strict";
import crypto from "node:crypto";
import { commandMapPoint } from "@/lib/command-map-data";

function cacheKey(address: string): string {
  const normalized = address.replace(/\s+/g, " ").replace(/\s*,\s*/g, ", ").trim().toUpperCase();
  return crypto.createHash("sha256").update(normalized).digest("hex");
}

const address = "70285 Fuchsia St, Abita Springs, 70420";
const point = commandMapPoint({
  appt_id: "4055341",
  job_id: "JK4068519",
  customer_name: "Michael Lebas",
  service_address: address,
  appointment_time: "08:00 AM - 09:00 AM",
  truck: "Truck# 8",
  job_status: "Completed Duration: 60 min(s)",
  latitude: 0,
  longitude: 0,
}, 0, {
  [cacheKey(address)]: {
    latitude: 30.453521127721,
    longitude: -90.052660126032,
    match_confidence: "confirmed",
    normalized_address: address,
  },
});

assert.equal(point.latitude, 30.453521127721);
assert.equal(point.longitude, -90.052660126032);
assert.equal(point.jkNumber, "JK4068519");

const unverified = commandMapPoint({ service_address: address, latitude: 0, longitude: 0 }, 0, {});
assert.equal(unverified.latitude, 0, "A missing verified geocode must not create a locator.");
assert.equal(unverified.longitude, 0, "A missing verified geocode must not create a locator.");

console.log("Command map geocode fallback keeps confirmed JunkWare appointments visible.");
