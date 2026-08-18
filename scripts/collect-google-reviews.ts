import fs from "node:fs";
import path from "node:path";
import { chicagoDateKey } from "../lib/report-dates";
import type { GoogleReview, GoogleReviewsSnapshot } from "../lib/google-reviews";

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

function writeJson(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o750 });
  const temporary = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.${Date.now()}.tmp`);
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o640 });
  fs.chmodSync(temporary, 0o640);
  fs.renameSync(temporary, file);
}

async function main(): Promise<void> {
  const requestedPlaceId = required("GOOGLE_REVIEWS_PLACE_ID", argument("place-id") || String(process.env.GOOGLE_REVIEWS_PLACE_ID || "").trim());
  const placeId = requestedPlaceId.replace(/^places\//i, "");
  const apiKey = required(
    "GOOGLE_MAPS_API_KEY or GOOGLE_MAPS_ROUTES_API_KEY",
    String(process.env.GOOGLE_MAPS_API_KEY || process.env.GOOGLE_MAPS_ROUTES_API_KEY || "").trim(),
  );
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
    rating: numberOrNull(payload.rating),
    userRatingCount: numberOrNull(payload.userRatingCount),
    googleMapsUri: String(payload.googleMapsUri || "").trim(),
    reviews: Array.isArray(payload.reviews) ? payload.reviews.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object")).map(review) : [],
  };
  const root = dataDirectory();
  writeJson(path.join(root, "google-reviews", "current.json"), snapshot);
  writeJson(path.join(root, "history", "google-reviews", `google-reviews_${chicagoDateKey()}.json`), snapshot);
  console.log(JSON.stringify({ status: "ok", fetchedAt, placeId: snapshot.placeId, rating: snapshot.rating, userRatingCount: snapshot.userRatingCount, reviews: snapshot.reviews.length }));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
