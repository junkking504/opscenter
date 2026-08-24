import fs from "node:fs";
import path from "node:path";

export const COLLECTOR_FAILURE_ESCALATION_THRESHOLD = 5;

export type CollectorFailure = {
  id: string;
  source: string;
  failedAt: string;
  firstFailedAt: string;
  consecutiveFailures: number;
  escalated: boolean;
  error: string;
};

function stateFile(): string {
  const configured = String(process.env.OPSCENTER_COLLECTOR_HEALTH_FILE || "").trim();
  if (configured) return configured;
  const dataDir = String(process.env.OPSBOT_DATA_DIR || "").trim();
  return path.join(dataDir || path.join(process.cwd(), "data"), "health", "collector_failures.json");
}

function sanitizeCollectorError(value: unknown): string {
  const source = value instanceof Error ? value.message : String(value || "External-source refresh failed.");
  const firstLine = source.split(/\r?\n/, 1)[0]
    .replace(/<[^>]*>/g, " ")
    .replace(/https?:\/\/[^\s?#]+\?[^\s]*/gi, "[redacted URL]")
    .replace(/\b(authorization|cookie|set-cookie|token|password|secret)\s*[:=]\s*[^\s,;]+/gi, "$1=[redacted]")
    .replace(/\s+/g, " ")
    .trim();
  return (firstLine || "External-source refresh failed.").slice(0, 240);
}

export function readCollectorFailures(): CollectorFailure[] {
  try {
    const payload = JSON.parse(fs.readFileSync(stateFile(), "utf8")) as { conditions?: unknown };
    if (!Array.isArray(payload.conditions)) return [];
    const seen = new Set<string>();
    return payload.conditions.flatMap((value): CollectorFailure[] => {
      if (!value || typeof value !== "object") return [];
      const record = value as Record<string, unknown>;
      const id = String(record.id || "").trim().toLowerCase();
      const source = String(record.source || "").trim();
      const failedAt = String(record.failed_at || "").trim();
      const firstFailedAt = String(record.first_failed_at || failedAt).trim();
      const consecutiveFailures = Math.max(1, Number(record.consecutive_failures) || 1);
      if (!/^[a-z0-9_-]{1,80}$/.test(id) || !source || seen.has(id)) return [];
      seen.add(id);
      return [{
        id,
        source: source.slice(0, 80),
        failedAt,
        firstFailedAt,
        consecutiveFailures,
        escalated: consecutiveFailures >= COLLECTOR_FAILURE_ESCALATION_THRESHOLD,
        error: sanitizeCollectorError(record.error),
      }];
    });
  } catch {
    return [];
  }
}
