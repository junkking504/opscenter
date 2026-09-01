import type {
  ActionDefinition,
  ActionVerification,
  EntityType,
} from "@/lib/platform/contracts";
import { dispatchActionDefinitions } from "@/lib/platform/actions/dispatch";
import { communicationsActionDefinitions } from "@/lib/platform/actions/communications";
import { customerContactActionDefinitions } from "@/lib/platform/actions/customer-contact";
import { fleetActionDefinitions } from "@/lib/platform/actions/fleet";
import { financeActionDefinitions } from "@/lib/platform/actions/finance";
import { kreweActionDefinitions } from "@/lib/platform/actions/krewe";
import { linxupActionDefinitions } from "@/lib/platform/actions/linxup";
import { marketingActionDefinitions } from "@/lib/platform/actions/marketing";
import { searchKingsActionDefinitions } from "@/lib/platform/actions/searchkings";
import { systemsActionDefinitions } from "@/lib/platform/actions/systems";
import { getWorkItem, mutateWorkItem, type WorkItemMutation } from "@/lib/platform/persistence/work-items";

type VersionedInput = { expectedVersion: number };
type SnoozeInput = VersionedInput & { until: string };
type ResolutionInput = VersionedInput & { reason: string };

function versionedInput(value: unknown): VersionedInput {
  const input = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const expectedVersion = Number(input.expectedVersion);
  if (!Number.isInteger(expectedVersion) || expectedVersion < 1) {
    throw new Error("A valid expectedVersion is required.");
  }
  return { expectedVersion };
}

function snoozeInput(value: unknown): SnoozeInput {
  const input = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const base = versionedInput(input);
  const until = new Date(String(input.until || ""));
  if (Number.isNaN(until.getTime()) || until.getTime() <= Date.now()) {
    throw new Error("Snooze time must be in the future.");
  }
  return { ...base, until: until.toISOString() };
}

function resolutionInput(value: unknown): ResolutionInput {
  const input = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const base = versionedInput(input);
  const reason = String(input.reason || "").trim();
  if (reason.length < 3) throw new Error("A resolution reason of at least 3 characters is required.");
  return { ...base, reason: reason.slice(0, 1_000) };
}

function workMutationAction<TInput extends VersionedInput>(input: {
  key: string;
  title: string;
  riskClass: 1 | 3;
  permission: "operations.write" | "sensitive.write";
  validateInput: (value: unknown) => TInput;
  mutation: (input: TInput) => WorkItemMutation;
  verify: (input: TInput, actorId: string, workItemId: string) => Promise<ActionVerification>;
  emittedEvent: string;
}): ActionDefinition<TInput> {
  return {
    key: input.key,
    version: 1,
    title: input.title,
    riskClass: input.riskClass,
    supportedEntityTypes: ["platform"],
    requiredPermission: input.permission,
    validateInput: input.validateInput,
    redactInput: (value) => ({ ...value }),
    idempotencyKey: ({ entity, input: value }) => `${entity.id}|v${value.expectedVersion}`,
    execute: async (context) => {
      const item = await mutateWorkItem({
        id: context.entity.id,
        expectedVersion: context.input.expectedVersion,
        actorId: context.actor.id,
        correlationId: context.correlationId,
        mutation: input.mutation(context.input),
      });
      return {
        outcome: "completed",
        verificationAvailable: true,
        metadata: {
          workItemId: item.id,
          workItemStatus: item.status,
          workItemVersion: item.version,
        },
      };
    },
    verify: async (context) => input.verify(context.input, context.actor.id, context.entity.id),
    retryableErrors: (error) => !/VERSION_CONFLICT|required|transition|not found/i.test(error instanceof Error ? error.message : String(error)),
    recoveryGuidance: "Refresh the work item, review its current version and state, then submit a new action request if the intent is still valid.",
    emittedEventTypes: [input.emittedEvent],
  };
}

