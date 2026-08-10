export type ActorKind = "human" | "service" | "schedule" | "agent";

export type ActorRole = "admin" | "operator" | "manager" | "crew" | "service" | "agent";

export type PlatformActor = {
  id: string;
  kind: ActorKind;
  externalIdentity: string;
  displayName: string;
  roles: Array<{
    role: ActorRole;
    resourceScope: string;
  }>;
};

export type EntityType = "job" | "employee" | "truck" | "finance" | "customer" | "lead" | "platform";

export type EntityReference = {
  type: EntityType;
  id: string;
  label?: string;
  externalReferences?: Array<{
    system: string;
    id: string;
  }>;
};

export type WorkItemStatus =
  | "open"
  | "acknowledged"
  | "in_progress"
  | "snoozed"
  | "resolved"
  | "dismissed";

export type WorkItemSeverity = "critical" | "warning" | "info";

export type WorkItem = {
  id: string;
  dedupeKey: string;
  operatingDate: string;
  rule: string;
  category: "Crew" | "Jobs" | "Fleet" | "Finance";
  severity: WorkItemSeverity;
  entity: EntityReference;
  title: string;
  description: string;
  source: string;
  sourceObservedAt: string;
  status: WorkItemStatus;
  ownerActorId?: string;
  dueAt?: string;
  snoozedUntil?: string;
  resolutionCode?: string;
  resolutionNote?: string;
  firstDetectedAt: string;
  lastDetectedAt: string;
  resolvedAt?: string;
  version: number;
};

export type ActionRiskClass = 0 | 1 | 2 | 3;

export type ActionRunStatus =
  | "requested"
  | "awaiting_approval"
  | "denied"
  | "queued"
  | "running"
  | "verifying"
  | "succeeded"
  | "failed"
  | "cancelled";

export type PolicyDecision = {
  outcome: "allow" | "deny" | "approval_required";
  policyVersion: string;
  reasons: string[];
  decidedAt: string;
};

export type ActionRun<TInput = Record<string, unknown>> = {
  id: string;
  actionKey: string;
  actionVersion: number;
  riskClass: ActionRiskClass;
  actorId: string;
  entity: EntityReference;
  workItemId?: string;
  idempotencyKey: string;
  input: TInput;
  status: ActionRunStatus;
  policyDecision: PolicyDecision;
  requestedAt: string;
  approvedAt?: string;
  startedAt?: string;
  finishedAt?: string;
  verification?: ActionVerification;
  sanitizedError?: string;
  correlationId: string;
};

export type ActionExecutionContext<TInput> = {
  actionRunId: string;
  actor: PlatformActor;
  entity: EntityReference;
  input: TInput;
  correlationId: string;
};

export type ActionExecutionResult = {
  outcome: "accepted" | "completed";
  externalReference?: string;
  verificationAvailable: boolean;
  metadata?: Record<string, unknown>;
};

export type ActionVerification = {
  outcome: "verified" | "pending" | "mismatch";
  verifiedAt?: string;
  summary: string;
  evidence?: Record<string, unknown>;
};

export type ActionDefinition<TInput> = {
  key: string;
  version: number;
  title: string;
  riskClass: ActionRiskClass;
  supportedEntityTypes: EntityType[];
  requiredPermission: string;
  validateInput: (input: unknown) => TInput;
  redactInput: (input: TInput) => Record<string, unknown>;
  idempotencyKey: (context: Omit<ActionExecutionContext<TInput>, "actor">) => string;
  execute: (context: ActionExecutionContext<TInput>) => Promise<ActionExecutionResult>;
  verify: (
    context: ActionExecutionContext<TInput>,
    result: ActionExecutionResult,
  ) => Promise<ActionVerification>;
  retryableErrors: (error: unknown) => boolean;
  recoveryGuidance: string;
  emittedEventTypes: string[];
};

export type PlatformEvent<TPayload = Record<string, unknown>> = {
  id: string;
  eventType: string;
  eventVersion: number;
  aggregateType: string;
  aggregateId: string;
  actorId?: string;
  occurredAt: string;
  recordedAt: string;
  correlationId: string;
  causationId?: string;
  payload: TPayload;
};
