import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { KNOWLEDGE_KINDS, KNOWLEDGE_WORKSPACES, type KnowledgeAction, type KnowledgeDraft, type KnowledgeEntry } from '../desktop-ui/lib/knowledge-contract';
import { knowledgeSeeds } from './knowledge-seeds';

export class KnowledgeError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}
export const knowledgeDirectory = () => process.env.OPSCENTER_KNOWLEDGE_DIR || path.join(process.cwd(), 'data', 'second-brain');
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
type Revision = { schema: 1; requestId: string; fingerprint: string; actor: string; entry: KnowledgeEntry };
const hash = (value: unknown) => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
function field(value: unknown, name: string, max: number, optional = false): string {
  if (typeof value !== 'string' || value.length > max || (!optional && !value.trim())) throw new KnowledgeError(`Provide ${name} (${max} characters maximum).`);
  return value.trim();
}
export function validateKnowledgeDraft(value: unknown): KnowledgeDraft {
  if (!value || typeof value !== 'object') throw new KnowledgeError('Provide a knowledge entry.');
  const draft = value as KnowledgeDraft;
  if (!KNOWLEDGE_KINDS.includes(draft.kind) || !KNOWLEDGE_WORKSPACES.includes(draft.workspace)) throw new KnowledgeError('Choose a valid type and workspace.');
  const sourceUrl = field(draft.sourceUrl, 'a source URL', 2000, true);
  if (sourceUrl) {
    let url: URL;
    try { url = new URL(sourceUrl); } catch { throw new KnowledgeError('Use a complete HTTPS source URL.'); }
    if (url.protocol !== 'https:' || url.username || url.password) throw new KnowledgeError('Use an HTTPS source URL without credentials.');
  }
  return { title: field(draft.title, 'a title', 160), kind: draft.kind, workspace: draft.workspace,
    summary: field(draft.summary, 'a short summary', 400), body: field(draft.body, 'steps, reasoning or resolution', 16000),
    owner: field(draft.owner, 'an owner', 120), sourceLabel: field(draft.sourceLabel, 'a source name', 200), sourceUrl,
    sourceNote: field(draft.sourceNote, 'a source reference or evidence description', 3000) };
}
function revisions(id: string, directory: string): Revision[] {
  if (!uuid.test(id)) throw new KnowledgeError('Invalid entry ID.');
  const folder = path.join(directory, id);
  let names: string[];
  try { names = fs.readdirSync(folder).filter(name => /^\d+\.json$/.test(name)).sort((a,b) => parseInt(a) - parseInt(b)); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
  return names.map((name, index) => {
    const record = JSON.parse(fs.readFileSync(path.join(folder, name), 'utf8')) as Revision;
    if (record.schema !== 1 || record.entry?.id !== id || record.entry?.version !== index + 1 || parseInt(name) !== index + 1 || !uuid.test(record.requestId)
        || !['draft','verified','archived'].includes(record.entry.status) || !Array.isArray(record.entry.history)
        || !Number.isFinite(Date.parse(record.entry.updatedAt)) || typeof record.actor !== 'string') throw new Error('Knowledge history needs recovery.');
    validateKnowledgeDraft(record.entry);
    if (record.entry.status === 'verified' && (!record.entry.verifiedBy || !Number.isFinite(Date.parse(record.entry.verifiedAt || ''))
      || !Number.isFinite(Date.parse(record.entry.reviewDue || '')) || !record.entry.verificationNote)) throw new Error('Knowledge verification needs recovery.');
    return record;
  });
}
export function readKnowledgeEntries(directory = knowledgeDirectory()): KnowledgeEntry[] {
  let names: string[];
  try { names = fs.readdirSync(directory); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
  return names.filter(name => uuid.test(name)).flatMap(id => {
    const rows = revisions(id, directory); return rows.length ? [rows[rows.length - 1].entry] : [];
  });
}

/** Registered Class 1 local actions. No source-system writer or provider call. */
export const knowledgeActions = { save: 'Save for review', verify: 'Verify against source', archive: 'Archive', restore: 'Restore for review' } as const;
export function executeKnowledgeAction(input: KnowledgeAction, actor: { id: string; canManage: boolean }, directory = knowledgeDirectory(), now = new Date()): KnowledgeEntry {
  if (!actor.canManage) throw new KnowledgeError('Manager access is required to save or review knowledge.', 403);
  if (!input || !Object.hasOwn(knowledgeActions, input.action) || !uuid.test(input.id) || !uuid.test(input.requestId)
      || !Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 0) throw new KnowledgeError('Invalid knowledge action.');
  const draft = input.action === 'save' ? validateKnowledgeDraft(input.draft) : undefined;
  const note = input.action === 'verify' ? field(input.verificationNote, 'what you checked against the source', 3000) : '';
  const fingerprint = hash({ ...input, draft, verificationNote: note, actor: actor.id });
  const rows = revisions(input.id, directory);
  const previousRequest = rows.find(row => row.requestId === input.requestId);
  if (previousRequest) {
    if (previousRequest.actor !== actor.id || previousRequest.fingerprint !== fingerprint) throw new KnowledgeError('This request ID was already used for different content.', 409);
    // Return the latest read-back, even if this was a retry of an older revision.
    return rows[rows.length - 1].entry;
  }
  const previous = rows.at(-1)?.entry;
  if ((previous?.version || 0) !== input.expectedVersion) throw new KnowledgeError('This entry changed. Reload the library before saving your revision.', 409);
  if (!previous && input.action !== 'save') throw new KnowledgeError('Entry not found.', 404);
  if (previous?.status === 'archived' && input.action !== 'restore') throw new KnowledgeError('Restore this entry before editing or verifying it.');
  if (input.action === 'restore' && previous?.status !== 'archived') throw new KnowledgeError('Only archived entries can be restored.');
  const at = now.toISOString();
  const entry: KnowledgeEntry = { ...(previous || {}), ...(draft || {}), id: input.id, version: input.expectedVersion + 1,
    status: input.action === 'verify' ? 'verified' : input.action === 'archive' ? 'archived' : 'draft',
    updatedAt: at, updatedBy: actor.id, verifiedAt: input.action === 'verify' ? at : null,
    verifiedBy: input.action === 'verify' ? actor.id : null, verificationNote: note,
    reviewDue: input.action === 'verify' ? new Date(now.getTime() + 30 * 86400000).toISOString() : null,
    history: [...(previous?.history || []), { version: input.expectedVersion + 1, action: knowledgeActions[input.action], at, actor: actor.id, requestId: input.requestId }] } as KnowledgeEntry;
  const folder = path.join(directory, input.id);
  fs.mkdirSync(folder, { recursive: true, mode: 0o700 });
  const temporary = path.join(folder, `.${crypto.randomUUID()}.tmp`);
  const target = path.join(folder, `${entry.version}.json`);
  const record: Revision = { schema: 1, requestId: input.requestId, fingerprint, actor: actor.id, entry };
  const fd = fs.openSync(temporary, 'wx', 0o600);
  try { fs.writeFileSync(fd, JSON.stringify(record)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  try {
    // Publish a complete immutable revision atomically; competing writers cannot overwrite it.
    try { fs.linkSync(temporary, target); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
        const winner = revisions(input.id, directory).find(row => row.requestId === input.requestId && row.fingerprint === fingerprint);
        if (winner) return winner.entry;
        throw new KnowledgeError('Another editor saved first. Reload before saving your revision.', 409);
      }
      throw error;
    }
    const directoryFd = fs.openSync(folder, 'r');
    try { fs.fsyncSync(directoryFd); } finally { fs.closeSync(directoryFd); }
    return revisions(input.id, directory).at(-1)!.entry;
  } finally { fs.unlinkSync(temporary); }
}

export function knowledgeSnapshot(canManage: boolean, directory = knowledgeDirectory()) {
  // Captured notes are manager-only; curated operational guidance is readable by operators.
  try { return { entries: [...knowledgeSeeds, ...(canManage ? readKnowledgeEntries(directory) : [])], canManage, available: true, observedAt: new Date().toISOString() }; }
  catch { return { entries: knowledgeSeeds, canManage, available: false, observedAt: new Date().toISOString(), error: 'Saved knowledge is unavailable. Documented guides remain available; saving is paused until the history is recovered.' }; }
}
