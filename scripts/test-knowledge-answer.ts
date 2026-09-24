import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { answerKnowledgeQuestion } from '../desktop-ui/lib/knowledge-answer';
import type { KnowledgeEntry } from '../desktop-ui/lib/knowledge-contract';
import { knowledgeSeeds } from '../lib/knowledge-seeds';

const now = Date.parse('2026-09-24T06:00:00.000Z');
const incident: KnowledgeEntry = {
  id: '00000000-0000-4000-8000-000000000001', version: 1, status: 'verified',
  title: 'Native LinxUp geofence events route once to each truck channel', kind: 'incident', workspace: 'Fleet',
  summary: 'Native geofence entries and matching exits now flow into the truck Slack channel with durable deduplication.',
  body: 'Source: a missing warehouse notification. Symptom: geofence events appeared in OpsCenter but not Slack. Cause: the native refresh ended at the local timeline and was not connected to the Slack publisher. Action: route entry and exit events through the existing publisher with a no-replay baseline. Evidence: focused pairing, routing and deduplication tests passed. Remaining work: observe the first naturally occurring event receipt. Prevention: refresh before publishing and keep an immutable delivery key.',
  sourceLabel: 'Synthetic geofence source', sourceUrl: '', sourceNote: 'Test evidence only.', owner: 'Test',
  learning: { sourceKey: 'issue:test-geofence', recordedAt: '2026-09-23T16:56:06.000Z', outcome: 'follow-up', topics: ['linxup-geofence','slack-alerts','truck-channel'] },
  updatedAt: '2026-09-23T16:56:06.000Z', updatedBy: 'test', verifiedAt: '2026-09-23T17:00:00.000Z', verifiedBy: 'test',
  verificationNote: 'Checked synthetic evidence.', reviewDue: '2026-10-23T17:00:00.000Z', history: [],
};

const entries = [...knowledgeSeeds, incident];
const cause = answerKnowledgeQuestion(entries, 'Why were the truck geofence alerts missing?', now);
assert.equal(cause?.entryId, incident.id);
assert.match(cause?.detail || '', /^Cause: the native refresh ended/);
assert.equal(cause?.confidence, 'strong');

const evidence = answerKnowledgeQuestion(entries, 'What proof verified the geofence Slack notification fix?', now);
assert.equal(evidence?.entryId, incident.id);
assert.match(evidence?.detail || '', /^Evidence: focused pairing/);

const remaining = answerKnowledgeQuestion(entries, 'What is still pending for the geofence notification?', now);
assert.equal(remaining?.entryId, incident.id);
assert.match(remaining?.detail || '', /^Remaining work: observe the first/);

const photos = answerKnowledgeQuestion(entries, 'How do I find missing job pictures?', now);
assert.equal(photos?.entryId, 'guide-held-photos');
assert.match(photos?.answer || '', /held photo/i);

assert.equal(answerKnowledgeQuestion([{ ...incident, status: 'archived' }], 'geofence alerts', now), null, 'archived entries cannot answer');
assert.equal(answerKnowledgeQuestion(entries, 'quantum submarine inventory', now), null, 'unrelated questions must not invent an answer');

const expanded = Array.from({ length: 120 }, (_, index) => ({ ...incident, id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`, title: `${incident.title} ${index}` }));
const started = performance.now();
for (let index = 0; index < 25; index += 1) assert.ok(answerKnowledgeQuestion(expanded, 'why did truck geofence notifications fail?', now));
const elapsed = performance.now() - started;
assert.ok(elapsed < 500, `local answers should stay interactive; 25 queries took ${elapsed.toFixed(1)}ms`);

console.log(`Knowledge answers passed: intent extraction, synonyms, confidence, archive exclusion, no-invention, and local response time (${elapsed.toFixed(1)}ms for 25 queries across 120 records).`);
