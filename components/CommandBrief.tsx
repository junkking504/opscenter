import Link from "next/link";
import type { OperatingStatus } from "@/components/OperatingPulse";
import SlackAlertsDigest from "@/components/SlackAlertsDigest";
import type { SlackDailyDigest } from "@/lib/slack-digest";
import styles from "./CommandBrief.module.css";

export type CommandBriefMetric = {
  label: string;
  value: string;
  detail: string;
  status: OperatingStatus;
  href: string;
  progress?: number;
  progressLabel?: string;
};

export type CommandBriefSignal = {
  title: string;
  detail: string;
  status: OperatingStatus;
  href: string;
};

const statusLabel: Record<OperatingStatus, string> = {
  "on-track": "On Track",
  watch: "Watch",
  "off-track": "Act Now",
};

function toneClass(status: OperatingStatus): string {
  if (status === "on-track") return styles.onTrack;
  if (status === "watch") return styles.watch;
  return styles.offTrack;
}

export default function CommandBrief({
  metrics,
  signals,
  date,
  slackDigest,
}: {
  metrics: CommandBriefMetric[];
  signals: CommandBriefSignal[];
  date: string;
  slackDigest: SlackDailyDigest;
}) {
  return (
    <section className={styles.brief} id="command-overview" aria-label="Command Overview">
      <div className={styles.metricStrip} aria-label="Headline operating metrics">
        {metrics.map((metric) => (
          <Link className={`${styles.metric} ${toneClass(metric.status)}`} href={metric.href} key={metric.label}>
            <div>
              <span>{metric.label}</span>
              <i className={styles.metricStatus} aria-label={statusLabel[metric.status]} title={statusLabel[metric.status]} />
            </div>
            <strong>{metric.value}</strong>
            <p>{metric.detail}</p>
            {metric.progress == null ? null : (
              <div
                className={styles.metricProgress}
                role="progressbar"
                aria-label={metric.progressLabel || `${metric.label} progress`}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.min(100, Math.max(0, Math.round(metric.progress)))}
              >
                <i style={{ width: `${Math.min(100, Math.max(0, metric.progress))}%` }} />
              </div>
            )}
          </Link>
        ))}
      </div>

      <div className={styles.body}>
        <section className={styles.signals} aria-labelledby="operating-brief-title">
          <div className={styles.sectionHeader}>
            <div>
              <span>Needs action</span>
              <h2 id="operating-brief-title">Priority Queue</h2>
            </div>
            <small>{String(signals.length).padStart(2, "0")} items</small>
          </div>

          <div className={styles.signalList}>
            {signals.slice(0, 3).map((signal) => (
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

      <div className={styles.lower}>
        <SlackAlertsDigest date={date} initialDigest={slackDigest} title="Operations Feed" kicker="Today's alerts" />
      </div>
    </section>
  );
}
