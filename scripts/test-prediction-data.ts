import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildPredictionDataset, writePredictionDataset } from "../lib/prediction-data";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "opscenter-prediction-"));
const writeJson = (relative: string, value: unknown) => {
  const file = path.join(root, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value));
};

for (let index = 0; index < 42; index += 1) {
  const date = new Date("2026-07-01T12:00:00Z");
  date.setUTCDate(date.getUTCDate() + index);
  const key = date.toISOString().slice(0, 10);
  writeJson(`history/daily_metrics/daily_metrics_${key}.json`, {
    date: key,
    generated_at: `${key}T23:00:00Z`,
    total_revenue: 1000 + index * 10,
    total_payroll: 300,
    fuel_expense: 50,
    dump_expense: 75,
    other_expense: 10,
    net_profit: 565 + index * 10,
    appointments: [
      { appointment_type: "Job", customer_name: "Must not leak", customer_phone: "555-0100" },
      { appointment_type: "Estimate", address: "Must not leak" },
    ],
    jobs_by_truck: { "Truck# 1": 1 },
    revenue_by_truck: { "Truck# 1": 1000 + index * 10 },
    miles_by_truck: { "Truck# 1": 30 },
    drive_time_by_truck: { "Truck# 1": "1:30" },
    idle_time_by_truck: { "Truck# 1": "0:15" },
    truck_record_financial_rows: [{ truck: "Truck# 1", fuel_expense: 50, dump_expense: 75 }],
  });
}

writeJson("integrations/wex-fuel/posted-transactions.json", {
  schemaVersion: 2,
  importedAt: "2026-08-12T12:00:00Z",
  coverageFrom: "2026-08-10",
  coverageThrough: "2026-08-11",
  transactionCount: 2,
  transactions: [
    { transactionId: "1", transactionDate: "2026-08-10", truck: "Truck 1", gallons: 10, netCost: 35 },
    { transactionId: "2", transactionDate: "2026-08-11", truck: "Truck 1", gallons: 12, netCost: 42 },
  ],
});

writeJson("history/searchkings/searchkings_2026-08.json", {
  fetchedAt: "2026-08-12T12:00:00Z",
  range: { startDate: "2026-08-01", endDate: "2026-08-12" },
  accounts: [{ metrics: [{ label: "Cost", chartData: { labels: ["Aug 10 2026"], datasets: [{ data: [100] }] } }] }],
  calls: { calls: [{ id: "call-1", calledAtDate: "Aug 10, 2026", score: 4, status: "answered", duration: "2:30" }] },
});

writeJson("history/podium-google-reviews/podium-google-reviews_2026-08-12.json", {
  fetchedAt: "2026-08-12T12:00:00Z",
  locations: [{ reviews: [{ uid: "review-1", createdAt: "2026-08-10T15:00:00Z", rating: 5, needsResponse: true, body: "Must not leak" }] }],
});

writeJson("history/payment_reconciliation/payment_reconciliation_2026-08-10.json", {
  date: "2026-08-10",
  generated_at: "2026-08-10T23:00:00Z",
  sources: { merchant_center: { available: true, collector: "qbo-accounting-api" } },
  summary: { merchant_center_count: 2, merchant_center_total: 1200, matched_total: 1100 },
});

const dataset = buildPredictionDataset(root, new Date("2026-08-12T15:00:00Z"));
assert.equal(dataset.daily.length, 42);
assert.equal(dataset.truckDaily.length, 42);
assert.equal(dataset.sourceCoverage.wex.records, 2);
assert.equal(dataset.daily.find((row) => row.date === "2026-08-10")?.actuals.fuelCostSource, "wex");
assert.equal(dataset.daily.find((row) => row.date === "2026-08-10")?.searchKings.qualifiedCalls, 1);
assert.equal(dataset.daily.find((row) => row.date === "2026-08-10")?.podium.newReviews, 1);
assert.equal(dataset.daily.find((row) => row.date === "2026-08-10")?.qbo.postedPaymentTotal, 1200);
assert.equal(dataset.forecasts.find((forecast) => forecast.target === "revenue")?.points.length, 7);
assert.equal(dataset.guardrails.some((guardrail) => guardrail.includes("assumptions are excluded")), true);
assert.equal(JSON.stringify(dataset).includes("Must not leak"), false);

const output = path.join(root, "prediction", "daily-operating-features.json");
writePredictionDataset(root, output, new Date("2026-08-12T15:00:00Z"));
assert.equal(fs.statSync(output).mode & 0o777, 0o600);
assert.equal(JSON.parse(fs.readFileSync(output, "utf8")).schemaVersion, 1);

console.log("Prediction data spine tests passed.");
