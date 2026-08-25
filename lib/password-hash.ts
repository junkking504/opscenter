const encoder = new TextEncoder();

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

export function validPasswordHash(value: unknown): boolean {
  const [algorithm, iterationsRaw, saltRaw, expectedRaw] = String(value || "").trim().split("$");
  const iterations = Number.parseInt(iterationsRaw, 10);
  return algorithm === "hmac-sha256"
    && iterations === 1
    && Boolean(saltRaw)
    && Boolean(expectedRaw);
}

function passwordPepper(secretOverride?: string): string {
  return String(secretOverride || process.env.OPS_CREW_PASSWORD_PEPPER || process.env.OPS_CREW_SESSION_SECRET || "").trim();
}

async function hmacPasswordDigest(password: string, salt: string, pepper: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(pepper),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return new Uint8Array(await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(`opscenter:crew-password:v1:${salt}:${password}`),
  ));
}

export async function verifyPasswordHash(
  passwordValue: unknown,
  hashValue: unknown,
  secretOverride?: string,
): Promise<boolean> {
  const password = String(passwordValue || "");
  const [algorithm, iterationsRaw, saltRaw, expectedRaw] = String(hashValue || "").trim().split("$");
  const iterations = Number.parseInt(iterationsRaw, 10);
  const pepper = passwordPepper(secretOverride);
  if (!password || algorithm !== "hmac-sha256" || iterations !== 1 || !saltRaw || !expectedRaw || pepper.length < 32) {
    return false;
  }

  try {
    const expected = base64UrlDecode(expectedRaw);
    if (expected.length < 16) return false;
    const derived = await hmacPasswordDigest(password, saltRaw, pepper);
    return constantTimeEqual(derived, expected);
  } catch (error) {
    console.warn("[crew-auth] Password verification could not complete.", {
      error: error instanceof Error ? error.name : "unknown",
    });
    return false;
  }
}

export async function createPasswordHash(
  passwordValue: unknown,
  _iterations = 1,
  secretOverride?: string,
): Promise<string> {
  const password = String(passwordValue || "");
  if (!password) throw new Error("A password is required.");
  const pepper = passwordPepper(secretOverride);
  if (pepper.length < 32) throw new Error("Krewe password hashing is not configured.");

  const salt = crypto.getRandomValues(new Uint8Array(18));
  const saltRaw = base64UrlEncode(salt);
  const derived = await hmacPasswordDigest(password, saltRaw, pepper);
  return `hmac-sha256$1$${saltRaw}$${base64UrlEncode(derived)}`;
}
