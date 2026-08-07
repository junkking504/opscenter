import { NextResponse } from "next/server";
import {
  AUTH_SESSION_MAX_AGE_SECONDS,
  AUTH_TRUSTED_DEVICE_MAX_AGE_SECONDS,
  authCookieOptionsForRequest,
  AUTH_SESSION_COOKIE,
  AUTH_TRUSTED_DEVICE_COOKIE,
  resolveRequestOrigin,
  clearLegacyAuthCookieNames,
  createAuthSessionCookieValue,
  createTrustedDeviceCookieValue,
  isValidJunkKingEmail,
  normalizeAuthEmail,
  sanitizeAuthRedirectTarget,
  trustedDeviceCookieOptionsForRequest,
} from "@/lib/auth";

async function buildInvalidEmailResponse(request: Request, next: string, json = false) {
  if (json) {
    return NextResponse.json(
      {
        ok: false,
        error: "Please enter a valid @junk-king.com email address.",
      },
      {
        status: 400,
        headers: {
          "Cache-Control": "no-store, max-age=0",
        },
      },
    );
  }

  const url = new URL("/login", resolveRequestOrigin(request));
  if (next) url.searchParams.set("next", next);
  url.searchParams.set("error", "invalid-email");
  return NextResponse.redirect(url);
}

export async function POST(request: Request) {
  const contentType = request.headers.get("content-type") || "";
  const acceptsJson = contentType.includes("application/json");
  const requestUrl = new URL(request.url);
  const requestOrigin = resolveRequestOrigin(request);
  const next = sanitizeAuthRedirectTarget(requestUrl.searchParams.get("next"));
  const cookieSecure = authCookieOptionsForRequest(request, new Date(Date.now() + AUTH_SESSION_MAX_AGE_SECONDS * 1000)).secure;

  console.info("[auth] login POST received", {
    host: request.headers.get("host"),
    forwardedHost: request.headers.get("x-forwarded-host"),
    forwardedProto: request.headers.get("x-forwarded-proto"),
    path: requestUrl.pathname,
    next,
    contentType,
  });

  let emailRaw = "";
  let redirectTarget = next;

  if (contentType.includes("application/json")) {
    const body = await request.json().catch(() => null);
    if (body && typeof body === "object") {
      emailRaw = String((body as Record<string, unknown>).email || "");
      redirectTarget = sanitizeAuthRedirectTarget((body as Record<string, unknown>).next);
    }
  } else {
    const formData = await request.formData();
    emailRaw = String(formData.get("email") || "");
    redirectTarget = sanitizeAuthRedirectTarget(formData.get("next"));
  }

  const email = normalizeAuthEmail(emailRaw);
  if (!isValidJunkKingEmail(email)) {
    console.info("[auth] rejected email", email || "(blank)");
    return buildInvalidEmailResponse(request, redirectTarget, acceptsJson);
  }

  const sessionValue = await createAuthSessionCookieValue(email);
  const response = NextResponse.redirect(new URL(redirectTarget, requestOrigin));
  clearLegacyAuthCookieNames(response, cookieSecure);
  response.cookies.set(
    AUTH_SESSION_COOKIE,
    sessionValue,
    authCookieOptionsForRequest(request, new Date(Date.now() + AUTH_SESSION_MAX_AGE_SECONDS * 1000)),
  );
  response.cookies.set(
    AUTH_TRUSTED_DEVICE_COOKIE,
    await createTrustedDeviceCookieValue(email, request),
    trustedDeviceCookieOptionsForRequest(
      request,
      new Date(Date.now() + AUTH_TRUSTED_DEVICE_MAX_AGE_SECONDS * 1000),
    ),
  );
  response.headers.set("Cache-Control", "no-store, max-age=0");
  console.info("[auth] accepted email", email);
  console.info("[auth] session created for", email);
  console.info("[auth] cookie options", {
    secure: cookieSecure,
    httpOnly: true,
    sameSite: "lax",
    path: "/",
  });
  console.info("[auth] redirect target", redirectTarget);
  console.info("[auth] verification email function not invoked");
  return response;
}
