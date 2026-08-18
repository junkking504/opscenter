import fs from "node:fs";
import path from "node:path";
import { chicagoDateKey } from "@/lib/report-dates";

export type GoogleReviewsLocation = { key: string; label: string; placeId: string };
export type GoogleReview = { name: string; authorName: string; authorUri: string; rating: number; text: string; publishTime: string; relativePublishTimeDescription: string; googleMapsUri: string };
export type GoogleReviewsSnapshot = { version: 1; source: "google_places_api"; fetchedAt: string; placeId: string; placeName: string; locationKey?: string; locationLabel?: string; rating: number | null; userRatingCount: number | null; googleMapsUri: string; reviews: GoogleReview[] };
export type GoogleReviewsView = { location: GoogleReviewsLocation; available: boolean; error?: string; snapshot: GoogleReviewsSnapshot | null; previousSnapshot: GoogleReviewsSnapshot | null; rating: number | null; userRatingCount: number | null; ratingChange: number | null; reviewCountChange: number | null; reviews: Array<GoogleReview & { isNew: boolean }> };

const LOCATION_ORDER = ["new-orleans", "jefferson-parish", "northshore", "baton-rouge"];

function dataRoots(): string[] {
  const configured = String(process.env.OPSBOT_DATA_DIR || "").trim();
  return [configured, path.join(process.cwd(), "data"), path.join(process.env.HOME || "", ".openclaw", "workspace", "opsbot", "data")].filter(Boolean);
}

