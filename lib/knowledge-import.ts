import crypto from 'node:crypto';
import { executeKnowledgeAction, readKnowledgeEntries, validateKnowledgeDraft, KnowledgeError } from './knowledge-store';
import type { KnowledgeDraft } from '../desktop-ui/lib/knowledge-contract';

export type KnowledgeImport = { schema: 1; records: KnowledgeDraft[] };
export const historyImporter = { id: 'second-brain-history-import', canManage: true };
export function knowledgeSourceId(key: string) {
  const hex = crypto.createHash('sha256').update(`opscenter-knowledge:${key}`).digest('hex');
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-5${hex.slice(13,16)}-a${hex.slice(17,20)}-${hex.slice(20,32)}`;
}
export function importKnowledgeHistory(value: unknown, directory: string, apply = false) {
  const manifest = value as KnowledgeImport;
  if (!manifest || manifest.schema !== 1 || !Array.isArray(manifest.records) || manifest.records.length > 2000) throw new KnowledgeError('Provide a schema 1 history manifest with at most 2000 records.');
  const keys = new Set<string>();
  // Validate the complete manifest before publishing anything. Source text is data, not executable instructions.
  const drafts = manifest.records.map(item => {
    const draft = validateKnowledgeDraft(item);
    if (!draft.learning) throw new KnowledgeError('Imported records require dated source metadata.');
    if (keys.has(draft.learning.sourceKey)) throw new KnowledgeError('Duplicate historical source key.');
    keys.add(draft.learning.sourceKey);
    return draft;
  });
  const existing = new Map(readKnowledgeEntries(directory).map(entry => [entry.id, entry]));
  const plan = drafts.map(draft => {
    const id = knowledgeSourceId(draft.learning!.sourceKey);
    const entry = existing.get(id);
    const equal = entry && JSON.stringify(validateKnowledgeDraft(entry)) === JSON.stringify(draft);
    // A manager's edits, verification, and archive decisions always win over re-imports.
    const disposition = equal ? 'unchanged' : entry && entry.updatedBy !== historyImporter.id ? 'conflict' : 'save';
    return { id, draft, expectedVersion: entry?.version || 0, disposition };
  });
  const report = { apply, created: 0, revised: 0, unchanged: 0, conflicts: [] as string[], ids: [] as string[] };
  for (const row of plan) {
    report.ids.push(row.id);
    if (row.disposition === 'conflict') { report.conflicts.push(row.draft.learning!.sourceKey); continue; }
    if (row.disposition === 'unchanged') { report.unchanged++; continue; }
    if (apply) executeKnowledgeAction({ action: 'save', id: row.id, requestId: crypto.randomUUID(), expectedVersion: row.expectedVersion, draft: row.draft }, historyImporter, directory);
    if (row.expectedVersion) report.revised++; else report.created++;
  }
  return report;
}