async function verifyWorkItem(
  workItemId: string,
  predicate: (item: NonNullable<Awaited<ReturnType<typeof getWorkItem>>>) => boolean,
  verifiedSummary: string,
): Promise<ActionVerification> {
  const item = await getWorkItem(workItemId);
  if (!item) return { outcome: "mismatch", summary: "The work item no longer exists." };
  if (!predicate(item)) {
    return {
      outcome: "mismatch",
      summary: "The work item does not match the requested outcome.",
      evidence: { status: item.status, ownerActorId: item.ownerActorId || null, version: item.version },
    };
  }
  return {
    outcome: "verified",
    verifiedAt: new Date().toISOString(),
    summary: verifiedSummary,
    evidence: { status: item.status, ownerActorId: item.ownerActorId || null, version: item.version },
  };
}

const workActionDefinitions: ActionDefinition<any>[] = [
  workMutationAction<VersionedInput>({
    key: "work.acknowledge.v1",
    title: "Acknowledge work item",
    riskClass: 1,
    permission: "operations.write",
    validateInput: versionedInput,
    mutation: () => ({ action: "acknowledge" }),
    verify: (_input, _actorId, id) => verifyWorkItem(id, (item) => item.status === "acknowledged", "Acknowledgement verified in OpsCenter work state."),
    emittedEvent: "work.acknowledged.v1",
  }),
  workMutationAction<VersionedInput>({
    key: "work.assign_self.v1",
    title: "Assign work item to requester",
    riskClass: 1,
    permission: "operations.write",
    validateInput: versionedInput,
    mutation: () => ({ action: "assign_self" }),
    verify: (_input, actorId, id) => verifyWorkItem(id, (item) => item.ownerActorId === actorId, "Ownership verified in OpsCenter work state."),
    emittedEvent: "work.assigned.v1",
  }),
  workMutationAction<SnoozeInput>({
    key: "work.snooze.v1",
    title: "Snooze work item",
    riskClass: 1,
    permission: "operations.write",
    validateInput: snoozeInput,
    mutation: (input) => ({ action: "snooze", until: input.until }),
    verify: (input, _actorId, id) => verifyWorkItem(id, (item) => item.status === "snoozed" && item.snoozedUntil === input.until, "Snooze state and return time verified in OpsCenter."),
    emittedEvent: "work.snoozed.v1",
  }),
  workMutationAction<VersionedInput>({
    key: "work.reopen.v1",
    title: "Reopen work item",
    riskClass: 1,
    permission: "operations.write",
    validateInput: versionedInput,
    mutation: () => ({ action: "reopen" }),
    verify: (_input, _actorId, id) => verifyWorkItem(id, (item) => item.status === "open", "Reopened state verified in OpsCenter."),
    emittedEvent: "work.reopened.v1",
  }),
  workMutationAction<ResolutionInput>({
    key: "work.resolve_manually.v1",
    title: "Manually resolve work item",
    riskClass: 3,
    permission: "operations.write",
    validateInput: resolutionInput,
    mutation: (input) => ({ action: "resolve_manually", reason: input.reason }),
    verify: (input, _actorId, id) => verifyWorkItem(
      id,
      (item) => item.status === "resolved" && item.resolutionCode === "manual_resolution" && item.resolutionNote === input.reason,
      "Manual resolution and recorded reason verified in OpsCenter.",
    ),
    emittedEvent: "work.resolved_manually.v1",
  }),
];

const definitions: ActionDefinition<any>[] = [
  ...workActionDefinitions,
  ...dispatchActionDefinitions,
  ...fleetActionDefinitions,
  ...financeActionDefinitions,
  ...kreweActionDefinitions,
  ...communicationsActionDefinitions,
  ...customerContactActionDefinitions,
  ...marketingActionDefinitions,
  ...searchKingsActionDefinitions,
  ...systemsActionDefinitions,
  ...linxupActionDefinitions,
];

const registry = new Map(definitions.map((definition) => [definition.key, definition]));

export function registeredActionDefinitions(): ReadonlyArray<ActionDefinition<any>> {
  return definitions;
}

export function registeredActionDefinition(key: string): ActionDefinition<any> | null {
  return registry.get(String(key || "").trim()) || null;
}

export function actionSupportsEntity(definition: ActionDefinition<any>, entityType: EntityType): boolean {
  return definition.supportedEntityTypes.includes(entityType);
}
