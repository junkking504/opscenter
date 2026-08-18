import fs from "node:fs";
import path from "node:path";

export type GoogleReview = {
  name: string;
  authorName: string;
  authorUri: string;
  rating: number;
  text: string;
  publishTime: string;
  relativePublishTimeDescription: string;
  googleMapsUri: string;
};

export type GoogleReviewsSnapshot = {
  version: 1;
  source: "google_places_api";
  fetchedAt: string;
  placeId: string;
  placeName: string;
  rating: number | null;
  userRatingCount: number | null;
  googleMapsUri: string;
  reviews: GoogleReview[];
};

export type GoogleReviewsView = {
  available: boolean;
  error?: string;
  snapshot: GoogleReviewsSnapshot | null;
  previousSnapshot: GoogleReviewsSnapshot | null;
  rating: number | null;
  userRatingCount: number | null;
  ratingChange: number | null;
  reviewCountChange: number | null;
  reviews: Array<GoogleReview & { isNew: boolean }>;
};

function dataRoots(): string[] {
  const configured = String(process.env.OPSBOT_DATA_DIR || "").trim();
  return [
    configured,
    path.join(process.cwd(), "data"),
    path.join(process.env.HOME || "", ".openclaw", "workspace", "opsbot", "data"),
  ].filter(Boolean);
}

function isSnapshot(value: unknown): value is GoogleReviewsSnapshot {
  const snapshot = value as Partial<GoogleReviewsSnapshot> | null;
  return snapshot?.version === 1
    && snapshot.source === "google_places_api"
    && typeof snapshot.fetchedAt === "string"
    && typeof snapshot.placeId === "string"
    && Array.isArray(snapshot.reviews);
}

function readSnapshot(file: string): GoogleReviewsSnapshot | null {
  try {
    if (!fs.existsSync(file)) return null;
    const value = JSON.parse(fs.readFileSync(file, "utf8"));
    return isSnapshot(value) ? value : null;
  } catch {
    return null;
  }
}

export function readGoogleReviewsSnapshot(): GoogleReviewsSnapshot | null {
  for (const root of dataRoots()) {
    const snapshot = readSnapshot(path.join(root, "google-reviews", "current.json"));
    if (snapshot) return snapshot;
  }
  return null;
}

export function readGoogleReviewsHistory(): GoogleReviewsSnapshot[] {
  const snapshots = new Map<string, GoogleReviewsSnapshot>();
  for (const root of dataRoots()) {
    const directory = path.join(root, "history", "google-reviews");
    try {
      if (!fs.existsSync(directory)) continue;
      for (const file of fs.readdirSync(directory)) {
        if (!/^google-reviews_\d{4}-\d{2}-\d{2}\.json$/.test(file)) continue;
        const snapshot = readSnapshot(path.join(directory, file));
        if (snapshot) snapshots.set(snapshot.fetchedAt, snapshot);
      }
    } catch {
      // Other data roots are allowed to be unavailable.
    }
  }
  return Array.from(snapshots.values()).sort((left, right) => left.fetchedAt.localeCompare(right.fetchedAt));
}

function numeric(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function buildGoogleReviewsViewFromData(
  snapshot: GoogleReviewsSnapshot | null,
  history: GoogleReviewsSnapshot[] = [],
): GoogleReviewsView {
  if (!snapshot) {
    return {
      available: false,
      error: "No Google Reviews snapshot has been collected yet.",
      snapshot: null,
      previousSnapshot: null,
      rating: null,
      userRatingCount: null,
      ratingChange: null,
      reviewCountChange: null,
      reviews: [],
    };
  }

  const previousSnapshot = history
    .filter((candidate) => candidate.placeId === snapshot.placeId && candidate.fetchedAt < snapshot.fetchedAt)
    .sort((left, right) => right.fetchedAt.localeCompare(left.fetchedAt))[0] || null;
  const priorReviewNames = new Set(previousSnapshot?.reviews.map((review) => review.name).filter(Boolean) || []);
  const rating = numeric(snapshot.rating);
  const userRatingCount = numeric(snapshot.userRatingCount);
  const previousRating = numeric(previousSnapshot?.rating);
  const previousReviewCount = numeric(previousSnapshot?.userRatingCount);

  return {
    available: true,
    snapshot,
    previousSnapshot,
    rating,
    userRatingCount,
    ratingChange: rating !== null && previousRating !== null ? rating - previousRating : null,
    reviewCountChange: userRatingCount !== null && previousReviewCount !== null
      ? userRatingCount - previousReviewCount
      : null,
    reviews: snapshot.reviews.map((review) => ({ ...review, isNew: Boolean(review.name) && !priorReviewNames.has(review.name) })),
  };
}

export function buildGoogleReviewsView(): GoogleReviewsView {
  return buildGoogleReviewsViewFromData(readGoogleReviewsSnapshot(), readGoogleReviewsHistory());
}

export function googleReviewsSetupSummary(view = buildGoogleReviewsView()): string {
  if (view.available) return `Google Reviews · ${view.userRatingCount ?? "Unknown"} ratings`;
  if (!String(process.env.GOOGLE_REVIEWS_PLACE_ID || "").trim()) {
    return "Google Reviews setup incomplete: GOOGLE_REVIEWS_PLACE_ID is missing.";
  }
  if (!String(process.env.GOOGLE_MAPS_API_KEY || process.env.GOOGLE_MAPS_ROUTES_API_KEY || "").trim()) {
    return "Google Reviews setup incomplete: a Google Maps API key is missing.";
  }
  return "Google Reviews is configured; awaiting its first collection.";
}
