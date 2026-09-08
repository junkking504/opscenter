import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { clearLoginFailures, loginAllowed, recordLoginFailure } from "../lib/login-rate-limit";
import { readFleetIssueStore, upsertFleetIssue } from "../lib/fleet-issues";
import { verifyTrustedDeviceCookie } from "../lib/auth";
import { collectSystemSignals, gpsCoverageSignal } from "../lib/system-signals";

const headers = new Headers({ "cf-connecting-ip": "192.0.2.123" });
const script = fileURLToPath(import.meta.url);

async function main() {
  if (process.argv.includes("--login-worker")) {
    process.send?.("ready");
    process.once("message", () => {
      for (let i = 0; i < 10; i++) recordLoginFailure("ops", headers, "test", 1000 + i);
      process.exit(0);
    });
    return;
  }
  const originalCwd = process.cwd();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ops-reliability-"));
  const oldFile = process.env.OPSCENTER_LOGIN_RATE_LIMIT_FILE;
  const oldData = process.env.OPSCENTER_DATA_DIR;
  const oldCache = process.env.OPSCENTER_SIGNAL_CACHE_MS;
  const target = path.join(root, "login", "attempts.json");
  process.env.OPSCENTER_LOGIN_RATE_LIMIT_FILE = target;
  try {
    const children = Array.from({ length: 8 }, () => spawn(process.execPath, ["--import", "tsx", script, "--login-worker"], {
      env: process.env, stdio: ["ignore", "ignore", "ignore", "ipc"],
    }));
    const completed = children.map(child => new Promise<void>((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", code => code === 0 ? resolve() : reject(new Error(`Worker exited ${code}`)));
    }));
    await Promise.all(children.map(child => new Promise<void>(resolve => child.once("message", () => resolve()))));
    children.forEach(child => child.send("go"));
    await Promise.all(completed);
    const attempts = JSON.parse(fs.readFileSync(target, "utf8"));
    assert.deepEqual(Object.values(attempts).map(value => (value as { failures: number }).failures), [80, 80]);
    assert.equal(loginAllowed("ops", headers, "different-user", 1010), false, "Address lock survives process exits and username rotation");
    assert.equal(loginAllowed("crew", headers, "test", 1010), true, "Scopes remain independent");
    assert.equal(loginAllowed("ops", headers, "test", 901010), true, "Lockout expires against caller clock");
    clearLoginFailures("ops", headers, "test", 1010);
    assert.equal(loginAllowed("ops", headers, "test", 1010), true);
    const lock = `${target}.lock`;
    fs.mkdirSync(lock);
    fs.writeFileSync(path.join(lock, `${children[0].pid}.00000000-0000-0000-0000-000000000000`), "");
    recordLoginFailure("ops", headers, "test", 2000);
    assert.equal(fs.existsSync(lock), false, "Dead process lock is recovered");
    assert.equal((fs.statSync(target).mode & 0o077), 0);
    fs.writeFileSync(target, "not json");
    assert.equal(loginAllowed("ops", headers, "test", 2001), false, "Unreadable state must not reset throttling");
    assert.throws(() => recordLoginFailure("ops", headers, "test", 2001));

    const request = new Request("http://127.0.0.1:3100", { headers: { "user-agent": "reliability-test" } });
    const legacyCookie = execFileSync(process.execPath, ["--import", "tsx", "-e",
      `const {createTrustedDeviceCookieValue}=require('./lib/auth.ts'); createTrustedDeviceCookieValue('test@junk-king.com', new Request('http://127.0.0.1:3100',{headers:{'user-agent':'reliability-test'}}),new Date(Date.now()-45*86400000)).then(value=>process.stdout.write(value));`,
    ], { encoding: "utf8", env: { ...process.env, OPS_TRUSTED_DEVICE_DAYS: "365" } });
    assert.equal(await verifyTrustedDeviceCookie(legacyCookie, request), null, "Old year-long cookies obey the new trust duration");

    process.chdir(root);
    const issue = { truck: "Truck 8", title: "Tire damage", description: "Front tire", severity: "out_of_service", submissionId: "report-1" };
    const first = upsertFleetIssue(issue)!;
    assert.equal(upsertFleetIssue(issue)?.issueId, first.issueId, "Identical submission retry returns original report");
    const updated = upsertFleetIssue({ issueId: first.issueId, owner: "Shop", severity: "repair_soon" })!;
    assert.deepEqual(upsertFleetIssue(issue), updated, "Retry cannot undo subsequent edits");
    assert.notEqual(upsertFleetIssue({ ...issue, submissionId: "report-2" })?.issueId, first.issueId, "Distinct identical reports remain separate");
    const different = upsertFleetIssue({ ...issue, submissionId: "report-3", severity: "monitor", owner: "Dispatcher" })!;
    assert.notEqual(different.issueId, first.issueId);
    assert.equal(readFleetIssueStore().issues.length, 3);
    const noToken = { ...issue, submissionId: "" };
    assert.notEqual(upsertFleetIssue(noToken)?.issueId, upsertFleetIssue(noToken)?.issueId, "Legacy clients are not guessed to be retries");

    const date = "2026-09-08";
    const createGpsRoot = (directory: string, truck: string) => {
      fs.mkdirSync(path.join(directory, "config"), { recursive: true });
      fs.mkdirSync(path.join(directory, "history", "linxup"), { recursive: true });
      fs.writeFileSync(path.join(directory, "config", "linxup_vehicle_map.json"), JSON.stringify({ mappings: [
        { status: "active", effective_start_date: "2026-01-01", junkware_truck_number: "Truck# 7", linxup_tracker_id: "synthetic" },
      ] }));
      const file = path.join(directory, "history", "linxup", `linxup_location_${date}.json`);
      fs.writeFileSync(file, JSON.stringify({ points: [{ truck_number: truck }] }));
      fs.utimesSync(file, new Date("2026-09-08T12:00:00Z"), new Date("2026-09-08T12:00:00Z"));
      return file;
    };
    const dataA = path.join(root, "source-a"), dataB = path.join(root, "source-b");
    createGpsRoot(dataA, "Truck# 7");
    const fileB = createGpsRoot(dataB, "Truck# 8");
    process.env.OPSCENTER_DATA_DIR = dataA;
    assert.equal(gpsCoverageSignal(date).reportingTrackers, 1);
    process.env.OPSCENTER_DATA_DIR = dataB;
    assert.equal(gpsCoverageSignal(date).reportingTrackers, 0, "Same date/mtime from another root cannot reuse GPS contents");
    fs.writeFileSync(fileB, JSON.stringify({ points: [{ truck_number: "Truck# 7" }] }));
    assert.equal(gpsCoverageSignal(date).reportingTrackers, 1, "File change invalidates GPS cache");
    delete process.env.OPSCENTER_SIGNAL_CACHE_MS;
    const signals = collectSystemSignals(date);
    assert.equal(collectSystemSignals(date), signals, "Default aggregate cache reuses computed signals");
    process.env.OPSCENTER_DATA_DIR = dataA;
    assert.notEqual(collectSystemSignals(date), signals, "Aggregate cache is scoped to data source");
    process.env.OPSCENTER_SIGNAL_CACHE_MS = "0";
    assert.notEqual(collectSystemSignals(date), collectSystemSignals(date), "Explicit zero disables aggregate cache");
    console.log("Reliability checks passed: concurrent durable lockouts, caller clock, dead-lock recovery, fail-closed reads, distinct Fleet submissions, and signal cache isolation.");
  } finally {
    process.chdir(originalCwd);
    if (oldFile === undefined) delete process.env.OPSCENTER_LOGIN_RATE_LIMIT_FILE; else process.env.OPSCENTER_LOGIN_RATE_LIMIT_FILE = oldFile;
    if (oldData === undefined) delete process.env.OPSCENTER_DATA_DIR; else process.env.OPSCENTER_DATA_DIR = oldData;
    if (oldCache === undefined) delete process.env.OPSCENTER_SIGNAL_CACHE_MS; else process.env.OPSCENTER_SIGNAL_CACHE_MS = oldCache;
    fs.rmSync(root, { recursive: true, force: true });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
