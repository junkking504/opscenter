export const KNOWLEDGE_KINDS = ['procedure', 'decision', 'incident'] as const;
export const KNOWLEDGE_WORKSPACES = ['All', 'Command', 'Schedule', 'Krewe', 'Fleet', 'Finance', 'Marketing'] as const;
export type KnowledgeKind = typeof KNOWLEDGE_KINDS[number];
export type KnowledgeWorkspace = typeof KNOWLEDGE_WORKSPACES[number];
export type KnowledgeDraft = {
  title: string; kind: KnowledgeKind; workspace: KnowledgeWorkspace; summary: string;
  body: string; sourceLabel: string; sourceUrl: string; sourceNote: string; owner: string;
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
export function searchKnowledge(entries: KnowledgeEntry[], query: string, workspace: string, kind: string, status: string) {
  const words = query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
  return entries.filter(entry => (workspace === 'All' || entry.workspace === 'All' || entry.workspace === workspace)
    && (kind === 'all' || entry.kind === kind)
    && (status === 'all' ? entry.status !== 'archived' : status === 'review' ? ['Needs review', 'Review due'].includes(knowledgeStatus(entry)) : entry.status === status)
    && words.every(word => [entry.title, entry.summary, entry.body, entry.sourceLabel, entry.sourceNote, entry.owner].join(' ').toLocaleLowerCase().includes(word)))
    .sort((a, b) => Number(b.workspace === workspace) - Number(a.workspace === workspace) || a.title.localeCompare(b.title));
}
