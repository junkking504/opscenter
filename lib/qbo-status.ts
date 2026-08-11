import { getQboConfig, qboCurrentConfigSummary } from "@/lib/qbo-config";
import { getQboTokenStoreStatus } from "@/lib/qbo-token-store";

export function getQboSetupStatus() {
  const summary = qboCurrentConfigSummary();
  const config = getQboConfig();
  const tokenStore = getQboTokenStoreStatus();

  return {
    appName: "OpsCenter",
    appPurpose: "Internal operations and financial reporting dashboard for the user's Junk King businesses.",
    distribution: "Private / unlisted internal-use application",
    scopes: config.scopes,
    environment: config.environment,
    ready: config.ready,
    connected: tokenStore.configured,
    missingConfig: config.missing,
    redirectUri: config.redirectUri,
    supportEmail: config.supportEmail,
    expectedCompanyName: config.expectedCompanyName,
    tokenStore,
    urls: summary.urls,
    publicOrigin: summary.publicOrigin,
  };
}
