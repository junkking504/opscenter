import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { publishScheduleChanges } from "@/lib/junkware-schedule-changes";

function argument(name: string): string {
  const index = process.argv.indexOf(name);
  return index >= 0 ? String(process.argv[index + 1] || "").trim() : "";
}

function loadToken(): string {
  const configured = String(process.env.SLACK_BOT_TOKEN || "").trim();
  if (configured) return configured;
  try {
    return execFileSync(
      "/usr/bin/security",
      ["find-generic-password", "-a", "opscenter", "-s", "com.opscenter.slack-bot-token", "-w"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    ).trim();
  } catch {
    return "";
  }
}

async function main() {
  const dataDir = argument("--data-dir") || String(process.env.OPSCENTER_DATA_DIR || "").trim();
  const date = argument("--date");
  if (!dataDir || !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("--data-dir and --date are required.");
  if (!/^(1|true|yes|on)$/i.test(String(process.env.SLACK_OPSCENTER_ALERTS_ENABLED || ""))) return;
  const token = loadToken();
  if (!token.startsWith("xoxb-")) throw new Error("Slack bot token is unavailable.");
  const file = path.join(dataDir, "history", "junkware", `junkware_schedule_fast_${date}.json`);
  const snapshot = JSON.parse(fs.readFileSync(file, "utf8"));
  const result = await publishScheduleChanges(dataDir, snapshot, token);
  console.log(`JunkWare schedule detector: ${result.baselined ? "baselined" : "checked"}; ${result.posted.length} posted, ${result.failed.length} failed.`);
  if (result.failed.length) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
