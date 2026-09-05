import fs from "fs";
import os from "os";
import path from "path";
import { publishCrewValue, runCrewWrangler, writeCrewSyncStatus } from "@/lib/crew-portal-sync";
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

async function putValue(key: string, value: unknown, tempDirectory: string) {
  const payloadPath = path.join(tempDirectory, `${key.replace(/[^a-z0-9-]/gi, "-")}.json`);
  fs.writeFileSync(payloadPath, JSON.stringify(value), {mode:0o600});
  await publishCrewValue(key,payloadPath,value,runCrewWrangler);
}
function writeSyncStatus(payload: Record<string, unknown>) { writeCrewSyncStatus(syncStatusFile,payload); }

function safeErrorMessage(error: unknown): string {
  return (error instanceof Error ? error.message : String(error || "Crew Portal synchronization failed."))
    .replace(/https?:\/\/\S+/gi, "[url]")
    .slice(0, 500);
}

async function main(): Promise<string[]> {
  const dates = metricDates();
  const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "opscenter-crew-portal-"));
  try {
    const monthKeys = [...new Set(dates.map((date) => date.slice(0, 7)))];
    const keys = monthKeys.map((month) => `${DATA_KEY}:${month}`);
    const monthsToUpload = process.argv.includes("--all") ? monthKeys : monthKeys.slice(-1);
    for (const month of monthsToUpload) {
      const index = monthKeys.indexOf(month);
      const monthDates = dates.filter((date) => date.startsWith(month));
      await putValue(keys[index], {
        dates: Object.fromEntries(monthDates.map((date) => [date, crewMetricsForDate(date)])),
      }, tempDirectory);
    }
    await putValue(`${DATA_KEY}:index`, { generatedAt: new Date().toISOString(), keys }, tempDirectory);
    return monthsToUpload;
  } finally {
    fs.rmSync(tempDirectory, { recursive: true, force: true });
  }
}

async function synchronize() {
try {
  const months = await main();
  const completedAt = new Date().toISOString();
  writeSyncStatus({ status: "synchronized", lastAttemptAt: completedAt, lastSuccessAt: completedAt, months });
  console.log(`Synced ${months.join(", ")} crew metrics to the Crew Portal.`);
} catch (error) {
  const attemptedAt = new Date().toISOString();
  writeSyncStatus({ status: "failed", lastAttemptAt: attemptedAt, error: safeErrorMessage(error) });
  console.error(safeErrorMessage(error));
  process.exitCode = 1;
}
}
void synchronize();
