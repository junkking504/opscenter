import type { ActionDefinition } from "@/lib/platform/contracts";
import {
  executeFleetOutOfService,
  executeFleetReturnToService,
  normalizeFleetControlTruck,
  verifyFleetOutOfService,
  verifyFleetReturnToService,
  type FleetOutOfServiceInput,
  type FleetReturnToServiceInput,
} from "@/lib/fleet-control";

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function expectedStoreUpdatedAt(input: Record<string, unknown>): string {
  if (!Object.prototype.hasOwnProperty.call(input, "expectedStoreUpdatedAt")) {
    throw new Error("The current Fleet repair state is required.");
  }
  const value = String(input.expectedStoreUpdatedAt || "").trim();
  if (value && !Number.isFinite(Date.parse(value))) throw new Error("The Fleet repair observation is invalid.");
  return value;
}

export function validateFleetOutOfService(value: unknown): FleetOutOfServiceInput {
  const input = record(value);
  const truck = normalizeFleetControlTruck(input.truck);
  const reason = String(input.reason || "").replace(/\s+/g, " ").trim().slice(0, 160);
  if (!truck) throw new Error("A valid Fleet truck is required.");
  if (reason.length < 5) throw new Error("An out-of-service reason of at least 5 characters is required.");
  return { truck, reason, expectedStoreUpdatedAt: expectedStoreUpdatedAt(input) };
}

export function validateFleetReturnToService(value: unknown): FleetReturnToServiceInput {
  const input = record(value);
  const truck = normalizeFleetControlTruck(input.truck);
  const issueId = String(input.issueId || "").trim();
  const resolution = String(input.resolution || "").replace(/\s+/g, " ").trim().slice(0, 1_000);
  const expectedIssueUpdatedAt = String(input.expectedIssueUpdatedAt || "").trim();
  if (!truck || !issueId) throw new Error("A valid blocking Fleet repair is required.");
  if (resolution.length < 5) throw new Error("A return-to-service resolution of at least 5 characters is required.");
  if (!Number.isFinite(Date.parse(expectedIssueUpdatedAt))) throw new Error("The current blocking repair observation is required.");
  return {
    truck,
    issueId,
    resolution,
    expectedStoreUpdatedAt: expectedStoreUpdatedAt(input),
    expectedIssueUpdatedAt,
  };
}

function entityMatchesTruck(entityId: string, truck: string): void {
  if (normalizeFleetControlTruck(entityId) !== truck) throw new Error("Fleet truck identity mismatch.");
}

export const fleetActionDefinitions: ActionDefinition<any>[] = [
  {
    key: "fleet.mark_out_of_service.v1",
    version: 1,
    title: "Place truck out of service",
    riskClass: 3,
    supportedEntityTypes: ["truck"],
    requiredPermission: "operations.write",
    validateInput: validateFleetOutOfService,
    redactInput: (input) => ({ ...input }),
    idempotencyKey: ({ entity, input }) => [entity.id, input.expectedStoreUpdatedAt || "initial", input.reason].join("|"),
    execute: async (context) => {
      entityMatchesTruck(context.entity.id, context.input.truck);
      const receipt = await executeFleetOutOfService(context.input);
      return { outcome: "completed", verificationAvailable: true, metadata: { receipt } };
    },
    verify: async (context, result) => verifyFleetOutOfService(
      result.metadata?.receipt as Awaited<ReturnType<typeof executeFleetOutOfService>>,
      context.input,
    ),
    retryableErrors: (error) => !/VERSION_CONFLICT|required|invalid|already has|identity mismatch/i.test(error instanceof Error ? error.message : String(error)),
    recoveryGuidance: "Refresh Fleet repair state, confirm the truck still needs a hold, then submit a new out-of-service request with the current reason.",
    emittedEventTypes: ["fleet.out_of_service_requested.v1", "fleet.out_of_service_verified.v1"],
  },
  {
    key: "fleet.return_to_service.v1",
    version: 1,
    title: "Return truck to service",
    riskClass: 3,
    supportedEntityTypes: ["truck"],
    requiredPermission: "operations.write",
    validateInput: validateFleetReturnToService,
    redactInput: (input) => ({ ...input }),
    idempotencyKey: ({ entity, input }) => [
      entity.id,
      input.issueId,
      input.expectedIssueUpdatedAt,
      input.expectedStoreUpdatedAt || "initial",
      input.resolution,
    ].join("|"),
    execute: async (context) => {
      entityMatchesTruck(context.entity.id, context.input.truck);
      const receipt = await executeFleetReturnToService(context.input);
      return { outcome: "completed", verificationAvailable: true, metadata: { receipt } };
    },
    verify: async (context, result) => verifyFleetReturnToService(
      result.metadata?.receipt as Awaited<ReturnType<typeof executeFleetReturnToService>>,
      context.input,
    ),
    retryableErrors: (error) => !/VERSION_CONFLICT|required|invalid|no longer|every other|identity mismatch/i.test(error instanceof Error ? error.message : String(error)),
    recoveryGuidance: "Refresh the Fleet repair queue. Resolve every remaining blocking repair, record the actual repair evidence, then submit a new return-to-service request.",
    emittedEventTypes: ["fleet.return_to_service_requested.v1", "fleet.return_to_service_verified.v1"],
  },
];
