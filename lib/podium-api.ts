import { PODIUM_API_ORIGIN, PODIUM_API_VERSION } from "@/lib/podium-config";
import { getValidPodiumToken } from "@/lib/podium-oauth";

type PodiumListResponse = {
  data?: unknown;
  metadata?: { nextCursor?: unknown };
};

export type PodiumLocation = {
  uid: string;
  name: string;
  displayName: string;
  address: string;
  archived: boolean;
};

export type PodiumGoogleReview = {
  uid: string;
  authorName: string;
  body: string;
  url: string;
  rating: number;
  createdAt: string;
  updatedAt: string;
  locationUids: string[];
  needsResponse: boolean;
  responseCount: number;
};

export type PodiumGoogleSummary = {
  averageRating: number | null;
  reviewCount: number;
};

function records(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object"))
    : [];
}

function numberOrNull(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

async function podiumRequest(pathname: string, forceRefresh = false): Promise<PodiumListResponse> {
  const token = await getValidPodiumToken(forceRefresh);
  const response = await fetch(`${PODIUM_API_ORIGIN}${pathname}`, {
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${token.accessToken}`,
      "podium-version": PODIUM_API_VERSION,
    },
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
  });
  if (response.status === 401 && !forceRefresh) return podiumRequest(pathname, true);
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) {
    const metadata = payload.metadata as Record<string, unknown> | undefined;
    throw new Error(`Podium API request failed (${response.status}): ${String(payload.message || metadata?.message || "unknown error")}`);
  }
  return payload as PodiumListResponse;
}

async function listAll(pathname: string, maxPages = 25): Promise<Record<string, unknown>[]> {
  const items: Record<string, unknown>[] = [];
  let cursor = "";
  for (let page = 0; page < maxPages; page += 1) {
    const separator = pathname.includes("?") ? "&" : "?";
    const response = await podiumRequest(`${pathname}${separator}${cursor ? `cursor=${encodeURIComponent(cursor)}` : "limit=100"}`);
    items.push(...records(response.data));
    cursor = String(response.metadata?.nextCursor || "").trim();
    if (!cursor) break;
  }
  return items;
}

export async function listPodiumLocations(): Promise<PodiumLocation[]> {
  const items = await listAll("/v4/locations", 10);
  return items.map((item) => ({
    uid: String(item.uid || "").trim(),
    name: String(item.name || "").trim(),
    displayName: String(item.displayName || item.name || "Podium location").trim(),
    address: String(item.address || "").trim(),
    archived: Boolean(item.archived),
  })).filter((location) => location.uid && !location.archived);
}

export async function listRecentPodiumGoogleReviews(locationUids: string[] = []): Promise<PodiumGoogleReview[]> {
  const items: Record<string, unknown>[] = [];
  const counts = new Map(locationUids.map((uid) => [uid, 0]));
  let cursor = "";
  for (let page = 0; page < 25; page += 1) {
    const response = await podiumRequest(`/v4/reviews?${cursor ? `cursor=${encodeURIComponent(cursor)}` : "limit=100"}`);
    const pageItems = records(response.data);
    items.push(...pageItems);
    for (const item of pageItems) {
      const review = item.review as Record<string, unknown> | undefined;
      if (String(review?.siteName || "").trim().toLowerCase() !== "google") continue;
      for (const location of records(item.locations)) {
        const uid = String(location.uid || "").trim();
        if (counts.has(uid)) counts.set(uid, (counts.get(uid) || 0) + 1);
      }
    }
    cursor = String(response.metadata?.nextCursor || "").trim();
    if (!cursor || (counts.size > 0 && Array.from(counts.values()).every((count) => count >= 100))) break;
  }
  return items.filter((item) => {
    const review = item.review as Record<string, unknown> | undefined;
    return String(review?.siteName || "").trim().toLowerCase() === "google";
  }).map((item) => {
    const author = item.author as Record<string, unknown> | undefined;
    const review = item.review as Record<string, unknown> | undefined;
    return {
      uid: String(item.uid || review?.siteReviewId || "").trim(),
      authorName: String(author?.name || "Anonymous Google user").trim(),
      body: String(review?.body || "").trim(),
      url: String(review?.url || "").trim(),
      rating: numberOrNull(review?.rating) || 0,
      createdAt: String(item.createdAt || "").trim(),
      updatedAt: String(item.updatedAt || item.createdAt || "").trim(),
      locationUids: records(item.locations).map((location) => String(location.uid || "").trim()).filter(Boolean),
      needsResponse: Boolean(item.needsResponse),
      responseCount: records(item.responses).length,
    };
  }).filter((review) => review.uid && review.locationUids.length > 0)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

export async function getPodiumGoogleSummary(locationUid: string): Promise<PodiumGoogleSummary> {
  const params = new URLSearchParams();
  params.append("locationUids[]", locationUid);
  const response = await podiumRequest(`/v4/reviews/sites/summary?${params.toString()}`);
  const google = records(response.data).find((item) => String(item.siteName || "").trim().toLowerCase() === "google");
  return {
    averageRating: numberOrNull(google?.averageRating),
    reviewCount: numberOrNull(google?.reviewCount) || 0,
  };
}
