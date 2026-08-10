import { NextRequest, NextResponse } from "next/server";
import { getQboConfig, QBO_STATE_COOKIE, QBO_ROUTE_PATHS } from "@/lib/qbo-config";

export const dynamic = "force-dynamic";

function jsonError(status: number, message: string, details?: Record<string, unknown>) {
  return NextResponse.json(
    {
      ok: false,
      message,
      ...(details || {}),
    },
    { status, headers: { "Cache-Control": "no-store, max-age=0" } },
  );
}

export function GET(request: NextRequest) {
  const config = getQboConfig();
  const url = new URL(request.url);
  const state = url.searchParams.get("state");
  const code = url.searchParams.get("code");
  const realmId = url.searchParams.get("realmId");
  const cookieState = request.cookies.get(QBO_STATE_COOKIE)?.value || "";

  if (!state || !cookieState || state !== cookieState) {
    return jsonError(400, "Missing or invalid OAuth state.", {
      route: QBO_ROUTE_PATHS.callbackApi,
      hasCookieState: Boolean(cookieState),
    });
  }

  if (!config.ready) {
    return jsonError(503, "QBO connection is not configured yet.", {
      missingConfig: config.missing,
      redirectUri: config.redirectUri,
    });
  }

  if (!code) {
    return jsonError(400, "Missing authorization code from Intuit.");
  }

  return NextResponse.json(
    {
      ok: true,
      phase: "setup",
      message: "OAuth callback verified. Token exchange is intentionally deferred in this setup phase.",
      realmId: realmId || null,
      redirectUri: config.redirectUri,
      scope: config.accountingScope,
    },
    {
      headers: {
        "Cache-Control": "no-store, max-age=0",
      },
    },
  );
}
