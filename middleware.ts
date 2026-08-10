import { NextRequest, NextResponse } from "next/server";
import {
  AUTH_LOGIN_PATH,
  AUTH_SESSION_COOKIE,
  AUTH_SESSION_MAX_AGE_SECONDS,
  AUTH_TRUSTED_DEVICE_COOKIE,
  AUTH_TRUSTED_DEVICE_MAX_AGE_SECONDS,
  authCookieOptionsForRequest,
  createAuthSessionCookieValue,
  createTrustedDeviceCookieValue,
  isValidJunkKingEmail,
  publicAuthRoute,
  protectedApiRoute,
  shouldRefreshTrustedDevice,
  trustedDeviceCookieOptionsForRequest,
  verifyAuthSessionCookie,
  verifyTrustedDeviceCookie,
} from "@/lib/auth";
import {
  CREW_IDENTITY_HEADER,
  CREW_LOGIN_PATH,
  CREW_PAY_PATH,
  crewMemberForEmail,
} from "@/lib/crew-auth";
import {
  opsAccessConfigured,
  verifyCloudflareAccessJwt,
  verifyOpsAccessJwt,
} from "@/lib/cloudflare-access";
import { JUNKWARE_SMS_API_PREFIX } from "@/lib/junkware-sms-constants";

function requestHeadersWithSession(request: NextRequest, sessionValue: string): Headers {
  const requestHeaders = new Headers(request.headers);
  const cookies = String(request.headers.get("cookie") || "")
    .split(";")
    .map((cookie) => cookie.trim())
    .filter((cookie) => cookie && !cookie.startsWith(`${AUTH_SESSION_COOKIE}=`));
  cookies.push(`${AUTH_SESSION_COOKIE}=${sessionValue}`);
  requestHeaders.set("cookie", cookies.join("; "));
  return requestHeaders;
}

