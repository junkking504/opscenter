export type MetricComparison = { prior: number | null; label: string };
/** Undefined, non-finite and zero baselines cannot support a percentage. */
export function percentDelta(current: number | null | undefined, prior: number | null | undefined) {
  return current == null || prior == null || !Number.isFinite(current) || !Number.isFinite(prior) || prior === 0 ? null : (current - prior) / Math.abs(prior) * 100;
}
export function DeltaChip({ current, comparison, lowerIsBetter = false }: { current: number | null | undefined; comparison?: MetricComparison; lowerIsBetter?: boolean }) {
  const delta = percentDelta(current, comparison?.prior);
  if (delta == null) return null;
  const direction = delta === 0 ? 'neutral' : (delta > 0) !== lowerIsBetter ? 'positive' : 'negative';
  const label = `${delta >= 0 ? '+' : '−'}${Math.abs(delta).toFixed(1)}%`;
  return <span className={`delta-chip delta-${direction}`} title={`${label} vs ${comparison!.label} (${comparison!.prior!.toLocaleString('en-US')})`} aria-label={`${label} versus ${comparison!.label}`}>{label}</span>;
}
