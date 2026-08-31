import { PODIUM_TOKEN_STORE_DIR } from "@/lib/podium-token-store";

export const PODIUM_PUBLIC_ORIGIN = "https://ops.junk-king.app";
export const PODIUM_API_ORIGIN = "https://api.podium.com";
export const PODIUM_API_VERSION = "2021.04.01";
export const PODIUM_SCOPES = ["read_reviews", "read_locations"] as const;
export const PODIUM_STATE_COOKIE = "opscenter_podium_oauth_state";
export const PODIUM_ROUTE_PATHS = {
  callbackApi: "/api/integrations/podium/callback",
  connectApi: "/api/integrations/podium/connect",
  statusApi: "/api/integrations/podium/status",
} as const;

export type PodiumConfig = {
  ready: boolean;
  missing: string[];
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  encryptionKey: string;
  scopes: readonly string[];
  tokenStoreDir: string;
};

export function podiumUrl(path: string): string {
  return new URL(path, PODIUM_PUBLIC_ORIGIN).toString();
}

export function getPodiumConfig(): PodiumConfig {
  const clientId = String(process.env.PODIUM_CLIENT_ID || "").trim();
  const clientSecret = String(process.env.PODIUM_CLIENT_SECRET || "").trim();
  const encryptionKey = String(process.env.PODIUM_TOKEN_ENCRYPTION_KEY || "").trim();
  const redirectUri = String(
    process.env.PODIUM_REDIRECT_URI || podiumUrl(PODIUM_ROUTE_PATHS.callbackApi),
  ).trim();
  const missing = [
    clientId ? "" : "PODIUM_CLIENT_ID",
    clientSecret ? "" : "PODIUM_CLIENT_SECRET",
    encryptionKey ? "" : "PODIUM_TOKEN_ENCRYPTION_KEY",
  ].filter(Boolean);

  return {
    ready: missing.length === 0,
    missing,
    clientId,
    clientSecret,
    redirectUri,
    encryptionKey,
    scopes: PODIUM_SCOPES,
    tokenStoreDir: PODIUM_TOKEN_STORE_DIR,
  };
}

export function buildPodiumConnectUrl(config: PodiumConfig, state: string): string {
  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    scope: config.scopes.join(" "),
    state,
  });
  return `${PODIUM_API_ORIGIN}/oauth/authorize?${params.toString()}`;
}
