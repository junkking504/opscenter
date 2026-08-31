import { getPodiumConfig, PODIUM_API_ORIGIN } from "@/lib/podium-config";
import {
  acquirePodiumRefreshLock,
  type PodiumTokenEnvelope,
  readPodiumTokenEnvelope,
  releasePodiumRefreshLock,
  writePodiumTokenEnvelope,
} from "@/lib/podium-token-store";

const REFRESH_EARLY_MS = 5 * 60 * 1000;

type PodiumTokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
};

function jwtExpiry(accessToken: string): number | null {
  try {
    const payload = JSON.parse(Buffer.from(accessToken.split(".")[1] || "", "base64url").toString("utf8")) as { exp?: unknown };
    const seconds = Number(payload.exp);
    return Number.isFinite(seconds) ? seconds * 1000 : null;
  } catch {
    return null;
  }
}

async function tokenRequest(body: Record<string, string>): Promise<PodiumTokenResponse> {
  const config = getPodiumConfig();
  if (!config.ready) throw new Error(`Podium OAuth is missing: ${config.missing.join(", ")}.`);
  const response = await fetch(`${PODIUM_API_ORIGIN}/oauth/token`, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      ...body,
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
  });
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) {
    throw new Error(`Podium OAuth request failed (${response.status}): ${String(payload.message || payload.error || "unknown error")}`);
  }
  return payload as PodiumTokenResponse;
}

function envelopeFromResponse(
  response: PodiumTokenResponse,
  previous?: PodiumTokenEnvelope | null,
): PodiumTokenEnvelope {
  const accessToken = String(response.access_token || "").trim();
  const refreshToken = String(response.refresh_token || previous?.refreshToken || "").trim();
  if (!accessToken || !refreshToken) throw new Error("Podium OAuth response did not contain usable tokens.");
  const now = new Date();
  const responseExpiry = Number(response.expires_in) > 0
    ? now.getTime() + Number(response.expires_in) * 1000
    : null;
  const expiresAt = jwtExpiry(accessToken) || responseExpiry || now.getTime() + 10 * 60 * 60 * 1000;
  return {
    accessToken,
    refreshToken,
    expiresAt: new Date(expiresAt).toISOString(),
    issuedAt: previous?.issuedAt || now.toISOString(),
    updatedAt: now.toISOString(),
    scope: String(response.scope || previous?.scope || "read_reviews read_locations").trim(),
  };
}

export async function exchangePodiumAuthorizationCode(code: string): Promise<PodiumTokenEnvelope> {
  const config = getPodiumConfig();
  const response = await tokenRequest({
    grant_type: "authorization_code",
    code,
    redirect_uri: config.redirectUri,
  });
  const envelope = envelopeFromResponse(response);
  writePodiumTokenEnvelope(envelope);
  return envelope;
}

function tokenIsFresh(envelope: PodiumTokenEnvelope): boolean {
  const expiresAt = new Date(envelope.expiresAt).getTime();
  return Number.isFinite(expiresAt) && expiresAt - Date.now() > REFRESH_EARLY_MS;
}

async function waitForConcurrentRefresh(previousUpdatedAt: string): Promise<PodiumTokenEnvelope> {
  for (let attempt = 0; attempt < 75; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 200));
    const current = readPodiumTokenEnvelope();
    if (current && current.updatedAt !== previousUpdatedAt && tokenIsFresh(current)) return current;
  }
  throw new Error("Timed out waiting for the active Podium token refresh.");
}

export async function getValidPodiumToken(forceRefresh = false): Promise<PodiumTokenEnvelope> {
  const current = readPodiumTokenEnvelope();
  if (!current) throw new Error("Podium is not connected. Complete the one-time OAuth authorization first.");
  if (!forceRefresh && tokenIsFresh(current)) return current;
  if (!acquirePodiumRefreshLock()) return waitForConcurrentRefresh(current.updatedAt);
  try {
    const latest = readPodiumTokenEnvelope() || current;
    if (!forceRefresh && tokenIsFresh(latest)) return latest;
    const response = await tokenRequest({ grant_type: "refresh_token", refresh_token: latest.refreshToken });
    const refreshed = envelopeFromResponse(response, latest);
    writePodiumTokenEnvelope(refreshed);
    return refreshed;
  } finally {
    releasePodiumRefreshLock();
  }
}
