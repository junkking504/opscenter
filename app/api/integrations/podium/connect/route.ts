import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { buildPodiumConnectUrl, getPodiumConfig, PODIUM_STATE_COOKIE } from "@/lib/podium-config";

export const dynamic = "force-dynamic";

export function GET() {
  const config = getPodiumConfig();
  if (!config.ready) {
    return NextResponse.json(
      { ok: false, message: "Podium connection is not configured.", missingConfig: config.missing, redirectUri: config.redirectUri },
      { status: 503, headers: { "Cache-Control": "no-store, max-age=0" } },
    );
  }
  const state = crypto.randomUUID();
  const response = NextResponse.redirect(buildPodiumConnectUrl(config, state));
  response.cookies.set(PODIUM_STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: "lax",
    secure: true,
    path: "/api/integrations/podium",
    maxAge: 10 * 60,
  });
  response.headers.set("Cache-Control", "no-store, max-age=0");
  return response;
}
