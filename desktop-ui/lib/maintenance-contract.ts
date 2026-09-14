export type MaintenanceObservation = {
  key: string; title: string; area: string; kind: 'technical' | 'review';
  unhealthy: boolean | null; evidence: string; nextStep: string;
  clientFailureAt?: number; recoveryVerifiedAt?: number;
};
export type MaintenanceDiagnosis = { summary: string; likelyCause: string; nextStep: string; verification: string };
export type MaintenanceIncident = MaintenanceObservation & {
  status: 'confirming' | 'open' | 'resolved'; firstSeenAt: string; lastSeenAt: string;
  resolvedAt: string | null; badChecks: number; goodChecks: number; occurrences: number;
  diagnosis?: MaintenanceDiagnosis; diagnosisAt?: string; attempts: number; attemptedAt?: string;
  diagnosisStatus?: 'pending' | 'complete' | 'unavailable';
};
export type MaintenanceState = {
  version: 1; checkedAt: string | null; aiStatus: string;
  aiRetryAfter?: string;
  incidents: MaintenanceIncident[];
  months: Record<string, { committedMicros: number; estimatedMicros: number; calls: number; inputTokens: number; outputTokens: number }>;
  receipts: Array<{ at: string; incident: string; event: string }>;
  addressResearch?: AddressResearchState;
};
export type AddressResearchItem = {
  address: string; dates: string[]; firstSeenAt: string; updatedAt: string;
  status: 'queued' | 'ready' | 'researching' | 'resolved' | 'unresolved' | 'provider_error' | 'inactive';
  attempts: number; committedMicros: number; estimatedMicros: number;
  reason: string; candidate?: string; sources?: string[]; responseId?: string;
};
export type AddressResearchState = {
  version: 1; checkedAt: string | null; status: string; items: Record<string, AddressResearchItem>;
};
export type AddressResearchSnapshot = {
  enabled: boolean; checkedAt: string | null; status: string; perAddressUsd: number;
  pending: number; resolved: number; unresolved: number;
  items: Array<AddressResearchItem & { id: string }>;
};
export type MaintenanceSnapshot = {
  available: boolean; fresh: boolean; checkedAt: string | null; mode: 'observe'; aiStatus: string;
  month: string; budgetUsd: number; committedUsd: number; estimatedUsd: number; calls: number;
  incidents: MaintenanceIncident[];
  recovery?: MaintenanceRecovery;
  canManageRecovery?: boolean;
  addressResearch?: AddressResearchSnapshot;
};
export type MaintenanceRecovery = {
  enabled: boolean; available: boolean; fresh: boolean; checkedAt: string | null;
  status: string; attemptsToday: number;
  receipts: Array<{ at: string; event: string }>;
};
