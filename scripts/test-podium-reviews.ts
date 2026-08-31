import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

async function main() {
const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "opscenter-podium-reviews-"));
process.env.PODIUM_TOKEN_STORE_DIR = path.join(fixture, "tokens");
process.env.PODIUM_TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 9).toString("base64");
process.env.PODIUM_CLIENT_ID = "test-client";
process.env.PODIUM_CLIENT_SECRET = "test-secret";

const configModule = await import("../lib/podium-config");
const tokenModule = await import("../lib/podium-token-store");
const apiModule = await import("../lib/podium-api");
const reviewsModule = await import("../lib/podium-reviews");
const rolesModule = await import("../lib/ops-roles");

const config = configModule.getPodiumConfig();
assert.equal(config.ready, true);
assert.deepEqual(config.scopes, ["read_reviews", "read_locations"]);
assert.equal(config.redirectUri, "https://ops.junk-king.app/api/integrations/podium/callback");
const connectUrl = new URL(configModule.buildPodiumConnectUrl(config, "state-123"));
assert.equal(connectUrl.origin, "https://api.podium.com");
assert.equal(connectUrl.searchParams.get("scope"), "read_reviews read_locations");
assert.equal(connectUrl.searchParams.get("state"), "state-123");

const envelope = {
  accessToken: "access-token-value",
  refreshToken: "refresh-token-value",
  expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
  issuedAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  scope: "read_reviews read_locations",
};
tokenModule.writePodiumTokenEnvelope(envelope);
assert.deepEqual(tokenModule.readPodiumTokenEnvelope(), envelope);
const encrypted = fs.readFileSync(tokenModule.PODIUM_TOKEN_STORE_FILE, "utf8");
assert.equal(encrypted.includes(envelope.accessToken), false);
assert.equal(encrypted.includes(envelope.refreshToken), false);
assert.equal(fs.statSync(tokenModule.PODIUM_TOKEN_STORE_FILE).mode & 0o777, 0o600);

const originalFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = new URL(String(input));
  assert.equal(new Headers(init?.headers).get("Authorization"), `Bearer ${envelope.accessToken}`);
  assert.equal(new Headers(init?.headers).get("podium-version"), "2021.04.01");
  if (url.pathname === "/v4/locations") {
    return Response.json({ data: [{ uid: "loc-1", displayName: "New Orleans", address: "123 Test St", archived: false }], metadata: {} });
  }
  if (url.pathname === "/v4/reviews") {
    return Response.json({ data: [
      {
        uid: "review-1",
        author: { name: "Google Customer" },
        review: { body: "Excellent service", url: "https://example.test/review-1", rating: 5, siteName: "Google" },
        createdAt: "2026-08-31T15:00:00Z",
        updatedAt: "2026-08-31T15:00:00Z",
        locations: [{ uid: "loc-1" }],
        responses: [],
        needsResponse: true,
      },
      {
        uid: "review-2",
        author: { name: "Other Customer" },
        review: { body: "Other site", rating: 5, siteName: "Facebook" },
        createdAt: "2026-08-31T14:00:00Z",
        locations: [{ uid: "loc-1" }],
      },
    ], metadata: {} });
  }
  if (url.pathname === "/v4/reviews/sites/summary") {
    assert.deepEqual(url.searchParams.getAll("locationUids[]"), ["loc-1"]);
    return Response.json({ data: [{ siteName: "google", averageRating: 4.9, reviewCount: 101 }], metadata: {} });
  }
  throw new Error(`Unexpected test request: ${url.pathname}`);
};

try {
  const locations = await apiModule.listPodiumLocations();
  assert.equal(locations.length, 1);
  const reviews = await apiModule.listRecentPodiumGoogleReviews(["loc-1"]);
  assert.equal(reviews.length, 1);
  assert.equal(reviews[0]?.needsResponse, true);
  const summary = await apiModule.getPodiumGoogleSummary("loc-1");
  assert.deepEqual(summary, { averageRating: 4.9, reviewCount: 101 });
} finally {
  globalThis.fetch = originalFetch;
}

const previous = {
  version: 1 as const,
  source: "podium_api" as const,
  fetchedAt: "2026-08-30T16:00:00Z",
  locations: [{ uid: "loc-1", name: "New Orleans", address: "123 Test St", averageRating: 4.8, reviewCount: 100, reviews: [] }],
};
const current = {
  version: 1 as const,
  source: "podium_api" as const,
  fetchedAt: "2026-08-31T16:00:00Z",
  locations: [{
    uid: "loc-1",
    name: "New Orleans",
    address: "123 Test St",
    averageRating: 4.9,
    reviewCount: 101,
    reviews: [{ uid: "review-1", authorName: "Customer", body: "Excellent", url: "", rating: 5, createdAt: "2026-08-31T15:00:00Z", updatedAt: "2026-08-31T15:00:00Z", needsResponse: true, responseCount: 0 }],
  }],
};
const view = reviewsModule.buildPodiumGoogleReviewsViewFromData(current, [previous]);
assert.equal(view.totalReviewCount, 101);
assert.equal(view.locations[0]?.reviewCountChange, 1);
assert.equal(view.locations[0]?.reviews[0]?.isNew, true);
assert.equal(view.recentNeedsResponse, 1);

assert.equal(rolesModule.authorizeOpsRequest("operator", "/api/integrations/podium/connect", "GET").allowed, false);
assert.equal(rolesModule.authorizeOpsRequest("admin", "/api/integrations/podium/connect", "GET").allowed, true);

const runner = fs.readFileSync(path.join(import.meta.dirname, "run-podium-reviews-refresh.sh"), "utf8");
const plist = fs.readFileSync(path.join(import.meta.dirname, "../deploy/macmini/production-launchd/com.openclaw.opsbot.podium-reviews-collector.plist"), "utf8");
const callbackRoute = fs.readFileSync(path.join(import.meta.dirname, "../app/api/integrations/podium/callback/route.ts"), "utf8");
assert.match(runner, /load-opscenter-secrets\.sh/);
assert.match(plist, /<integer>900<\/integer>/);
assert.match(callbackRoute, /NextResponse\.redirect\(podiumUrl\("\/marketing\?section=reviews&podium=connected"\)\)/);
assert.doesNotMatch(callbackRoute, /NextResponse\.redirect\(new URL\([^\n]+request\.url/);

fs.rmSync(fixture, { recursive: true, force: true });
console.log("Podium Google Reviews checks passed.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
