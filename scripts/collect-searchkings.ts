import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type {
  SearchKingsAccount,
  SearchKingsSnapshot,
} from "../lib/searchkings";

const REPORTS_API = "https://reports-api.searchkings.ca";
const DEFAULT_CUSTOMER_ID = "SKC1002034843";
const DEFAULT_TIMEZONE = "America/Chicago";
const LOCK_FILE = path.join(os.tmpdir(), "opscenter-searchkings-refresh.lock");

type FirebaseSignInResponse = {
  idToken?: string;
  email?: string;
  expiresIn?: string;
  localId?: string;
  refreshToken?: string;
  error?: { message?: string };
};

function argument(name: string): string {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? String(process.argv[index + 1] || "").trim() : "";
}

function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function chicagoDateKey(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: DEFAULT_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function isDateKey(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function monthStart(date: string): string {
  return `${date.slice(0, 7)}-01`;
}

function environmentSecret(name: string): string {
  const encoded = String(process.env[`${name}_BASE64`] || "").trim();
  if (encoded) {
    try {
      return Buffer.from(encoded, "base64").toString("utf8");
    } catch {
      return "";
    }
  }
  return String(process.env[name] || "");
}

function keychain(service: string): string {
  try {
    return execFileSync("security", ["find-generic-password", "-w", "-s", service], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 10_000,
    }).trim();
  } catch {
    return "";
  }
}

function firebaseSignInUrl(): string {
  const apiKey = environmentSecret("SEARCHKINGS_FIREBASE_API_KEY").trim()
    || keychain("opsbot-searchkings-firebase-api-key");
  if (!apiKey) {
    throw new Error(
      "SearchKings Firebase API key is unavailable. Configure SEARCHKINGS_FIREBASE_API_KEY or the opsbot-searchkings-firebase-api-key keychain entry.",
    );
  }
  return `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${encodeURIComponent(apiKey)}`;
}

function credentials(): { email: string; password: string } {
  const email = environmentSecret("SEARCHKINGS_EMAIL").trim()
    || environmentSecret("SEARCHKINGS_USERNAME").trim()
    || keychain("opsbot-searchkings-username");
  const password = environmentSecret("SEARCHKINGS_PASSWORD")
    || keychain("opsbot-searchkings-password");
  if (!email || !password) {
    throw new Error(
      "SearchKings credentials are unavailable. Configure SEARCHKINGS_EMAIL and SEARCHKINGS_PASSWORD or the opsbot-searchkings keychain entries.",
    );
  }
  return { email, password };
}

function acquireLock(): number {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return fs.openSync(LOCK_FILE, "wx", 0o600);
    } catch (error) {
      const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
      if (code !== "EEXIST") throw error;
      const age = Date.now() - fs.statSync(LOCK_FILE).mtimeMs;
      if (age < 10 * 60_000 || attempt) throw new Error("Another SearchKings refresh is already running.");
      fs.unlinkSync(LOCK_FILE);
    }
  }
  throw new Error("Unable to reserve the SearchKings refresh lock.");
}

function releaseLock(descriptor: number): void {
  try {
    fs.closeSync(descriptor);
  } catch {}
  try {
    fs.unlinkSync(LOCK_FILE);
  } catch {}
}

async function fetchJson<T>(
  url: string,
  options: RequestInit,
  label: string,
  timeoutMs = 45_000,
): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    const text = await response.text();
    let payload: unknown = null;
    try {
      payload = text ? JSON.parse(text) : null;
    } catch {
      throw new Error(`${label} returned an invalid response (${response.status}).`);
    }
    if (!response.ok) {
      const message = payload && typeof payload === "object"
        ? String((payload as Record<string, any>).message || (payload as Record<string, any>).error?.message || "")
        : "";
      throw new Error(`${label} failed (${response.status})${message ? `: ${message}` : ""}.`);
    }
    return payload as T;
  } finally {
    clearTimeout(timeout);
  }
}

async function signIn(email: string, password: string): Promise<string> {
  const response = await fetchJson<FirebaseSignInResponse>(
    firebaseSignInUrl(),
    {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ email, password, returnSecureToken: true, clientType: "CLIENT_TYPE_WEB" }),
    },
    "SearchKings sign-in",
  );
  if (!response.idToken) throw new Error("SearchKings sign-in did not return an access token.");
  return response.idToken;
}

function queryUrl(pathname: string, query: Record<string, string | undefined>): string {
  const url = new URL(pathname, REPORTS_API);
  for (const [name, value] of Object.entries(query)) {
    if (value !== undefined && value !== "") url.searchParams.set(name, value);
  }
  return url.toString();
}

