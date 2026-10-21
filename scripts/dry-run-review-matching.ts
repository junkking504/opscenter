import fs from 'node:fs';
import path from 'node:path';
import { buildPodiumReviewNameSuggestionMap } from '../lib/podium-review-attribution';
import type { PodiumGoogleReviewsSnapshot } from '../lib/podium-reviews';
// Pure local read: never imports the collector, invokes a provider or saves.
const index = process.argv.indexOf('--data-dir');
if (index < 0 || !process.argv[index + 1]) throw new Error('Pass --data-dir with the local snapshot directory.');
const root = path.resolve(process.argv[index + 1]);
const snapshot: PodiumGoogleReviewsSnapshot = JSON.parse(fs.readFileSync(path.join(root, 'podium-google-reviews/current.json'), 'utf8'));
for (const location of snapshot.locations) {
  const reviews = location.reviews.map(review => ({ ...review, locationName: location.name }));
  const suggestions = buildPodiumReviewNameSuggestionMap(root, reviews);
  const counts = { High: 0, Medium: 0, Low: 0, None: 0 };
  for (const review of reviews) counts[suggestions[review.uid]?.[0]?.confidence || 'None']++;
  console.log(JSON.stringify({ location: location.name, snapshotAt: snapshot.fetchedAt, reviews: reviews.length, topCandidateBands: counts }));
}
