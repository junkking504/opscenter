import { cookies } from "next/headers";
import { execFileSync } from "node:child_process";
import { NextResponse } from "next/server";
import { AUTH_SESSION_COOKIE, verifyAuthSessionCookie } from "@/lib/auth";
import { withJunkwareAppointmentSyncLock } from "@/lib/job-route-assignments";
import { junkwareJobCloseout } from "@/lib/junkware-job-closeout";
import { publishVerifiedTruckCloseout } from "@/lib/slack-alerts";

async function authenticated() {
  const cookieStore = await cookies();
  return verifyAuthSessionCookie(cookieStore.get(AUTH_SESSION_COOKIE)?.value || "");
}
function appointmentId(request: Request, body?: Record<string, unknown>) {
  return String(body?.appointmentId || new URL(request.url).searchParams.get("appointmentId") || "").trim();
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
    // The regular collector will retry a closeout alert when the credential is unavailable.
  }
}

async function publishVerifiedCloseout(result: Record<string, unknown>, id: string) {
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

export async function GET(request: Request) {
  if (!(await authenticated())) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  const id = appointmentId(request);
  if (!/^\d{1,12}$/.test(id)) return NextResponse.json({ error: "The appointment is unavailable." }, { status: 400 });
  try {
    const result = await withJunkwareAppointmentSyncLock(id, () => junkwareJobCloseout(id));
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store, max-age=0" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "JunkWare could not load the closeout." }, { status: 502 });
  }
}

export async function POST(request: Request) {
  if (!(await authenticated())) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  const parsed = await request.json().catch(() => null);
  const body = parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : {};
  const id = appointmentId(request, body);
  if (!/^\d{1,12}$/.test(id)) return NextResponse.json({ error: "The appointment is unavailable." }, { status: 400 });
  try {
    const { appointmentId: _ignored, ...payload } = body;
    const result = await withJunkwareAppointmentSyncLock(id, () => junkwareJobCloseout(id, payload));
    const slackNotification = await publishVerifiedCloseout(result as Record<string, unknown>, id);
    return NextResponse.json({ ...result, slackNotification }, { headers: { "Cache-Control": "no-store, max-age=0" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "JunkWare could not save the closeout." }, { status: 502 });
  }
}
