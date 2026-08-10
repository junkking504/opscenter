import { execFileSync } from "node:child_process";
import { runSlackOpsAlerts } from "@/lib/slack-alerts";

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

async function main() {
  loadSlackBotTokenFromKeychain();
  const dryRun = process.argv.includes("--dry-run");
  const result = await runSlackOpsAlerts({
    date: argumentValue("--date"),
    dryRun,
  });

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
