import { NextResponse } from "next/server";
import { resolveRequestOrigin } from "@/lib/auth";
import {
  CREW_SESSION_COOKIE,
  CREW_SESSION_MAX_AGE_SECONDS,
  CREW_SET_PASSWORD_PATH,
  CREW_PAY_PATH,
  createCrewSessionCookieValue,
  crewSessionCookieOptions,
} from "@/lib/crew-auth";
import { authenticateCrewCredentials } from "@/lib/crew-credentials";
import {
  clearCrewLoginFailures,
  crewLoginAllowed,
  recordCrewLoginFailure,
} from "@/lib/crew-login-rate-limit";

function invalidCredentials(request: Request, throttled = false) {
  const url = new URL("/crew-login", resolveRequestOrigin(request));
  url.searchParams.set("error", "invalid-credentials");
  const response = NextResponse.redirect(url, 303);
  if (throttled) response.headers.set("Retry-After", "900");
  return response;
}

export async function POST(request: Request) {
  const formData = await request.formData();
  const username = formData.get("username");
  if (!crewLoginAllowed(request.headers, username)) return invalidCredentials(request, true);
  const authentication = await authenticateCrewCredentials(username, formData.get("password"));
  if (!authentication) {
    recordCrewLoginFailure(request.headers, username);
    return invalidCredentials(request);
  }
  clearCrewLoginFailures(request.headers, username);

  const session = await createCrewSessionCookieValue(authentication.member, authentication.passwordChangeRequired);
  const destination = authentication.passwordChangeRequired ? CREW_SET_PASSWORD_PATH : CREW_PAY_PATH;
  const response = NextResponse.redirect(new URL(destination, resolveRequestOrigin(request)), 303);
  response.cookies.set(
    CREW_SESSION_COOKIE,
    session,
    crewSessionCookieOptions(request, new Date(Date.now() + CREW_SESSION_MAX_AGE_SECONDS * 1000)),
  );
  response.headers.set("Cache-Control", "no-store, max-age=0");
  return response;
}
