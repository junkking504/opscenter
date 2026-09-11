export type MaintenanceObservation = {
  key: string; title: string; area: string; kind: 'technical' | 'review';
  unhealthy: boolean | null; evidence: string; nextStep: string;
  verificationRequired?: boolean; verified?: boolean;
};
export type MaintenanceDiagnosis = { summary: string; likelyCause: string; nextStep: string; verification: string };
export type MaintenanceIncident = MaintenanceObservation & {
  status: 'confirming' | 'open' | 'verification-needed' | 'resolved'; firstSeenAt: string; lastSeenAt: string;
  resolvedAt: string | null; badChecks: number; goodChecks: number; occurrences: number;
  diagnosis?: MaintenanceDiagnosis; diagnosisAt?: string; attempts: number; attemptedAt?: string;
  diagnosisStatus?: 'pending' | 'complete' | 'unavailable';
  verifiedAt?: string; assessmentRefreshDue?: boolean;
};
export type MaintenanceState = {
  version: 1; checkedAt: string | null; aiStatus: string;
  aiRetryAfter?: string;
  aiFailureCode?: string; aiBlocked?: boolean;
  workflowCheck?: { at: number; results: Record<string, boolean | null> };
  incidents: MaintenanceIncident[];
  months: Record<string, { committedMicros: number; estimatedMicros: number; calls: number; inputTokens: number; outputTokens: number }>;
  receipts: Array<{ at: string; incident: string; event: string }>;
};
export type MaintenanceSnapshot = {
  available: boolean; fresh: boolean; checkedAt: string | null; mode: 'observe'; aiStatus: string;
  month: string; budgetUsd: number; committedUsd: number; estimatedUsd: number; calls: number;
  incidents: MaintenanceIncident[];
  recovery?: MaintenanceRecovery;
  canManageRecovery?: boolean;
  canVerify?: boolean;
  clientFailureTimes?: Record<string, number>;
};
export type MaintenanceRecovery = {
  enabled: boolean; available: boolean; fresh: boolean; checkedAt: string | null;
  status: string; attemptsToday: number;
  receipts: Array<{ at: string; event: string }>;
};
