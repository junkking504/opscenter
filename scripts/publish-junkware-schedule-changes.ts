import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { junkwareJobCloseout } from "@/lib/junkware-job-closeout";
import { publishScheduleChanges } from "@/lib/junkware-schedule-changes";
import { publishVerifiedTruckCloseout } from "@/lib/slack-alerts";
import type { AnyRecord } from "@/lib/opsData";

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

function text(row: AnyRecord, keys: string[]): string {
  for (const key of keys) {
    const value = String(row[key] ?? "").trim();
    if (value) return value;
  }
  return "";
}

function fullCloseout(value: unknown): AnyRecord | null {
  if (!value || typeof value !== "object") return null;
  const closeout = value as AnyRecord;
  const status = closeout.status && typeof closeout.status === "object" ? closeout.status as AnyRecord : {};
  if (text(status, ["value"]) !== "8") return null;
  const payments = Array.isArray(closeout.payments) ? closeout.payments : [];
  if (!payments.length) return null;
  return {
    ...closeout,
    payments: payments.map((payment) => {
      const row = payment && typeof payment === "object" ? payment as AnyRecord : {};
      return { ...row, method: text(row, ["method", "description"]) };
    }),
  };
}

async function main() {
  const dataDir = argument("--data-dir") || String(process.env.OPSCENTER_DATA_DIR || "").trim();
  const date = argument("--date");
  const snapshotFile = argument("--snapshot-file");
  const scope = argument("--scope") || "legacy";
  if (!dataDir || !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("--data-dir and --date are required.");
  if (!/^(1|true|yes|on)$/i.test(String(process.env.SLACK_OPSCENTER_ALERTS_ENABLED || ""))) return;
  const token = loadToken();
  if (!token.startsWith("xoxb-")) throw new Error("Slack bot token is unavailable.");
  const file = snapshotFile || path.join(dataDir, "history", "junkware", `junkware_schedule_fast_${date}.json`);
  const rawSnapshot = JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>;
  const snapshot = {
    date: String(rawSnapshot.date || date),
    scrapedAt: String(rawSnapshot.scraped_at || rawSnapshot.scrapedAt || ""),
    appointments: Array.isArray(rawSnapshot.appointments) ? rawSnapshot.appointments : [],
    cancelled: Array.isArray(rawSnapshot.cancelled) ? rawSnapshot.cancelled : [],
  };
  const result = await publishScheduleChanges(dataDir, snapshot, token, {
    scope,
    resolveCloseout: async ({ date: closeoutDate, row }) => {
      const appointmentId = text(row, ["appt_id", "appointment_id", "appointmentId"]);
      if (!appointmentId) return false;
      const verified = await junkwareJobCloseout(appointmentId);
      const closeout = fullCloseout(verified?.closeout);
      if (!closeout) return false;
      const published = await publishVerifiedTruckCloseout({
        date: closeoutDate,
        appointmentId,
        jobNumber: text(closeout, ["jobNumber"]) || text(row, ["job_id", "jk_number", "job_number"]),
        truck: text(closeout, ["truck"]) || text(row, ["truck", "assigned_truck", "truck_number"]),
        closeout,
      });
      return published.posted || published.duplicate;
    },
  });
  console.log(`JunkWare schedule detector [${scope}]: ${result.baselined ? "baselined" : "checked"}; ${result.posted.length} schedule changes, ${result.closeoutsResolved} full closeouts, ${result.failed.length + result.closeoutFailures.length} failed.`);
  if (result.failed.length || result.closeoutFailures.length) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
