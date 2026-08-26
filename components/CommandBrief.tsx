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
  completedJobs,
  totalJobs,
  revenue,
  revenuePlan,
}: {
  metrics: CommandBriefMetric[];
  signals: CommandBriefSignal[];
  date: string;
  slackDigest: SlackDailyDigest;
  completedJobs: number;
  totalJobs: number;
  revenue: number;
  revenuePlan: number;
}) {
  const completionPercent = totalJobs > 0 ? Math.min(100, Math.round((completedJobs / totalJobs) * 100)) : 0;
  const revenuePercent = revenuePlan > 0 ? Math.min(100, Math.round((revenue / revenuePlan) * 100)) : 0;
  const remainingJobs = Math.max(0, totalJobs - completedJobs);

  return (
    <section className={styles.brief} id="command-overview" aria-label="Command Overview">
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

        <aside className={styles.progress} aria-labelledby="day-progress-title">
          <span id="day-progress-title">Day progress</span>
          <small>Live operational pace</small>
          <strong>{completionPercent}%</strong>
          <p>{completedJobs} of {totalJobs} jobs completed</p>
          <div className={styles.progressTrack}><i style={{ width: `${completionPercent}%` }} /></div>
          <div className={styles.milestone}>
            <span>Next milestone</span>
            <strong>{remainingJobs ? `${remainingJobs} job${remainingJobs === 1 ? "" : "s"} remaining` : "Schedule complete"}</strong>
          </div>
          <div className={styles.progressState}><i /> Revenue and staffing signals remain visible in the queue</div>
        </aside>
      </div>

      <div className={styles.lower}>
        <section className={styles.performance} aria-labelledby="command-performance-title">
          <div className={styles.sectionHeader}>
            <div>
              <span>Performance</span>
              <h2 id="command-performance-title">Revenue Pace</h2>
            </div>
            <small>{revenuePercent}% of plan</small>
          </div>
          <div className={styles.performanceBody}>
            <div><span>Actual</span><strong>${Math.round(revenue).toLocaleString("en-US")}</strong></div>
            <div><span>Plan</span><strong>${Math.round(revenuePlan).toLocaleString("en-US")}</strong></div>
            <div className={styles.performanceTrack}><i style={{ width: `${revenuePercent}%` }} /></div>
          </div>
        </section>

        <SlackAlertsDigest date={date} initialDigest={slackDigest} title="Operations Feed" kicker="Today's alerts" />
      </div>
    </section>
  );
}
