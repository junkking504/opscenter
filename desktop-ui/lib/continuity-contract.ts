export type ContinuityCheck = { key: string; title: string; status: 'ok' | 'warn' | 'unknown'; evidence: string; nextStep: string };
export type ContinuityIncident = { key: string; status: 'confirming' | 'open' | 'resolved'; firstSeenAt: string; lastSeenAt: string; resolvedAt: string | null; occurrences: number };
export type ContinuitySnapshot = {
  available: boolean; fresh: boolean; checkedAt: string | null; receivedAt: string | null;
  status: 'ready' | 'attention' | 'unknown'; checks: ContinuityCheck[]; incidents: ContinuityIncident[];
};
