import type { ActionRun, EntityReference, PlatformActor } from "@/lib/platform/contracts";
import { createCorrelationId } from "@/lib/platform/identifiers";
import { actorCanApprove, decideActionPolicy } from "@/lib/platform/actions/policy";
import {
  actionSupportsEntity,
  registeredActionDefinition,
  registeredActionDefinitions,
} from "@/lib/platform/actions/registry";
import { getPlatformActor } from "@/lib/platform/persistence/actors";
import {
  createPersistedActionRun,
  decidePersistedApproval,
  getActionRun,
  listActionRuns,
  transitionPersistedActionRun,
} from "@/lib/platform/persistence/action-runs";

function safeError(error: unknown): string {
  const message = error instanceof Error ? error.message : "Unknown action failure.";
  return message
    .replace(/postgres(?:ql)?:\/\/[^\s]+/gi, "[DATABASE_URL_REDACTED]")
    .replace(/(token|secret|password|cookie)\s*[=:]\s*[^\s,;]+/gi, "$1=[REDACTED]")
    .slice(0, 1_000);
}

export function actionCatalog() {
  return registeredActionDefinitions().map((definition) => ({
    key: definition.key,
    version: definition.version,
    title: definition.title,
    riskClass: definition.riskClass,
    requiredPermission: definition.requiredPermission,
    supportedEntityTypes: definition.supportedEntityTypes,
    recoveryGuidance: definition.recoveryGuidance,
  }));
}

export function summarizeActionRuns(runs: ActionRun[]) {
  return {
    total: runs.length,
    awaitingApproval: runs.filter((run) => run.status === "awaiting_approval").length,
    executing: runs.filter((run) => ["queued", "running", "verifying"].includes(run.status)).length,
    succeeded: runs.filter((run) => run.status === "succeeded").length,
    failed: runs.filter((run) => run.status === "failed").length,
  };
}

export async function executeActionRun(run: ActionRun): Promise<ActionRun> {
  if (run.status !== "queued") return run;
  const definition = registeredActionDefinition(run.actionKey);
  if (!definition) {
    return transitionPersistedActionRun({
      id: run.id,
      nextStatus: "failed",
      eventType: "action.failed.v1",
      sanitizedError: "The registered action definition is unavailable.",
    });
  }
  const actor = await getPlatformActor(run.actorId);
  if (!actor) {
    return transitionPersistedActionRun({
      id: run.id,
      nextStatus: "failed",
      eventType: "action.failed.v1",
      sanitizedError: "The requesting actor is unavailable or disabled.",
    });
  }

  let current = await transitionPersistedActionRun({
    id: run.id,
    nextStatus: "running",
    eventType: "action.started.v1",
    actorId: actor.id,
  });
  try {
    const validatedInput = definition.validateInput(current.input);
    const context = {
      actionRunId: current.id,
      actor,
      entity: current.entity,
      input: validatedInput,
      correlationId: current.correlationId,
    };
    const result = await definition.execute(context);
    current = await transitionPersistedActionRun({
      id: current.id,
      nextStatus: "verifying",
      eventType: "action.verification_started.v1",
      actorId: actor.id,
      verification: result.verificationAvailable
        ? { outcome: "pending", summary: "Execution completed; authoritative verification is in progress." }
        : { outcome: "pending", summary: "The external outcome is awaiting a verifiable observation." },
    });
    if (!result.verificationAvailable) return current;

    const verification = await definition.verify(context, result);
    if (verification.outcome === "pending") {
      return transitionPersistedActionRun({
        id: current.id,
        nextStatus: "verifying",
        eventType: "action.verification_pending.v1",
        actorId: actor.id,
        verification,
      });
    }
    return transitionPersistedActionRun({
      id: current.id,
      nextStatus: verification.outcome === "verified" ? "succeeded" : "failed",
      eventType: verification.outcome === "verified" ? "action.succeeded.v1" : "action.verification_failed.v1",
      actorId: actor.id,
      verification,
      sanitizedError: verification.outcome === "mismatch" ? verification.summary : undefined,
    });
  } catch (error) {
    return transitionPersistedActionRun({
      id: current.id,
      nextStatus: "failed",
      eventType: "action.failed.v1",
      actorId: actor.id,
      sanitizedError: safeError(error),
    });
  }
}

export async function requestAction(input: {
  actor: PlatformActor;
  actionKey: string;
  entity: EntityReference;
  workItemId?: string;
  rawInput: unknown;
  requestKey?: string;
}): Promise<{ run: ActionRun; created: boolean }> {
  const definition = registeredActionDefinition(input.actionKey);
  if (!definition) throw new Error("Registered action not found.");
  if (!actionSupportsEntity(definition, input.entity.type)) throw new Error("Action does not support this entity type.");
  if (input.workItemId && input.workItemId !== input.entity.id) throw new Error("Work-item action entity mismatch.");
  const validatedInput = definition.validateInput(input.rawInput);
  const correlationId = createCorrelationId();
  const policy = decideActionPolicy(definition, input.actor);
  const idempotencyKey = String(input.requestKey || definition.idempotencyKey({
    actionRunId: "pending",
    entity: input.entity,
    input: validatedInput,
    correlationId,
  })).trim().slice(0, 500);
  if (!idempotencyKey) throw new Error("Action idempotency key is required.");
  const status = policy.decision.outcome === "allow"
    ? "queued"
    : policy.decision.outcome === "approval_required" ? "awaiting_approval" : "denied";
  const persisted = await createPersistedActionRun({
    actionKey: definition.key,
    actionVersion: definition.version,
    riskClass: definition.riskClass,
    actor: input.actor,
    entity: input.entity,
    workItemId: input.workItemId,
    idempotencyKey,
    storedInput: definition.redactInput(validatedInput),
    status,
    policyDecision: policy.decision,
    requestedFromRole: policy.requestedFromRole,
    correlationId,
  });
  return {
    ...persisted,
    run: persisted.created && persisted.run.status === "queued"
      ? await executeActionRun(persisted.run)
      : persisted.run,
  };
}

export async function decideActionApproval(input: {
  actor: PlatformActor;
  actionRunId: string;
  decision: "approved" | "denied";
  reason?: string;
}): Promise<ActionRun> {
  if (!actorCanApprove(input.actor, "manager")) throw new Error("Manager approval is required.");
  const run = await getActionRun(input.actionRunId);
  if (!run) throw new Error("Action run not found.");
  if (run.actorId === input.actor.id && run.riskClass >= 3) {
    throw new Error("Sensitive actions require approval from a different manager or administrator.");
  }
  const decided = await decidePersistedApproval({
    actionRunId: input.actionRunId,
    decision: input.decision,
    actorId: input.actor.id,
    reason: String(input.reason || "").trim().slice(0, 1_000),
  });
  return decided.status === "queued" ? executeActionRun(decided) : decided;
}

export async function actionControlSnapshot(workItemId?: string) {
  const runs = await listActionRuns({ limit: 40, workItemId });
  return { catalog: actionCatalog(), runs, summary: summarizeActionRuns(runs) };
}
