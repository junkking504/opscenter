import Link from "next/link";
import type { OperatingAction, OperatingStatus } from "@/components/OperatingPulse";
import styles from "./CommandBrief.module.css";

export type CommandBriefMetric = {
  label: string;
  value: string;
  detail: string;
  status: OperatingStatus;
  href: string;
};

export type CommandBriefSignal = {
  title: string;
  detail: string;
  status: OperatingStatus;
  href: string;
};

const statusLabel: Record<OperatingStatus, string> = {
  "on-track": "On track",
  watch: "Watch",
  "off-track": "Act now",
};

function toneClass(status: OperatingStatus): string {
  if (status === "on-track") return styles.onTrack;
  if (status === "watch") return styles.watch;
  return styles.offTrack;
}

export default function CommandBrief({
  readiness,
  overallStatus,
  metrics,
  signals,
  actions,
}: {
  readiness: number;
  overallStatus: OperatingStatus;
  metrics: CommandBriefMetric[];
  signals: CommandBriefSignal[];
  actions: OperatingAction[];
}) {
  return (
    <section className={styles.brief} id="command-overview" aria-labelledby="command-brief-title">
      <header className={styles.header}>
        <div>
          <div className={styles.kicker}><span /> Daily overview</div>
          <h2 id="command-brief-title">Today&apos;s command brief</h2>
          <p>{String(signals.length).padStart(2, "0")} operating signals · {String(actions.slice(0, 3).length).padStart(2, "0")} priority actions</p>
        </div>
        <div className={`${styles.readiness} ${toneClass(overallStatus)}`}>
          <span className={styles.readinessDot} />
          <div>
            <span>Readiness</span>
            <small>{statusLabel[overallStatus]}</small>
          </div>
          <strong>{readiness}<small>/100</small></strong>
        </div>
      </header>

      <div className={styles.metricStrip} aria-label="Headline operating metrics">
        {metrics.map((metric) => (
          <Link className={`${styles.metric} ${toneClass(metric.status)}`} href={metric.href} key={metric.label}>
            <div>
              <span>{metric.label}</span>
              <small>{statusLabel[metric.status]}</small>
            </div>
            <strong>{metric.value}</strong>
            <p>{metric.detail}</p>
            <b aria-hidden="true">→</b>
          </Link>
        ))}
      </div>

      <div className={styles.body}>
        <section className={styles.queue} aria-labelledby="manager-queue-title">
          <div className={styles.sectionHeader}>
            <div>
              <span>Priority actions</span>
              <h2 id="manager-queue-title">Manager Queue</h2>
            </div>
            <small>{String(actions.slice(0, 3).length).padStart(2, "0")} actions</small>
          </div>

          <div className={styles.actionList}>
            {actions.slice(0, 3).map((action, index) => {
              const content = (
                <>
                  <span>{String(index + 1).padStart(2, "0")}</span>
                  <span>
                    <strong>{action.title}</strong>
                    <small>{action.detail}</small>
                  </span>
                  <b aria-hidden="true">↗</b>
                </>
              );

              return action.href ? (
                <Link className={`${styles.action} ${toneClass(action.status)}`} href={action.href} key={`${action.title}-${action.href}`}>
                  {content}
                </Link>
              ) : (
                <div className={`${styles.action} ${toneClass(action.status)}`} key={action.title}>{content}</div>
              );
            })}
          </div>
        </section>

        <section className={styles.signals} aria-labelledby="operating-brief-title">
          <div className={styles.sectionHeader}>
            <div>
              <span>Operating status</span>
              <h2 id="operating-brief-title">Current Conditions</h2>
            </div>
            <small>{String(signals.length).padStart(2, "0")} signals</small>
          </div>

          <div className={styles.signalList}>
            {signals.map((signal) => (
              <Link className={`${styles.signal} ${toneClass(signal.status)}`} href={signal.href} key={`${signal.title}-${signal.href}`}>
                <span className={styles.signalDot} />
                <span>
                  <strong>{signal.title}</strong>
                  <small>{signal.detail}</small>
                </span>
                <em>{statusLabel[signal.status]}</em>
                <b aria-hidden="true">→</b>
              </Link>
            ))}
          </div>
        </section>
      </div>
    </section>
  );
}