function configuredLocation(value: unknown): GoogleReviewsLocation | null {
  const candidate = value as Partial<GoogleReviewsLocation> | null;
  const key = String(candidate?.key || "").trim().toLowerCase();
  const label = String(candidate?.label || "").trim();
  const placeId = String(candidate?.placeId || "").trim().replace(/^places\//i, "");
  if (!/^[a-z0-9-]{1,80}$/.test(key) || !label || label.length > 120 || !/^ChIJ[0-9A-Za-z_-]{10,}$/.test(placeId)) return null;
  return { key, label, placeId };
}

export function googleReviewsLocations(): GoogleReviewsLocation[] {
  try {
    const configured = JSON.parse(String(process.env.GOOGLE_REVIEWS_LOCATIONS || ""));
    if (Array.isArray(configured)) {
      const locations = configured.map(configuredLocation).filter((location): location is GoogleReviewsLocation => Boolean(location));
      if (locations.length && new Set(locations.map((location) => location.key)).size === locations.length) {
        return locations.sort((left, right) => {
          const leftRank = LOCATION_ORDER.indexOf(left.key);
          const rightRank = LOCATION_ORDER.indexOf(right.key);
          const resolvedLeftRank = leftRank < 0 ? LOCATION_ORDER.length : leftRank;
          const resolvedRightRank = rightRank < 0 ? LOCATION_ORDER.length : rightRank;
          return resolvedLeftRank - resolvedRightRank || left.label.localeCompare(right.label);
        });
      }
    }
  } catch { /* Preserve the legacy single-location setup. */ }
  const placeId = String(process.env.GOOGLE_REVIEWS_PLACE_ID || "").trim().replace(/^places\//i, "");
  return placeId ? [{ key: "default", label: "Google Reviews", placeId }] : [];
}

function isSnapshot(value: unknown): value is GoogleReviewsSnapshot {
  const snapshot = value as Partial<GoogleReviewsSnapshot> | null;
  return snapshot?.version === 1 && snapshot.source === "google_places_api" && typeof snapshot.fetchedAt === "string" && typeof snapshot.placeId === "string" && Array.isArray(snapshot.reviews);
}

function readSnapshot(file: string): GoogleReviewsSnapshot | null {
  try { if (!fs.existsSync(file)) return null; const value = JSON.parse(fs.readFileSync(file, "utf8")); return isSnapshot(value) ? value : null; } catch { return null; }
}

function legacySnapshot(location: GoogleReviewsLocation): GoogleReviewsSnapshot | null {
  if (location.key === "default") return null;
  for (const root of dataRoots()) {
    const snapshot = readSnapshot(path.join(root, "google-reviews", "current.json"));
    if (snapshot?.placeId === location.placeId) return snapshot;
  }
  return null;
}

export function readGoogleReviewsSnapshot(location: GoogleReviewsLocation): GoogleReviewsSnapshot | null {
  for (const root of dataRoots()) {
    const keyed = readSnapshot(path.join(root, "google-reviews", location.key, "current.json"));
    if (keyed?.placeId === location.placeId) return keyed;
    if (location.key === "default") { const legacy = readSnapshot(path.join(root, "google-reviews", "current.json")); if (legacy?.placeId === location.placeId) return legacy; }
  }
  return legacySnapshot(location);
}

export function readGoogleReviewsHistory(location: GoogleReviewsLocation): GoogleReviewsSnapshot[] {
  const snapshots = new Map<string, GoogleReviewsSnapshot>();
  for (const root of dataRoots()) {
    const directory = path.join(root, "history", "google-reviews", location.key);
    try {
      if (!fs.existsSync(directory)) continue;
      for (const file of fs.readdirSync(directory)) {
        if (!/^google-reviews_\d{4}-\d{2}-\d{2}\.json$/.test(file)) continue;
        const snapshot = readSnapshot(path.join(directory, file));
        if (snapshot?.placeId === location.placeId) snapshots.set(snapshot.fetchedAt, snapshot);
      }
    } catch { /* Other data roots are allowed to be unavailable. */ }
  }
  const legacy = legacySnapshot(location);
  if (legacy) snapshots.set(legacy.fetchedAt, legacy);
  return Array.from(snapshots.values()).sort((left, right) => left.fetchedAt.localeCompare(right.fetchedAt));
}

function numeric(value: unknown): number | null { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : null; }

export function reviewsPublishedOn(
  reviews: Array<GoogleReview & { isNew: boolean }>,
  date = chicagoDateKey(),
): Array<GoogleReview & { isNew: boolean }> {
  return reviews
    .filter((review) => {
      const publishedAt = new Date(review.publishTime);
      return Number.isFinite(publishedAt.getTime()) && chicagoDateKey(publishedAt) === date;
    })
    .sort((left, right) => new Date(right.publishTime).getTime() - new Date(left.publishTime).getTime());
}

export function buildGoogleReviewsViewFromData(location: GoogleReviewsLocation, snapshot: GoogleReviewsSnapshot | null, history: GoogleReviewsSnapshot[] = []): GoogleReviewsView {
  if (!snapshot) return { location, available: false, error: `No Google Reviews snapshot has been collected yet for ${location.label}.`, snapshot: null, previousSnapshot: null, rating: null, userRatingCount: null, ratingChange: null, reviewCountChange: null, reviews: [] };
  const previousSnapshot = history.filter((candidate) => candidate.placeId === snapshot.placeId && candidate.fetchedAt < snapshot.fetchedAt).sort((left, right) => right.fetchedAt.localeCompare(left.fetchedAt))[0] || null;
  const priorReviewNames = new Set(previousSnapshot?.reviews.map((review) => review.name).filter(Boolean) || []);
  const rating = numeric(snapshot.rating); const userRatingCount = numeric(snapshot.userRatingCount); const previousRating = numeric(previousSnapshot?.rating); const previousReviewCount = numeric(previousSnapshot?.userRatingCount);
  return { location, available: true, snapshot, previousSnapshot, rating, userRatingCount, ratingChange: rating !== null && previousRating !== null ? rating - previousRating : null, reviewCountChange: userRatingCount !== null && previousReviewCount !== null ? userRatingCount - previousReviewCount : null, reviews: snapshot.reviews.map((review) => ({ ...review, isNew: Boolean(review.name) && !priorReviewNames.has(review.name) })) };
}

export function buildGoogleReviewsViews(): GoogleReviewsView[] { return googleReviewsLocations().map((location) => buildGoogleReviewsViewFromData(location, readGoogleReviewsSnapshot(location), readGoogleReviewsHistory(location))); }

export function googleReviewsSetupSummary(views = buildGoogleReviewsViews()): string {
  if (views.length && views.every((view) => view.available)) return `Google Reviews · ${views.length} ${views.length === 1 ? "location" : "locations"} tracking`;
  if (!googleReviewsLocations().length) return "Google Reviews setup incomplete: GOOGLE_REVIEWS_LOCATIONS is missing.";
  if (!String(process.env.GOOGLE_MAPS_API_KEY || process.env.GOOGLE_MAPS_ROUTES_API_KEY || "").trim()) return "Google Reviews setup incomplete: a Google Maps API key is missing.";
  return "Google Reviews is configured; awaiting its first collection.";
}
