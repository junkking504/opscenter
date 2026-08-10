import crypto from "node:crypto";
import { Pool } from "pg";
import { resolveKernelDatabaseConfig } from "@/lib/platform/persistence/config";

type KernelPoolGlobal = typeof globalThis & {
  __opscenterKernelPool?: Pool;
  __opscenterKernelPoolIdentity?: string;
};

const kernelGlobal = globalThis as KernelPoolGlobal;

export function getKernelPool(): Pool {
  const config = resolveKernelDatabaseConfig();
  if (config.status !== "ready") {
    throw new Error(`Platform kernel database is ${config.status}: ${config.reason}`);
  }

  const identity = crypto
    .createHash("sha256")
    .update(`${config.runtime}|${config.connectionString}|${config.applicationName}`)
    .digest("hex");
  if (kernelGlobal.__opscenterKernelPool && kernelGlobal.__opscenterKernelPoolIdentity !== identity) {
    throw new Error("Platform kernel database configuration changed after the pool was created.");
  }

  if (!kernelGlobal.__opscenterKernelPool) {
    kernelGlobal.__opscenterKernelPool = new Pool({
      connectionString: config.connectionString,
      application_name: config.applicationName,
      max: config.maxConnections,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
      allowExitOnIdle: true,
    });
    kernelGlobal.__opscenterKernelPoolIdentity = identity;
  }

  return kernelGlobal.__opscenterKernelPool;
}
