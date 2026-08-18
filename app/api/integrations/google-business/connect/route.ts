import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { buildGoogleBusinessProfileConnectUrl, getGoogleBusinessProfileConfig, GOOGLE_BUSINESS_PROFILE_STATE_COOKIE } from "@/lib/google-business-profile";

export const dynamic = "force-dynamic";

export function GET() {
  const config = getGoogleBusinessProfileConfig();
  if (!config.ready) return NextResponse.json({ ok: false, message: "Google Business Profile connection is not configured.", missingConfig: config.missing, redirectUri: config.redirectUri }, { status: 503, headers: { "Cache-Control": "no-store, max-age=0" } });
  const state = crypto.randomUUID();
  const response = NextResponse.redirect(buildGoogleBusinessProfileConnectUrl(state));
  response.cookies.set(GOOGLE_BUSINESS_PROFILE_STATE_COOKIE, state, { httpOnly: true, sameSite: "lax", secure: true, path: "/api/integrations/google-business", maxAge: 10 * 60 });
  response.headers.set("Cache-Control", "no-store, max-age=0");
  return response;
}
