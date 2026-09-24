import fs from "node:fs";
import path from "node:path";
import type { WexFuelTransaction } from "@/lib/wex-fuel";

type AnyRecord = Record<string, unknown>;
type Candidate = { truck: string; method: "address_stop" | "trip_endpoint" | "known_station_point"; observedAt: string; latitude: number | null; longitude: number | null; distanceMiles: number | null };
export type WexTruckAttribution = {
  status: "attributed" | "ambiguous" | "unavailable";
  truck: string | null;
  transactionAt: string;
  method: Candidate["method"] | null;
  evidence: string;
  candidates: string[];
};

const clean = (value: unknown) => String(value || "").replace(/\s+/g, " ").trim();
const truck = (value: unknown) => {
  const match = clean(value).match(/(?:truck\s*#?\s*)?(\d{1,3})/i);
  return match && Number(match[1]) > 0 ? `Truck# ${Number(match[1])}` : null;
};
const epoch = (value: unknown) => {
  const number = Number(value);
  if (Number.isFinite(number) && number > 1_000_000_000) return number < 10_000_000_000 ? number * 1_000 : number;
  const parsed = Date.parse(clean(value));
  return Number.isFinite(parsed) ? parsed : null;
};
const number = (value: unknown) => clean(value) && Number.isFinite(Number(value)) ? Number(value) : null;

function normalizedAddress(value: string): string {
  return clean(value).toLowerCase()
    .replace(/\bavenue\b/g, "ave").replace(/\bstreet\b/g, "st").replace(/\bboulevard\b/g, "blvd")
    .replace(/\broad\b/g, "rd").replace(/\bdrive\b/g, "dr").replace(/\bhighway\b/g, "hwy")
    .replace(/\blane\b/g, "ln").replace(/\bparkway\b/g, "pkwy").replace(/\bcourt\b/g, "ct")
    .replace(/\bnorth\b/g, "n").replace(/\bsouth\b/g, "s").replace(/\beast\b/g, "e").replace(/\bwest\b/g, "w")
    .replace(/\b(?:usa|united states)\b/g, "").replace(/[^a-z0-9]+/g, " ").trim();
}

function addressMatches(transaction: WexFuelTransaction, observed: string): boolean {
  const expected = normalizedAddress(`${transaction.merchantAddress} ${transaction.city} ${transaction.state} ${transaction.postalCode}`);
  const actual = normalizedAddress(observed);
  const streetNumber = normalizedAddress(transaction.merchantAddress).match(/^\d+/)?.[0];
  const postal = transaction.postalCode.match(/\d{5}/)?.[0];
  if (!streetNumber || !expected || !actual.match(new RegExp(`(?:^| )${streetNumber}(?: |$)`))) return false;
  if (postal && !actual.includes(postal)) return false;
  const words = normalizedAddress(transaction.merchantAddress).split(" ").filter(word => word !== streetNumber && word.length > 1);
  return words.length > 0 && words.every(word => actual.split(" ").includes(word));
}

function zonedDate(transaction: WexFuelTransaction): Date {
  const match = transaction.transactionTime.trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?$/i);
  if (!match) return new Date(NaN);
  let hour = Number(match[1]);
  if (match[4]) hour = hour % 12 + (match[4].toUpperCase() === "PM" ? 12 : 0);
  const [year, month, day] = transaction.transactionDate.split("-").map(Number);
  const desired = Date.UTC(year, month - 1, day, hour, Number(match[2]), Number(match[3] || 0));
  let estimate = desired;
  for (let count = 0; count < 3; count += 1) {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(new Date(estimate));
    const part = (type: string) => Number(parts.find(entry => entry.type === type)?.value);
    const rendered = Date.UTC(part("year"), part("month") - 1, part("day"), part("hour"), part("minute"), part("second"));
    estimate += desired - rendered;
  }
  return new Date(estimate);
}

function rootDirectory(): string {
  return process.env.OPSCENTER_DATA_DIR || process.env.OPSBOT_DATA_DIR || path.join(process.env.HOME || "", ".openclaw", "workspace", "opsbot", "data");
}
function locationFile(date: string, root = rootDirectory()): string {
  return path.join(root, "history", "linxup", `linxup_location_${date}.json`);
}
function readPayload(date: string, root?: string): AnyRecord | null {
  try { return JSON.parse(fs.readFileSync(locationFile(date, root), "utf8")) as AnyRecord; } catch { return null; }
}
const rows = (payload: AnyRecord | null, key: string) => Array.isArray(payload?.[key]) ? payload[key] as AnyRecord[] : [];
const miles = (a: [number, number], b: [number, number]) => {
  const radians = (value: number) => value * Math.PI / 180;
  const dLat = radians(b[0] - a[0]), dLon = radians(b[1] - a[1]);
  const value = Math.sin(dLat / 2) ** 2 + Math.cos(radians(a[0])) * Math.cos(radians(b[0])) * Math.sin(dLon / 2) ** 2;
  return 3958.7613 * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
};

function candidate(truckValue: unknown, method: Candidate["method"], at: number, latitude: unknown, longitude: unknown, distanceMiles: number | null = null): Candidate | null {
  const name = truck(truckValue);
  if (!name) return null;
  return { truck: name, method, observedAt: new Date(at).toISOString(), latitude: number(latitude), longitude: number(longitude), distanceMiles };
}

export function attributeWexTransactionToLinxup(transaction: WexFuelTransaction, root = rootDirectory()): WexTruckAttribution {
  const at = zonedDate(transaction).getTime();
  const transactionAt = Number.isFinite(at) ? new Date(at).toISOString() : "";
  if (!transactionAt || !transaction.merchantAddress) return { status: "unavailable", truck: null, transactionAt, method: null, evidence: "WEX transaction time or merchant street address is unavailable.", candidates: [] };
  const payload = readPayload(transaction.transactionDate, root);
  if (!payload) return { status: "unavailable", truck: null, transactionAt, method: null, evidence: `No LinxUp location history is available for ${transaction.transactionDate}.`, candidates: [] };
  const matches: Candidate[] = [];
  for (const stop of rows(payload, "stops")) {
    const begin = epoch(stop.beginDate), end = epoch(stop.endDate);
    const address = `${clean(stop.street)} ${clean(stop.city)} ${clean(stop.stateCode)} ${clean(stop.postalCode)}`;
    if (begin !== null && end !== null && at >= begin - 15 * 60_000 && at <= end + 15 * 60_000 && addressMatches(transaction, address)) {
      const item = candidate(stop.driverName || stop.firstName, "address_stop", Math.max(begin, Math.min(at, end)), stop.latitude, stop.longitude);
      if (item) matches.push(item);
    }
  }
  for (const trip of rows(payload, "trips")) {
    for (const endpoint of ["start", "end"] as const) {
      const observed = epoch(trip[`${endpoint}DateTime`]);
      if (observed !== null && Math.abs(at - observed) <= 20 * 60_000 && addressMatches(transaction, clean(trip[`${endpoint}Address`]))) {
        const item = candidate(trip.personName || trip.driverName, "trip_endpoint", observed, trip[`${endpoint}Latitude`], trip[`${endpoint}Longitude`]);
        if (item) matches.push(item);
      }
    }
  }
  if (!matches.length) {
    const stationCoordinates: Array<[number, number]> = [];
    const history = path.dirname(locationFile(transaction.transactionDate, root));
    let files: string[] = [];
    try { files = fs.readdirSync(history).filter(file => /^linxup_location_\d{4}-\d{2}-\d{2}\.json$/.test(file)).sort().slice(-60); } catch { /* no historical station coordinates */ }
    for (const file of files) {
      let historical: AnyRecord | null = null;
      try { historical = JSON.parse(fs.readFileSync(path.join(history, file), "utf8")) as AnyRecord; } catch { continue; }
      for (const stop of rows(historical, "stops")) {
        if (!addressMatches(transaction, `${clean(stop.street)} ${clean(stop.city)} ${clean(stop.stateCode)} ${clean(stop.postalCode)}`)) continue;
        const latitude = number(stop.latitude), longitude = number(stop.longitude);
        if (latitude !== null && longitude !== null) stationCoordinates.push([latitude, longitude]);
      }
      for (const trip of rows(historical, "trips")) for (const endpoint of ["start", "end"] as const) {
        if (!addressMatches(transaction, clean(trip[`${endpoint}Address`]))) continue;
        const latitude = number(trip[`${endpoint}Latitude`]), longitude = number(trip[`${endpoint}Longitude`]);
        if (latitude !== null && longitude !== null) stationCoordinates.push([latitude, longitude]);
      }
    }
    if (stationCoordinates.length) for (const point of rows(payload, "points")) {
      const observed = epoch(point.timestamp), latitude = number(point.latitude), longitude = number(point.longitude);
      if (observed === null || latitude === null || longitude === null || Math.abs(at - observed) > 20 * 60_000) continue;
      const distance = Math.min(...stationCoordinates.map(coordinate => miles([latitude, longitude], coordinate)));
      if (distance <= 0.2) {
        const item = candidate(point.truck_number, "known_station_point", observed, latitude, longitude, distance);
        if (item) matches.push(item);
      }
    }
  }
  const byTruck = new Map<string, Candidate>();
  for (const match of matches.sort((left, right) => Math.abs(Date.parse(left.observedAt) - at) - Math.abs(Date.parse(right.observedAt) - at))) if (!byTruck.has(match.truck)) byTruck.set(match.truck, match);
  const candidates = [...byTruck.keys()].sort();
  if (candidates.length !== 1) return { status: candidates.length ? "ambiguous" : "unavailable", truck: null, transactionAt, method: null, evidence: candidates.length ? `Multiple trucks matched the LinxUp time/location evidence: ${candidates.join(", ")}.` : "No truck was within the allowed LinxUp time/location window.", candidates };
  const selected = byTruck.get(candidates[0])!;
  const distance = selected.distanceMiles === null ? "" : `, ${selected.distanceMiles.toFixed(2)} mi from the known station coordinate`;
  return { status: "attributed", truck: selected.truck, transactionAt, method: selected.method, evidence: `${selected.method.replaceAll("_", " ")} at ${selected.observedAt}${distance}; exactly one truck matched.`, candidates };
}
