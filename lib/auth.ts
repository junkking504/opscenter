import { NextResponse } from "next/server";

export const AUTH_SESSION_COOKIE = "opscenter_email_session";
export const AUTH_SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;
export const AUTH_TRUSTED_DEVICE_COOKIE = "opscenter_trusted_device";
export const AUTH_TRUSTED_DEVICE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;
export const AUTH_TRUSTED_DEVICE_REFRESH_AFTER_SECONDS = 60 * 60 * 24 * 30;
export const AUTH_LOGIN_PATH = "/login";
export const AUTH_LOGOUT_PATH = "/api/auth/logout";
export const LEGACY_AUTH_COOKIE_NAMES = [
  "opscenter_pending_verification",
  "opscenter_verification_code",
  "opscenter_verification_token",
  "opscenter_otp",
  "opscenter_magic_link",
  "opscenter_auth_pending",
] as const;
export const AUTH_PUBLIC_PREFIXES = ["/legal/", "/support"] as const;
export const AUTH_PUBLIC_ROUTES = ["/integrations/qbo", "/integrations/qbo/disconnected"] as const;
export const AUTH_PUBLIC_API_PREFIXES = ["/api/auth/", "/api/health", "/api/integrations/junkware/sms", "/api/integrations/whatsapp/job-photos"] as const;
export const AUTH_PUBLIC_API_ROUTES = [
  "/api/integrations/qbo/connect",
  "/api/integrations/qbo/callback",
] as const;
export const AUTH_PUBLIC_FILES = ["/junk-king-logo.svg"] as const;
export const AUTH_PROTECTED_API_PREFIXES = ["/api/exceptions", "/api/inbox", "/api/fleet-map", "/api/fleet-maintenance", "/api/fleet-checklists", "/api/fleet-checklist-templates", "/api/fleet-checklist-photos", "/api/fleet-issues", "/api/fleet-issue-photos", "/api/manual-bonuses", "/api/searchkings", "/api/integrations/qbo/status", "/api/integrations/qbo/disconnect"] as const;
export const LEGACY_VERIFICATION_CODE_FLOW_ENABLED = false;

export type AuthSessionPayload = {
  version: 1;
  email: string;
  issuedAt: string;
  expiresAt: string;
};

export type AuthSession = {
  email: string;
  issuedAt: Date;
  expiresAt: Date;
};

export type TrustedDevicePayload = {
  version: 1;
  email: string;
  deviceId: string;
  userAgentHash: string;
  networkHash: string;
  issuedAt: string;
  expiresAt: string;
};

// Browsers do not expose IMEI or other hardware identifiers. This signed,
// HttpOnly credential is the device identifier; the hashed browser/network
// signals keep it associated with the environment where login occurred.
export type TrustedDevice = AuthSession & {
  deviceId: string;
  matchedBy: "browser" | "network";
};

const encoder = new TextEncoder();
const DEFAULT_SESSION_SECRET = "opscenter-local-email-session-secret";

function getSessionSecret(): string {
  return String(
    process.env.OPS_AUTH_SESSION_SECRET ||
      process.env.AUTH_SESSION_SECRET ||
      process.env.NEXTAUTH_SECRET ||
      DEFAULT_SESSION_SECRET,
  ).trim();
}

function isNodeBufferAvailable(): boolean {
  return typeof Buffer !== "undefined";
}

function bytesToBase64(bytes: Uint8Array): string {
  if (isNodeBufferAvailable()) {
    return Buffer.from(bytes).toString("base64");
  }
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  if (isNodeBufferAvailable()) {
    return new Uint8Array(Buffer.from(value, "base64"));
  }
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function base64UrlEncode(value: Uint8Array): string {
  return bytesToBase64(value).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function base64UrlDecode(value: string): Uint8Array {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  const pad = padded.length % 4 === 0 ? "" : "=".repeat(4 - (padded.length % 4));
  return base64ToBytes(`${padded}${pad}`);
}

async function importHmacKey() {
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(getSessionSecret()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

async function signPayload(payload: string): Promise<string> {
  const key = await importHmacKey();
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(payload));
  return base64UrlEncode(new Uint8Array(signature));
}

async function hashDeviceSignal(label: string, value: string): Promise<string> {
  if (!value) return "";
  return signPayload(`${label}:${value}`);
}

function parseSeconds(value: string): number {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.getTime() : 0;
}

export function normalizeAuthEmail(value: unknown): string {
  return String(value || "").trim().toLowerCase();
}

export function normalizeAuthUsername(value: unknown): string {
  return String(value || "").trim().toLowerCase();
}

function constantTimeEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left[index] ^ right[index];
  }
  return difference === 0;
}

async function constantTimeStringEqual(left: string, right: string): Promise<boolean> {
  const [leftHash, rightHash] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(left)),
    crypto.subtle.digest("SHA-256", encoder.encode(right)),
  ]);
  return constantTimeEqual(new Uint8Array(leftHash), new Uint8Array(rightHash));
}

