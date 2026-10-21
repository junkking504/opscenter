import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { evaluatePodiumExactMatches } from '../lib/podium-review-attribution';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'review-calibration-'));
try {
  fs.mkdirSync(path.join(root, 'processed'));
  const job = (id: string, name: string, completed_at: string) => ({ appt_id: id, job_id: `JKTEST${id}`, customer_name: name, completed_at, job_status: 'Completed', appointment_type: 'Job', territory: 'Fixture Bay', driver_name: 'Example Crew' });
  fs.writeFileSync(path.join(root, 'processed/daily_metrics_2024-05-20.json'), JSON.stringify({ appointments: [job('1', 'Jane Doe', '2024-05-20T15:00:00Z'), job('2', 'Unrelated Person', ''), job('3', 'Another Person', '2024-05-21T22:00:00Z')] }));
  const review = { uid: 'r', authorName: 'Jane Doe', createdAt: '2024-05-20T22:00:00Z', locationName: 'Junk King Fixture Bay', body: '' };
  const label = (appointmentId: string) => ({ status: 'matched' as const, matchMethod: 'exact_phone' as const, appointmentId });
  const result = evaluatePodiumExactMatches(root, [
    { ...review, attribution: label('1') },
    { ...review, attribution: label('1') }, // duplicate location occurrence
    { ...review, uid: 'unknown-time', attribution: label('2') },
    { ...review, uid: 'late', attribution: label('3') },
    { ...review, uid: 'missing', attribution: label('4') },
    { ...review, uid: 'manual', attribution: { ...label('1'), matchMethod: 'manual_appointment' } },
  ]);
  assert.equal(result.exactReviews, 4);
  assert.equal(result.resolvedExactJobs, 3);
  assert.equal(result.top1, 1);
  assert.equal(result.top3, 2);
  assert.equal(result.high, 4);
  assert.equal(result.wrongHigh, 3, 'measure wrong High without hiding unresolved labels');
  assert.equal(result.completionMinusReviewMs.count, 2, 'unknown time and unresolved labels excluded only from delay denominator');
  assert.equal(result.completionMinusReviewMs.p50, -7 * 3_600_000);
  assert.equal(result.completionMinusReviewMs.p99, 24 * 3_600_000, 'late labels contribute before eligibility filtering');
  assert.equal(result.recommendedToleranceMs, 12 * 3_600_000, '12-hour cap');
  assert.equal(result.eligibleCandidates, 2);
  assert.equal(result.candidatesWithCompletedAt, 1);
  assert.equal(result.completedAtShare, 0.5);
  assert.equal(evaluatePodiumExactMatches(root, []).recommendedToleranceMs, 6 * 3_600_000, 'empty cohort retains default');
  console.log('PASS exact-cohort calibration: labels, missingness, percentiles, cap, deduplication and wrong-High accounting.');
} finally { fs.rmSync(root, { recursive: true, force: true }); }
