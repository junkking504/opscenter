import { getQboConfig } from "@/lib/qbo-config";
import {
  acquireQboRefreshLock,
  QboTokenEnvelope,
  readQboTokenEnvelope,
  releaseQboRefreshLock,
  writeQboTokenEnvelope,
} from "@/lib/qbo-token-store";

const TOKEN_ENDPOINT = "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer";
const REVOCATION_ENDPOINT = "https://developer.api.intuit.com/v2/oauth2/tokens/revoke";
const REFRESH_EARLY_MS = 5 * 60 * 1000;

type IntuitTokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  x_refresh_token_expires_in?: number;
  scope?: string;
  token_type?: string;
};

function basicAuthorization(): string {
  const config = getQboConfig();
  if (!config.clientId || !config.clientSecret) {
    throw new Error("Intuit client credentials are not configured.");
  }
  return `Basic ${Buffer.from(`${config.clientId}:${config.clientSecret}`, "utf8").toString("base64")}`;
}

async function tokenRequest(parameters: URLSearchParams): Promise<IntuitTokenResponse> {
  const response = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: {
      Accept: "application/json",
      Authorization: basicAuthorization(),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: parameters,
    cache: "no-store",
  });
  const body = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) {
    const code = String(body.error || response.status);
    const description = String(body.error_description || "Intuit token request failed.");
    throw new Error(`Intuit OAuth error ${code}: ${description}`);
  }
  return body as IntuitTokenResponse;
}

function envelopeFromResponse(
  response: IntuitTokenResponse,
  realmId: string,
  previous?: QboTokenEnvelope | null,
): QboTokenEnvelope {
  const accessToken = String(response.access_token || "").trim();
  const refreshToken = String(response.refresh_token || previous?.refreshToken || "").trim();
  if (!accessToken || !refreshToken) {
    throw new Error("Intuit OAuth response did not contain usable access and refresh tokens.");
  }
  const now = new Date();
  const accessSeconds = Number(response.expires_in || 3600);
  const refreshSeconds = Number(response.x_refresh_token_expires_in || 0);
  return {
    realmId,
    accessToken,
    refreshToken,
    expiresAt: new Date(now.getTime() + accessSeconds * 1000).toISOString(),
    refreshExpiresAt: refreshSeconds > 0
      ? new Date(now.getTime() + refreshSeconds * 1000).toISOString()
      : previous?.refreshExpiresAt || null,
    issuedAt: previous?.issuedAt || now.toISOString(),
    updatedAt: now.toISOString(),
    scope: String(response.scope || previous?.scope || "").trim(),
  };
}

export async function exchangeQboAuthorizationCode(code: string, realmId: string): Promise<QboTokenEnvelope> {
  const config = getQboConfig();
  const response = await tokenRequest(new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: config.redirectUri,
  }));
  const envelope = envelopeFromResponse(response, realmId);
  writeQboTokenEnvelope(envelope);
  return envelope;
}

function tokenIsFresh(envelope: QboTokenEnvelope): boolean {
  const expiresAt = new Date(envelope.expiresAt).getTime();
  return Number.isFinite(expiresAt) && expiresAt - Date.now() > REFRESH_EARLY_MS;
}

async function waitForConcurrentRefresh(previousUpdatedAt: string): Promise<QboTokenEnvelope> {
  for (let attempt = 0; attempt < 75; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 200));
    const current = readQboTokenEnvelope();
    if (current && current.updatedAt !== previousUpdatedAt && tokenIsFresh(current)) {
      return current;
    }
  }
  throw new Error("Timed out waiting for the active QBO token refresh.");
}

export async function getValidQboTokenEnvelope(forceRefresh = false): Promise<QboTokenEnvelope> {
  const current = readQboTokenEnvelope();
  if (!current) {
    throw new Error("QuickBooks is not connected. Complete the one-time OAuth authorization first.");
  }
  if (!forceRefresh && tokenIsFresh(current)) return current;

  if (!acquireQboRefreshLock()) {
    return waitForConcurrentRefresh(current.updatedAt);
  }

  try {
    const latest = readQboTokenEnvelope() || current;
    if (!forceRefresh && tokenIsFresh(latest)) return latest;
    const response = await tokenRequest(new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: latest.refreshToken,
    }));
    const refreshed = envelopeFromResponse(response, latest.realmId, latest);
    writeQboTokenEnvelope(refreshed);
    return refreshed;
  } finally {
    releaseQboRefreshLock();
  }
}

export async function revokeQboToken(envelope: QboTokenEnvelope): Promise<void> {
  const response = await fetch(REVOCATION_ENDPOINT, {
    method: "POST",
    headers: {
      Accept: "application/json",
      Authorization: basicAuthorization(),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ token: envelope.refreshToken }),
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error(`Intuit token revocation failed with HTTP ${response.status}.`);
  }
}
