type Highlight = "positive" | "negative" | "warn" | "neutral";

type MetricCardProps = {
  label: string;
  value: string;
  sublabel?: string;
  highlight?: Highlight;
};

const valueColor: Record<Highlight, string> = {
  positive: "text-good",
  negative: "text-red-400",
  warn: "text-warn",
  neutral: "text-ink",
};

export function MetricCard({ label, value, sublabel, highlight = "neutral" }: MetricCardProps) {
  return (
    <section className="rounded-lg border border-line bg-panel p-4 shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted">{label}</p>
      <p className={`mt-2 text-3xl font-semibold tracking-tight ${valueColor[highlight]}`}>{value}</p>
      {sublabel ? <p className="mt-1 text-xs text-muted">{sublabel}</p> : null}
    </section>
  );
}
