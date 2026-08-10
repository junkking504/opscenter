import crypto from "crypto";
import { NextResponse } from "next/server";
import { buildIntuitConnectUrl, getQboConfig, QBO_ROUTE_PATHS, QBO_STATE_COOKIE } from "@/lib/qbo-config";

export const dynamic = "force-dynamic";

export function GET() {
  const config = getQboConfig();

  if (!config.ready) {
    return NextResponse.json(
      {
        ok: false,
        phase: "setup",
        message: "QBO connection is not yet configured.",
        missingConfig: config.missing,
        redirectUri: config.redirectUri,
      },
      { status: 503, headers: { "Cache-Control": "no-store, max-age=0" } },
    );
  }

  const state = crypto.randomUUID();
  const response = NextResponse.redirect(buildIntuitConnectUrl(config, state));
  response.cookies.set(QBO_STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: "lax",
    secure: true,
    path: "/api/integrations/qbo",
    maxAge: 10 * 60,
  });
  response.headers.set("Cache-Control", "no-store, max-age=0");
  response.headers.set("X-QBO-Launch-Page", QBO_ROUTE_PATHS.connectPage);
  return response;
}
