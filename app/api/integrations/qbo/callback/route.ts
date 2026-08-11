import { NextRequest, NextResponse } from "next/server";
import { getQboConfig, QBO_STATE_COOKIE, QBO_ROUTE_PATHS } from "@/lib/qbo-config";
import { exchangeQboAuthorizationCode } from "@/lib/qbo-oauth";

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

export async function GET(request: NextRequest) {
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

  if (!code || !realmId) {
    return jsonError(400, "Missing authorization code or company identifier from Intuit.");
  }

  try {
    await exchangeQboAuthorizationCode(code, realmId);
    const response = NextResponse.redirect(new URL(`${QBO_ROUTE_PATHS.statusPage}?connected=1`, request.url));
    response.cookies.set(QBO_STATE_COOKIE, "", {
      httpOnly: true,
      sameSite: "lax",
      secure: true,
      path: "/api/integrations/qbo",
      maxAge: 0,
    });
    response.headers.set("Cache-Control", "no-store, max-age=0");
    return response;
  } catch (error) {
    return jsonError(502, error instanceof Error ? error.message : "Intuit token exchange failed.");
  }
}
