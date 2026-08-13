import { NextResponse } from "next/server";
import { resolveRequestOrigin } from "@/lib/auth";
import {
  CREW_LOGIN_PATH,
  CREW_PAY_PATH,
  CREW_SESSION_COOKIE,
  CREW_SESSION_MAX_AGE_SECONDS,
  CREW_SET_PASSWORD_PATH,
  clearCrewSessionCookieOptions,
  createCrewSessionCookieValue,
  crewSessionCookieOptions,
  crewSessionFromCookieHeader,
  verifyCrewSessionCookie,
} from "@/lib/crew-auth";
import { crewPasswordPolicyError, setInitialCrewPassword } from "@/lib/crew-credentials";

function redirectWithError(request: Request, error: string) {
  const url = new URL(CREW_SET_PASSWORD_PATH, resolveRequestOrigin(request));
  url.searchParams.set("error", error);
  return NextResponse.redirect(url, 303);
}

function sameOrigin(request: Request): boolean {
  const origin = String(request.headers.get("origin") || "").trim();
  if (!origin) return true;
  try {
    return new URL(origin).origin === new URL(resolveRequestOrigin(request)).origin;
  } catch {
    return false;
  }
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return new NextResponse("Forbidden", { status: 403 });
  const session = await verifyCrewSessionCookie(crewSessionFromCookieHeader(request.headers.get("cookie")));
  if (!session?.passwordChangeRequired) {
    return NextResponse.redirect(new URL(session ? CREW_PAY_PATH : CREW_LOGIN_PATH, resolveRequestOrigin(request)), 303);
  }

  const formData = await request.formData();
  const password = String(formData.get("password") || "");
  const confirmation = String(formData.get("confirmPassword") || "");
  if (password !== confirmation) return redirectWithError(request, "password-mismatch");
  if (crewPasswordPolicyError(password)) return redirectWithError(request, "password-policy");

  const result = await setInitialCrewPassword(session.username, session.employee, password);
  if (!result.ok) {
    if (result.reason === "temporary-password") return redirectWithError(request, "temporary-password");
    const response = NextResponse.redirect(new URL(`${CREW_LOGIN_PATH}?error=session-expired`, resolveRequestOrigin(request)), 303);
    response.cookies.set(CREW_SESSION_COOKIE, "", clearCrewSessionCookieOptions(request));
    return response;
  }

  const sessionValue = await createCrewSessionCookieValue(
    { username: session.username, employee: session.employee },
    false,
  );
  const response = NextResponse.redirect(new URL(CREW_PAY_PATH, resolveRequestOrigin(request)), 303);
  response.cookies.set(
    CREW_SESSION_COOKIE,
    sessionValue,
    crewSessionCookieOptions(request, new Date(Date.now() + CREW_SESSION_MAX_AGE_SECONDS * 1000)),
  );
  response.headers.set("Cache-Control", "no-store, max-age=0");
  return response;
}