export function opsAuthIdentity(): string {
  const username = normalizeAuthUsername(process.env.OPS_AUTH_USERNAME);
  return username ? `${username}@junk-king.com` : "";
}

export function opsAuthDisplayName(identityValue: unknown): string {
  const identity = normalizeAuthEmail(identityValue);
  const configuredUsername = normalizeAuthUsername(process.env.OPS_AUTH_USERNAME);
  return configuredUsername && identity === `${configuredUsername}@junk-king.com`
    ? configuredUsername
    : identity;
}

export async function verifyOpsCredentials(usernameValue: unknown, passwordValue: unknown): Promise<boolean> {
  const configuredUsername = normalizeAuthUsername(process.env.OPS_AUTH_USERNAME);
  const username = normalizeAuthUsername(usernameValue);
  const password = String(passwordValue || "");
  const passwordHash = String(process.env.OPS_AUTH_PASSWORD_HASH || "").trim();

  const [algorithm, iterationsRaw, saltRaw, expectedRaw] = passwordHash.split("$");
  const iterations = Number.parseInt(iterationsRaw, 10);
  if (!configuredUsername || algorithm !== "pbkdf2-sha256" || !Number.isSafeInteger(iterations) || iterations < 100_000 || !saltRaw || !expectedRaw) {
    return false;
  }

  try {
    const usernameMatches = await constantTimeStringEqual(username, configuredUsername);
    const key = await crypto.subtle.importKey(
      "raw",
      encoder.encode(password || "\0"),
      "PBKDF2",
      false,
      ["deriveBits"],
    );
    const expected = base64UrlDecode(expectedRaw);
    const salt = Uint8Array.from(base64UrlDecode(saltRaw)).buffer;
    const derived = new Uint8Array(await crypto.subtle.deriveBits(
      {
        name: "PBKDF2",
        hash: "SHA-256",
        salt,
        iterations,
      },
      key,
      expected.length * 8,
    ));
    return Boolean(username && password) && usernameMatches && constantTimeEqual(derived, expected);
  } catch {
    return false;
  }
}

function normalizeDeviceUserAgent(value: string | null | undefined): string {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[0-9._-]+/g, "#")
    .replace(/\s+/g, " ")
    .slice(0, 512);
}

export function resolveClientNetwork(headers: Headers): string {
  const raw = String(
    headers.get("cf-connecting-ip") ||
      headers.get("x-forwarded-for")?.split(",")[0] ||
      headers.get("x-real-ip") ||
      "",
  ).trim().toLowerCase();

  if (!raw) return "";
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(raw)) {
    const octets = raw.split(".");
    return `${octets[0]}.${octets[1]}.${octets[2]}.0/24`;
  }
  if (raw.includes(":")) {
    const address = raw.replace(/^\[|\]$/g, "").split("%")[0];
    const halves = address.split("::");
    if (halves.length <= 2) {
      const left = halves[0] ? halves[0].split(":") : [];
      const right = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
      const missing = 8 - left.length - right.length;
      const groups = [...left, ...Array(Math.max(0, missing)).fill("0"), ...right];
      if (groups.length === 8 && groups.every((group) => /^[0-9a-f]{1,4}$/.test(group))) {
        return `${groups.slice(0, 4).map((group) => group.padStart(4, "0")).join(":")}::/64`;
      }
    }
  }
  return raw;
}

function createDeviceId(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return base64UrlEncode(bytes);
}

export function isValidJunkKingEmail(value: unknown): boolean {
  const email = normalizeAuthEmail(value);
  return /^[^\s@]+@junk-king\.com$/.test(email);
}

export function sanitizeAuthRedirectTarget(value: unknown): string {
  const target = String(value || "").trim();
  if (!target) return "/";
  if (!target.startsWith("/")) return "/";
  if (target.startsWith("//")) return "/";
  if (target.startsWith(AUTH_LOGIN_PATH)) return "/";
  return target;
}

function normalizeRequestHostname(value: string | null | undefined): string {
  const host = String(value || "").trim();
  if (!host) return "";
  try {
    return new URL(`http://${host}`).hostname.toLowerCase();
  } catch {
    return host.toLowerCase();
  }
}

