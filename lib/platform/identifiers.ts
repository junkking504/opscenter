const IDENTIFIER_PREFIX = /^[a-z][a-z0-9_]{1,30}$/;

function randomIdentifier(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  throw new Error("Secure random UUID generation is unavailable.");
}

export function createPlatformId(prefix: string): string {
  if (!IDENTIFIER_PREFIX.test(prefix)) {
    throw new Error(`Invalid platform identifier prefix: ${prefix}`);
  }
  return `${prefix}_${randomIdentifier()}`;
}

export function createCorrelationId(): string {
  return createPlatformId("corr");
}

export function workItemDedupeKey(input: {
  operatingDate: string;
  category: string;
  rule: string;
  entityType: string;
  entityId: string;
}): string {
  const parts = [
    input.operatingDate,
    input.category,
    input.rule,
    input.entityType,
    input.entityId,
  ].map((value) => String(value || "").trim());

  if (!/^\d{4}-\d{2}-\d{2}$/.test(parts[0]) || parts.some((value) => !value || value.includes("|"))) {
    throw new Error("Work item dedupe key fields are invalid.");
  }

  return parts.join("|");
}
