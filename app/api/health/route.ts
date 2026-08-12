import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { getOpsRuntime } from "@/lib/runtime";
import { chicagoDateKey } from "@/lib/report-dates";
import { getKernelDatabaseHealth } from "@/lib/platform/persistence/health";

export const dynamic = "force-dynamic";

const OPERATOR_STATE_DIRECTORIES = [
  "manual_bonuses",
  "job-route-assignments",
  "job-route-geocodes",
  "searchkings-overrides",
  "fleet",
  "finance",
  "job-call-ahead",
  path.join("integrations", "junkware-sms"),
  path.join("integrations", "whatsapp-job-photos"),
  path.join("integrations", "whatsapp-crew-expenses"),
] as const;

function latestMetricsFile(directory: string, throughDate?: string): string | null {
  try {
    const files = fs.readdirSync(directory)
      .filter((name) => /^daily_metrics_\d{4}-\d{2}-\d{2}\.json$/.test(name))
      .filter((name) => !throughDate || name.slice("daily_metrics_".length, -".json".length) <= throughDate)
      .sort();
    return files.length ? path.join(directory, files[files.length - 1]) : null;
  } catch {
    return null;
  }
}

function writableStateTarget(directory: string): string {
  let target = directory;
  while (!fs.existsSync(target) && path.dirname(target) !== target) {
    target = path.dirname(target);
  }
  return target;
}

export async function GET(request: Request) {
  const runtime = getOpsRuntime();
  const platformKernel = await getKernelDatabaseHealth();
  const metricsDirectory = path.join(process.cwd(), "data", "history", "daily_metrics");
  const expectedMetricsDate = chicagoDateKey();
  const requestedDate = new URL(request.url).searchParams.get("date") || "";
  const targetDate = /^\d{4}-\d{2}-\d{2}$/.test(requestedDate) ? requestedDate : expectedMetricsDate;
  const targetFile = path.join(metricsDirectory, `daily_metrics_${targetDate}.json`);
  const metricsFile = fs.existsSync(targetFile) ? targetFile : null;
  const latestFile = latestMetricsFile(metricsDirectory, expectedMetricsDate);
  const latestMetricsDate = latestFile
    ? path.basename(latestFile).slice("daily_metrics_".length, -".json".length)
    : null;
  const maxAgeSeconds = Math.max(60, Number(process.env.OPSCENTER_HEALTH_MAX_AGE_SECONDS || 1200));
  const assignmentStore = String(process.env.JOB_ROUTE_ASSIGNMENTS_FILE || "").trim()
    || path.join(process.cwd(), "data", "job-route-assignments", "assignments.json");
  const assignmentDirectory = path.dirname(assignmentStore);
  let assignmentStoreWritable = false;
  try {
    const writableTarget = fs.existsSync(assignmentDirectory)
      ? assignmentDirectory
      : path.dirname(assignmentDirectory);
    fs.accessSync(writableTarget, fs.constants.W_OK);
    assignmentStoreWritable = true;
  } catch {
    assignmentStoreWritable = false;
  }

  const operatorStateUnwritable = OPERATOR_STATE_DIRECTORIES.filter((relativeDirectory) => {
    const directory = path.join(process.cwd(), "data", relativeDirectory);
    try {
      fs.accessSync(writableStateTarget(directory), fs.constants.W_OK);
      return false;
    } catch {
      return true;
    }
  });
  const operatorStateWritable = operatorStateUnwritable.length === 0;

  const assignmentHealth = {
    assignmentPersistence: "durable-local-first-v2",
    assignmentStoreWritable,
    operatorStateWritable,
    operatorStateUnwritable,
    platformKernel,
  };

  if (!metricsFile) {
    return NextResponse.json(
      { ok: false, status: "missing-data", runtime, metricsDate: targetDate, latestMetricsDate, ...assignmentHealth },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }

  try {
    const stats = fs.statSync(metricsFile);
    const ageSeconds = Math.max(0, Math.floor((Date.now() - stats.mtimeMs) / 1000));
    const metricsDate = path.basename(metricsFile).slice("daily_metrics_".length, -".json".length);
    const monitorsCurrentDate = metricsDate === expectedMetricsDate;
    const stale = monitorsCurrentDate && ageSeconds > maxAgeSeconds;
    const healthy = !stale && assignmentStoreWritable && operatorStateWritable && platformKernel.healthy;
    return NextResponse.json(
      {
        ok: healthy,
        status: stale
          ? "stale-data"
          : !assignmentStoreWritable
            ? "assignment-storage-unwritable"
            : !operatorStateWritable
              ? "operator-storage-unwritable"
              : !platformKernel.healthy
                ? "platform-kernel-unhealthy"
                : monitorsCurrentDate ? "healthy" : "available",
        runtime,
        metricsDate,
        latestMetricsDate,
        expectedMetricsDate,
        updatedAt: stats.mtime.toISOString(),
        ageSeconds,
        ...assignmentHealth,
      },
      { status: healthy ? 200 : 503, headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return NextResponse.json(
      { ok: false, status: "unreadable-data", runtime, metricsDate: targetDate, latestMetricsDate, ...assignmentHealth },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
