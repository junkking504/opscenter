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
process.env.OPSBOT_DATA_DIR = fixture;
process.env.PODIUM_REVIEW_ASSIGNMENT_STORE = path.join(fixture, "operator", "podium_review_assignments.json");

const configModule = await import("../lib/podium-config");
const tokenModule = await import("../lib/podium-token-store");
const apiModule = await import("../lib/podium-api");
const attributionModule = await import("../lib/podium-review-attribution");
const assignmentModule = await import("../lib/podium-review-assignments");
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
        attributions: [{ reviewInvitationUid: "invite-1", userUid: "user-1" }],
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
  if (url.pathname === "/v4/reviews/invites/invite-1") {
    return Response.json({ data: {
      uid: "invite-1",
      customerName: "Test Customer",
      channel: { identifier: "+1 (504) 555-0123" },
      location: { uid: "loc-1" },
    }, metadata: {} });
  }
  throw new Error(`Unexpected test request: ${url.pathname}`);
};

try {
  const locations = await apiModule.listPodiumLocations();
  assert.equal(locations.length, 1);
  const reviews = await apiModule.listRecentPodiumGoogleReviews(["loc-1"]);
  assert.equal(reviews.length, 1);
  assert.equal(reviews[0]?.needsResponse, true);
  assert.deepEqual(reviews[0]?.reviewInvitationUids, ["invite-1"]);
  const invite = await apiModule.getPodiumReviewInvite("invite-1");
  assert.equal(invite?.channelIdentifier, "+1 (504) 555-0123");
  const summary = await apiModule.getPodiumGoogleSummary("loc-1");
  assert.deepEqual(summary, { averageRating: 4.9, reviewCount: 101 });
} finally {
  globalThis.fetch = originalFetch;
}

const metricsDirectory = path.join(fixture, "processed");
fs.mkdirSync(metricsDirectory, { recursive: true });
fs.writeFileSync(path.join(metricsDirectory, "daily_metrics_2026-08-30.json"), JSON.stringify({
  appointments: [{
    appt_id: "4055001",
    job_id: "JK4067001",
    job_status: "Completed",
    appointment_type: "Job",
    customer_phone: "504-555-0123",
    market: "New Orleans",
    truck: "Truck 1",
    driver_normalized_name: "Driver One",
    navigator_normalized_name: "Navigator Two",
    source_page: "https://junkware.example.test/appointment/4055001",
  }],
}));
const matchAppointment = attributionModule.buildPodiumAppointmentMatcher(fixture);
const matchedAppointment = matchAppointment("2026-08-31T15:00:00Z", {
  uid: "invite-1",
  customerName: "Test Customer",
  channelIdentifier: "+1 (504) 555-0123",
  locationUid: "loc-1",
});
assert.equal(matchedAppointment.status, "matched");
assert.equal(matchedAppointment.appointmentId, "4055001");
assert.deepEqual(matchedAppointment.crew, ["Driver One", "Navigator Two"]);
assert.equal(JSON.stringify(matchedAppointment).includes("5045550123"), false);
const assignmentOptions = assignmentModule.podiumReviewAssignmentOptions("2026-08-01");
assert.equal(assignmentOptions.length, 1);
assert.equal(assignmentOptions[0]?.reference, "4055001");
assert.match(assignmentOptions[0]?.label || "", /JK4067001/);

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
    reviews: [{
      uid: "review-1",
      authorName: "Customer",
      body: "Excellent",
      url: "",
      rating: 5,
      createdAt: "2026-08-31T15:00:00Z",
      updatedAt: "2026-08-31T15:00:00Z",
      needsResponse: true,
      responseCount: 0,
      attribution: { status: "unmatched" as const },
    }],
  }],
};
const unassignedView = reviewsModule.buildPodiumGoogleReviewsViewFromData(current, [previous]);
assert.equal(unassignedView.attributed30Days, 0);
assert.equal(unassignedView.pendingAttribution30Days, 1);
assert.deepEqual(unassignedView.unassigned30Days.map((review) => review.uid), ["review-1"]);
const manualAssignment = assignmentModule.assignPodiumReviewToAppointment({
  reviewUid: "review-1",
  appointmentReference: "JK4067001",
  assignedBy: "manager@junk-king.com",
});
assert.equal(manualAssignment?.attribution.matchMethod, "manual_appointment");
assert.deepEqual(manualAssignment?.attribution.crew, ["Driver One", "Navigator Two"]);
const assignmentStore = fs.readFileSync(process.env.PODIUM_REVIEW_ASSIGNMENT_STORE, "utf8");
assert.equal(/504|customer_phone|channelIdentifier/i.test(assignmentStore), false);
const view = reviewsModule.buildPodiumGoogleReviewsViewFromData(current, [previous]);
assert.equal(view.totalReviewCount, 101);
assert.equal(view.locations[0]?.reviewCountChange, 1);
assert.equal(view.locations[0]?.reviews[0]?.isNew, true);
assert.equal(view.locations[0]?.newToday, 1);
assert.equal(view.locations[0]?.new7Days, 1);
assert.equal(view.locations[0]?.new30Days, 1);
assert.equal(view.newToday, 1);
assert.equal(view.new7Days, 1);
assert.equal(view.new30Days, 1);
assert.equal(view.recentNeedsResponse, 1);
assert.equal(view.attributed30Days, 1);
assert.equal(view.pendingAttribution30Days, 0);
assert.equal(view.unassigned30Days.length, 0);
assert.deepEqual(view.employeeTallies30Days.map((entry) => entry.name), ["Driver One", "Navigator Two"]);
assert.deepEqual(view.teamTallies30Days.map((entry) => entry.name), ["Driver One + Navigator Two"]);

