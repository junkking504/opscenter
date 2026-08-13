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
  return algorithm === "pbkdf2-sha256"
    && Number.isSafeInteger(iterations)
    && iterations >= 100_000
    && Boolean(saltRaw)
    && Boolean(expectedRaw);
}

export async function verifyPasswordHash(passwordValue: unknown, hashValue: unknown): Promise<boolean> {
  const password = String(passwordValue || "");
  const [algorithm, iterationsRaw, saltRaw, expectedRaw] = String(hashValue || "").trim().split("$");
  const iterations = Number.parseInt(iterationsRaw, 10);
  if (!password || algorithm !== "pbkdf2-sha256" || !Number.isSafeInteger(iterations) || iterations < 100_000 || !saltRaw || !expectedRaw) {
    return false;
  }

  try {
    const expected = base64UrlDecode(expectedRaw);
    if (expected.length < 16) return false;
    const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
    const derived = new Uint8Array(await crypto.subtle.deriveBits(
      {
        name: "PBKDF2",
        hash: "SHA-256",
        salt: base64UrlDecode(saltRaw).buffer as ArrayBuffer,
        iterations,
      },
      key,
      expected.length * 8,
    ));
    return constantTimeEqual(derived, expected);
  } catch {
    return false;
  }
}

export async function createPasswordHash(passwordValue: unknown, iterations = 310_000): Promise<string> {
  const password = String(passwordValue || "");
  if (!password) throw new Error("A password is required.");
  if (!Number.isSafeInteger(iterations) || iterations < 100_000) throw new Error("Password hash iterations are too low.");

  const salt = crypto.getRandomValues(new Uint8Array(18));
  const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  const derived = new Uint8Array(await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: salt.buffer as ArrayBuffer, iterations },
    key,
    256,
  ));
  return `pbkdf2-sha256$${iterations}$${base64UrlEncode(salt)}$${base64UrlEncode(derived)}`;
}
