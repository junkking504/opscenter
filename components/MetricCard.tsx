type Highlight = "positive" | "negative" | "warn" | "neutral";

type MetricCardProps = {
  label: string;
  value: string;
  sublabel?: string;
  highlight?: Highlight;
  sublabelTone?: Highlight;
};

const valueClass: Record<Highlight, string> = {
  positive: "ops-kpi-good",
  negative: "ops-kpi-danger",
  warn: "ops-kpi-accent",
  neutral: "",
};

const sublabelClass: Record<Highlight, string> = {
  positive: "ops-kpi-good",
  negative: "ops-kpi-danger",
  warn: "ops-kpi-sub-warn",
  neutral: "",
};

export function MetricCard({
  label,
  value,
  sublabel,
  highlight = "neutral",
  sublabelTone = "neutral",
}: MetricCardProps) {
  return (
    <section className="ops-card ops-kpi-card">
      <div className="ops-card-title">{label}</div>
      <div className={`ops-kpi-value ${valueClass[highlight]}`.trim()}>{value}</div>
      {sublabel ? (
        <div className={`ops-kpi-sub ${sublabelClass[sublabelTone]}`.trim()}>{sublabel}</div>
      ) : null}
    </section>
  );
}
