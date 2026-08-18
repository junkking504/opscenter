import assert from "node:assert/strict";
import { buildGoogleBusinessProfileConnectUrl, getGoogleBusinessProfileConfig } from "../lib/google-business-profile";

const original = {
  clientId: process.env.GOOGLE_BUSINESS_PROFILE_CLIENT_ID,
  clientSecret: process.env.GOOGLE_BUSINESS_PROFILE_CLIENT_SECRET,
  encryptionKey: process.env.GOOGLE_BUSINESS_PROFILE_TOKEN_ENCRYPTION_KEY,
  redirectUri: process.env.GOOGLE_BUSINESS_PROFILE_REDIRECT_URI,
};

delete process.env.GOOGLE_BUSINESS_PROFILE_CLIENT_ID;
delete process.env.GOOGLE_BUSINESS_PROFILE_CLIENT_SECRET;
delete process.env.GOOGLE_BUSINESS_PROFILE_TOKEN_ENCRYPTION_KEY;
delete process.env.GOOGLE_BUSINESS_PROFILE_REDIRECT_URI;

assert.deepEqual(getGoogleBusinessProfileConfig().missing, [
  "GOOGLE_BUSINESS_PROFILE_CLIENT_ID",
  "GOOGLE_BUSINESS_PROFILE_CLIENT_SECRET",
  "GOOGLE_BUSINESS_PROFILE_TOKEN_ENCRYPTION_KEY",
]);

process.env.GOOGLE_BUSINESS_PROFILE_CLIENT_ID = "client-id.apps.googleusercontent.com";
process.env.GOOGLE_BUSINESS_PROFILE_CLIENT_SECRET = "client-secret";
process.env.GOOGLE_BUSINESS_PROFILE_TOKEN_ENCRYPTION_KEY = "a".repeat(64);
const config = getGoogleBusinessProfileConfig();
assert.equal(config.ready, true);
assert.equal(config.redirectUri, "https://ops.junk-king.app/api/integrations/google-business/callback");
const authorizationUrl = new URL(buildGoogleBusinessProfileConnectUrl("state-value"));
assert.equal(authorizationUrl.origin, "https://accounts.google.com");
assert.equal(authorizationUrl.searchParams.get("scope"), "https://www.googleapis.com/auth/business.manage");
assert.equal(authorizationUrl.searchParams.get("access_type"), "offline");
assert.equal(authorizationUrl.searchParams.get("redirect_uri"), config.redirectUri);

for (const [key, value] of Object.entries(original)) {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

console.log("Google Business Profile OAuth configuration checks passed.");
