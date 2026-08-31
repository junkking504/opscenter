type AccessJwtPayload = {
  aud?: string | string[];
  email?: string;
  exp?: number;
  iat?: number;
  iss?: string;
  nbf?: number;
};

type AccessJwtHeader = {
  alg?: string;
  kid?: string;
};

type CloudflareJwk = JsonWebKey & { kid?: string };

type CloudflareJwks = {
  keys?: CloudflareJwk[];
};

const cachedKeys = new Map<string, { expiresAt: number; keys: CloudflareJwk[] }>();

function normalizeTeamDomain(value: unknown): string {
  return String(value || "").trim().replace(/\/$/, "");
}

function crewTeamDomain(): string {
  return normalizeTeamDomain(process.env.OPS_CREW_ACCESS_TEAM_DOMAIN);
}

function crewAudience(): string {
  return String(process.env.OPS_CREW_ACCESS_AUD || "").trim();
}

function opsTeamDomain(): string {
  return normalizeTeamDomain(
    process.env.OPS_ACCESS_TEAM_DOMAIN || process.env.OPS_CREW_ACCESS_TEAM_DOMAIN,
  );
}

function opsAudience(): string {
  return String(process.env.OPS_ACCESS_AUD || "").trim();
}

function decodeBase64Url(value: string): Uint8Array {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  if (typeof Buffer !== "undefined") return new Uint8Array(Buffer.from(padded, "base64"));
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function decodeJsonPart<T>(value: string): T | null {
  try {
    return JSON.parse(new TextDecoder().decode(decodeBase64Url(value))) as T;
  } catch {
    return null;
  }
}

async function accessKeys(issuer: string): Promise<CloudflareJwk[]> {
  const cached = cachedKeys.get(issuer);
  if (cached && cached.expiresAt > Date.now()) return cached.keys;
  if (!issuer) return [];

  const response = await fetch(`${issuer}/cdn-cgi/access/certs`, {
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) return [];
  const payload = (await response.json()) as CloudflareJwks;
  const keys = Array.isArray(payload.keys) ? payload.keys : [];
  cachedKeys.set(issuer, { expiresAt: Date.now() + 60 * 60 * 1000, keys });
  return keys;
}

function expectedAudience(payload: AccessJwtPayload, expected: string): boolean {
  if (typeof payload.aud === "string") return payload.aud === expected;
  return Array.isArray(payload.aud) && payload.aud.includes(expected);
}

async function verifyJwt(
  token: string | null | undefined,
  expectedIssuer: string,
  expectedAud: string,
): Promise<string | null> {
  const raw = String(token || "").trim();
  if (!raw || !expectedIssuer || !expectedAud) return null;

  const parts = raw.split(".");
  if (parts.length !== 3) return null;
  const header = decodeJsonPart<AccessJwtHeader>(parts[0]);
  const payload = decodeJsonPart<AccessJwtPayload>(parts[1]);
  if (!header || !payload || header.alg !== "RS256" || !header.kid) return null;

  const now = Math.floor(Date.now() / 1000);
  if (payload.iss !== expectedIssuer || !expectedAudience(payload, expectedAud)) return null;
  if (!payload.exp || payload.exp <= now || (payload.nbf && payload.nbf > now + 30)) return null;
  if (!payload.email) return null;

  try {
    const keys = await accessKeys(expectedIssuer);
    const jwk = keys.find((candidate) => candidate.kid === header.kid);
    if (!jwk) {
      cachedKeys.delete(expectedIssuer);
      return null;
    }
    const key = await crypto.subtle.importKey(
      "jwk",
      jwk,
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"],
    );
    const signature = decodeBase64Url(parts[2]);
    const valid = await crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5",
      key,
      signature.buffer as ArrayBuffer,
      new TextEncoder().encode(`${parts[0]}.${parts[1]}`),
    );
    return valid ? String(payload.email).trim().toLocaleLowerCase() : null;
  } catch {
    return null;
  }
}

export async function verifyCloudflareAccessJwt(token: string | null | undefined): Promise<string | null> {
  return verifyJwt(token, crewTeamDomain(), crewAudience());
}

export async function verifyOpsAccessJwt(token: string | null | undefined): Promise<string | null> {
  return verifyJwt(token, opsTeamDomain(), opsAudience());
}

export function crewAccessConfigured(): boolean {
  return Boolean(crewTeamDomain() && crewAudience());
}

export function opsAccessConfigured(): boolean {
  return Boolean(opsTeamDomain() && opsAudience());
}

export function opsAccessLoginUrl(redirectUrl: URL | string): URL | null {
  const domain = opsTeamDomain();
  const audience = opsAudience();
  if (!domain || !audience) return null;

  const redirect = typeof redirectUrl === "string" ? new URL(redirectUrl) : redirectUrl;
  const login = new URL(`/cdn-cgi/access/login/${redirect.hostname}`, domain);
  login.searchParams.set("kid", audience);
  login.searchParams.set("redirect_url", `${redirect.pathname}${redirect.search}`);
  return login;
}
