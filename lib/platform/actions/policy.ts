import type {
  ActionDefinition,
  ActorRole,
  PlatformActor,
  PolicyDecision,
} from "@/lib/platform/contracts";

export type ActionPolicyResult = {
  decision: PolicyDecision;
  requestedFromRole?: "manager" | "admin";
};

const ROLE_PERMISSIONS: Readonly<Record<ActorRole, ReadonlySet<string>>> = {
  admin: new Set(["operations.read", "operations.write", "finance.read", "sensitive.write", "platform.manage"]),
  manager: new Set(["operations.read", "operations.write", "finance.read", "sensitive.write"]),
  operator: new Set(["operations.read", "operations.write"]),
  crew: new Set(["operations.read"]),
  service: new Set(),
  agent: new Set(["operations.read"]),
};

export function actorHasPermission(actor: PlatformActor, permission: string): boolean {
  return actor.roles.some(({ role }) => ROLE_PERMISSIONS[role]?.has(permission));
}

export function actorCanApprove(actor: PlatformActor, requestedFromRole: string): boolean {
  if (requestedFromRole === "admin") return actor.roles.some(({ role }) => role === "admin");
  return actor.roles.some(({ role }) => role === "manager" || role === "admin");
}

export function decideActionPolicy<TInput>(
  definition: ActionDefinition<TInput>,
  actor: PlatformActor,
  now = new Date(),
): ActionPolicyResult {
  const decidedAt = now.toISOString();
  if (!actorHasPermission(actor, definition.requiredPermission)) {
    return {
      decision: {
        outcome: "deny",
        policyVersion: "opsbot-control.v1",
        reasons: [`Actor lacks ${definition.requiredPermission}.`],
        decidedAt,
      },
    };
  }

  if (definition.riskClass >= 2 || (actor.kind === "agent" && definition.riskClass > 0)) {
    return {
      decision: {
        outcome: "approval_required",
        policyVersion: "opsbot-control.v1",
        reasons: [
          actor.kind === "agent"
            ? "Agent-initiated writes require human approval."
            : `Risk class ${definition.riskClass} requires explicit human approval.`,
        ],
        decidedAt,
      },
      requestedFromRole: "manager",
    };
  }

  return {
    decision: {
      outcome: "allow",
      policyVersion: "opsbot-control.v1",
      reasons: ["Actor permission and action risk are within the direct-execution boundary."],
      decidedAt,
    },
  };
}
