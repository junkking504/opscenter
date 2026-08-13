import { NextResponse } from "next/server";
import { resolveRequestOrigin } from "@/lib/auth";
import { CREW_LOGIN_PATH, CREW_SESSION_COOKIE, clearCrewSessionCookieOptions } from "@/lib/crew-auth";

export async function GET(request: Request) {
  const response = NextResponse.redirect(new URL(CREW_LOGIN_PATH, resolveRequestOrigin(request)));
  response.cookies.set(CREW_SESSION_COOKIE, "", clearCrewSessionCookieOptions(request));
  response.headers.set("Cache-Control", "no-store, max-age=0");
  return response;
}
