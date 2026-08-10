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
  opsAuthIdentity,
  sanitizeAuthRedirectTarget,
  trustedDeviceCookieOptionsForRequest,
  verifyOpsCredentials,
} from "@/lib/auth";

async function buildInvalidCredentialsResponse(request: Request, next: string, json = false) {
  if (json) {
    return NextResponse.json(
      {
        ok: false,
        error: "Invalid username or password.",
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
  url.searchParams.set("error", "invalid-credentials");
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

  let usernameRaw = "";
  let passwordRaw = "";
  let redirectTarget = next;

  if (contentType.includes("application/json")) {
    const body = await request.json().catch(() => null);
    if (body && typeof body === "object") {
      usernameRaw = String((body as Record<string, unknown>).username || "");
      passwordRaw = String((body as Record<string, unknown>).password || "");
      redirectTarget = sanitizeAuthRedirectTarget((body as Record<string, unknown>).next);
    }
  } else {
    const formData = await request.formData();
    usernameRaw = String(formData.get("username") || "");
    passwordRaw = String(formData.get("password") || "");
    redirectTarget = sanitizeAuthRedirectTarget(formData.get("next"));
  }

  if (!(await verifyOpsCredentials(usernameRaw, passwordRaw))) {
    console.info("[auth] rejected credentials", usernameRaw ? "username-present" : "username-blank");
    return buildInvalidCredentialsResponse(request, redirectTarget, acceptsJson);
  }

  const email = opsAuthIdentity();

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
  console.info("[auth] accepted username", usernameRaw.trim().toLowerCase());
  console.info("[auth] session created");
  console.info("[auth] cookie options", {
    secure: cookieSecure,
    httpOnly: true,
    sameSite: "lax",
    path: "/",
  });
  console.info("[auth] redirect target", redirectTarget);
  return response;
}
