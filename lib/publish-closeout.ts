import { execFileSync } from "node:child_process";
import { publishVerifiedTruckCloseout } from "./slack-alerts";

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
    // The regular collector will retry a closeout alert when the credential is unavailable.
  }
}

export async function publishVerifiedCloseout(result: Record<string, unknown>, id: string) {
  const closeout = result.closeout && typeof result.closeout === "object"
    ? result.closeout as Record<string, unknown>
    : null;
  if (!closeout) return null;
  loadSlackBotTokenFromKeychain();
  try {
    return await publishVerifiedTruckCloseout({
      appointmentId: id,
      jobNumber: String(closeout.jobNumber || ""),
      truck: String(closeout.truck || ""),
      closeout,
    });
  } catch {
    // Slack delivery is never allowed to turn a verified JunkWare closeout into a failed save.
    return null;
  }
}
