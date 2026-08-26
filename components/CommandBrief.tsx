import Link from "next/link";
import type { ReactNode } from "react";
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
  date,
  slackDigest,
  map,
}: {
  metrics: CommandBriefMetric[];
  date: string;
  slackDigest: SlackDailyDigest;
  map: ReactNode;
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

      <div className={styles.workspace}>
        <SlackAlertsDigest date={date} initialDigest={slackDigest} title="Operations Feed" kicker="Today's alerts" />
        <div className={`${styles.map} ops-jobs-page ops-command-operations-map`}>{map}</div>
      </div>
    </section>
  );
}
