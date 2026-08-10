import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { getKernelPool } from "../lib/platform/persistence/pool";
import { resolveKernelDatabaseConfig } from "../lib/platform/persistence/config";

const MIGRATION_DIRECTORY = path.join(
  process.cwd(),
  "lib",
  "platform",
  "persistence",
  "migrations",
);
const ADVISORY_LOCK_ID = 6_729_053_011;

function checksum(contents: string): string {
  return crypto.createHash("sha256").update(contents).digest("hex");
}

async function main(): Promise<void> {
  const config = resolveKernelDatabaseConfig();
  if (config.status !== "ready") {
    throw new Error(`Platform kernel database is ${config.status}: ${config.reason}`);
  }

  const migrationFiles = fs.readdirSync(MIGRATION_DIRECTORY)
    .filter((name) => /^\d{4}_[a-z0-9_]+\.sql$/.test(name))
    .sort();
  if (!migrationFiles.length) throw new Error("No platform kernel migrations were found.");

  const pool = getKernelPool();
  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock($1)", [ADVISORY_LOCK_ID]);
    await client.query("CREATE SCHEMA IF NOT EXISTS opscenter_kernel");
    await client.query(`
      CREATE TABLE IF NOT EXISTS opscenter_kernel.schema_migrations (
        version text PRIMARY KEY,
        checksum text NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    const appliedResult = await client.query<{ version: string; checksum: string }>(
      "SELECT version, checksum FROM opscenter_kernel.schema_migrations ORDER BY version",
    );
    const applied = new Map(appliedResult.rows.map((row) => [row.version, row.checksum]));

    for (const fileName of migrationFiles) {
      const contents = fs.readFileSync(path.join(MIGRATION_DIRECTORY, fileName), "utf8");
      const fileChecksum = checksum(contents);
      const appliedChecksum = applied.get(fileName);
      if (appliedChecksum) {
        if (appliedChecksum !== fileChecksum) {
          throw new Error(`Applied migration ${fileName} has changed.`);
        }
        console.log(`[platform-kernel] migration already applied: ${fileName}`);
        continue;
      }

      await client.query("BEGIN");
      try {
        await client.query(contents);
        await client.query(
          "INSERT INTO opscenter_kernel.schema_migrations (version, checksum) VALUES ($1, $2)",
          [fileName, fileChecksum],
        );
        await client.query("COMMIT");
        console.log(`[platform-kernel] migration applied: ${fileName}`);
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    }
  } finally {
    try {
      await client.query("SELECT pg_advisory_unlock($1)", [ADVISORY_LOCK_ID]);
    } finally {
      client.release();
      await pool.end();
    }
  }

  console.log(`[platform-kernel] migrations complete for ${config.runtime}/${config.databaseName}`);
}

main().catch((error) => {
  console.error(`[platform-kernel] migration failed: ${error instanceof Error ? error.message : "Unknown error"}`);
  process.exitCode = 1;
});
