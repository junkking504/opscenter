export const CREW_LOGIN_PATH = "/crew-login";
export const CREW_SET_PASSWORD_PATH = "/set-password";
export const CREW_PAY_PATH = "/my-pay";
export const CREW_IDENTITY_HEADER = "x-ops-crew-employee";
export const CREW_SESSION_COOKIE = "opscenter_crew_session";
export const CREW_SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

const encoder = new TextEncoder();

function validConfiguredPasswordHash(value: unknown): boolean {
  const [algorithm, iterationsRaw, saltRaw, expectedRaw] = String(value || "").trim().split("$");
  const iterations = Number.parseInt(iterationsRaw, 10);
  return algorithm === "hmac-sha256"
    && iterations === 1
    && Boolean(saltRaw)
    && Boolean(expectedRaw);
}

export type CrewRosterEntry = {
  employee: string;
  username: string;
  active: boolean;
};

export type CrewSession = {
  username: string;
  employee: string;
  passwordChangeRequired: boolean;
  issuedAt: string;
  expiresAt: string;
};

type CrewSessionPayload = CrewSession & { version: 1; purpose: "crew" };

function base64UrlEncode(value: Uint8Array): string {
  if (typeof Buffer !== "undefined") return Buffer.from(value).toString("base64url");
  let binary = "";
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlDecode(value: string): Uint8Array {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  if (typeof Buffer !== "undefined") return new Uint8Array(Buffer.from(padded, "base64"));
  return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
}

function constantTimeEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left[index] ^ right[index];
  return difference === 0;
}

function sessionSecret(): string {
  return String(process.env.OPS_CREW_SESSION_SECRET || process.env.OPS_AUTH_SESSION_SECRET || "").trim();
}

async function signPayload(payload: string): Promise<Uint8Array> {
  const secret = sessionSecret();
  if (!secret) return new Uint8Array();
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(`opscenter:crew:${payload}`)));
}

export function normalizeCrewUsername(value: unknown): string {
  const username = String(value || "").trim().toLocaleLowerCase();
  return /^[a-z0-9][a-z0-9._@+!\-]{0,127}$/.test(username) ? username : "";
}

export function crewRoster(): CrewRosterEntry[] {
  const raw = String(process.env.OPS_CREW_ROSTER_JSON || "").trim();
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];

    const roster: CrewRosterEntry[] = [];
    const seenUsernames = new Set<string>();
    const seenEmployees = new Set<string>();
    for (const item of parsed) {
      if (!item || typeof item !== "object") continue;
      const row = item as Record<string, unknown>;
      const employee = String(row.employee || row.name || "").trim();
      const employeeKey = employee.toLocaleLowerCase();
      const username = normalizeCrewUsername(row.username || row.user || row.login);
      const active = row.active !== false;
      if (!employee || !username || seenUsernames.has(username) || seenEmployees.has(employeeKey)) continue;
      seenUsernames.add(username);
      seenEmployees.add(employeeKey);
      roster.push({ employee, username, active });
    }
    return roster;
  } catch {
    return [];
  }
}

export function crewMemberForUsername(value: unknown): CrewRosterEntry | null {
  const username = normalizeCrewUsername(value);
  if (!username) return null;
  return crewRoster().find((entry) => entry.active && entry.username === username) || null;
}

export function crewAuthConfigured(): boolean {
  return Boolean(
    sessionSecret().length >= 32
    && validConfiguredPasswordHash(process.env.OPS_CREW_TEMP_PASSWORD_HASH)
    && crewRoster().some((entry) => entry.active),
  );
}

export async function createCrewSessionCookieValue(
  member: Pick<CrewRosterEntry, "username" | "employee">,
  passwordChangeRequired: boolean,
  now = new Date(),
): Promise<string> {
  if (sessionSecret().length < 32) throw new Error("Krewe session authentication is not configured.");
  const payload: CrewSessionPayload = {
    version: 1,
    purpose: "crew",
    username: normalizeCrewUsername(member.username),
    employee: String(member.employee || "").trim(),
    passwordChangeRequired,
    issuedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + CREW_SESSION_MAX_AGE_SECONDS * 1000).toISOString(),
  };
  if (!payload.username || !payload.employee) throw new Error("A valid krewe identity is required.");
  const encoded = base64UrlEncode(encoder.encode(JSON.stringify(payload)));
  return `${encoded}.${base64UrlEncode(await signPayload(encoded))}`;
}

export async function verifyCrewSessionCookie(value: string | null | undefined, now = new Date()): Promise<CrewSession | null> {
  const raw = String(value || "").trim();
  const [encoded, signatureRaw] = raw.split(".");
  if (!encoded || !signatureRaw || !sessionSecret()) return null;

  try {
    const expected = await signPayload(encoded);
    const actual = base64UrlDecode(signatureRaw);
    if (!constantTimeEqual(expected, actual)) return null;
    const payload = JSON.parse(new TextDecoder().decode(base64UrlDecode(encoded))) as CrewSessionPayload;
    const username = normalizeCrewUsername(payload.username);
    const employee = String(payload.employee || "").trim();
    const currentMember = crewMemberForUsername(username);
    const issuedAt = new Date(payload.issuedAt).getTime();
    const expiresAt = new Date(payload.expiresAt).getTime();
    if (
      payload.version !== 1
      || payload.purpose !== "crew"
      || !username
      || !employee
      || !currentMember
      || currentMember.employee !== employee
      || !Number.isFinite(issuedAt)
      || !Number.isFinite(expiresAt)
      || issuedAt > now.getTime() + 60_000
      || expiresAt <= now.getTime()
      || expiresAt - issuedAt > CREW_SESSION_MAX_AGE_SECONDS * 1000 + 60_000
    ) return null;
    return { username, employee, passwordChangeRequired: payload.passwordChangeRequired === true, issuedAt: payload.issuedAt, expiresAt: payload.expiresAt };
  } catch {
    return null;
  }
}

export function crewSessionFromCookieHeader(header: string | null | undefined): string {
  const prefix = `${CREW_SESSION_COOKIE}=`;
  return String(header || "").split(";").map((part) => part.trim()).find((part) => part.startsWith(prefix))?.slice(prefix.length) || "";
}

export function crewSessionCookieOptions(request: Request, expiresAt: Date) {
  const forwardedProto = String(request.headers.get("x-forwarded-proto") || "").split(",")[0].trim().toLowerCase();
  const secure = forwardedProto ? forwardedProto === "https" : new URL(request.url).protocol === "https:";
  return { httpOnly: true, sameSite: "lax" as const, secure, path: "/", expires: expiresAt, maxAge: CREW_SESSION_MAX_AGE_SECONDS };
}

export function clearCrewSessionCookieOptions(request: Request) {
  return { ...crewSessionCookieOptions(request, new Date(0)), maxAge: 0 };
}
