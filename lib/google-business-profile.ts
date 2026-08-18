import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const GOOGLE_BUSINESS_PROFILE_SCOPE = "https://www.googleapis.com/auth/business.manage";
export const GOOGLE_BUSINESS_PROFILE_STATE_COOKIE = "opscenter_google_business_profile_oauth_state";
export const GOOGLE_BUSINESS_PROFILE_CALLBACK_PATH = "/api/integrations/google-business/callback";
export const GOOGLE_BUSINESS_PROFILE_CONNECT_PATH = "/api/integrations/google-business/connect";
export const GOOGLE_BUSINESS_PROFILE_STATUS_PATH = "/api/integrations/google-business/status";
const PUBLIC_ORIGIN = "https://ops.junk-king.app";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const STORE_DIRECTORY = String(process.env.GOOGLE_BUSINESS_PROFILE_TOKEN_STORE_DIR || path.join(os.homedir(), "Library", "Application Support", "OpsCenter", "google-business-profile")).trim();
const STORE_FILE = path.join(STORE_DIRECTORY, "tokens.json");
const REFRESH_EARLY_MS = 5 * 60 * 1000;

type EncryptedRecord = { version: 1; algorithm: "aes-256-gcm"; iv: string; authTag: string; ciphertext: string };
export type GoogleBusinessProfileToken = { accessToken: string; refreshToken: string; expiresAt: string; issuedAt: string; updatedAt: string; scope: string };
export type GoogleBusinessProfileConfig = { ready: boolean; missing: string[]; clientId: string; clientSecret: string; redirectUri: string; encryptionKey: string };

export function getGoogleBusinessProfileConfig(): GoogleBusinessProfileConfig {
  const clientId = String(process.env.GOOGLE_BUSINESS_PROFILE_CLIENT_ID || "").trim();
  const clientSecret = String(process.env.GOOGLE_BUSINESS_PROFILE_CLIENT_SECRET || "").trim();
  const redirectUri = String(process.env.GOOGLE_BUSINESS_PROFILE_REDIRECT_URI || new URL(GOOGLE_BUSINESS_PROFILE_CALLBACK_PATH, PUBLIC_ORIGIN)).trim();
  const encryptionKey = String(process.env.GOOGLE_BUSINESS_PROFILE_TOKEN_ENCRYPTION_KEY || "").trim();
  const missing = [clientId ? "" : "GOOGLE_BUSINESS_PROFILE_CLIENT_ID", clientSecret ? "" : "GOOGLE_BUSINESS_PROFILE_CLIENT_SECRET", encryptionKey ? "" : "GOOGLE_BUSINESS_PROFILE_TOKEN_ENCRYPTION_KEY"].filter(Boolean);
  return { ready: missing.length === 0, missing, clientId, clientSecret, redirectUri, encryptionKey };
}

function key(): Buffer {
  const raw = getGoogleBusinessProfileConfig().encryptionKey;
  const value = /^[0-9a-f]{64}$/i.test(raw) ? Buffer.from(raw, "hex") : Buffer.from(raw, "base64");
  if (value.length !== 32) throw new Error("GOOGLE_BUSINESS_PROFILE_TOKEN_ENCRYPTION_KEY must be 32 bytes encoded as base64 or 64 hexadecimal characters.");
  return value;
}

function encrypt(value: GoogleBusinessProfileToken): EncryptedRecord {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key(), iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return { version: 1, algorithm: "aes-256-gcm", iv: iv.toString("base64"), authTag: cipher.getAuthTag().toString("base64"), ciphertext: ciphertext.toString("base64") };
}

function decrypt(value: string): GoogleBusinessProfileToken {
  const record = JSON.parse(value) as Partial<EncryptedRecord>;
  if (record.version !== 1 || record.algorithm !== "aes-256-gcm" || !record.iv || !record.authTag || !record.ciphertext) throw new Error("Google Business Profile token store is not a supported encrypted record.");
  const cipher = crypto.createDecipheriv("aes-256-gcm", key(), Buffer.from(record.iv, "base64"));
  cipher.setAuthTag(Buffer.from(record.authTag, "base64"));
  const token = JSON.parse(Buffer.concat([cipher.update(Buffer.from(record.ciphertext, "base64")), cipher.final()]).toString("utf8")) as Partial<GoogleBusinessProfileToken>;
  if (!token.accessToken || !token.refreshToken || !token.expiresAt) throw new Error("Google Business Profile token store is incomplete.");
  return token as GoogleBusinessProfileToken;
}

