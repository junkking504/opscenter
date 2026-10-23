import fs from 'node:fs';
import path from 'node:path';
import { evaluatePodiumExactMatches } from '../lib/podium-review-attribution';
import type { PodiumGoogleReviewsSnapshot } from '../lib/podium-reviews';

// No collector, provider calls, assignment writer or raw-row output.
try {
  const index = process.argv.indexOf('--data-dir');
  if (index < 0 || !process.argv[index + 1]) throw new Error();
  const root = path.resolve(process.argv[index + 1]);
  const snapshot: PodiumGoogleReviewsSnapshot = JSON.parse(fs.readFileSync(path.join(root, 'podium-google-reviews/current.json'), 'utf8'));
  const reviews = snapshot.locations.flatMap(location => location.reviews.map(review => ({ ...review, locationName: location.name })));
  console.log(JSON.stringify({ snapshotAt: snapshot.fetchedAt, ...evaluatePodiumExactMatches(root, reviews) }));
} catch {
  console.error('Exact-match evaluation failed; check --data-dir and local snapshot availability. No data was written.');
  process.exitCode = 1;
}
