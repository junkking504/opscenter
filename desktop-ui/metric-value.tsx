import type { ReactNode } from 'react';

/** Missing observations never inherit the headline treatment of real values. */
export function MetricValue({ value, reason }: { value: ReactNode; reason?: string }) {
  const text = typeof value === 'string' ? value.trim() : '';
  const missing = value == null || typeof value === 'number' && !Number.isFinite(value) || /^(?:—(?:\s.*)?|Unavailable|Hours unavailable|Missing clock-out|Missing clock-in|Not recorded|Stale|Unknown|No record|Not available|N\/A)$/i.test(text);
  if (!missing) return <>{value}</>;
  const explanation = reason || (text && text !== '—' ? text : 'This value is not available in the selected source records.');
  return <span className="missing-value" title={explanation} aria-label={explanation}>—</span>;
}
