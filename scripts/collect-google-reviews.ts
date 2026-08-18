import fs from "node:fs";
import path from "node:path";
import { chicagoDateKey } from "../lib/report-dates";
import { googleReviewsLocations, type GoogleReview, type GoogleReviewsLocation, type GoogleReviewsSnapshot } from "../lib/google-reviews";
import { getGoogleBusinessProfileConfig, getValidGoogleBusinessProfileToken } from "../lib/google-business-profile";

function argument(name: string): string {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? String(process.argv[index + 1] || "").trim() : "";
}

function dataDirectory(): string {
  const requested = argument("data-dir") || String(process.env.OPSBOT_DATA_DIR || "").trim();
  return requested || path.join(process.env.HOME || "", ".openclaw", "workspace", "opsbot", "data");
}

function required(name: string, value: string): string {
  if (value) return value;
  throw new Error(`${name} is required. Configure it in the protected OpsCenter environment.`);
}

function text(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (value && typeof value === "object" && "text" in value) return String((value as { text?: unknown }).text || "").trim();
  return "";
}

function numberOrNull(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function review(value: Record<string, unknown>): GoogleReview {
  const author = value.authorAttribution as Record<string, unknown> | undefined;
  return {
    name: String(value.name || "").trim(),
    authorName: String(author?.displayName || "Anonymous Google user").trim(),
    authorUri: String(author?.uri || "").trim(),
    rating: numberOrNull(value.rating) || 0,
    text: text(value.text),
    publishTime: String(value.publishTime || "").trim(),
    relativePublishTimeDescription: String(value.relativePublishTimeDescription || "").trim(),
    googleMapsUri: String(value.googleMapsUri || "").trim(),
  };
}

function businessProfileReview(value: Record<string, unknown>): GoogleReview {
  const reviewer = value.reviewer as Record<string, unknown> | undefined;
  const rating = String(value.starRating || "").toUpperCase();
  const numericRating = ({ ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5 } as Record<string, number>)[rating] || 0;
  const timestamp = String(value.updateTime || value.createTime || "").trim();
  return {
    name: String(value.reviewId || value.name || "").trim(),
    authorName: String(reviewer?.displayName || "Anonymous Google user").trim(),
    authorUri: "",
    rating: numericRating,
    text: String(value.comment || "").trim(),
    publishTime: timestamp,
    relativePublishTimeDescription: "",
    googleMapsUri: "",
  };
}

function writeJson(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o750 });
  const temporary = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.${Date.now()}.tmp`);
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o640 });
  fs.chmodSync(temporary, 0o640);
  fs.renameSync(temporary, file);
}

async function collectLocation(location: GoogleReviewsLocation, apiKey: string, root: string): Promise<GoogleReviewsSnapshot> {
  const placeId = location.placeId;
  const response = await fetch(`https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}`, {
    headers: {
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": "id,displayName,rating,userRatingCount,googleMapsUri,reviews",
    },
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`Google Places request failed (${response.status}): ${(await response.text()).slice(0, 500)}`);
  const payload = await response.json() as Record<string, unknown>;
  const fetchedAt = new Date().toISOString();
  const snapshot: GoogleReviewsSnapshot = {
    version: 1,
    source: "google_places_api",
    fetchedAt,
    placeId,
    placeName: text(payload.displayName) || "Google Business Profile",
    locationKey: location.key,
    locationLabel: location.label,
    rating: numberOrNull(payload.rating),
    userRatingCount: numberOrNull(payload.userRatingCount),
    googleMapsUri: String(payload.googleMapsUri || "").trim(),
    reviews: Array.isArray(payload.reviews) ? payload.reviews.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object")).map(review) : [],
  };
  writeJson(path.join(root, "google-reviews", location.key, "current.json"), snapshot);
  writeJson(path.join(root, "history", "google-reviews", location.key, `google-reviews_${chicagoDateKey()}.json`), snapshot);
  return snapshot;
}

async function googleRequest(url: string, token: string): Promise<Record<string, unknown>> {
  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store", signal: AbortSignal.timeout(20_000) });
  const body = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) throw new Error(`Google Business Profile request failed (${response.status}): ${JSON.stringify(body).slice(0, 500)}`);
  return body;
}

async function collectBusinessProfileLocations(locations: GoogleReviewsLocation[], root: string): Promise<GoogleReviewsSnapshot[]> {
  const token = await getValidGoogleBusinessProfileToken();
  const accountsPayload = await googleRequest("https://mybusinessaccountmanagement.googleapis.com/v1/accounts", token.accessToken);
  const accounts = Array.isArray(accountsPayload.accounts) ? accountsPayload.accounts.filter((value): value is Record<string, unknown> => Boolean(value && typeof value === "object")) : [];
  const matched = new Map<string, { account: string; locationId: string; title: string; mapsUri: string }>();
  for (const account of accounts) {
    const accountName = String(account.name || "").trim();
    if (!/^accounts\/[^/]+$/.test(accountName)) continue;
    let pageToken = "";
    do {
      const params = new URLSearchParams({ readMask: "name,title,metadata", pageSize: "100" });
      if (pageToken) params.set("pageToken", pageToken);
      const locationsPayload = await googleRequest(`https://mybusinessbusinessinformation.googleapis.com/v1/${accountName}/locations?${params.toString()}`, token.accessToken);
      const profileLocations = Array.isArray(locationsPayload.locations) ? locationsPayload.locations.filter((value): value is Record<string, unknown> => Boolean(value && typeof value === "object")) : [];
      for (const profileLocation of profileLocations) {
        const metadata = profileLocation.metadata as Record<string, unknown> | undefined;
        const placeId = String(metadata?.placeId || "").trim();
        const locationId = String(profileLocation.name || "").trim().replace(/^locations\//, "");
        const configured = locations.find((candidate) => candidate.placeId === placeId);
        if (configured && /^\d+$/.test(locationId) && !matched.has(configured.key)) matched.set(configured.key, { account: accountName, locationId, title: String(profileLocation.title || configured.label).trim(), mapsUri: String(metadata?.mapsUri || "").trim() });
      }
      pageToken = String(locationsPayload.nextPageToken || "").trim();
    } while (pageToken);
  }
  const unresolved = locations.filter((location) => !matched.has(location.key));
  if (unresolved.length) throw new Error(`Connected Google Business Profile access did not include: ${unresolved.map((location) => location.label).join(", ")}. Confirm the signed-in account is an owner or manager of every profile.`);
  const fetchedAt = new Date().toISOString();
  const snapshots = await Promise.all(locations.map(async (location) => {
    const profile = matched.get(location.key)!;
    const params = new URLSearchParams({ pageSize: "50", orderBy: "updateTime desc" });
    const payload = await googleRequest(`https://mybusiness.googleapis.com/v4/${profile.account}/locations/${profile.locationId}/reviews?${params.toString()}`, token.accessToken);
    const reviews = Array.isArray(payload.reviews) ? payload.reviews.filter((value): value is Record<string, unknown> => Boolean(value && typeof value === "object")).map(businessProfileReview) : [];
    const snapshot: GoogleReviewsSnapshot = { version: 1, source: "google_business_profile_api", fetchedAt, placeId: location.placeId, placeName: profile.title || location.label, locationKey: location.key, locationLabel: location.label, rating: numberOrNull(payload.averageRating), userRatingCount: numberOrNull(payload.totalReviewCount), googleMapsUri: profile.mapsUri, reviews };
    writeJson(path.join(root, "google-reviews", location.key, "current.json"), snapshot);
    writeJson(path.join(root, "history", "google-reviews", location.key, `google-reviews_${chicagoDateKey()}.json`), snapshot);
    return snapshot;
  }));
  return snapshots;
}

