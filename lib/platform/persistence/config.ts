import type { OpsRuntime } from "@/lib/runtime";
import { getOpsRuntime } from "@/lib/runtime";

type KernelDatabaseDisabled = {
  status: "disabled";
  enabled: false;
  runtime: OpsRuntime;
  reason: string;
};

type KernelDatabaseMisconfigured = {
  status: "misconfigured";
  enabled: true;
  runtime: OpsRuntime;
  reason: string;
  environmentVariable: string;
};

export type KernelDatabaseReady = {
  status: "ready";
  enabled: true;
  runtime: OpsRuntime;
  environmentVariable: string;
  connectionString: string;
  databaseName: string;
  applicationName: string;
  maxConnections: number;
};

export type KernelDatabaseConfig =
  | KernelDatabaseDisabled
  | KernelDatabaseMisconfigured
  | KernelDatabaseReady;

const DATABASE_URL_VARIABLE: Record<OpsRuntime, string> = {
  MAC_MINI_PREVIEW: "OPSCENTER_PREVIEW_DATABASE_URL",
  MISSION_CONTROL: "OPSCENTER_MISSION_CONTROL_DATABASE_URL",
  LIVE: "OPSCENTER_LIVE_DATABASE_URL",
  VPS: "OPSCENTER_VPS_DATABASE_URL",
};

function boundedInteger(value: string | undefined, fallback: number, minimum: number, maximum: number): number {
  const parsed = Number.parseInt(String(value || ""), 10);
  return Number.isInteger(parsed) ? Math.min(maximum, Math.max(minimum, parsed)) : fallback;
}

export function resolveKernelDatabaseConfig(
  environment: Readonly<Record<string, string | undefined>> = process.env,
  runtime: OpsRuntime = getOpsRuntime(),
): KernelDatabaseConfig {
  if (String(environment.OPSCENTER_KERNEL_ENABLED || "").trim() !== "1") {
    return {
      status: "disabled",
      enabled: false,
      runtime,
      reason: "OPSCENTER_KERNEL_ENABLED is not set to 1.",
    };
  }

  const environmentVariable = DATABASE_URL_VARIABLE[runtime];
  const connectionString = String(environment[environmentVariable] || "").trim();
  if (!connectionString) {
    return {
      status: "misconfigured",
      enabled: true,
      runtime,
      environmentVariable,
      reason: `${environmentVariable} is required when the platform kernel is enabled.`,
    };
  }

  let parsed: URL;
  try {
    parsed = new URL(connectionString);
  } catch {
    return {
      status: "misconfigured",
      enabled: true,
      runtime,
      environmentVariable,
      reason: `${environmentVariable} is not a valid URL.`,
    };
  }

  if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") {
    return {
      status: "misconfigured",
      enabled: true,
      runtime,
      environmentVariable,
      reason: `${environmentVariable} must use the postgres or postgresql protocol.`,
    };
  }

  const databaseName = decodeURIComponent(parsed.pathname.replace(/^\//, "")).trim();
  if (!databaseName) {
    return {
      status: "misconfigured",
      enabled: true,
      runtime,
      environmentVariable,
      reason: `${environmentVariable} must name a database.`,
    };
  }

  if (runtime === "MAC_MINI_PREVIEW" && !databaseName.toLowerCase().includes("preview")) {
    return {
      status: "misconfigured",
      enabled: true,
      runtime,
      environmentVariable,
      reason: "The preview database name must contain preview.",
    };
  }

  return {
    status: "ready",
    enabled: true,
    runtime,
    environmentVariable,
    connectionString,
    databaseName,
    applicationName: `opscenter-kernel-${runtime.toLowerCase().replaceAll("_", "-")}`,
    maxConnections: boundedInteger(environment.OPSCENTER_KERNEL_DB_POOL_MAX, 5, 1, 20),
  };
}
