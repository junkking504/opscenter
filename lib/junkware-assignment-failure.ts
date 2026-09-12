export type JunkwareAssignmentSyncStatus = "pending" | "verified" | "manual_correction";

const JUNKWARE_VALIDATION_REJECTION = /JunkWare blocked [^:]+:\s*(?:please\s+(?:enter|select)|(?:an?\s+)?(?:valid|invalid|required)\b)/i;

export const JUNKWARE_DISPATCH_PREFLIGHT_REJECTION = /This appointment is not draggable in the source daily schedule\.|JunkWare dispatch preflight:|The requested JunkWare dispatch lane is unavailable\./;

export function classifyJunkwareAssignmentFailure(error: unknown): JunkwareAssignmentSyncStatus {
  const detail = error instanceof Error ? error.message : String(error || "");
  return (JUNKWARE_VALIDATION_REJECTION.test(detail) || JUNKWARE_DISPATCH_PREFLIGHT_REJECTION.test(detail)) ? "manual_correction" : "pending";
}
