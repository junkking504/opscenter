import fs from "node:fs";
import path from "node:path";
import { getPodiumConfig } from "@/lib/podium-config";
import { podiumTokenStoreStatus } from "@/lib/podium-token-store";

export type PodiumReviewSnapshotItem = {
  uid: string;
  authorName: string;
  body: string;
  url: string;
  rating: number;
  createdAt: string;
  updatedAt: string;
  needsResponse: boolean;
  responseCount: number;
};

export type PodiumReviewLocationSnapshot = {
  uid: string;
  name: string;
  address: string;
  averageRating: number | null;
  reviewCount: number;
  reviews: PodiumReviewSnapshotItem[];
};

export type PodiumGoogleReviewsSnapshot = {
  version: 1;
  source: "podium_api";
  fetchedAt: string;
  locations: PodiumReviewLocationSnapshot[];
};

export type PodiumReviewLocationView = PodiumReviewLocationSnapshot & {
  reviewCountChange: number | null;
  reviews: Array<PodiumReviewSnapshotItem & { isNew: boolean }>;
};

export type PodiumGoogleReviewsView = {
  available: boolean;
  error?: string;
  snapshot: PodiumGoogleReviewsSnapshot | null;
  previousSnapshot: PodiumGoogleReviewsSnapshot | null;
  locations: PodiumReviewLocationView[];
  totalReviewCount: number;
  weightedAverageRating: number | null;
  recentNeedsResponse: number;
  recentLowRatings: number;
};

function dataRoots(): string[] {
  const configured = String(process.env.OPSBOT_DATA_DIR || "").trim();
  return [
    configured,
    path.join(process.cwd(), "data"),
    path.join(process.env.HOME || "", ".openclaw", "workspace", "opsbot", "data"),
  ].filter(Boolean);
}

function isSnapshot(value: unknown): value is PodiumGoogleReviewsSnapshot {
  const snapshot = value as Partial<PodiumGoogleReviewsSnapshot> | null;
  return snapshot?.version === 1
    && snapshot.source === "podium_api"
    && typeof snapshot.fetchedAt === "string"
    && Array.isArray(snapshot.locations);
}

function readSnapshot(file: string): PodiumGoogleReviewsSnapshot | null {
  try {
    if (!fs.existsSync(file)) return null;
    const value = JSON.parse(fs.readFileSync(file, "utf8"));
    return isSnapshot(value) ? value : null;
  } catch {
    return null;
  }
}

export function readPodiumGoogleReviewsSnapshot(): PodiumGoogleReviewsSnapshot | null {
  for (const root of dataRoots()) {
    const snapshot = readSnapshot(path.join(root, "podium-google-reviews", "current.json"));
    if (snapshot) return snapshot;
  }
  return null;
}

export function readPodiumGoogleReviewsHistory(): PodiumGoogleReviewsSnapshot[] {
  const snapshots = new Map<string, PodiumGoogleReviewsSnapshot>();
  for (const root of dataRoots()) {
    const directory = path.join(root, "history", "podium-google-reviews");
    try {
      if (!fs.existsSync(directory)) continue;
      for (const file of fs.readdirSync(directory)) {
        if (!/^podium-google-reviews_\d{4}-\d{2}-\d{2}\.json$/.test(file)) continue;
        const snapshot = readSnapshot(path.join(directory, file));
        if (snapshot) snapshots.set(snapshot.fetchedAt, snapshot);
      }
    } catch {
      // Runtime roots can be absent or inaccessible outside production.
    }
  }
  return Array.from(snapshots.values()).sort((left, right) => left.fetchedAt.localeCompare(right.fetchedAt));
}

export function buildPodiumGoogleReviewsViewFromData(
  snapshot: PodiumGoogleReviewsSnapshot | null,
  history: PodiumGoogleReviewsSnapshot[] = [],
): PodiumGoogleReviewsView {
  if (!snapshot) {
    return {
      available: false,
      error: "No Podium Google Reviews snapshot has been collected yet.",
      snapshot: null,
      previousSnapshot: null,
      locations: [],
      totalReviewCount: 0,
      weightedAverageRating: null,
      recentNeedsResponse: 0,
      recentLowRatings: 0,
    };
  }
  const previousSnapshot = history
    .filter((candidate) => candidate.fetchedAt < snapshot.fetchedAt)
    .sort((left, right) => right.fetchedAt.localeCompare(left.fetchedAt))[0] || null;
  const previousLocations = new Map(previousSnapshot?.locations.map((location) => [location.uid, location]) || []);
  const locations = snapshot.locations.map((location) => {
    const previous = previousLocations.get(location.uid);
    const previousReviewIds = new Set(previous?.reviews.map((review) => review.uid) || []);
    return {
      ...location,
      reviewCountChange: previous ? location.reviewCount - previous.reviewCount : null,
      reviews: [...location.reviews]
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
        .map((review) => ({ ...review, isNew: Boolean(previous) && !previousReviewIds.has(review.uid) })),
    };
  }).sort((left, right) => left.name.localeCompare(right.name));
  const totalReviewCount = locations.reduce((sum, location) => sum + location.reviewCount, 0);
  const ratedReviewCount = locations.reduce(
    (sum, location) => sum + (location.averageRating === null ? 0 : location.reviewCount),
    0,
  );
  const weightedRatingTotal = locations.reduce(
    (sum, location) => sum + (location.averageRating || 0) * location.reviewCount,
    0,
  );
  const recent = locations.flatMap((location) => location.reviews);
  return {
    available: true,
    snapshot,
    previousSnapshot,
    locations,
    totalReviewCount,
    weightedAverageRating: ratedReviewCount ? weightedRatingTotal / ratedReviewCount : null,
    recentNeedsResponse: recent.filter((review) => review.needsResponse).length,
    recentLowRatings: recent.filter((review) => review.rating > 0 && review.rating <= 3).length,
  };
}

export function buildPodiumGoogleReviewsView(): PodiumGoogleReviewsView {
  return buildPodiumGoogleReviewsViewFromData(
    readPodiumGoogleReviewsSnapshot(),
    readPodiumGoogleReviewsHistory(),
  );
}

export function podiumReviewsSetupSummary(view = buildPodiumGoogleReviewsView()): string {
  if (view.available) return `Google Reviews via Podium · ${view.locations.length} locations`;
  const config = getPodiumConfig();
  if (!config.ready) return `Podium setup incomplete: ${config.missing.join(", ")}`;
  if (!podiumTokenStoreStatus().connected) return "Podium is configured; OAuth authorization is still required.";
  return "Podium is connected; awaiting the first Google Reviews collection.";
}
