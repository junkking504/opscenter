import fs from "node:fs";
import path from "node:path";
import {
  getPodiumGoogleSummary,
  getPodiumReviewInvite,
  listPodiumLocations,
  listRecentPodiumGoogleReviews,
  type PodiumReviewInvite,
} from "../lib/podium-api";
import { buildPodiumAppointmentMatcher } from "../lib/podium-review-attribution";
import type { PodiumGoogleReviewsSnapshot } from "../lib/podium-reviews";
import { chicagoDateKey } from "../lib/report-dates";

const ATTRIBUTION_LOOKBACK_DAYS = 45;
const MAX_INVITES_PER_RUN = 200;
const INVITE_BATCH_SIZE = 8;

function argument(name: string): string {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? String(process.argv[index + 1] || "").trim() : "";
}

function dataDirectory(): string {
  const requested = argument("data-dir") || String(process.env.OPSBOT_DATA_DIR || "").trim();
  return requested || path.join(process.env.HOME || "", ".openclaw", "workspace", "opsbot", "data");
}

function writeJson(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o750 });
  const temporary = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.${Date.now()}.tmp`);
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o640 });
  fs.chmodSync(temporary, 0o640);
  fs.renameSync(temporary, file);
}

function snapshotAgeMinutes(file: string): number | null {
  try {
    const value = JSON.parse(fs.readFileSync(file, "utf8")) as { fetchedAt?: unknown };
    const fetchedAt = new Date(String(value.fetchedAt || "")).getTime();
    return Number.isFinite(fetchedAt) ? (Date.now() - fetchedAt) / 60_000 : null;
  } catch {
    return null;
  }
}

async function loadReviewInvites(uids: string[]): Promise<Map<string, PodiumReviewInvite>> {
  const invites = new Map<string, PodiumReviewInvite>();
  for (let index = 0; index < uids.length; index += INVITE_BATCH_SIZE) {
    const batch = uids.slice(index, index + INVITE_BATCH_SIZE);
    const results = await Promise.all(batch.map(async (uid) => {
      try {
        return await getPodiumReviewInvite(uid);
      } catch {
        return null;
      }
    }));
    for (const invite of results) {
      if (invite?.uid) invites.set(invite.uid, invite);
    }
  }
  return invites;
}

async function main(): Promise<void> {
  const root = dataDirectory();
  const currentFile = path.join(root, "podium-google-reviews", "current.json");
  const minimumAge = Number(argument("min-age-minutes") || 0);
  const age = snapshotAgeMinutes(currentFile);
  if (minimumAge > 0 && age !== null && age < minimumAge) {
    console.log(JSON.stringify({ status: "fresh", ageMinutes: Number(age.toFixed(1)) }));
    return;
  }

  const locations = await listPodiumLocations();
  if (!locations.length) throw new Error("The connected Podium account did not expose any active locations.");
  const reviews = await listRecentPodiumGoogleReviews(locations.map((location) => location.uid));
  const summaries = await Promise.all(locations.map((location) => getPodiumGoogleSummary(location.uid)));
  const fetchedAt = new Date().toISOString();
  const attributionCutoff = Date.now() - ATTRIBUTION_LOOKBACK_DAYS * 86_400_000;
  const inviteUids = Array.from(new Set(reviews
    .filter((review) => {
      const createdAt = new Date(review.createdAt).getTime();
      return Number.isFinite(createdAt) && createdAt >= attributionCutoff;
    })
    .flatMap((review) => review.reviewInvitationUids)))
    .slice(0, MAX_INVITES_PER_RUN);
  const invites = await loadReviewInvites(inviteUids);
  const matchAppointment = buildPodiumAppointmentMatcher(root);
  const attributionByReviewUid = new Map(reviews.map((review) => {
    const invite = review.reviewInvitationUids
      .map((uid) => invites.get(uid) || null)
      .find((candidate): candidate is PodiumReviewInvite => Boolean(candidate)) || null;
    return [review.uid, matchAppointment(review.createdAt, invite)] as const;
  }));
  const snapshot: PodiumGoogleReviewsSnapshot = {
    version: 1,
    source: "podium_api",
    fetchedAt,
    locations: locations.map((location, index) => ({
      uid: location.uid,
      name: location.displayName || location.name,
      address: location.address,
      averageRating: summaries[index]?.averageRating ?? null,
      reviewCount: summaries[index]?.reviewCount ?? 0,
      reviews: reviews.filter((review) => review.locationUids.includes(location.uid)).slice(0, 100).map((review) => ({
        uid: review.uid,
        authorName: review.authorName,
        body: review.body,
        url: review.url,
        rating: review.rating,
        createdAt: review.createdAt,
        updatedAt: review.updatedAt,
        needsResponse: review.needsResponse,
        responseCount: review.responseCount,
        attribution: attributionByReviewUid.get(review.uid),
      })),
    })),
  };
  writeJson(
    path.join(root, "history", "podium-google-reviews", `podium-google-reviews_${chicagoDateKey()}.json`),
    snapshot,
  );
  writeJson(currentFile, snapshot);
  const recentReviews = Array.from(new Map(
    snapshot.locations.flatMap((location) => location.reviews).map((review) => [review.uid, review]),
  ).values());
  console.log(JSON.stringify({
    status: "ok",
    fetchedAt,
    attributedReviews: recentReviews.filter((review) => review.attribution?.status === "matched").length,
    unassignedReviews: recentReviews.filter((review) => review.attribution?.status !== "matched").length,
    locations: snapshot.locations.map((location) => ({
      name: location.name,
      reviewCount: location.reviewCount,
      averageRating: location.averageRating,
      recentReviews: location.reviews.length,
    })),
  }));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
