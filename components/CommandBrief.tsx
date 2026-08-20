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
            </div>
            <strong>{metric.value}</strong>
            <p>{metric.detail}</p>
            <b aria-hidden="true">→</b>
          </Link>
        ))}
      </div>

      <div className={styles.body}>
        <SlackAlertsDigest date={date} initialDigest={slackDigest} />

        <section className={styles.signals} aria-labelledby="operating-brief-title">
          <div className={styles.sectionHeader}>
            <div>
              <span>Operating Status</span>
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
