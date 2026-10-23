import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { importKnowledgeHistory } from '../lib/knowledge-import';
import { readKnowledgeEntries, knowledgeSnapshot } from '../lib/knowledge-store';
import { parseNote, vaultKnowledgeManifest, vaultNoteDraft } from '../lib/vault-knowledge';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vault-knowledge-'));
const vault = path.join(root, 'vault');
const store = path.join(root, 'store');
const write = (file: string, text: string) => { fs.mkdirSync(path.dirname(path.join(vault, file)), { recursive: true }); fs.writeFileSync(path.join(vault, file), text); };
try {
  write('Decisions/Backup target.md', '---\nopswiki: publish\ndate: 2026-10-09\nsummary: Offsite backup moves off the retired VPS.\ntopics: [backup, vps]\n---\n# Backup target\n\nChosen: new host. Rejected: retired VPS.\n');
  write('Lessons/Rsync locks.md', '---\nopswiki: publish\ndate: 2026-10-09\nid: lesson-rsync-locks\nworkspace: Command\nsummary: Exclude lock files before include rules.\ntopics:\n  - backup\n  - rsync\n---\nRsync stops at the first matching rule.\n');
  write('Knowledge/Draft only.md', '---\ndate: 2026-10-09\nsummary: Not published.\n---\nPrivate draft.\n');
  write('Knowledge/Unpublished long.md', '---\nsummary: |\n  several\n  lines\n---\nDraft.\n');
  write('Inbox/Scrape.md', '---\nopswiki: publish\ndate: 2026-10-09\nsummary: Raw capture.\n---\nUnreviewed.\n');
  write('Tasks/demo/brief.md', '---\nopswiki: publish\ndate: 2026-10-09\nsummary: Task file.\n---\nBrief.\n');

  assert.deepEqual(parseNote('---\na: "x"\nb: [c, d]\nc: Command   # optional\n---\nBody').meta, { a: 'x', b: ['c', 'd'], c: 'Command' });
  assert.equal(parseNote('---\nsummary: "Fix #42 before release"   # note\n---\n').meta.summary, 'Fix #42 before release', 'a quoted # is text');
  assert.equal(parseNote("---\nsummary: 'Issue #7'\n---\n").meta.summary, 'Issue #7');
  assert.equal(parseNote('---\nsummary: Ticket#9 stays\n---\n').meta.summary, 'Ticket#9 stays', 'a # without a leading space is text');
  assert.equal(parseNote("---\nsummary: Don't publish this   # private note\n---\n").meta.summary, "Don't publish this", 'an apostrophe in plain text does not hide a comment');
  assert.equal(parseNote("---\nsummary: 'It''s #1' # note\n---\n").meta.summary, "It's #1", "'' is an escaped apostrophe, not the closing quote");
  assert.equal(parseNote('---\nsummary: "Say \\"#1\\" now" # note\n---\n').meta.summary, 'Say "#1" now');
  assert.deepEqual(parseNote('---\ntopics: ["Fix #42", \'Bob\'\'s, #7\', plain]   # note\n---\n').meta.topics, ['Fix #42', "Bob's, #7", 'plain'], 'quoted # and commas in list items are text');
  assert.deepEqual(parseNote('---\ntopics:\n  - "Fix #42"  # note\n  - backup # note\n---\n').meta.topics, ['Fix #42', 'backup']);
  assert.deepEqual(parseNote('---\nsummary: >\n  folded text\n---\n').multiline, ['summary']);
  assert.equal(vaultNoteDraft('Knowledge/Draft.md', '---\nsummary: |\n  block text\n---\nPrivate.\n'), null, 'an unpublished multiline note is skipped, not fatal');
  assert.throws(() => vaultNoteDraft('Knowledge/Long.md', '---\nopswiki: publish\ndate: 2026-10-09\nsummary: >\n  folded text\n---\n'), /Long\.md: frontmatter field "summary" uses multiline YAML/);
  const manifest = vaultKnowledgeManifest(vault);
  assert.deepEqual(manifest.records.map(record => record.sourceNote), ['vault/Decisions/Backup target.md', 'vault/Lessons/Rsync locks.md'], 'only published notes outside Inbox, Templates and Tasks');
  const [decision, lesson] = manifest.records;
  assert.equal(decision.kind, 'decision'); assert.equal(decision.title, 'Backup target'); assert.equal(decision.learning?.outcome, 'context');
  assert.equal(decision.body, 'Chosen: new host. Rejected: retired VPS.', 'title heading is not repeated in the body');
  assert.deepEqual(decision.learning?.topics, ['backup', 'vps']);
  assert.equal(lesson.kind, 'incident'); assert.equal(lesson.workspace, 'Command'); assert.equal(lesson.learning?.sourceKey, 'vault:lesson-rsync-locks');
  assert.deepEqual(lesson.learning?.topics, ['backup', 'rsync']);

  assert.equal(importKnowledgeHistory(manifest, store, true).created, 2);
  assert.equal(importKnowledgeHistory(vaultKnowledgeManifest(vault), store, true).unchanged, 2, 'republishing an unchanged vault is a no-op');
  fs.renameSync(path.join(vault, 'Lessons/Rsync locks.md'), path.join(vault, 'Lessons/Rsync lock files.md'));
  const renamed = importKnowledgeHistory(vaultKnowledgeManifest(vault), store, true);
  assert.deepEqual([renamed.created, renamed.revised], [0, 1], 'an explicit id revises the same entry after a rename');
  assert.equal(readKnowledgeEntries(store).length, 2);
  assert.equal(readKnowledgeEntries(store).every(entry => entry.status === 'draft'), true, 'publishing never verifies');
  assert.equal(knowledgeSnapshot(false, store).entries.some(entry => entry.sourceLabel === 'OpsCenter vault'), false, 'vault notes stay manager-only');

  write('Knowledge/Broken.md', '---\nopswiki: publish\nsummary: Missing date.\n---\nBody\n');
  assert.throws(() => vaultKnowledgeManifest(vault), /Knowledge\/Broken\.md: add `date/);
  console.log('Vault knowledge passed: publish flag, skipped folders, folder kinds, frontmatter lists, stable ids, idempotent republish, draft status and manager-only access.');
} finally { fs.rmSync(root, { recursive: true, force: true }); }
