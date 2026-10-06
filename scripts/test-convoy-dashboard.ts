import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  servicePlan,
  serviceMonthTarget,
  mileageQuality,
  type FleetMileage,
} from "../lib/fleet-service-plan";
import { readFleetServiceIntervals } from "../lib/fleet-service-intervals";
import { readDesktopFleet, runDesktopFleetAction } from "../lib/desktop-fleet";
import { desktopVersion } from "../lib/desktop-krewe";
import { readFleetMaintenanceStore, upsertFleetMaintenanceRecord } from "../lib/fleet-maintenance";
const now = Date.parse("2026-10-06T22:00:00Z");
const reading: FleetMileage = {
  value: 155000,
  source: "true",
  reportedAt: new Date(now - 1000).toISOString(),
  retrievedAt: new Date(now).toISOString(),
  estimated: 154000,
  conflicting: false,
  duplicate: false,
};
const rule = {
  truck: "Truck# 4",
  serviceType: "Oil change",
  miles: 5000,
  months: 6,
  enabled: true,
  updatedAt: "",
};
const record = {
  recordId: "last",
  serviceType: "Oil change",
  status: "completed",
  serviceDate: "2026-04-30",
  odometer: 151000,
  nextServiceDate: "",
  nextServiceOdometer: null,
};
assert.equal(serviceMonthTarget("2026-01-31", 1), "2026-02-28");
assert.equal(serviceMonthTarget("2024-01-31", 1), "2024-02-29");
assert.equal(mileageQuality(reading, now), "current");
assert.equal(mileageQuality({ ...reading, value: 0 }, now), "current");
assert.equal(mileageQuality({ ...reading, conflicting: true }, now), "conflict");
assert.equal(mileageQuality({ ...reading, duplicate: true }, now), "conflict");
assert.equal(mileageQuality({ ...reading, reportedAt: "2026-08-01" }, now), "stale");
assert.equal(mileageQuality({ ...reading, retrievedAt: "2026-08-01" }, now), "stale");
assert.equal(mileageQuality({ ...reading, reportedAt: "2026-10-07" }, now), "stale");
const plan = servicePlan("Oil change", rule, [record], reading, "2026-10-06", now);
assert.equal(plan.nextDate, "2026-10-30");
assert.equal(plan.nextMiles, 156000);
assert.equal(plan.status, "soon");
assert.equal(
  servicePlan("Oil change", rule, [record], { ...reading, value: 156000 }, "2026-10-06", now)
    .status,
  "due",
);
assert.equal(
  servicePlan("Oil change", rule, [record], { ...reading, conflicting: true }, "2026-10-31", now)
    .status,
  "due",
  "known time target remains due even when mileage is unknown",
);
assert.equal(
  servicePlan(
    "Oil change",
    { ...rule, months: null },
    [record],
    { ...reading, conflicting: true },
    "2026-10-06",
    now,
  ).status,
  "unknown",
);
assert.equal(
  servicePlan("Oil change", rule, [{ ...record, status: "scheduled" }], reading, "2026-10-06", now)
    .status,
  "baseline",
  "scheduled work never establishes baseline",
);
assert.equal(
  servicePlan("Oil change", undefined, [record], reading, "2026-10-06", now).status,
  "unset",
);
assert.equal(
  servicePlan(
    "Oil change",
    rule,
    [{ ...record, serviceDate: "2026-10-07" }],
    reading,
    "2026-10-06",
    now,
  ).status,
  "baseline",
);
assert.equal(
  servicePlan(
    "Oil change",
    rule,
    [{ ...record, nextServiceOdometer: 0 }],
    reading,
    "2026-10-06",
    now,
  ).status,
  "due",
  "zero is a real explicit target",
);
const cwd = process.cwd(),
  directory = fs.mkdtempSync(path.join(os.tmpdir(), "convoy-dashboard-"));
