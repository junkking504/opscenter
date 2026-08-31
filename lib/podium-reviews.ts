import fs from "node:fs";
import path from "node:path";
import { chicagoDateKey } from "@/lib/chicago-date";
import { getPodiumConfig } from "@/lib/podium-config";
import type { PodiumReviewAppointmentAttribution } from "@/lib/podium-review-attribution";
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
  attribution?: PodiumReviewAppointmentAttribution;
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
  newToday: number;
  new7Days: number;
  new30Days: number;
  reviews: Array<PodiumReviewSnapshotItem & { isNew: boolean }>;
};

export type PodiumReviewCreditTally = {
  name: string;
  reviewCount: number;
  averageRating: number;
};

export type PodiumGoogleReviewsView = {
  available: boolean;
  error?: string;
  snapshot: PodiumGoogleReviewsSnapshot | null;
  previousSnapshot: PodiumGoogleReviewsSnapshot | null;
  locations: PodiumReviewLocationView[];
  totalReviewCount: number;
  weightedAverageRating: number | null;
  newToday: number;
  new7Days: number;
  new30Days: number;
  recentNeedsResponse: number;
  recentLowRatings: number;
  attributed30Days: number;
  pendingAttribution30Days: number;
  employeeTallies30Days: PodiumReviewCreditTally[];
  teamTallies30Days: PodiumReviewCreditTally[];
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
      newToday: 0,
      new7Days: 0,
      new30Days: 0,
      recentNeedsResponse: 0,
      recentLowRatings: 0,
      attributed30Days: 0,
      pendingAttribution30Days: 0,
      employeeTallies30Days: [],
      teamTallies30Days: [],
    };
  }
  const fetchedAt = new Date(snapshot.fetchedAt);
  const fetchedTimestamp = fetchedAt.getTime();
  const today = chicagoDateKey(Number.isFinite(fetchedTimestamp) ? fetchedAt : new Date());
  const withinDays = (createdAt: string, days: number) => {
    const timestamp = new Date(createdAt).getTime();
    return Number.isFinite(timestamp)
      && Number.isFinite(fetchedTimestamp)
      && timestamp <= fetchedTimestamp
      && timestamp >= fetchedTimestamp - days * 86_400_000;
  };
  const createdToday = (createdAt: string) => {
    const date = new Date(createdAt);
    return Number.isFinite(date.getTime()) && chicagoDateKey(date) === today;
  };
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
      newToday: location.reviews.filter((review) => createdToday(review.createdAt)).length,
      new7Days: location.reviews.filter((review) => withinDays(review.createdAt, 7)).length,
      new30Days: location.reviews.filter((review) => withinDays(review.createdAt, 30)).length,
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
  const recentByUid = new Map<string, PodiumReviewLocationView["reviews"][number]>();
  for (const review of locations.flatMap((location) => location.reviews)) recentByUid.set(review.uid, review);
  const recent = Array.from(recentByUid.values());
  const recent30Days = recent.filter((review) => withinDays(review.createdAt, 30));
  const matched30Days = recent30Days.filter((review) => review.attribution?.status === "matched");
  const tally = (entries: Array<{ name: string; rating: number }>): PodiumReviewCreditTally[] => {
    const values = new Map<string, { name: string; ratings: number[] }>();
    for (const entry of entries) {
      const key = entry.name.toLowerCase();
      const existing = values.get(key) || { name: entry.name, ratings: [] };
      existing.ratings.push(entry.rating);
      values.set(key, existing);
    }
    return Array.from(values.values()).map((entry) => ({
      name: entry.name,
      reviewCount: entry.ratings.length,
      averageRating: entry.ratings.reduce((sum, rating) => sum + rating, 0) / entry.ratings.length,
    })).sort((left, right) => right.reviewCount - left.reviewCount
      || right.averageRating - left.averageRating
      || left.name.localeCompare(right.name));
  };
  const employeeTallies30Days = tally(matched30Days.flatMap((review) =>
    Array.from(new Set(review.attribution?.crew || [])).map((name) => ({ name, rating: review.rating }))));
  const teamTallies30Days = tally(matched30Days.flatMap((review) => {
    const crew = Array.from(new Set(review.attribution?.crew || [])).sort((left, right) => left.localeCompare(right));
    return crew.length ? [{ name: crew.join(" + "), rating: review.rating }] : [];
  }));
  return {
    available: true,
    snapshot,
    previousSnapshot,
    locations,
    totalReviewCount,
    weightedAverageRating: ratedReviewCount ? weightedRatingTotal / ratedReviewCount : null,
    newToday: recent.filter((review) => createdToday(review.createdAt)).length,
    new7Days: recent.filter((review) => withinDays(review.createdAt, 7)).length,
    new30Days: recent30Days.length,
    recentNeedsResponse: recent.filter((review) => review.needsResponse).length,
    recentLowRatings: recent.filter((review) => review.rating > 0 && review.rating <= 3).length,
    attributed30Days: matched30Days.length,
    pendingAttribution30Days: recent30Days.length - matched30Days.length,
    employeeTallies30Days,
    teamTallies30Days,
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
