import { QBO_TOKEN_STORE_DIR } from "@/lib/qbo-token-store";

export const QBO_PUBLIC_ORIGIN = "https://ops.junk-king.app";
export const QBO_ROUTE_PATHS = {
  connectPage: "/integrations/qbo",
  statusPage: "/integrations/qbo/status",
  disconnectedPage: "/integrations/qbo/disconnected",
  privacyPage: "/legal/privacy",
  termsPage: "/legal/terms",
  supportPage: "/support",
  callbackApi: "/api/integrations/qbo/callback",
  connectApi: "/api/integrations/qbo/connect",
  disconnectApi: "/api/integrations/qbo/disconnect",
  statusApi: "/api/integrations/qbo/status",
} as const;

export const QBO_ACCOUNTING_SCOPE = "com.intuit.quickbooks.accounting";
export const QBO_SCOPES = [QBO_ACCOUNTING_SCOPE] as const;
export const QBO_STATE_COOKIE = "opscenter_qbo_oauth_state";

export type IntuitEnvironment = "sandbox" | "production";

export type QboConfig = {
  ready: boolean;
  missing: string[];
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  environment: IntuitEnvironment;
  supportEmail: string | null;
  expectedCompanyName: string | null;
  tokenStoreDir: string;
  encryptionKey: string;
  scopes: readonly string[];
};

function normalizeEnvironment(value: string | undefined): IntuitEnvironment {
  return String(value || "").toLowerCase() === "sandbox" ? "sandbox" : "production";
}

export function qboUrl(path: string): string {
  return new URL(path, QBO_PUBLIC_ORIGIN).toString();
}

export function getQboConfig(): QboConfig {
  const clientId = String(process.env.INTUIT_CLIENT_ID || "").trim();
  const clientSecret = String(process.env.INTUIT_CLIENT_SECRET || "").trim();
  const redirectUri = String(process.env.INTUIT_REDIRECT_URI || qboUrl(QBO_ROUTE_PATHS.callbackApi)).trim();
  const environment = normalizeEnvironment(process.env.INTUIT_ENVIRONMENT);
  const supportEmail = String(process.env.QBO_SUPPORT_EMAIL || "").trim() || null;
  const expectedCompanyName = String(process.env.QBO_EXPECTED_COMPANY_NAME || "").trim() || null;
  const encryptionKey = String(process.env.QBO_TOKEN_ENCRYPTION_KEY || "").trim();
  const missing = [
    clientId ? "" : "INTUIT_CLIENT_ID",
    clientSecret ? "" : "INTUIT_CLIENT_SECRET",
    redirectUri ? "" : "INTUIT_REDIRECT_URI",
    encryptionKey ? "" : "QBO_TOKEN_ENCRYPTION_KEY",
  ].filter(Boolean);

  return {
    ready: missing.length === 0,
    missing,
    clientId,
    clientSecret,
    redirectUri,
    environment,
    supportEmail,
    expectedCompanyName,
    tokenStoreDir: QBO_TOKEN_STORE_DIR,
    encryptionKey,
    scopes: QBO_SCOPES,
  };
}

export function intuitAuthBaseUrl(_environment: IntuitEnvironment): string {
  return "https://appcenter.intuit.com/connect/oauth2";
}

export function buildIntuitConnectUrl(config: QboConfig, state: string): string {
  const params = new URLSearchParams({
    client_id: config.clientId,
    scope: config.scopes.join(" "),
    redirect_uri: config.redirectUri,
    response_type: "code",
    state,
  });
  return `${intuitAuthBaseUrl(config.environment)}?${params.toString()}`;
}

export function qboCurrentConfigSummary() {
  const config = getQboConfig();
  return {
    publicOrigin: QBO_PUBLIC_ORIGIN,
    urls: {
      connectPage: qboUrl(QBO_ROUTE_PATHS.connectPage),
      statusPage: qboUrl(QBO_ROUTE_PATHS.statusPage),
      disconnectedPage: qboUrl(QBO_ROUTE_PATHS.disconnectedPage),
      privacyPage: qboUrl(QBO_ROUTE_PATHS.privacyPage),
      termsPage: qboUrl(QBO_ROUTE_PATHS.termsPage),
      supportPage: qboUrl(QBO_ROUTE_PATHS.supportPage),
      connectApi: qboUrl(QBO_ROUTE_PATHS.connectApi),
      disconnectApi: qboUrl(QBO_ROUTE_PATHS.disconnectApi),
      statusApi: qboUrl(QBO_ROUTE_PATHS.statusApi),
      callbackApi: qboUrl(QBO_ROUTE_PATHS.callbackApi),
    },
    environment: config.environment,
    scopes: config.scopes,
    ready: config.ready,
    missing: config.missing,
    redirectUri: config.redirectUri,
    supportEmail: config.supportEmail,
    expectedCompanyName: config.expectedCompanyName,
    tokenStoreDir: config.tokenStoreDir,
  };
}
