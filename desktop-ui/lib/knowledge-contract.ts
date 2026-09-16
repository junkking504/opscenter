export const KNOWLEDGE_KINDS = ['procedure', 'decision', 'incident', 'discussion', 'pattern'] as const;
export const KNOWLEDGE_WORKSPACES = ['All', 'Command', 'Schedule', 'Krewe', 'Fleet', 'Finance', 'Marketing'] as const;
export type KnowledgeKind = typeof KNOWLEDGE_KINDS[number];
export type KnowledgeWorkspace = typeof KNOWLEDGE_WORKSPACES[number];
export const KNOWLEDGE_OUTCOMES = ['fixed', 'follow-up', 'open', 'unknown', 'context'] as const;
export const outcomeLabel = { fixed: 'Historical fix', 'follow-up': 'Fix with follow-up', open: 'Open in source', unknown: 'Outcome not established', context: 'Context / decision' };
export type KnowledgeLearning = { sourceKey: string; recordedAt: string; outcome: typeof KNOWLEDGE_OUTCOMES[number]; topics: string[] };
export type KnowledgeDraft = {
  title: string; kind: KnowledgeKind; workspace: KnowledgeWorkspace; summary: string;
  body: string; sourceLabel: string; sourceUrl: string; sourceNote: string; owner: string; learning?: KnowledgeLearning;
};
export type KnowledgeEntry = KnowledgeDraft & {
  id: string; version: number; status: 'documented' | 'draft' | 'verified' | 'archived';
  updatedAt: string; updatedBy: string; verifiedAt: string | null; verifiedBy: string | null;
  reviewDue: string | null; verificationNote: string; sourceExcerpt?: string;
  history: Array<{ version: number; action: string; at: string; actor: string; requestId: string }>;
};
export type KnowledgeSnapshot = { entries: KnowledgeEntry[]; canManage: boolean; observedAt: string; available: boolean; error?: string };
export type KnowledgeAction = {
  action: 'save' | 'verify' | 'archive' | 'restore'; id: string; expectedVersion: number;
  requestId: string; draft?: KnowledgeDraft; verificationNote?: string;
};
export function knowledgeStatus(entry: KnowledgeEntry, now = Date.now()): string {
  if (entry.status === 'archived') return 'Archived';
  if (entry.status === 'draft') return 'Needs review';
  if (!entry.reviewDue || Date.parse(entry.reviewDue) <= now) return 'Review due';
  return entry.status === 'documented' ? 'Documented' : 'Verified';
}
export function searchKnowledge(entries: KnowledgeEntry[], query: string, workspace: string, kind: string, status: string, outcome = 'all') {
  const words = query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
  return entries.filter(entry => (workspace === 'All' || entry.workspace === 'All' || entry.workspace === workspace)
    && (outcome === 'all' || entry.learning?.outcome === outcome)
    && (kind === 'all' || entry.kind === kind)
    && (status === 'all' ? entry.status !== 'archived' : status === 'review' ? ['Needs review', 'Review due'].includes(knowledgeStatus(entry)) : entry.status === status)
    && words.every(word => [entry.title, entry.summary, entry.body, entry.sourceLabel, entry.sourceNote, entry.owner, ...(entry.learning?.topics || [])].join(' ').toLocaleLowerCase().includes(word)))
    .sort((a, b) => Number(b.workspace === workspace) - Number(a.workspace === workspace) || a.title.localeCompare(b.title));
}

/** Suggestions share recorded topics; they are evidence leads, never repair authorization. */
export function relatedKnowledge(entry: KnowledgeEntry, entries: KnowledgeEntry[]) {
  const topics = new Set(entry.learning?.topics || []);
  return entries.filter(other => other.id !== entry.id && other.status !== 'archived' && other.learning?.topics.some(topic => topics.has(topic)))
    .map(other => ({ entry: other, matches: other.learning!.topics.filter(topic => topics.has(topic)).length }))
    .sort((a, b) => b.matches - a.matches || Number(b.entry.kind === 'pattern') - Number(a.entry.kind === 'pattern') || b.entry.learning!.recordedAt.localeCompare(a.entry.learning!.recordedAt))
    .slice(0, 6).map(row => row.entry);
}
