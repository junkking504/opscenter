import Link from "next/link";

export type OperatingStatus = "on-track" | "watch" | "off-track";

export type OperatingPulseItem = {
  label: string;
  value: string;
  valueLabel?: string;
  supportingValues?: Array<{
    label: string;
    value: string;
  }>;
  target: string;
  detail: string;
  status: OperatingStatus;
};

export type OperatingAction = {
  title: string;
  detail: string;
  status: OperatingStatus;
  href?: string;
};

const statusLabel: Record<OperatingStatus, string> = {
  "on-track": "On track",
  watch: "Watch",
  "off-track": "Off track",
};

export default function OperatingPulse({
  title,
  subtitle,
  targetSummary,
  items,
  actions,
  id,
}: {
  title: string;
  subtitle: string;
  targetSummary: string;
  items: OperatingPulseItem[];
  actions: OperatingAction[];
  id?: string;
}) {
  const readiness = Math.round(
    items.reduce((sum, item) => sum + (item.status === "on-track" ? 100 : item.status === "watch" ? 68 : 28), 0) /
      Math.max(items.length, 1),
  );
  const overallStatus: OperatingStatus = readiness >= 85 ? "on-track" : readiness >= 60 ? "watch" : "off-track";
  const readinessLabel = overallStatus === "on-track" ? "Operational" : overallStatus === "watch" ? "Watch state" : "Intervention";

  return (
    <section className="ops-operating-pulse" id={id}>
      <div className="ops-operating-pulse-head">
        <div className="ops-operating-pulse-title">
          <div className="ops-operating-kicker"><span /> Operating brief</div>
          <h2>{title}</h2>
          <p>{subtitle}</p>
        </div>
        <div className="ops-target-summary">{targetSummary}</div>
      </div>

      <div className="ops-operating-pulse-body">
        <div className={`ops-readiness-score is-${overallStatus}`}>
          <div className="ops-readiness-label">Command readiness</div>
          <div className="ops-readiness-value">
            <strong>{readiness}</strong><span>/100</span>
          </div>
          <div className="ops-readiness-track" aria-hidden="true">
            <span style={{ width: `${readiness}%` }} />
          </div>
          <div className="ops-readiness-state"><span /> {readinessLabel}</div>
        </div>

        <div className="ops-operating-score-grid">
          {items.map((item) => (
            <article className={`ops-operating-score is-${item.status}`} key={item.label}>
              <div className="ops-operating-score-content">
                <div className="ops-operating-score-top">
                  <span>{item.label}</span>
                  <span className="ops-operating-status">{statusLabel[item.status]}</span>
                </div>
                {item.valueLabel ? <div className="ops-operating-value-label">{item.valueLabel}</div> : null}
                <strong>{item.value}</strong>
                {item.supportingValues?.length ? (
                  <div className="ops-operating-supporting-values">
                    {item.supportingValues.map((supportingValue) => (
                      <div key={supportingValue.label}>
                        <span>{supportingValue.label}</span>
                        <strong>{supportingValue.value}</strong>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="ops-operating-target">Target {item.target}</div>
                )}
              </div>
            </article>
          ))}
        </div>

        <aside className="ops-action-brief">
          <div className="ops-action-brief-head">
            <span>Priority queue</span>
            <small>{String(actions.length).padStart(2, "0")} active</small>
          </div>
          <div className="ops-action-list">
            {actions.map((action) => {
              const content = (
                <>
                  <span className={`ops-action-dot is-${action.status}`} />
                  <span>
                    <strong>{action.title}</strong>
                    <small>{action.detail}</small>
                  </span>
                  {action.href ? <span className="ops-action-arrow" aria-hidden="true">→</span> : null}
                </>
              );
              return action.href ? (
                <Link className="ops-action-item" href={action.href} key={`${action.title}-${action.href}`}>
                  {content}
                </Link>
              ) : (
                <div className="ops-action-item" key={action.title}>{content}</div>
              );
            })}
          </div>
        </aside>
      </div>
    </section>
  );
}