const oldHome = process.env.HOME;
process.chdir(directory);
process.env.HOME = directory;
try {
  fs.mkdirSync("data/history/linxup", { recursive: true });
  fs.mkdirSync("data/fleet", { recursive: true });
  fs.writeFileSync("data/fleet/repair_issues.json", JSON.stringify({ issues: [] }));
  fs.writeFileSync(
    "data/history/linxup/linxup_2026-10-06_raw.json",
    JSON.stringify({
      retrieved_at: new Date(now).toISOString(),
      responses: {
        locations: {
          data: {
            locations: [
              {
                personName: "Truck# 4",
                trueOdo: 155000,
                virtualOdo: 155000,
                estimatedOdo: 140000,
                date: now,
              },
              { personName: "Truck# 3", virtualOdo: 31000, estimatedOdo: 143000, date: now },
            ],
          },
        },
      },
    }),
  );
  const snapshot = readDesktopFleet("2026-10-09", "overview", "admin");
  assert.equal(
    snapshot.trucks.find((t) => t.id === "Truck# 4")?.mileage?.value,
    155000,
    "future planning retains latest mileage",
  );
  assert.equal(
    snapshot.trucks.find((t) => t.id === "Truck# 4")?.mileage?.conflicting,
    false,
    "true odometer has precedence",
  );
  assert.equal(
    snapshot.trucks.find((t) => t.id === "Truck# 3")?.mileage?.conflicting,
    true,
    "conflicting virtual counters are flagged",
  );
  assert.equal(snapshot.trucks.find((t) => t.id === "Truck# 5")?.mileage?.value, null);
  const body = {
    date: "2026-10-06",
    truck: "Truck# 4",
    action: "interval",
    requestId: randomUUID(),
    expectedVersion: desktopVersion(null),
    values: { serviceType: "Oil change", miles: 5000, months: 6, enabled: true },
  };
  assert.equal(
    readDesktopFleet("2026-10-06", "overview", "operator").canWrite,
    true,
    "operators retain existing operations permission",
  );
  assert.equal(runDesktopFleetAction(body, "test@example.invalid", "admin").status, "verified");
  assert.equal(runDesktopFleetAction(body, "test@example.invalid", "admin").status, "verified");
  assert.equal(readFleetServiceIntervals().length, 1, "idempotent interval saves");
  assert.throws(
    () =>
      runDesktopFleetAction(
        { ...body, requestId: randomUUID(), values: { ...body.values, miles: 6000 } },
        "test@example.invalid",
        "admin",
      ),
    /changed/,
  );
  assert.throws(
    () =>
      runDesktopFleetAction(
        { ...body, values: { ...body.values, miles: -1 } },
        "test@example.invalid",
        "admin",
      ),
    /positive/,
  );
  assert.throws(
    () =>
      runDesktopFleetAction(
        { ...body, values: { ...body.values, miles: 0, months: null } },
        "test@example.invalid",
        "admin",
      ),
    /positive/,
  );
  const current = readFleetServiceIntervals()[0];
  assert.equal(
    runDesktopFleetAction(
      {
        ...body,
        requestId: randomUUID(),
        expectedVersion: desktopVersion(current),
        values: { ...body.values, miles: 6000 },
      },
      "test@example.invalid",
      "admin",
    ).status,
    "verified",
  );
  assert.equal(readFleetServiceIntervals()[0].miles, 6000);
  const maintenance = {
    ...body,
    action: "maintenance",
    requestId: randomUUID(),
    values: {
      serviceType: "Oil change",
      serviceDate: "2026-09-30",
      status: "completed",
      odometer: 150000,
      cost: 0,
    },
    expectedVersion: desktopVersion(null),
  };
  assert.equal(
    runDesktopFleetAction(maintenance, "test@example.invalid", "admin").status,
    "verified",
  );
  assert.equal(readFleetMaintenanceStore().records[0].cost, 0);
  assert.throws(
    () =>
      runDesktopFleetAction(
        {
          ...maintenance,
          requestId: randomUUID(),
          values: { ...maintenance.values, serviceDate: "2099-01-01" },
        },
        "test@example.invalid",
        "admin",
      ),
    /future/,
  );
  assert.throws(
    () =>
      runDesktopFleetAction(
        { ...maintenance, requestId: randomUUID(), values: { ...maintenance.values, cost: -1 } },
        "test@example.invalid",
        "admin",
      ),
    /non-negative/,
  );
  fs.writeFileSync("data/fleet/service_intervals.json", "broken");
  assert.throws(() => readFleetServiceIntervals());
  fs.writeFileSync("data/fleet/maintenance_records.json", "broken");
  assert.throws(
    () =>
      upsertFleetMaintenanceRecord({
        truck: "Truck# 4",
        serviceDate: "2026-09-30",
        serviceType: "Oil change",
        status: "completed",
      }),
    /unavailable/,
  );
  assert.equal(fs.readFileSync("data/fleet/maintenance_records.json", "utf8"), "broken");
  console.log(
    "Convoy dashboard passed: future-date mileage, quality and nulls, calendar/mileage due rules, interval persistence, replay, stale versions, permissions, validation, corrupt-store protection.",
  );
} finally {
  process.chdir(cwd);
  if (oldHome === undefined) delete process.env.HOME;
  else process.env.HOME = oldHome;
  fs.rmSync(directory, { recursive: true, force: true });
}
