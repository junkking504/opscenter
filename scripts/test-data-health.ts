import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "opscenter-data-health-test-"));
process.env.OPSBOT_DATA_DIR = temporaryRoot;

function chicagoDateKey(value = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);
  const fields = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${fields.year}-${fields.month}-${fields.day}`;
}

function writeSnapshot(date: string, metadata: Record<string, unknown>): string {
  const directory = path.join(temporaryRoot, "imports", "intuit_merchant_center", "junk_krewe");
  fs.mkdirSync(directory, { recursive: true });
  const file = path.join(directory, `transactions-${date}.json`);
  fs.writeFileSync(file, `${JSON.stringify(metadata, null, 2)}\n`);
  return file;
}

async function main() {
  try {
    const today = chicagoDateKey();
    const collectedAt = new Date().toISOString();
    const snapshotFile = writeSnapshot(today, {
      date: today,
      collected_at: collectedAt,
      account_name: "Test QBO Company",
      qbo_company_name: "Test QBO Company",
      transaction_count: 0,
      transaction_total: 0,
      collector: "qbo-accounting-api",
    });

    const { getDataHealthReport } = await import("../lib/data-health");
    let qbo = getDataHealthReport().sources.qbo;
    assert.equal(qbo.stateLabel, "Connected");
    assert.equal(qbo.missingToday, false);
    assert.equal(qbo.lastSuccessfulAt, collectedAt);
    assert.match(qbo.notes.join(" "), new RegExp(path.basename(snapshotFile)));

    writeSnapshot(today, {
      date: today,
      collected_at: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
      account_name: "Test QBO Company",
      qbo_company_name: "Test QBO Company",
      transaction_count: 0,
      transaction_total: 0,
      collector: "qbo-accounting-api",
    });
    qbo = getDataHealthReport().sources.qbo;
    assert.equal(qbo.stateLabel, "Stale");
    assert.equal(qbo.details, "Latest API snapshot is stale");

    writeSnapshot(today, {
      date: today,
      collected_at: new Date().toISOString(),
      account_name: "Wrong Company",
      qbo_company_name: "Test QBO Company",
      transaction_count: 0,
      transaction_total: 0,
      collector: "qbo-accounting-api",
    });
    qbo = getDataHealthReport().sources.qbo;
    assert.equal(qbo.stateLabel, "Not Connected");
    assert.equal(qbo.missingToday, true);

    process.stdout.write("Data health tests passed.\n");
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack || error.message : String(error)}\n`);
  process.exitCode = 1;
});
