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
  if (kinds.length !== 1 || !["truck_arrival", "collector_failure"].includes(kinds[0])) {
    throw new Error("--only supports truck_arrival or collector_failure.");
  }
  return [kinds[0] as SlackAlertKind];
}

function withPublishLock<T>(callback: () => Promise<T>): Promise<T | undefined> {
  const stateFile = String(process.env.SLACK_OPSCENTER_STATE_FILE || "").trim()
    || path.join(process.cwd(), "data", "slack", "ops_alert_state.json");
  const lockDirectory = path.join(path.dirname(stateFile), ".ops_alert_publish.lock");
  fs.mkdirSync(path.dirname(lockDirectory), { recursive: true });
  try {
    fs.mkdirSync(lockDirectory);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      console.log("Slack alert publish skipped because another publisher is active.");
      return Promise.resolve(undefined);
    }
    throw error;
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
