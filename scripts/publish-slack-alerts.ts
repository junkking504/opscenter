import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { runSlackOpsAlerts, type SlackAlertKind } from "@/lib/slack-alerts";

function argumentValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function loadSlackBotTokenFromKeychain(): void {
  if (String(process.env.SLACK_BOT_TOKEN || "").trim() || process.platform !== "darwin") return;
  try {
    const token = execFileSync(
      "/usr/bin/security",
      ["find-generic-password", "-a", "opscenter", "-s", "com.opscenter.slack-bot-token", "-w"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    ).trim();
    if (token.startsWith("xoxb-")) process.env.SLACK_BOT_TOKEN = token;
  } catch {
    // The alert runner will report the missing credential when alerts are enabled.
  }
}

function selectedKinds(): SlackAlertKind[] | undefined {
  const value = argumentValue("--only");
  if (!value) return undefined;
  const kinds = value.split(",").map((kind) => kind.trim()).filter(Boolean);
  if (!kinds.length || !kinds.every((kind) => ["truck_arrival", "truck_departure", "job_closed", "estimate_closed"].includes(kind))) {
    throw new Error("--only supports truck_arrival, truck_departure, job_closed, or estimate_closed.");
  }
  return kinds as SlackAlertKind[];
}

// A plain mkdir lock with no owner and no expiry is a silent single point of
// failure: if the publisher is killed mid-run - SIGKILL, a disk-full write, a
// deploy restart - the directory outlives the process and every later run exits
// 0 having posted nothing. Record the owner and reclaim demonstrably dead locks.
const PUBLISH_LOCK_STALE_MS = Number(process.env.SLACK_PUBLISH_LOCK_STALE_MS) || 10 * 60 * 1000;

type PublishLockOwner = { pid: number; startedAt: string };

function readLockOwner(ownerFile: string): PublishLockOwner | null {
  try {
    const payload = JSON.parse(fs.readFileSync(ownerFile, "utf8")) as Partial<PublishLockOwner>;
    const pid = Number(payload.pid);
    if (!Number.isInteger(pid) || pid <= 0) return null;
    return { pid, startedAt: String(payload.startedAt || "") };
  } catch {
    return null;
  }
}

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

function lockIsStale(lockDirectory: string, ownerFile: string): boolean {
  const owner = readLockOwner(ownerFile);
  if (owner) {
    if (processAlive(owner.pid)) return false;
    console.warn(`Reclaiming Slack alert publish lock held by dead process ${owner.pid}.`);
    return true;
  }
  // No readable owner: fall back to age so a lock from an older build cannot
  // wedge publishing forever.
  try {
    const age = Date.now() - fs.statSync(lockDirectory).mtimeMs;
    if (age > PUBLISH_LOCK_STALE_MS) {
      console.warn(`Reclaiming Slack alert publish lock with no owner after ${Math.round(age / 1000)}s.`);
      return true;
    }
  } catch {
    return false;
  }
  return false;
}

function withPublishLock<T>(callback: () => Promise<T>): Promise<T | undefined> {
  const stateFile = String(process.env.SLACK_OPSCENTER_STATE_FILE || "").trim()
    || path.join(process.cwd(), "data", "slack", "ops_alert_state.json");
  const lockDirectory = path.join(path.dirname(stateFile), ".ops_alert_publish.lock");
  const ownerFile = path.join(lockDirectory, "owner.json");
  fs.mkdirSync(path.dirname(lockDirectory), { recursive: true });

  const acquire = (): boolean => {
    try {
      fs.mkdirSync(lockDirectory);
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      return false;
    }
  };

  let acquired = acquire();
  if (!acquired && lockIsStale(lockDirectory, ownerFile)) {
    fs.rmSync(lockDirectory, { recursive: true, force: true });
    acquired = acquire();
  }
  if (!acquired) {
    console.log("Slack alert publish skipped because another publisher is active.");
    return Promise.resolve(undefined);
  }

  try {
    fs.writeFileSync(
      ownerFile,
      JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }),
      { encoding: "utf8", mode: 0o600 },
    );
  } catch (error) {
    console.warn("Could not record Slack alert publish lock owner.", error instanceof Error ? error.message : error);
  }

  return callback().finally(() => {
    fs.rmSync(lockDirectory, { recursive: true, force: true });
  });
}

async function main() {
  loadSlackBotTokenFromKeychain();
  const dryRun = process.argv.includes("--dry-run");
  const result = await withPublishLock(() => runSlackOpsAlerts({
    date: argumentValue("--date"),
    dryRun,
    onlyKinds: selectedKinds(),
  }));
  if (!result) return;

  if (dryRun) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (!result.enabled) {
    console.log("Slack OpsCenter alerts are disabled; set SLACK_OPSCENTER_ALERTS_ENABLED=true to enable them.");
    return;
  }

  console.log(
    `Slack alerts: ${result.posted.length} posted, ${result.resolved.length} resolved, ${result.unchanged} unchanged, ${result.failures.length} failed.`,
  );
  if (result.failures.length) {
    for (const failure of result.failures) console.error(`${failure.fingerprint}: ${failure.error}`);
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
