const SENSITIVE_KEY = /(?:authorization|cookie|credential|password|private.?key|secret|session|token)/i;
const REDACTED = "[REDACTED]";
const MAX_DEPTH = 12;

export function redactOperationalValue(value: unknown): unknown {
  return redact(value, new WeakSet<object>(), 0);
}

function redact(value: unknown, seen: WeakSet<object>, depth: number): unknown {
  if (depth > MAX_DEPTH) return "[MAX_DEPTH]";
  if (value === null || value === undefined) return value;
  if (typeof value === "bigint") return value.toString();
  if (typeof value !== "object") return value;
  if (value instanceof Date) return value.toISOString();
  if (seen.has(value)) return "[CIRCULAR]";

  seen.add(value);
  try {
    if (Array.isArray(value)) {
      return value.map((item) => redact(item, seen, depth + 1));
    }

    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        SENSITIVE_KEY.test(key) ? REDACTED : redact(item, seen, depth + 1),
      ]),
    );
  } finally {
    seen.delete(value);
  }
}
