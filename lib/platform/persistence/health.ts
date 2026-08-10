import { getKernelPool } from "@/lib/platform/persistence/pool";
import { resolveKernelDatabaseConfig } from "@/lib/platform/persistence/config";

export type KernelDatabaseHealth = {
  enabled: boolean;
  healthy: boolean;
  status: "disabled" | "misconfigured" | "unavailable" | "migration-required" | "healthy";
  runtime: string;
  databaseName?: string;
  migrationVersion?: string;
  reason?: string;
};

function sanitizedConnectionError(error: unknown, connectionString: string): string {
  let message = error instanceof Error ? error.message : "Database connection failed.";
  message = message.replaceAll(connectionString, "[REDACTED_DATABASE_URL]");
  try {
    const parsed = new URL(connectionString);
    for (const secret of [parsed.password, decodeURIComponent(parsed.password)]) {
      if (secret) message = message.replaceAll(secret, "[REDACTED]");
    }
  } catch {
    // Configuration validation already ensures ready connection strings are URLs.
  }
  return message.slice(0, 300);
}

export async function getKernelDatabaseHealth(): Promise<KernelDatabaseHealth> {
  const config = resolveKernelDatabaseConfig();
  if (config.status === "disabled") {
    return {
      enabled: false,
      healthy: true,
      status: "disabled",
      runtime: config.runtime,
      reason: config.reason,
    };
  }
  if (config.status === "misconfigured") {
    return {
      enabled: true,
      healthy: false,
      status: "misconfigured",
      runtime: config.runtime,
      reason: config.reason,
    };
  }

  try {
    const pool = getKernelPool();
    const tableResult = await pool.query<{ migration_table: string | null }>(
      "SELECT to_regclass('opscenter_kernel.schema_migrations')::text AS migration_table",
    );
    if (!tableResult.rows[0]?.migration_table) {
      return {
        enabled: true,
        healthy: false,
        status: "migration-required",
        runtime: config.runtime,
        databaseName: config.databaseName,
        reason: "The platform kernel schema has not been migrated.",
      };
    }
    const migrationResult = await pool.query<{ migration_version: string | null }>(
      "SELECT MAX(version) AS migration_version FROM opscenter_kernel.schema_migrations",
    );
    return {
      enabled: true,
      healthy: true,
      status: "healthy",
      runtime: config.runtime,
      databaseName: config.databaseName,
      migrationVersion: migrationResult.rows[0]?.migration_version || undefined,
    };
  } catch (error) {
    return {
      enabled: true,
      healthy: false,
      status: "unavailable",
      runtime: config.runtime,
      databaseName: config.databaseName,
      reason: sanitizedConnectionError(error, config.connectionString),
    };
  }
}
