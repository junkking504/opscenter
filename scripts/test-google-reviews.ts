import assert from "node:assert/strict";
import { buildGoogleReviewsViewFromData, googleReviewsLocations, reviewsPublishedOn, type GoogleReviewsLocation, type GoogleReviewsSnapshot } from "../lib/google-reviews";

const newOrleans: GoogleReviewsLocation = { key: "new-orleans", label: "New Orleans", placeId: "ChIJneworleans01" };

const earlier: GoogleReviewsSnapshot = {
  version: 1,
  source: "google_places_api",
  fetchedAt: "2026-08-15T16:00:00.000Z",
  placeId: newOrleans.placeId,
  placeName: "Junk King Louisiana",
  rating: 4.8,
  userRatingCount: 121,
  googleMapsUri: "https://maps.google.example/place",
  reviews: [{ name: "reviews/old", authorName: "Earlier reviewer", authorUri: "", rating: 5, text: "Great", publishTime: "2026-08-14T16:00:00.000Z", relativePublishTimeDescription: "a day ago", googleMapsUri: "" }],
};

const current: GoogleReviewsSnapshot = {
  ...earlier,
  fetchedAt: "2026-08-17T16:00:00.000Z",
  rating: 4.9,
  userRatingCount: 123,
  reviews: [
    { name: "reviews/newest", authorName: "Newest reviewer", authorUri: "", rating: 5, text: "Just arrived", publishTime: "2026-08-17T14:00:00.000Z", relativePublishTimeDescription: "2 hours ago", googleMapsUri: "" },
    { name: "reviews/new", authorName: "New reviewer", authorUri: "", rating: 5, text: "Excellent work", publishTime: "2026-08-17T12:00:00.000Z", relativePublishTimeDescription: "4 hours ago", googleMapsUri: "" },
    earlier.reviews[0],
  ],
};

const view = buildGoogleReviewsViewFromData(newOrleans, current, [earlier]);
assert.equal(view.available, true);
assert.equal(view.rating, 4.9);
assert.equal(view.reviewCountChange, 2);
assert.ok(Math.abs((view.ratingChange || 0) - 0.1) < 0.000001);
assert.equal(view.reviews[0].isNew, true);
assert.equal(view.reviews[2].isNew, false);
assert.equal(buildGoogleReviewsViewFromData(newOrleans, null).available, false);
assert.deepEqual(reviewsPublishedOn(view.reviews, "2026-08-17").map((review) => review.name), ["reviews/newest", "reviews/new"]);

const originalLocations = process.env.GOOGLE_REVIEWS_LOCATIONS;
process.env.GOOGLE_REVIEWS_LOCATIONS = JSON.stringify([
  { key: "northshore", label: "Northshore", placeId: "ChIJnorthshore" },
  { key: "baton-rouge", label: "Baton Rouge", placeId: "ChIJbatonrouge" },
  newOrleans,
]);
assert.deepEqual(googleReviewsLocations().map(({ key, label }) => ({ key, label })), [
  { key: "new-orleans", label: "New Orleans" },
  { key: "northshore", label: "Northshore" },
  { key: "baton-rouge", label: "Baton Rouge" },
]);
if (originalLocations === undefined) delete process.env.GOOGLE_REVIEWS_LOCATIONS;
else process.env.GOOGLE_REVIEWS_LOCATIONS = originalLocations;

console.log("Google Reviews snapshot and change-tracking checks passed.");