async function reportsPayload<T>(
  token: string,
  pathname: string,
  query: Record<string, string | undefined>,
  label: string,
): Promise<T> {
  const response = await fetchJson<{ payload?: T; success?: boolean; message?: string }>(
    queryUrl(pathname, query),
    {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${token}`,
        "X-Cachebuster": "true",
      },
    },
    label,
  );
  if (response.payload === undefined) throw new Error(`${label} did not include a payload.`);
  return response.payload;
}

function atomicJson(file: string, payload: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.${Date.now()}.tmp`);
  fs.writeFileSync(temporary, `${JSON.stringify(payload, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  fs.renameSync(temporary, file);
}

function outputDataRoot(): string {
  return path.resolve(
    argument("data-dir")
      || String(process.env.OPSBOT_DATA_DIR || "").trim()
      || path.join(process.env.HOME || "", ".openclaw", "workspace", "opsbot", "data"),
  );
}

function currentSnapshotFresh(file: string, minimumAgeMinutes: number): boolean {
  if (!fs.existsSync(file) || minimumAgeMinutes <= 0) return false;
  return Date.now() - fs.statSync(file).mtimeMs < minimumAgeMinutes * 60_000;
}

async function collect(): Promise<SearchKingsSnapshot | null> {
  const endDate = argument("date") || chicagoDateKey();
  const startDate = argument("start-date") || monthStart(endDate);
  if (!isDateKey(startDate) || !isDateKey(endDate) || startDate > endDate) {
    throw new Error("The SearchKings date range is not valid.");
  }
  const customerId = argument("customer-id")
    || String(process.env.SEARCHKINGS_CUSTOMER_ID || DEFAULT_CUSTOMER_ID).trim();
  if (!/^SKC\d+$/.test(customerId)) throw new Error("The SearchKings customer ID is not valid.");
  const timezone = argument("timezone") || String(process.env.SEARCHKINGS_TIMEZONE || DEFAULT_TIMEZONE).trim();
  const dataRoot = outputDataRoot();
  const currentFile = path.join(dataRoot, "searchkings", "current.json");
  const minimumAgeMinutes = Math.max(0, Number(argument("min-age-minutes") || 15));
  if (!hasFlag("force") && currentSnapshotFresh(currentFile, minimumAgeMinutes)) {
    console.log(JSON.stringify({ status: "skipped", reason: "SearchKings snapshot is still fresh", currentFile }));
    return null;
  }

  const { email, password } = credentials();
  const token = await signIn(email, password);
  const accountSummaries = await reportsPayload<Array<Record<string, any>>>(
    token,
    "/api/v1/accounts",
    { customerId },
    "SearchKings accounts",
  );
  const rangeQuery = {
    start_date: startDate,
    end_date: endDate,
    date_range: "custom",
    tz: timezone,
  };
  const accountResults = await Promise.all(
    accountSummaries.map(async (account) => {
      const type = String(account.type || "").trim();
      const id = String(account.id || "").trim();
      if (!type || !id) return null;
      const payload = await reportsPayload<SearchKingsAccount[]>(
        token,
        `/api/v1/accounts/${encodeURIComponent(type)}/${encodeURIComponent(id)}`,
        rangeQuery,
        `SearchKings metrics for ${String(account.name || id)}`,
      );
      return payload[0] || null;
    }),
  );
  const calls = await reportsPayload<SearchKingsSnapshot["calls"]>(
    token,
    `/api/v1/customers/${encodeURIComponent(customerId)}/calls`,
    rangeQuery,
    "SearchKings calls",
  );
  const snapshot: SearchKingsSnapshot = {
    version: 1,
    source: "searchkings_reports_api",
    fetchedAt: new Date().toISOString(),
    customerId,
    customerName: accountSummaries.find((account) => account?.customer?.name)?.customer?.name,
    range: { startDate, endDate, timezone, label: "Month to date" },
    accounts: accountResults.filter((account): account is SearchKingsAccount => Boolean(account)),
    calls: {
      ...calls,
      callsQuality: Array.isArray(calls?.callsQuality) ? calls.callsQuality : [],
      calls: Array.isArray(calls?.calls) ? calls.calls : [],
    },
  };
  const monthKey = endDate.slice(0, 7);
  const historyFile = path.join(dataRoot, "history", "searchkings", `searchkings_${monthKey}.json`);
  atomicJson(historyFile, snapshot);
  atomicJson(currentFile, snapshot);
  console.log(JSON.stringify({
    status: "ok",
    currentFile,
    historyFile,
    accounts: snapshot.accounts.length,
    calls: snapshot.calls.calls.length,
    startDate,
    endDate,
  }));
  return snapshot;
}

async function main(): Promise<void> {
  const lock = acquireLock();
  try {
    await collect();
  } finally {
    releaseLock(lock);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
