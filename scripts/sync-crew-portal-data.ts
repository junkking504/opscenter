import fs from "fs";
import os from "os";
import path from "path";
import { spawnSync } from "child_process";
import { applyManualBonusesToMetrics } from "@/lib/manual-bonuses";

const DATA_KEY = "crew-portal-data-v1";
const metricsDirectory = path.join(process.cwd(), "data", "history", "daily_metrics");
const syncStatusFile = path.join(process.cwd(), "data", "integrations", "crew-portal-sync", "status.json");

type AnyRecord = Record<string, any>;

function metricDates(): string[] {
  return fs.readdirSync(metricsDirectory)
    .map((filename) => filename.match(/^daily_metrics_(\d{4}-\d{2}-\d{2})\.json$/)?.[1] || "")
    .filter(Boolean)
    .sort();
}

function crewMetricsForDate(date: string): AnyRecord {
  const filename = path.join(metricsDirectory, `daily_metrics_${date}.json`);
  const parsed = JSON.parse(fs.readFileSync(filename, "utf8")) as AnyRecord;
  const source = applyManualBonusesToMetrics(parsed, date) || parsed;
  return {
    date,
    generated_at: source.generated_at || null,
    payroll_as_of: source.payroll_as_of || null,
    total_revenue: source.total_revenue || 0,
    net_revenue: source.net_revenue || 0,
    jobs_by_market: source.jobs_by_market || {},
    jobs_by_truck: source.jobs_by_truck || {},
    credited_revenue_by_employee: source.credited_revenue_by_employee || {},
    crew_credit_audit: Array.isArray(source.crew_credit_audit) ? source.crew_credit_audit : [],
    employee_leaderboard: Array.isArray(source.employee_leaderboard) ? source.employee_leaderboard : [],
    payroll_records: Array.isArray(source.payroll_records) ? source.payroll_records : [],
  };
}

function putValue(key: string, value: unknown, tempDirectory: string) {
  const payloadPath = path.join(tempDirectory, `${key.replace(/[^a-z0-9-]/gi, "-")}.json`);
  fs.writeFileSync(payloadPath, JSON.stringify(value));
  const result = spawnSync(
    path.join(process.cwd(), "node_modules", ".bin", "wrangler"),
    ["kv", "key", "put", key, "--path", payloadPath, "--binding", "CREW_METRICS", "--remote"],
    { cwd: process.cwd(), encoding: "utf8" },
  );
  const output = `${result.stdout || ""}${result.stderr || ""}`;
  process.stdout.write(output);
  if (result.status !== 0 || /\bERROR\b|fetch failed/i.test(output)) {
    throw new Error(`Cloudflare KV upload failed for ${key}.`);
  }
}

function writeSyncStatus(payload: Record<string, unknown>) {
  fs.mkdirSync(path.dirname(syncStatusFile), { recursive: true, mode: 0o700 });
  const temporary = `${syncStatusFile}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(temporary, `${JSON.stringify({ version: 1, ...payload }, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporary, syncStatusFile);
}

function safeErrorMessage(error: unknown): string {
  return (error instanceof Error ? error.message : String(error || "Crew Portal synchronization failed."))
    .replace(/https?:\/\/\S+/gi, "[url]")
    .slice(0, 500);
}

function main(): string[] {
  const dates = metricDates();
  const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "opscenter-crew-portal-"));
  try {
    const monthKeys = [...new Set(dates.map((date) => date.slice(0, 7)))];
    const keys = monthKeys.map((month) => `${DATA_KEY}:${month}`);
    const monthsToUpload = process.argv.includes("--all") ? monthKeys : monthKeys.slice(-1);
    for (const month of monthsToUpload) {
      const index = monthKeys.indexOf(month);
      const monthDates = dates.filter((date) => date.startsWith(month));
      putValue(keys[index], {
        dates: Object.fromEntries(monthDates.map((date) => [date, crewMetricsForDate(date)])),
      }, tempDirectory);
    }
    putValue(`${DATA_KEY}:index`, { generatedAt: new Date().toISOString(), keys }, tempDirectory);
    return monthsToUpload;
  } finally {
    fs.rmSync(tempDirectory, { recursive: true, force: true });
  }
}

try {
  const months = main();
  const completedAt = new Date().toISOString();
  writeSyncStatus({ status: "synchronized", lastAttemptAt: completedAt, lastSuccessAt: completedAt, months });
  console.log(`Synced ${months.join(", ")} crew metrics to the Crew Portal.`);
} catch (error) {
  const attemptedAt = new Date().toISOString();
  writeSyncStatus({ status: "failed", lastAttemptAt: attemptedAt, error: safeErrorMessage(error) });
  throw error;
}