function normalizeRequestProto(value: string | null | undefined): string {
  return String(value || "").trim().toLowerCase().split(",")[0] || "";
}

export function resolveAuthCookieSecure(requestUrl: string | URL, headers?: Headers | null): boolean {
  const url = typeof requestUrl === "string" ? new URL(requestUrl) : requestUrl;
  const hostname = normalizeRequestHostname(headers?.get("x-forwarded-host") || headers?.get("host") || url.host);
  const protocol = normalizeRequestProto(headers?.get("x-forwarded-proto")) || url.protocol.replace(":", "").toLowerCase();

  if (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1" || hostname.endsWith(".localhost")) {
    return false;
  }

  if (protocol === "https") {
    return true;
  }

  return process.env.NODE_ENV === "production";
}

export function resolveRequestOrigin(request: Request): string {
  const url = new URL(request.url);
  const protocol = normalizeRequestProto(request.headers.get("x-forwarded-proto")) || url.protocol.replace(":", "").toLowerCase();
  const host = request.headers.get("x-forwarded-host") || request.headers.get("host") || url.host;
  return `${protocol}://${host}`;
}

export function createAuthSessionPayload(email: string, now = new Date()): AuthSessionPayload {
  return {
    version: 1,
    email: normalizeAuthEmail(email),
    issuedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + AUTH_SESSION_MAX_AGE_SECONDS * 1000).toISOString(),
  };
}

export async function encodeAuthSession(payload: AuthSessionPayload): Promise<string> {
  const payloadJson = JSON.stringify(payload);
  const encodedPayload = base64UrlEncode(encoder.encode(payloadJson));
  const signature = await signPayload(encodedPayload);
  return `${encodedPayload}.${signature}`;
}

export async function createAuthSessionCookieValue(email: string, now = new Date()): Promise<string> {
  return encodeAuthSession(createAuthSessionPayload(email, now));
}

export async function createTrustedDeviceCookieValue(
  email: string,
  request: Request,
  now = new Date(),
): Promise<string> {
  const payload: TrustedDevicePayload = {
    version: 1,
    email: normalizeAuthEmail(email),
    deviceId: createDeviceId(),
    userAgentHash: await hashDeviceSignal(
      "browser",
      normalizeDeviceUserAgent(request.headers.get("user-agent")),
    ),
    networkHash: await hashDeviceSignal("network", resolveClientNetwork(request.headers)),
    issuedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + AUTH_TRUSTED_DEVICE_MAX_AGE_SECONDS * 1000).toISOString(),
  };
  const encodedPayload = base64UrlEncode(encoder.encode(JSON.stringify(payload)));
  const signature = await signPayload(`trusted-device:${encodedPayload}`);
  return `${encodedPayload}.${signature}`;
}

export async function verifyTrustedDeviceCookie(
  cookieValue: string | null | undefined,
  request: Request,
): Promise<TrustedDevice | null> {
  const raw = String(cookieValue || "").trim();
  if (!raw) return null;

  const [encodedPayload, signature] = raw.split(".");
  if (!encodedPayload || !signature) return null;
  const expectedSignature = await signPayload(`trusted-device:${encodedPayload}`);
  if (signature !== expectedSignature) return null;

  let payload: TrustedDevicePayload | null = null;
  try {
    payload = JSON.parse(new TextDecoder().decode(base64UrlDecode(encodedPayload))) as TrustedDevicePayload;
  } catch {
    payload = null;
  }
  if (!payload || payload.version !== 1 || !isValidJunkKingEmail(payload.email) || !payload.deviceId) return null;

  const expiresAtMs = parseSeconds(payload.expiresAt);
  const issuedAtMs = parseSeconds(payload.issuedAt);
  if (!expiresAtMs || expiresAtMs <= Date.now() || !issuedAtMs) return null;

  const browserHash = await hashDeviceSignal(
    "browser",
    normalizeDeviceUserAgent(request.headers.get("user-agent")),
  );
  const networkHash = await hashDeviceSignal("network", resolveClientNetwork(request.headers));
  const browserMatches = Boolean(payload.userAgentHash && browserHash === payload.userAgentHash);
  const networkMatches = Boolean(payload.networkHash && networkHash === payload.networkHash);
  if (!browserMatches && !networkMatches) return null;

  return {
    email: normalizeAuthEmail(payload.email),
    deviceId: payload.deviceId,
    matchedBy: browserMatches ? "browser" : "network",
    issuedAt: new Date(issuedAtMs),
    expiresAt: new Date(expiresAtMs),
  };
}

