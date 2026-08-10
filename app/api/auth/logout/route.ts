import { NextResponse } from "next/server";
import { AUTH_SESSION_COOKIE, AUTH_TRUSTED_DEVICE_COOKIE, authCookieOptionsForRequest, clearLegacyAuthCookieNames, resolveAuthCookieSecure, resolveRequestOrigin, trustedDeviceCookieOptionsForRequest } from "@/lib/auth";

export async function GET(request: Request) {
  const response = NextResponse.redirect(new URL("/login", resolveRequestOrigin(request)));
  const secure = resolveAuthCookieSecure(request.url, request.headers);
  clearLegacyAuthCookieNames(response, secure);
  response.cookies.set(AUTH_SESSION_COOKIE, "", {
    ...authCookieOptionsForRequest(request, new Date(0)),
    maxAge: 0,
    expires: new Date(0),
  });
  response.cookies.set(AUTH_TRUSTED_DEVICE_COOKIE, "", {
    ...trustedDeviceCookieOptionsForRequest(request, new Date(0)),
    maxAge: 0,
    expires: new Date(0),
  });
  response.headers.set("Cache-Control", "no-store, max-age=0");
  return response;
}

export const POST = GET;
