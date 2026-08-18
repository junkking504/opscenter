import { NextRequest, NextResponse } from "next/server";
import { exchangeGoogleBusinessProfileAuthorizationCode, getGoogleBusinessProfileConfig, GOOGLE_BUSINESS_PROFILE_STATE_COOKIE } from "@/lib/google-business-profile";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const state = url.searchParams.get("state");
  const code = url.searchParams.get("code");
  const cookieState = request.cookies.get(GOOGLE_BUSINESS_PROFILE_STATE_COOKIE)?.value || "";
  if (!state || !cookieState || state !== cookieState) return NextResponse.json({ ok: false, message: "Missing or invalid OAuth state." }, { status: 400, headers: { "Cache-Control": "no-store, max-age=0" } });
  const config = getGoogleBusinessProfileConfig();
  if (!config.ready) return NextResponse.json({ ok: false, message: "Google Business Profile connection is not configured.", missingConfig: config.missing }, { status: 503, headers: { "Cache-Control": "no-store, max-age=0" } });
  if (!code) return NextResponse.json({ ok: false, message: "Google did not return an authorization code." }, { status: 400, headers: { "Cache-Control": "no-store, max-age=0" } });
  try {
    await exchangeGoogleBusinessProfileAuthorizationCode(code);
    const response = NextResponse.redirect(new URL("/marketing?section=reviews&googleBusinessConnected=1", request.url));
    response.cookies.set(GOOGLE_BUSINESS_PROFILE_STATE_COOKIE, "", { httpOnly: true, sameSite: "lax", secure: true, path: "/api/integrations/google-business", maxAge: 0 });
    response.headers.set("Cache-Control", "no-store, max-age=0");
    return response;
  } catch (error) {
    return NextResponse.json({ ok: false, message: error instanceof Error ? error.message : "Google OAuth token exchange failed." }, { status: 502, headers: { "Cache-Control": "no-store, max-age=0" } });
  }
}