assert.equal(rolesModule.authorizeOpsRequest("operator", "/api/integrations/podium/connect", "GET").allowed, false);
assert.equal(rolesModule.authorizeOpsRequest("admin", "/api/integrations/podium/connect", "GET").allowed, true);
assert.equal(rolesModule.authorizeOpsRequest("operator", "/api/integrations/podium/reviews/attribution", "POST").allowed, false);
assert.equal(rolesModule.authorizeOpsRequest("manager", "/api/integrations/podium/reviews/attribution", "POST").allowed, true);

const runner = fs.readFileSync(path.join(import.meta.dirname, "run-podium-reviews-refresh.sh"), "utf8");
const plist = fs.readFileSync(path.join(import.meta.dirname, "../deploy/macmini/production-launchd/com.openclaw.opsbot.podium-reviews-collector.plist"), "utf8");
const callbackRoute = fs.readFileSync(path.join(import.meta.dirname, "../app/api/integrations/podium/callback/route.ts"), "utf8");
const marketingPage = fs.readFileSync(path.join(import.meta.dirname, "../app/(protected)/marketing/page.tsx"), "utf8");
const assignmentRoute = fs.readFileSync(path.join(import.meta.dirname, "../app/api/integrations/podium/reviews/attribution/route.ts"), "utf8");
const unassignedComponent = fs.readFileSync(path.join(import.meta.dirname, "../components/PodiumUnassignedReviews.tsx"), "utf8");
assert.match(runner, /load-opscenter-secrets\.sh/);
assert.match(plist, /<integer>900<\/integer>/);
assert.match(callbackRoute, /NextResponse\.redirect\(podiumUrl\("\/marketing\?section=reviews&podium=connected"\)\)/);
assert.doesNotMatch(callbackRoute, /NextResponse\.redirect\(new URL\([^\n]+request\.url/);
assert.match(marketingPage, /New Reviews Today/);
assert.match(marketingPage, /ops-kpi-value">\{reviews\.newToday\}/);
assert.match(marketingPage, /PodiumUnassignedReviews/);
assert.match(assignmentRoute, /verifyAuthSessionCookie/);
assert.match(unassignedComponent, /Appointment ID or JK number/);

fs.rmSync(fixture, { recursive: true, force: true });
console.log("Podium Google Reviews checks passed.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
