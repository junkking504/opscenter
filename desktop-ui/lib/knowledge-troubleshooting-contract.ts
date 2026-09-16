export type KnowledgeTroubleshootingCase = {
  key: string; title: string; area: string; state: 'active' | 'confirming' | 'awaiting-verification' | 'recovering' | 'cleared' | 'stale';
  evidence: string; assessment: string; nextChecks: string[]; verification: string;
  occurrences: number; firstSeenAt: string; lastSeenAt: string; resolvedAt: string | null;
  matches: Array<{ id: string; title: string; summary: string; reason: string; recordedAt: string; outcome: string; reviewStatus: string }>;
};
export type KnowledgeTroubleshooting = {
  available: boolean; current: boolean; knowledgeAvailable: boolean; observedAt: string | null; evaluatedAt: string;
  message: string; cases: KnowledgeTroubleshootingCase[];
};
