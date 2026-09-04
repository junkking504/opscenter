import { isDesktopWriteOriginAllowed } from '@/lib/desktop-request-origin';
import { cookies } from "next/headers";
import { execFileSync } from "node:child_process";
import { NextResponse } from "next/server";
import { AUTH_SESSION_COOKIE, verifyAuthSessionCookie } from "@/lib/auth";
import { withJunkwareAppointmentSyncLock } from "@/lib/job-route-assignments";
import { junkwareJobCloseout, JunkwareCloseoutError } from "@/lib/junkware-job-closeout";
import { publishVerifiedTruckCloseout } from "@/lib/slack-alerts";
import { recordTruckLoadFromCloseout } from "@/lib/truck-load-status";

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
  const authSession = await authenticated();
  if (!authSession) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  if (!isDesktopWriteOriginAllowed(request)) return NextResponse.json({ ok: false, error: "Same-origin request required.", stage: "preflight" }, { status: 403 });
  const parsed = await request.json().catch(() => null);
  const body = parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : {};
  const id = appointmentId(request, body);
  if (!/^\d{1,12}$/.test(id)) return NextResponse.json({ error: "The appointment is unavailable." }, { status: 400 });
  try {
    const { appointmentId: _ignored, serviceDate: _serviceDate, ...payload } = body;
    const result = await withJunkwareAppointmentSyncLock(id, () => junkwareJobCloseout(id, payload));
    const closeout = result && typeof result === "object" && "closeout" in result && result.closeout && typeof result.closeout === "object"
      ? result.closeout as Record<string, unknown>
      : {};
    const loadSize = closeout.loadSize && typeof closeout.loadSize === "object"
      ? String((closeout.loadSize as Record<string, unknown>).label || "")
      : String(closeout.loadSize || "");
    let truckLoadStatus;
    try {
      truckLoadStatus = recordTruckLoadFromCloseout({
        date: String(_serviceDate || ""),
        truck: String(closeout.truck || ""),
        appointmentId: id,
        jobNumber: String(closeout.jobNumber || ""),
        loadSize,
        loadQuantity: closeout.loadQuantity,
        verifiedAt: String((result as Record<string, unknown>).verifiedAt || ""),
        recordedBy: authSession.email,
      });
    } catch (loadStatusError) {
      truckLoadStatus = {
        updated: false,
        status: null,
        reason: loadStatusError instanceof Error ? loadStatusError.message : "The truck load status could not be updated.",
      };
    }
    const slackNotification = await publishVerifiedCloseout(result as Record<string, unknown>, id);
    return NextResponse.json({ ...result, truckLoadStatus, slackNotification }, { headers: { "Cache-Control": "no-store, max-age=0" } });
  } catch (error) {
    const preflight = error instanceof JunkwareCloseoutError && error.stage === "preflight";
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "JunkWare could not save the closeout.", stage: preflight ? "preflight" : "uncertain", code: error instanceof JunkwareCloseoutError ? error.code : "closeout_unavailable" }, { status: preflight ? 409 : 502 });
  }
}