export function shouldRefreshTrustedDevice(
  device: Pick<TrustedDevice, "issuedAt" | "expiresAt">,
  now = new Date(),
): boolean {
  const nowMs = now.getTime();
  const issuedAtMs = device.issuedAt.getTime();
  const expiresAtMs = device.expiresAt.getTime();
  if (!Number.isFinite(nowMs) || !Number.isFinite(issuedAtMs) || !Number.isFinite(expiresAtMs)) {
    return true;
  }

  return (
    nowMs - issuedAtMs >= AUTH_TRUSTED_DEVICE_REFRESH_AFTER_SECONDS * 1000 ||
    expiresAtMs - nowMs <= AUTH_TRUSTED_DEVICE_REFRESH_AFTER_SECONDS * 1000
  );
}

export async function verifyAuthSessionCookie(cookieValue: string | null | undefined): Promise<AuthSession | null> {
  const raw = String(cookieValue || "").trim();
  if (!raw) return null;

  const [encodedPayload, signature] = raw.split(".");
  if (!encodedPayload || !signature) return null;

  const expectedSignature = await signPayload(encodedPayload);
  if (signature !== expectedSignature) return null;

  let payload: AuthSessionPayload | null = null;
  try {
    const decoded = base64UrlDecode(encodedPayload);
    payload = JSON.parse(new TextDecoder().decode(decoded)) as AuthSessionPayload;
  } catch {
    payload = null;
  }

  if (!payload || payload.version !== 1 || !isValidJunkKingEmail(payload.email)) return null;

  const expiresAtMs = parseSeconds(payload.expiresAt);
  if (!expiresAtMs || expiresAtMs <= Date.now()) return null;

  const issuedAtMs = parseSeconds(payload.issuedAt);
  if (!issuedAtMs) return null;

  return {
    email: normalizeAuthEmail(payload.email),
    issuedAt: new Date(issuedAtMs),
    expiresAt: new Date(expiresAtMs),
  };
}

export function authCookieOptions(expiresAt: Date, secure = process.env.NODE_ENV === "production") {
  return {
    httpOnly: true as const,
    sameSite: "lax" as const,
    secure,
    path: "/",
    expires: expiresAt,
    maxAge: AUTH_SESSION_MAX_AGE_SECONDS,
  };
}

export function authCookieOptionsForRequest(request: Request, expiresAt: Date) {
  return authCookieOptions(expiresAt, resolveAuthCookieSecure(request.url, request.headers));
}

export function trustedDeviceCookieOptionsForRequest(request: Request, expiresAt: Date) {
  return {
    httpOnly: true as const,
    sameSite: "lax" as const,
    secure: resolveAuthCookieSecure(request.url, request.headers),
    path: "/",
    expires: expiresAt,
    maxAge: AUTH_TRUSTED_DEVICE_MAX_AGE_SECONDS,
  };
}

export function clearLegacyAuthCookieNames(response: NextResponse, secure = process.env.NODE_ENV === "production"): NextResponse {
  for (const name of LEGACY_AUTH_COOKIE_NAMES) {
    response.cookies.set(name, "", {
      httpOnly: true,
      sameSite: "lax",
      secure,
      path: "/",
      expires: new Date(0),
      maxAge: 0,
    });
  }
  return response;
}

export async function requireAuthSession(request: Request): Promise<AuthSession | NextResponse> {
  const session = await verifyAuthSessionCookie(request.headers.get("cookie"));
  if (session) return session;

  return NextResponse.json(
    { error: "Authentication required.", loginPath: AUTH_LOGIN_PATH },
    {
      status: 401,
      headers: {
        "Cache-Control": "no-store, max-age=0",
      },
    },
  );
}

export function publicAuthRoute(pathname: string): boolean {
  if (pathname === AUTH_LOGIN_PATH || pathname === AUTH_LOGOUT_PATH) return true;
  return AUTH_PUBLIC_FILES.includes(pathname as (typeof AUTH_PUBLIC_FILES)[number]) ||
    AUTH_PUBLIC_ROUTES.includes(pathname as (typeof AUTH_PUBLIC_ROUTES)[number]) ||
    AUTH_PUBLIC_PREFIXES.some((prefix) => pathname.startsWith(prefix)) ||
    AUTH_PUBLIC_API_PREFIXES.some((prefix) => pathname.startsWith(prefix)) ||
    AUTH_PUBLIC_API_ROUTES.includes(pathname as (typeof AUTH_PUBLIC_API_ROUTES)[number]);
}

export function protectedApiRoute(pathname: string): boolean {
  return AUTH_PROTECTED_API_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}