async function initializeOpsSession(
  request: NextRequest,
  email: string,
  options: { rememberDevice: boolean; redirect: boolean },
): Promise<NextResponse> {
  const sessionValue = await createAuthSessionCookieValue(email);
  const response = options.redirect
    ? NextResponse.redirect(request.nextUrl)
    : NextResponse.next({ request: { headers: requestHeadersWithSession(request, sessionValue) } });

  response.cookies.set(
    AUTH_SESSION_COOKIE,
    sessionValue,
    authCookieOptionsForRequest(
      request,
      new Date(Date.now() + AUTH_SESSION_MAX_AGE_SECONDS * 1000),
    ),
  );
  if (options.rememberDevice) {
    response.cookies.set(
      AUTH_TRUSTED_DEVICE_COOKIE,
      await createTrustedDeviceCookieValue(email, request),
      trustedDeviceCookieOptionsForRequest(
        request,
        new Date(Date.now() + AUTH_TRUSTED_DEVICE_MAX_AGE_SECONDS * 1000),
      ),
    );
  }
  response.headers.set("Cache-Control", "no-store, max-age=0");
  return response;
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const hostname = String(
    request.headers.get("x-forwarded-host") || request.headers.get("host") || request.nextUrl.host,
  ).split(":")[0].toLowerCase();
  const crewHostname = String(process.env.OPS_CREW_HOSTNAME || "crew.junk-king.app").trim().toLowerCase();
  const smsHostname = String(process.env.OPS_SMS_WEBHOOK_HOSTNAME || "hooks.junk-king.app").trim().toLowerCase();
  const isCrewHostname = hostname === crewHostname;
  const isSmsHostname = hostname === smsHostname;
  const slackActionsPath = "/api/integrations/slack/actions";

  if (pathname.startsWith("/_next/")) {
    return NextResponse.next();
  }

  if (isSmsHostname) {
    if (pathname === JUNKWARE_SMS_API_PREFIX || pathname.startsWith(`${JUNKWARE_SMS_API_PREFIX}/`)) {
      return NextResponse.next();
    }
    if (pathname === slackActionsPath) {
      return NextResponse.next();
    }
    return new NextResponse("Not Found", { status: 404 });
  }

  if (isCrewHostname && pathname === "/") {
    return NextResponse.redirect(new URL(CREW_PAY_PATH, request.url));
  }

  if (
    isCrewHostname &&
    pathname !== CREW_LOGIN_PATH &&
    !pathname.startsWith(`${CREW_LOGIN_PATH}/`) &&
    pathname !== CREW_PAY_PATH &&
    !pathname.startsWith(`${CREW_PAY_PATH}/`) &&
    !pathname.startsWith("/legal/") &&
    pathname !== "/support"
  ) {
    return NextResponse.redirect(new URL(CREW_LOGIN_PATH, request.url));
  }

  if (!isCrewHostname && (pathname === CREW_LOGIN_PATH || pathname.startsWith(`${CREW_LOGIN_PATH}/`) || pathname === CREW_PAY_PATH || pathname.startsWith(`${CREW_PAY_PATH}/`))) {
    return NextResponse.redirect(new URL(`https://${crewHostname}${pathname}${request.nextUrl.search}`));
  }

  if (isCrewHostname && (pathname === CREW_LOGIN_PATH || pathname.startsWith(`${CREW_LOGIN_PATH}/`) || pathname === CREW_PAY_PATH || pathname.startsWith(`${CREW_PAY_PATH}/`))) {
    const email = await verifyCloudflareAccessJwt(request.headers.get("cf-access-jwt-assertion"));
    const crewMember = email ? crewMemberForEmail(email) : null;

    if (crewMember && pathname.startsWith(CREW_LOGIN_PATH)) {
      return NextResponse.redirect(new URL(CREW_PAY_PATH, request.url));
    }

    if (crewMember && pathname.startsWith(CREW_PAY_PATH)) {
      const requestHeaders = new Headers(request.headers);
      requestHeaders.set(CREW_IDENTITY_HEADER, crewMember.email);
      return NextResponse.next({ request: { headers: requestHeaders } });
    }

    if (pathname.startsWith(CREW_PAY_PATH)) {
      const crewLoginUrl = new URL(CREW_LOGIN_PATH, request.url);
      crewLoginUrl.searchParams.set("error", email ? "not-rostered" : "not-authenticated");
      return NextResponse.redirect(crewLoginUrl);
    }

    return NextResponse.next();
  }

  const enforceOpsAccess = !isCrewHostname
    && opsAccessConfigured()
    && (pathname === AUTH_LOGIN_PATH || !publicAuthRoute(pathname));

  const sessionCookie = request.cookies.get(AUTH_SESSION_COOKIE)?.value || "";
  const session = await verifyAuthSessionCookie(sessionCookie);
  const trustedDeviceCookie = request.cookies.get(AUTH_TRUSTED_DEVICE_COOKIE)?.value || "";
  const trustedDevice = await verifyTrustedDeviceCookie(trustedDeviceCookie, request);

  if (enforceOpsAccess) {
    const accessAssertion = request.headers.get("cf-access-jwt-assertion");
    const accessEmail = accessAssertion ? await verifyOpsAccessJwt(accessAssertion) : null;
    const rememberedEmail = session?.email || trustedDevice?.email || null;

    if (accessEmail && isValidJunkKingEmail(accessEmail) && accessEmail !== rememberedEmail) {
      return initializeOpsSession(request, accessEmail, {
        rememberDevice: true,
        redirect: request.method === "GET" || request.method === "HEAD",
      });
    }

    if (!session && !trustedDevice) {
      if (!accessEmail || !isValidJunkKingEmail(accessEmail)) {
        return NextResponse.json(
          { error: "Cloudflare Access authentication required." },
          { status: 401, headers: { "Cache-Control": "no-store, max-age=0" } },
        );
      }
      return initializeOpsSession(request, accessEmail, {
        rememberDevice: true,
        redirect: request.method === "GET" || request.method === "HEAD",
      });
    }

    if (session && !trustedDevice && accessEmail === session.email) {
      return initializeOpsSession(request, session.email, { rememberDevice: true, redirect: false });
    }
  }

  if (publicAuthRoute(pathname)) {
    if (pathname === AUTH_LOGIN_PATH && !session && trustedDevice) {
      return initializeOpsSession(request, trustedDevice.email, { rememberDevice: false, redirect: true });
    }
    return NextResponse.next();
  }

  console.info("[auth] protected request", {
    pathname,
    sessionCookie: sessionCookie ? "present" : "absent",
    trustedDevice: trustedDevice ? `valid:${trustedDevice.matchedBy}` : "absent-or-invalid",
  });
  console.info("[auth] session validation", {
    pathname,
    valid: Boolean(session),
  });
  if (session) {
    if (trustedDevice && shouldRefreshTrustedDevice(trustedDevice)) {
      return initializeOpsSession(request, session.email, {
        rememberDevice: true,
        redirect: false,
      });
    }
    return NextResponse.next();
  }

  if (trustedDevice) {
    return initializeOpsSession(request, trustedDevice.email, {
      rememberDevice: shouldRefreshTrustedDevice(trustedDevice),
      redirect: request.method === "GET" || request.method === "HEAD",
    });
  }

  if (pathname.startsWith("/api/")) {
    if (protectedApiRoute(pathname)) {
      return NextResponse.json(
        { error: "Authentication required.", loginPath: "/login" },
        {
          status: 401,
          headers: {
            "Cache-Control": "no-store, max-age=0",
          },
        },
      );
    }

    return NextResponse.next();
  }

  const loginUrl = new URL("/login", request.url);
  const nextPath = `${request.nextUrl.pathname}${request.nextUrl.search}`;
  if (nextPath && nextPath !== "/login") {
    loginUrl.searchParams.set("next", nextPath);
  }
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml).*)"],
};
