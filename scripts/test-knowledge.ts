import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { executeKnowledgeAction, knowledgeSnapshot, readKnowledgeEntries, validateKnowledgeDraft } from '../lib/knowledge-store';
import { knowledgeSeeds } from '../lib/knowledge-seeds';
import { knowledgeStatus, searchKnowledge, type KnowledgeAction, type KnowledgeDraft } from '../desktop-ui/lib/knowledge-contract';

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ops-knowledge-test-'));
const actor = { id: 'test-manager', canManage: true };
const now = new Date('2026-09-16T16:00:00Z');
const draft: KnowledgeDraft = { title: 'Inspect a test source', summary: 'Synthetic knowledge', kind: 'procedure', workspace: 'Schedule', body: 'Check the authoritative result.', owner: 'Test owner', sourceLabel: 'Synthetic source', sourceUrl: '', sourceNote: 'Test evidence only.' };
const id = crypto.randomUUID();
const create: KnowledgeAction = { action: 'save', id, expectedVersion: 0, requestId: crypto.randomUUID(), draft };
try {
  assert.equal(knowledgeSnapshot(true, directory).entries.length, knowledgeSeeds.length);
  assert.throws(() => executeKnowledgeAction(create, { ...actor, canManage: false }, directory, now), /Manager access/);
  assert.throws(() => executeKnowledgeAction({ ...create, id: '../../escape' }, actor, directory, now), /Invalid/);
  for (const sourceUrl of ['javascript:alert(1)', 'http://example.com', 'https://user:pass@example.com']) assert.throws(() => validateKnowledgeDraft({ ...draft, sourceUrl }), /HTTPS/);
  assert.throws(() => validateKnowledgeDraft({ ...draft, body: 'x'.repeat(16001) }), /maximum/);
  const saved = executeKnowledgeAction(create, actor, directory, now);
  assert.equal(saved.status, 'draft'); assert.equal(saved.version, 1); assert.equal(saved.verifiedAt, null);
  assert.deepEqual(executeKnowledgeAction(create, actor, directory, now), saved, 'retry is idempotent');
  assert.throws(() => executeKnowledgeAction({ ...create, draft: { ...draft, title: 'Changed retry' } }, actor, directory, now), /already used/);
  assert.throws(() => executeKnowledgeAction({ ...create, requestId: crypto.randomUUID() }, actor, directory, now), /changed/);
  assert.equal(knowledgeSnapshot(false, directory).entries.some(entry => entry.id === id), false, 'operator cannot read manager notes');
  assert.throws(() => executeKnowledgeAction({ action: 'verify', id, expectedVersion: 1, requestId: crypto.randomUUID(), verificationNote: '' }, actor, directory, now), /what you checked/);
  const verified = executeKnowledgeAction({ action: 'verify', id, expectedVersion: 1, requestId: crypto.randomUUID(), verificationNote: 'Checked the synthetic source.' }, actor, directory, now);
  assert.equal(verified.status, 'verified'); assert.equal(verified.verifiedBy, actor.id);
  assert.equal(knowledgeStatus(verified, now.getTime()), 'Verified');
  assert.equal(knowledgeStatus(verified, now.getTime() + 31 * 86400000), 'Review due');
  const edited = executeKnowledgeAction({ ...create, expectedVersion: 2, requestId: crypto.randomUUID(), draft: { ...draft, body: 'Revised procedure' } }, actor, directory, now);
  assert.equal(edited.status, 'draft'); assert.equal(edited.verifiedAt, null); assert.equal(edited.verificationNote, '');
  const archived = executeKnowledgeAction({ action: 'archive', id, expectedVersion: 3, requestId: crypto.randomUUID() }, actor, directory, now);
  assert.equal(searchKnowledge([archived], '', 'All', 'all', 'all').length, 0);
  assert.equal(searchKnowledge([archived], '', 'All', 'all', 'archived').length, 1);
  assert.throws(() => executeKnowledgeAction({ ...create, expectedVersion: 4, requestId: crypto.randomUUID() }, actor, directory, now), /Restore/);
  const restored = executeKnowledgeAction({ action: 'restore', id, expectedVersion: 4, requestId: crypto.randomUUID() }, actor, directory, now);
  assert.equal(restored.status, 'draft'); assert.equal(restored.history.length, 5);
  assert.equal(readKnowledgeEntries(directory)[0].version, 5);
  const copy = path.join(directory, 'backup-test'); fs.cpSync(path.join(directory, id), path.join(copy, id), { recursive: true });
  assert.deepEqual(readKnowledgeEntries(copy), readKnowledgeEntries(directory), 'backup restores complete revision history');
  assert.equal(fs.statSync(path.join(directory, id, '1.json')).mode & 0o777, 0o600);
  assert.equal(JSON.parse(fs.readFileSync(path.join(directory, id, '1.json'), 'utf8')).entry.body, draft.body, 'old revisions remain intact');
  assert.equal(searchKnowledge(knowledgeSeeds, 'photos', 'Schedule', 'procedure', 'all')[0].id, 'guide-held-photos');
  assert.equal(searchKnowledge(knowledgeSeeds, 'zzzz-no-match', 'All', 'all', 'all').length, 0);
  for (const seed of knowledgeSeeds) {
    const file = seed.sourceUrl.split('/').slice(7).join('/');
    const normalize = (text: string) => text.replace(/\s+/g, ' ').trim();
    assert.ok(normalize(fs.readFileSync(file, 'utf8')).includes(normalize(seed.sourceExcerpt!)), `${seed.id}: documentation must support the excerpt`);
    assert.equal(seed.verifiedAt, null, 'documentation review cannot claim live source verification');
  }
  fs.writeFileSync(path.join(directory, id, '5.json'), '{damaged');
  assert.equal(knowledgeSnapshot(true, directory).available, false, 'damaged history cannot appear empty or healthy');
  assert.throws(() => executeKnowledgeAction({ ...create, expectedVersion: 5, requestId: crypto.randomUUID() }, actor, directory, now));
  console.log('Knowledge passed: authorization, source URLs, validation, durable read-back, idempotency, conflicts, review aging, edit invalidation, archive/restore, backup recovery, search, source provenance, and corruption handling.');
} finally { fs.rmSync(directory, { recursive: true, force: true }); }
