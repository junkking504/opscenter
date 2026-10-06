import fs from "node:fs";
import path from "node:path";
import { fleetServiceTypes, type FleetServiceInterval } from "./fleet-service-plan";
const file = () => path.join(process.cwd(), "data", "fleet", "service_intervals.json");
export function readFleetServiceIntervals(): FleetServiceInterval[] {
  if (!fs.existsSync(file())) return [];
  const data = JSON.parse(fs.readFileSync(file(), "utf8"));
  if (data.version !== 1 || !Array.isArray(data.intervals))
    throw new Error(
      "Maintenance intervals are unavailable. Existing records have not been changed.",
    );
  const keys = new Set<string>();
  for (const row of data.intervals) {
    validateInterval(row);
    const key = `${row.truck}:${row.serviceType}`;
    if (keys.has(key) || !/^Truck# [1-9]\d*$/.test(row.truck) || typeof row.updatedAt !== "string")
      throw new Error("Maintenance interval records need review.");
    keys.add(key);
  }
  return data.intervals;
}
export function validateInterval(input: Record<string, unknown>) {
  if (!fleetServiceTypes.includes(input.serviceType as (typeof fleetServiceTypes)[number]))
    throw new Error("Choose a supported service type.");
  for (const key of ["miles", "months"]) {
    const v = input[key];
    if (
      v !== "" &&
      v !== null &&
      v !== undefined &&
      (!Number.isSafeInteger(Number(v)) ||
        Number(v) <= 0 ||
        Number(v) > (key === "months" ? 120 : 1000000))
    )
      throw new Error(`Enter a positive whole number for ${key}.`);
  }
  if (typeof input.enabled !== "boolean")
    throw new Error("Choose whether the interval is enabled.");
  if (input.enabled && !Number(input.miles) && !Number(input.months))
    throw new Error("Set a mileage or month interval.");
}
export function upsertFleetServiceInterval(
  truck: string,
  input: Record<string, unknown>,
): FleetServiceInterval {
  validateInterval(input);
  const intervals = readFleetServiceIntervals();
  const row: FleetServiceInterval = {
    truck,
    serviceType: String(input.serviceType),
    miles: Number(input.miles) || null,
    months: Number(input.months) || null,
    enabled: input.enabled === true,
    updatedAt: new Date().toISOString(),
  };
  const index = intervals.findIndex((i) => i.truck === truck && i.serviceType === row.serviceType);
  if (index < 0) intervals.push(row);
  else intervals[index] = row;
  fs.mkdirSync(path.dirname(file()), { recursive: true });
  const temporary = `${file()}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify({ version: 1, intervals }, null, 2), { mode: 0o660 });
  fs.renameSync(temporary, file());
  return row;
}
