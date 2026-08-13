import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { AUTH_SESSION_COOKIE, verifyAuthSessionCookie } from "@/lib/auth";
import {
  LinxupCameraError,
  startLinxupCameraStream,
  stopLinxupCameraStream,
  type CameraOrientation,
} from "@/lib/linxup-live-camera";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type CameraRequest = {
  action?: "start" | "stop";
  truck?: number;
  channel?: CameraOrientation;
};

async function authenticated(): Promise<boolean> {
  const cookieStore = await cookies();
  return Boolean(await verifyAuthSessionCookie(cookieStore.get(AUTH_SESSION_COOKIE)?.value || ""));
}

function noStoreJson(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store, max-age=0" } });
}

export async function POST(request: Request) {
  if (!(await authenticated())) {
    return noStoreJson({ error: "Authentication required.", loginPath: "/login" }, 401);
  }

  let body: CameraRequest;
  try {
    body = await request.json() as CameraRequest;
  } catch {
    return noStoreJson({ error: "A valid camera request is required." }, 400);
  }

  const truck = Number(body.truck);
  if (!Number.isInteger(truck) || truck < 1 || truck > 99) {
    return noStoreJson({ error: "A valid truck number is required." }, 400);
  }

  try {
    if (body.action === "stop") {
      const channel = body.channel === "inside" || body.channel === "aux" ? body.channel : "outside";
      await stopLinxupCameraStream(truck, channel);
      return noStoreJson({ ok: true });
    }
    return noStoreJson(await startLinxupCameraStream(truck));
  } catch (error) {
    if (error instanceof LinxupCameraError) {
      const status = error.code === "CAMERA_NOT_FOUND" ? 404
        : error.code === "NOT_CONFIGURED" || error.code === "NOT_AUTHENTICATED" ? 503
          : 502;
      return noStoreJson({ error: error.message, code: error.code }, status);
    }
    return noStoreJson({ error: "LinxUp live video is temporarily unavailable.", code: "STREAM_UNAVAILABLE" }, 502);
  }
}
