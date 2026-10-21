import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import confirmed from '../tests/fixtures/review-matching-confirmed.json';
import { buildPodiumReviewNameSuggestionMap, type PodiumReviewNameSuggestionInput } from '../lib/podium-review-attribution';

// --baseline-module points at an unchanged earlier attribution module for
// reproducible before/after measurement. All inputs and output are synthetic.
async function main() {
const baselineIndex = process.argv.indexOf('--baseline-module');
const matcher: typeof buildPodiumReviewNameSuggestionMap = baselineIndex >= 0
  ? (await import(pathToFileURL(path.resolve(process.argv[baselineIndex + 1])).href)).buildPodiumReviewNameSuggestionMap
  : buildPodiumReviewNameSuggestionMap;
const base = { job_status: 'Completed', appointment_type: 'Job', territory: 'Fixture Bay', driver_name: 'Eugene Fiction' };
const job = (id: string, customer: string, extra = {}) => ({ ...base, appt_id: id, job_id: `JKTEST${id}`, customer_name: customer, completed_at: '2024-05-20T15:00:00Z', ...extra });
const review = (authorName: string, body = '') => ({ uid: 'test', authorName, body, createdAt: '2024-05-20T22:00:00Z', locationName: 'Junk King Fixture Bay' });
type Case = { name: string; expected: string; date: string; review: PodiumReviewNameSuggestionInput; appointments: Record<string, unknown>[]; confidence?: string };
const cases: Case[] = [
  { name: 'confirmed pair (204-second completion delay)', ...confirmed, confidence: 'High' },
  { name: 'worked email and service context', expected: '1', date: '2024-05-20', review: review('Jane Doe', 'Helped with the storage facility in Oakridge.'), appointments: [job('1', 'Pat Baker', { customerEmail: 'jdoe872@example.invalid', appointment_notes: 'Oakridge storage facility', service_address: '1 Synthetic Lane' }), job('2', 'Unrelated Person')], confidence: 'High' },
  { name: 'worked first name and crew', expected: '1', date: '2024-05-20', review: review('Jane Doe', 'Thanks to Eugene for the help.'), appointments: [job('1', 'Jane Baker'), job('2', 'Unrelated Person', { driver_name: 'Zach Fiction' })], confidence: 'Medium' },
  { name: 'initial', expected: '1', date: '2024-05-20', review: review('J. Doe', 'Oakridge storage was cleared.'), appointments: [job('1', 'Jane Doe', { job_notes: 'Oakridge storage' }), job('2', 'Unrelated Person')], confidence: 'High' },
  { name: 'nickname and spelling', expected: '1', date: '2024-05-20', review: review('Bill Chowdry'), appointments: [job('1', 'William Chowdhury'), job('2', 'Unrelated Person')], confidence: 'Medium' },
  { name: 'invite identity', expected: '1', date: '2024-05-20', review: { ...review('Jane Doe'), invite: { uid: 'fake-invite', customerName: 'Jane Doe', locationUid: 'fake-location', channelIdentifier: '' } }, appointments: [job('1', 'Jane Doe'), job('2', 'Unrelated Person')], confidence: 'High' },
  { name: 'tied identity', expected: '1', date: '2024-05-20', review: review('Jane Doe'), appointments: [job('1', 'Jane Doe'), job('2', 'Jane Doe')], confidence: 'Medium' },
  { name: 'no recent Medium widens', expected: '1', date: '2024-04-01', review: review('Jane Doe'), appointments: [job('1', 'Jane Doe', { completed_at: '2024-04-01T15:00:00Z' })], confidence: 'Medium' },
];
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'review-evaluation-'));
try {
  const outcomes = cases.map((test, index) => {
    const data = path.join(root, String(index)); fs.mkdirSync(path.join(data, 'processed'), { recursive: true });
    fs.writeFileSync(path.join(data, 'processed', `daily_metrics_${test.date}.json`), JSON.stringify({ appointments: test.appointments }));
    const ranked = matcher(data, [test.review])[test.review.uid];
    const wrongHigh = ranked.filter(candidate => candidate.confidence === 'High' && candidate.appointmentId !== test.expected).length;
    assert.equal(wrongHigh, 0, `Wrong High auto-save in synthetic case ${index}`);
    if (baselineIndex < 0 && test.confidence) {
      assert.equal(ranked[0]?.appointmentId, test.expected, test.name);
      assert.equal(ranked[0]?.confidence, test.confidence, test.name);
    }
    return { cohort: index === 0 ? 'confirmed' : 'synthetic', top1: ranked[0]?.appointmentId === test.expected, top3: ranked.slice(0, 3).some(candidate => candidate.appointmentId === test.expected), wrongHigh };
  });
  for (const cohort of ['confirmed', 'synthetic', 'all']) {
    const rows = outcomes.filter(row => cohort === 'all' || row.cohort === cohort);
    console.log(JSON.stringify({ mode: baselineIndex < 0 ? 'after' : 'before', cohort, cases: rows.length, top1: rows.filter(row => row.top1).length / rows.length, top3: rows.filter(row => row.top3).length / rows.length, wrongHigh: rows.reduce((sum, row) => sum + row.wrongHigh, 0) }));
  }
  console.log('Confirmed pair retains its 204-second delay and email-handle evidence. Baseline confidence availability depends on the selected module.');
} finally { fs.rmSync(root, { recursive: true, force: true }); }

}
void main();