export function readGoogleBusinessProfileToken(): GoogleBusinessProfileToken | null {
  try { return fs.existsSync(STORE_FILE) ? decrypt(fs.readFileSync(STORE_FILE, "utf8")) : null; } catch (error) { throw error; }
}

function writeToken(value: GoogleBusinessProfileToken): void {
  fs.mkdirSync(STORE_DIRECTORY, { recursive: true, mode: 0o700 });
  fs.chmodSync(STORE_DIRECTORY, 0o700);
  const temporary = `${STORE_FILE}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(encrypt(value), null, 2)}\n`, { mode: 0o600 });
  fs.chmodSync(temporary, 0o600);
  fs.renameSync(temporary, STORE_FILE);
  fs.chmodSync(STORE_FILE, 0o600);
}

function fresh(value: GoogleBusinessProfileToken): boolean { return new Date(value.expiresAt).getTime() - Date.now() > REFRESH_EARLY_MS; }

async function requestToken(parameters: URLSearchParams): Promise<Record<string, unknown>> {
  const config = getGoogleBusinessProfileConfig();
  const response = await fetch(TOKEN_ENDPOINT, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: parameters, cache: "no-store" });
  const body = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) throw new Error(`Google OAuth error ${String(body.error || response.status)}: ${String(body.error_description || "token request failed")}`);
  if (!config.ready) throw new Error("Google Business Profile OAuth is not configured.");
  return body;
}

function tokenFromResponse(response: Record<string, unknown>, previous?: GoogleBusinessProfileToken): GoogleBusinessProfileToken {
  const accessToken = String(response.access_token || "").trim();
  const refreshToken = String(response.refresh_token || previous?.refreshToken || "").trim();
  if (!accessToken || !refreshToken) throw new Error("Google OAuth response did not contain usable access and refresh tokens.");
  const now = new Date();
  return { accessToken, refreshToken, expiresAt: new Date(now.getTime() + Number(response.expires_in || 3600) * 1000).toISOString(), issuedAt: previous?.issuedAt || now.toISOString(), updatedAt: now.toISOString(), scope: String(response.scope || previous?.scope || GOOGLE_BUSINESS_PROFILE_SCOPE).trim() };
}

export function buildGoogleBusinessProfileConnectUrl(state: string): string {
  const config = getGoogleBusinessProfileConfig();
  const query = new URLSearchParams({ client_id: config.clientId, redirect_uri: config.redirectUri, response_type: "code", scope: GOOGLE_BUSINESS_PROFILE_SCOPE, state, access_type: "offline", prompt: "consent" });
  return `https://accounts.google.com/o/oauth2/v2/auth?${query.toString()}`;
}

export async function exchangeGoogleBusinessProfileAuthorizationCode(code: string): Promise<GoogleBusinessProfileToken> {
  const config = getGoogleBusinessProfileConfig();
  if (!config.ready) throw new Error("Google Business Profile OAuth is not configured.");
  const response = await requestToken(new URLSearchParams({ code, client_id: config.clientId, client_secret: config.clientSecret, redirect_uri: config.redirectUri, grant_type: "authorization_code" }));
  const token = tokenFromResponse(response);
  writeToken(token);
  return token;
}

export async function getValidGoogleBusinessProfileToken(): Promise<GoogleBusinessProfileToken> {
  const current = readGoogleBusinessProfileToken();
  if (!current) throw new Error("Google Business Profile is not connected. Complete the one-time OAuth authorization first.");
  if (fresh(current)) return current;
  const config = getGoogleBusinessProfileConfig();
  if (!config.ready) throw new Error("Google Business Profile OAuth is not configured.");
  const response = await requestToken(new URLSearchParams({ refresh_token: current.refreshToken, client_id: config.clientId, client_secret: config.clientSecret, grant_type: "refresh_token" }));
  const token = tokenFromResponse(response, current);
  writeToken(token);
  return token;
}

export function googleBusinessProfileStatus() {
  const config = getGoogleBusinessProfileConfig();
  let connected = false;
  let tokenError: string | null = null;
  try { connected = Boolean(readGoogleBusinessProfileToken()); } catch (error) { tokenError = error instanceof Error ? error.message : "Token store could not be read."; }
  return { ready: config.ready, connected, missingConfig: config.missing, redirectUri: config.redirectUri, scope: GOOGLE_BUSINESS_PROFILE_SCOPE, tokenStore: { file: STORE_FILE, encrypted: fs.existsSync(STORE_FILE), tokenError } };
}