async function main(): Promise<void> {
  const requestedPlaceId = argument("place-id");
  const locations = requestedPlaceId
    ? [{ key: argument("location") || "manual", label: argument("label") || "Google Reviews", placeId: requestedPlaceId.replace(/^places\//i, "") }]
    : googleReviewsLocations();
  if (!locations.length) throw new Error("GOOGLE_REVIEWS_LOCATIONS or GOOGLE_REVIEWS_PLACE_ID is required. Configure it in the protected OpsCenter environment.");
  const root = dataDirectory();
  const businessProfile = getGoogleBusinessProfileConfig();
  const snapshots = businessProfile.ready
    ? await collectBusinessProfileLocations(locations, root)
    : await Promise.all(locations.map((location) => collectLocation(location, required("GOOGLE_MAPS_API_KEY or GOOGLE_MAPS_ROUTES_API_KEY", String(process.env.GOOGLE_MAPS_API_KEY || process.env.GOOGLE_MAPS_ROUTES_API_KEY || "").trim()), root)));
  console.log(JSON.stringify({ status: "ok", locations: snapshots.map((snapshot) => ({ location: snapshot.locationLabel, placeId: snapshot.placeId, rating: snapshot.rating, userRatingCount: snapshot.userRatingCount, reviews: snapshot.reviews.length })) }));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
